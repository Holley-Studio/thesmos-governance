// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Context Intelligence — the one place Thesmos decides what a provider sees.
 *
 * Composes the existing repo-evidence capsule (`context-capsule.ts`) with
 * governed recall (`memory/`) and returns a single bounded capsule. It is
 * re-exported from `context-capsule.ts`, so there remains one import surface
 * and one canonical context-construction path.
 *
 * It lives in its own file rather than inside `context-capsule.ts` for two
 * reasons: that module is a repo-state snapshot with a different lifecycle, and
 * merging them would push a single file past the repo's 800-line threshold.
 * This is composition, not a competing context system — nothing here re-derives
 * repo evidence or re-implements retrieval.
 *
 * The architectural rule it exists to enforce:
 *
 *   > Provider adapters never decide what historical context to send.
 *   > Thesmos decides, before dispatch.
 *
 * Authority hierarchy, highest first — memory is always last:
 *
 *   SYSTEM POLICY → THESMOS GOVERNANCE → CURRENT USER INTENT
 *     → CURRENT VERIFIED EVIDENCE → RETRIEVED GOVERNED MEMORY
 */

import { createHash } from 'node:crypto';
import { estimateTokens } from './token-budget.js';
import { MnemosyneService } from './memory/service.js';
import { renderMemoryCapsule } from './memory/capsule.js';
import { lexicalSimilarity } from './memory/retrieve.js';
import { DEFAULT_MEMORY_BUDGET, type MemoryScope, type MemorySearchResult } from './memory/types.js';
import type { EmbeddingContext } from './memory/embeddings.js';
import type { MemoryConflict } from './memory/types.js';

/** What a caller is allowed to retrieve, derived from authority — never asked for. */
export interface ContextAuthority {
  /** Widest scope this caller may read. A child never widens its parent's. */
  maxScope: MemoryScope;
  repoId?: string;
  projectId?: string;
  missionId?: string;
}

export interface ContextBudget {
  /** Ceiling on estimated tokens memory may contribute. */
  maxMemoryTokens: number;
  maxMemories: number;
  /** Below this composite rank a candidate is never injected. */
  minRelevance: number;
  /**
   * Minimum raw topical similarity, checked *separately* from the composite
   * rank — and the check that actually does the work.
   *
   * The composite score sums similarity with type, confidence, provenance and
   * recency weights. Those non-similarity terms alone floor an authoritative
   * record near 0.5, so a `minRelevance` gate can never exclude a well-attested
   * memory about a completely unrelated subject. That is the wrong model:
   * authority should decide *which of the relevant* records matter most, not
   * manufacture relevance for an irrelevant one.
   *
   * Calibrated for lexical overlap, where an unrelated record scores 0 and a
   * genuine match scores ~0.2–0.4. Semantic callers should raise it — cosine
   * similarity is generously high even for loosely related text.
   */
  minSimilarity: number;
}

/**
 * Defaults chosen to be small.
 *
 * Memory is opportunistic: mandatory current evidence must never be dropped to
 * fit more history. 1500 tokens is roughly a page — enough for the handful of
 * decisions that actually matter, far too little to smuggle a transcript in.
 */
export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxMemoryTokens: 1500,
  maxMemories: DEFAULT_MEMORY_BUDGET.maxRecords,
  minRelevance: 0.35,
  minSimilarity: 0.08,
};

export interface ContextRequest {
  root: string;
  /** Free-text intent — the user's request, mission title, or task title. */
  query: string;
  authority: ContextAuthority;
  budget?: ContextBudget;
  /** Text already going to the provider. Memory duplicating it is dropped. */
  currentEvidence?: string;
  /** Absent means lexical retrieval. */
  embedding?: EmbeddingContext;
  /** Force recall on or off, overriding the deterministic policy. */
  recall?: boolean;
  signal?: AbortSignal;
}

export type ExclusionReason =
  | 'below-relevance-threshold'
  | 'duplicates-current-evidence'
  | 'exceeds-token-budget'
  | 'exceeds-record-budget';

export interface ExcludedMemory {
  id: string;
  reason: ExclusionReason;
  relevanceScore: number;
}

export interface ContextDiagnostics {
  recallAttempted: boolean;
  /** Why recall did or did not run — always populated, for `context:explain`. */
  recallReason: string;
  candidates: number;
  included: number;
  excluded: ExcludedMemory[];
  conflicts: MemoryConflict[];
  /** ESTIMATE. See `estimateTokens`. Never report as measured. */
  memoryTokensEstimate: number;
  memoryChars: number;
  retrievalMs: number;
  embeddingMs?: number;
  embeddingUsed: boolean;
  /** True when the store was missing or recall threw — context still built. */
  degraded: boolean;
}

export interface ContextResult {
  /** The memory block, already fenced and sanitized. Empty when nothing qualified. */
  memoryCapsule: string;
  included: MemorySearchResult[];
  diagnostics: ContextDiagnostics;
  /** Stable id list for receipts — ids and hashes, never full content. */
  memoryIds: string[];
}

/**
 * Signals that a request benefits from project history.
 *
 * Deterministic on purpose. An LLM classifier here would add a model call, a
 * failure mode and nondeterminism to a decision that is well served by asking
 * "is this about continuing something?".
 */
const RECALL_SIGNALS =
  /\b(continue|continuing|resume|again|still|previous|prior|earlier|last\s+time|fix|failing|failure|regress|incident|migration|migrate|deploy|deployment|certif|architect|decision|constraint|convention|why\s+did|pick\s+up|follow[-\s]?up|blocked|blocker)\b/i;

/** Requests that are self-contained — history would be pure cost. */
const TRIVIAL_SIGNALS =
  /^\s*(format|rename|indent|prettify|lowercase|uppercase|capitali[sz]e|sort)\b/i;

export interface RecallDecision {
  recall: boolean;
  reason: string;
}

/**
 * Decide whether to spend a retrieval on this request.
 *
 * Requires a project identity: without one, any retrieval risks pulling another
 * repository's memory, and no amount of semantic similarity makes that
 * permissible. Failing to recall is cheap; leaking across projects is not.
 */
export function shouldRecall(request: ContextRequest): RecallDecision {
  if (request.recall === false) return { recall: false, reason: 'recall explicitly disabled' };
  if (request.recall === true) return { recall: true, reason: 'recall explicitly requested' };

  const { repoId, projectId } = request.authority;
  if (!repoId && !projectId) {
    return {
      recall: false,
      reason: 'no repository or project identity — retrieving without one risks cross-project context',
    };
  }

  const query = request.query.trim();
  if (query.length < 8) {
    return { recall: false, reason: 'query too short to retrieve meaningfully' };
  }
  if (TRIVIAL_SIGNALS.test(query)) {
    return { recall: false, reason: 'self-contained transformation — history adds cost, not signal' };
  }
  if (RECALL_SIGNALS.test(query)) {
    return { recall: true, reason: 'request references prior work, a failure, or a decision' };
  }
  // Default on: a missed recall is a silent regression to the old behaviour,
  // and the budget already bounds the cost of an unhelpful one.
  return { recall: true, reason: 'project-scoped request — recall within budget' };
}

/**
 * Build a compact retrieval query from mission/task signals.
 *
 * Not the raw prompt: embedding a whole transcript is slow, costs tokens, and
 * dilutes the signal that actually selects records. Long input is truncated to
 * its first sentences, which carry the intent.
 */
export function deriveQuery(parts: {
  missionTitle?: string;
  missionIntent?: string;
  taskTitle?: string;
  taskIntent?: string;
  userRequest?: string;
}): string {
  const ordered = [
    parts.taskTitle,
    parts.taskIntent,
    parts.missionTitle,
    parts.missionIntent,
    parts.userRequest,
  ].filter((p): p is string => Boolean(p?.trim()));

  const joined = [...new Set(ordered.map((p) => p.trim()))].join('. ');
  if (joined.length <= 400) return joined;

  // Keep whole sentences rather than cutting mid-word.
  const clipped = joined.slice(0, 400);
  const lastStop = clipped.lastIndexOf('.');
  return lastStop > 120 ? clipped.slice(0, lastStop + 1) : clipped;
}

/**
 * Build governed context for one request.
 *
 * Never throws. A missing store, an unreachable embedding provider or a failed
 * recall all degrade to "no memory this turn" with `degraded: true` — memory
 * must improve Thesmos, never become a dependency that can stop it.
 *
 * Read-only: retrieval never writes, so a context build cannot mutate memory
 * as a side effect and parallel tasks cannot race on the store.
 */
export async function buildMissionContext(request: ContextRequest): Promise<ContextResult> {
  const budget = request.budget ?? DEFAULT_CONTEXT_BUDGET;
  const decision = shouldRecall(request);

  const empty = (reason: string, degraded = false): ContextResult => ({
    memoryCapsule: '',
    included: [],
    memoryIds: [],
    diagnostics: {
      recallAttempted: false,
      recallReason: reason,
      candidates: 0,
      included: 0,
      excluded: [],
      conflicts: [],
      memoryTokensEstimate: 0,
      memoryChars: 0,
      retrievalMs: 0,
      embeddingUsed: false,
      degraded,
    },
  });

  if (!decision.recall) return empty(decision.reason);

  let outcome;
  try {
    const service = new MnemosyneService(request.root, {
      // Reads never write, so no secret patterns are needed here; the write
      // path owns that check.
      secretPatterns: [],
      repoId: request.authority.repoId,
      maxScope: request.authority.maxScope,
    });
    outcome = await service.recall({
      text: request.query,
      scope: request.authority.maxScope,
      repoId: request.authority.repoId,
      projectId: request.authority.projectId,
      missionId: request.authority.missionId,
      // Over-fetch, then filter on relevance: "top K" is not "relevant".
      limit: Math.max(budget.maxMemories * 3, 20),
      embedding: request.embedding,
      signal: request.signal,
    });
  } catch {
    return empty('memory store unavailable — continuing without recall', true);
  }

  const excluded: ExcludedMemory[] = [];
  const included: MemorySearchResult[] = [];
  let tokens = 0;

  for (const candidate of outcome.results) {
    const id = candidate.memory.id;

    // Topical similarity first: an authoritative memory about an unrelated
    // subject is still unrelated, and its authority must not buy it a place.
    if (candidate.similarity < budget.minSimilarity || candidate.relevanceScore < budget.minRelevance) {
      excluded.push({ id, reason: 'below-relevance-threshold', relevanceScore: candidate.relevanceScore });
      continue;
    }

    // Current evidence outranks a memory restating it — the live file is the
    // truth, and paying tokens for a historical echo of it is pure waste.
    if (
      request.currentEvidence &&
      lexicalSimilarity(candidate.memory.content, request.currentEvidence) >= 0.6
    ) {
      excluded.push({ id, reason: 'duplicates-current-evidence', relevanceScore: candidate.relevanceScore });
      continue;
    }

    if (included.length >= budget.maxMemories) {
      excluded.push({ id, reason: 'exceeds-record-budget', relevanceScore: candidate.relevanceScore });
      continue;
    }

    const cost = estimateTokens(candidate.memory.content);
    if (tokens + cost > budget.maxMemoryTokens) {
      excluded.push({ id, reason: 'exceeds-token-budget', relevanceScore: candidate.relevanceScore });
      continue;
    }

    included.push(candidate);
    tokens += cost;
  }

  // Conflicts are computed over what is actually injected: warning about a
  // contradiction the model will never see is noise.
  const conflicts = outcome.capsule.conflicts.filter((c) =>
    included.some((r) => r.memory.id === c.a.id) && included.some((r) => r.memory.id === c.b.id),
  );

  const rendered = renderMemoryCapsule(included, conflicts);

  return {
    memoryCapsule: rendered.text,
    included,
    memoryIds: included.map((r) => r.memory.id),
    diagnostics: {
      recallAttempted: true,
      recallReason: decision.reason,
      candidates: outcome.telemetry.candidatesConsidered,
      included: included.length,
      excluded,
      conflicts,
      memoryTokensEstimate: estimateTokens(rendered.text),
      memoryChars: rendered.chars,
      retrievalMs: outcome.telemetry.retrievalMs,
      embeddingMs: outcome.telemetry.embeddingMs,
      embeddingUsed: outcome.telemetry.embeddingUsed,
      degraded: false,
    },
  };
}

/**
 * Assemble the final provider-visible text.
 *
 * Order is the authority hierarchy and is not configurable: memory is appended
 * last so that nothing in it can precede — and therefore appear to qualify —
 * policy, user intent, or current evidence. A stale memory saying "deploy
 * automatically" sits below a policy saying approval is required, and policy
 * wins because it was stated first and memory is explicitly labelled as
 * non-authoritative data.
 */
/**
 * Condense a context decision into receipt evidence.
 *
 * Carries ids, counts, reasons and a hash — never content. Enough to prove
 * which memories influenced an execution and why the rest did not, without
 * duplicating the memory store into the audit log.
 */
export function toReceiptEvidence(result: ContextResult): {
  includedIds: string[];
  candidates: number;
  excluded: Array<{ id: string; reason: string }>;
  capsuleHash?: string;
  tokensEstimate: number;
  degraded: boolean;
} {
  return {
    includedIds: result.memoryIds,
    candidates: result.diagnostics.candidates,
    excluded: result.diagnostics.excluded.map((e) => ({ id: e.id, reason: e.reason })),
    capsuleHash: result.memoryCapsule
      ? createHash('sha256').update(result.memoryCapsule, 'utf8').digest('hex')
      : undefined,
    tokensEstimate: result.diagnostics.memoryTokensEstimate,
    degraded: result.diagnostics.degraded,
  };
}

export function assembleContext(sections: {
  systemPolicy?: string;
  governance?: string;
  userIntent?: string;
  currentEvidence?: string;
  memoryCapsule?: string;
}): string {
  const parts: string[] = [];
  const push = (heading: string, body: string | undefined): void => {
    if (body?.trim()) parts.push(`## ${heading}\n${body.trim()}`);
  };

  push('SYSTEM POLICY', sections.systemPolicy);
  push('THESMOS GOVERNANCE', sections.governance);
  push('CURRENT USER INTENT', sections.userIntent);
  push('CURRENT VERIFIED EVIDENCE', sections.currentEvidence);

  // Not wrapped in a `##` heading: it carries its own fence and its own
  // "this is data" preamble from renderMemoryCapsule.
  if (sections.memoryCapsule?.trim()) parts.push(sections.memoryCapsule.trim());

  return parts.join('\n\n');
}
