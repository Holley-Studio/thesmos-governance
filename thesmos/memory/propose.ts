// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — closing the learning loop.
 *
 * Missions produce durable knowledge; this is where that knowledge becomes
 * governed memory. Without it, recall works but the store only ever fills by
 * hand, so every new project starts amnesiac.
 *
 * The rule that shapes everything here:
 *
 *   > Automatic does not mean unquestioned.
 *
 * Extraction is deterministic — no model call. A classifier would be
 * non-reproducible, would cost a request per mission, and would be a second
 * place where "is this worth remembering?" gets decided. The structured fields
 * of an `AgentHandoff` already answer that question: a completed task with
 * evidence refs and passing tests is exactly the shape of a fact worth keeping,
 * and an unresolved risk is exactly the shape of one that is not yet a fact.
 *
 * Every proposal still passes `validateMemoryProposal`, so nothing here can
 * bypass secret detection, scope containment or provenance requirements.
 */

import type { AgentHandoff, AgentTestResult } from '../council/handoff.js';
import type { Mission, MissionState } from '../mission/types.js';
import { lexicalSimilarity } from './retrieve.js';
import type { MemoryStore } from './store.js';
import type {
  MemoryConfidence,
  MemoryProposal,
  MemoryRecord,
  MemoryType,
} from './types.js';

/**
 * Content that is never worth persisting.
 *
 * These are the shapes that make a memory store useless: conversational
 * filler, raw logs, and restatements of what the mission was asked to do. A
 * store full of "Done!" teaches nothing and crowds out the records that do.
 */
const FILLER =
  /^\s*(ok(ay)?|done|complete[d]?|success(ful)?|finished|no changes|nothing to do|n\/?a|todo|wip|see above|as requested)\s*[.!]?\s*$/i;

/** A summary shorter than this cannot carry a durable fact. */
const MIN_CONTENT_CHARS = 24;

/**
 * Above this, a "summary" is a pasted log rather than a finding.
 *
 * Well below the 4000-char record ceiling on purpose: the ceiling exists to
 * bound storage, this exists to keep *quality* high. A 1200-character summary
 * is already a document, not a fact.
 */
const MAX_SUMMARY_CHARS = 1200;

/** Log-shaped text: many lines, timestamps, stack frames. */
function looksLikeLog(text: string): boolean {
  const lines = text.split(/\r?\n/);
  if (lines.length > 12) return true;
  if (/^\s*at\s+\S+\s+\(/m.test(text)) return true;
  if (/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(text)) return true;
  return false;
}

/** Fenced code or diff hunks — Git already stores code. */
function looksLikeCode(text: string): boolean {
  return /```/.test(text) || /^\s*[+-]{3}\s+\S+/m.test(text) || /^@@ -\d+/m.test(text);
}

/**
 * Is this summary worth remembering at all?
 *
 * Rejecting generously is correct: a missed memory costs one retrieval that
 * finds nothing, while a junk memory costs budget on every future mission and
 * dilutes ranking for everything else.
 */
export function isDurableContent(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_CONTENT_CHARS) return false;
  if (trimmed.length > MAX_SUMMARY_CHARS) return false;
  if (FILLER.test(trimmed)) return false;
  if (looksLikeLog(trimmed)) return false;
  if (looksLikeCode(trimmed)) return false;
  return true;
}

/**
 * Confidence from test evidence.
 *
 * `verified` requires tests that actually ran and passed. A handoff that merely
 * claims success without a passing suite is `high` at best — the distinction is
 * the whole reason confidence exists, and inflating it here would make
 * `verified` meaningless everywhere else.
 */
export function confidenceFromTests(tests: readonly AgentTestResult[]): MemoryConfidence {
  if (tests.length === 0) return 'high';
  // `errored` counts against confidence exactly like `failed`: a suite that
  // crashed proved nothing, and treating it as merely "not passed" would let a
  // broken run masquerade as weak evidence rather than no evidence.
  if (tests.some((t) => t.status === 'failed' || t.status === 'errored')) return 'low';
  const passed = tests.filter((t) => t.status === 'passed');
  if (passed.length === 0) return 'medium';
  // A suite reporting counts is stronger evidence than a bare "passed".
  return passed.some((t) => typeof t.passed === 'number' && t.passed > 0) ? 'verified' : 'high';
}

/**
 * Classify what kind of claim a summary makes.
 *
 * Keyword-driven and intentionally shallow. It only has to separate a durable
 * decision from an incidental observation; getting that wrong costs ranking
 * weight, not correctness, and every type still carries full provenance.
 */
export function classifySummary(summary: string): MemoryType {
  const s = summary.toLowerCase();
  if (/\b(decided|decision|we will|going forward|standardi[sz]ed on|chose|adopted)\b/.test(s)) {
    return 'architecture-decision';
  }
  if (/\b(must|never|always|require[sd]?|forbidden|do not|policy)\b/.test(s)) return 'constraint';
  if (/\b(procedure|steps?|runbook|to (fix|repair|reproduce)|process for|workflow)\b/.test(s)) {
    return 'procedure';
  }
  return 'observation';
}

export interface ProposalContext {
  repoId?: string;
  projectId?: string;
  /** Scope for produced records. Never wider than `mission`. */
  scope?: 'repository' | 'project' | 'mission';
}

/**
 * Derive candidate memories from one completed handoff.
 *
 * A failed or blocked task produces nothing: recording what a failed attempt
 * *claimed* as though it were an outcome is how a memory store starts asserting
 * things that never happened. Failed missions are still useful — but as
 * unresolved risks, below, not as observations.
 */
export function proposeFromHandoff(
  handoff: AgentHandoff,
  context: ProposalContext = {},
): MemoryProposal[] {
  const proposals: MemoryProposal[] = [];
  const scope = context.scope ?? 'repository';

  const evidenceRef = handoff.evidenceRefs[0];
  const hasEvidence = Boolean(evidenceRef);

  if (handoff.status === 'complete' && isDurableContent(handoff.summary)) {
    // `observed` demands evidence; without it the claim is `stated` at best.
    // Silently upgrading an unbacked claim to "observed" is exactly what the
    // write validator rejects, and it is right to.
    proposals.push({
      scope,
      type: classifySummary(handoff.summary),
      content: handoff.summary.trim(),
      provenance: {
        sourceKind: 'mission',
        sourceId: handoff.missionId,
        creator: handoff.agentId,
        derivation: hasEvidence ? 'observed' : 'stated',
        evidenceRef,
      },
      confidence: confidenceFromTests(handoff.testResults),
      sensitivity: 'project',
      repoId: context.repoId,
      projectId: context.projectId,
      missionId: handoff.missionId,
      metadata: {
        taskId: handoff.taskId,
        changedFiles: handoff.changedFiles.slice(0, 20),
      },
    });
  }

  // Unresolved risks are hypotheses, never observations — nobody verified them,
  // and a risk recorded as fact becomes a phantom constraint on future work.
  for (const risk of handoff.unresolvedRisks) {
    if (!isDurableContent(risk)) continue;
    proposals.push({
      scope,
      type: 'hypothesis',
      content: risk.trim(),
      provenance: {
        sourceKind: 'mission',
        sourceId: handoff.missionId,
        creator: handoff.agentId,
        derivation: 'inferred',
      },
      // Deliberately capped: an unresolved risk can never be `verified`, and
      // the validator enforces that independently.
      confidence: 'medium',
      sensitivity: 'project',
      repoId: context.repoId,
      projectId: context.projectId,
      missionId: handoff.missionId,
      metadata: { taskId: handoff.taskId, kind: 'unresolved-risk' },
    });
  }

  return proposals;
}

/**
 * Derive candidates from a whole mission.
 *
 * Handoffs are read in task-id order so the same mission always produces the
 * same proposals in the same order — proposal generation must not be a source
 * of nondeterminism in an otherwise deterministic runtime.
 */
export function proposeFromMission(
  mission: Mission,
  state: MissionState,
  handoffs: readonly AgentHandoff[],
  context: ProposalContext = {},
): MemoryProposal[] {
  const completed = new Set(
    state.tasks.filter((t) => t.status === 'complete').map((t) => t.taskId),
  );

  return [...handoffs]
    .filter((h) => completed.has(h.taskId))
    .sort((a, b) => a.taskId.localeCompare(b.taskId))
    .flatMap((h) => proposeFromHandoff(h, { ...context, projectId: context.projectId }))
    .map((p) => ({ ...p, missionId: mission.id }));
}

/** Outcome of committing one proposal. */
export interface CommitOutcome {
  proposal: MemoryProposal;
  status: 'stored' | 'duplicate' | 'rejected' | 'needs-review';
  /** Id of the stored record, or of the duplicate it matched. */
  recordId?: string;
  reason?: string;
  /** Ids this record superseded, when supersession was proposed. */
  superseded?: string[];
}

/**
 * Should this proposal be written without asking?
 *
 * The gate from the mission brief: low sensitivity, project scoped, evidence
 * backed, non-secret, high confidence. Anything else is still *stored* — but as
 * a record a human should look at, not one presented as settled truth.
 *
 * Note this deliberately does not invent a second approval system: the existing
 * write validator remains the authority on whether a record may exist at all.
 * This only decides whether it may exist *unreviewed*.
 */
export function qualifiesForAutoWrite(proposal: MemoryProposal): boolean {
  if (proposal.sensitivity !== 'public' && proposal.sensitivity !== 'project') return false;
  if (proposal.scope === 'global' || proposal.scope === 'workspace') return false;
  if (proposal.type === 'hypothesis') return false;
  if (proposal.confidence !== 'high' && proposal.confidence !== 'verified') return false;
  return Boolean(proposal.provenance.evidenceRef || proposal.provenance.sourceId);
}

/** Near-identical existing record, if any. */
function findDuplicate(
  proposal: MemoryProposal,
  existing: readonly MemoryRecord[],
  threshold: number,
): MemoryRecord | undefined {
  return existing.find(
    (r) =>
      r.status === 'active' &&
      r.type === proposal.type &&
      lexicalSimilarity(r.content, proposal.content) >= threshold,
  );
}

/**
 * Detect a record this proposal supersedes.
 *
 * Requires the *same subject* with *different content* — similar enough to be
 * about the same thing, not so similar that it is merely a restatement. Both
 * bounds matter: too loose and unrelated records get retired, too tight and
 * stale facts survive alongside their corrections.
 *
 * Only durable governance types supersede. An observation about one CI run does
 * not retire an observation about another.
 */
function findSuperseded(
  proposal: MemoryProposal,
  existing: readonly MemoryRecord[],
): MemoryRecord[] {
  const SUPERSEDABLE: MemoryType[] = ['architecture-decision', 'constraint', 'procedure'];
  if (!SUPERSEDABLE.includes(proposal.type)) return [];

  return existing.filter((r) => {
    if (r.status !== 'active' || r.type !== proposal.type) return false;
    const overlap = lexicalSimilarity(r.content, proposal.content);
    return overlap >= 0.45 && overlap < 0.85;
  });
}

export interface CommitOptions {
  /** Above this similarity a proposal is treated as already known. */
  duplicateThreshold?: number;
  /** Propose supersession of stale governance records. Default true. */
  supersede?: boolean;
}

/**
 * Validate, deduplicate, supersede and store.
 *
 * Reads the store once and tracks newly-stored records in memory, so a batch
 * containing two near-identical proposals stores one — re-reading per proposal
 * would be O(n²) on a linear-scan store and still miss same-batch duplicates.
 */
export function commitProposals(
  store: MemoryStore,
  proposals: readonly MemoryProposal[],
  validate: (proposal: MemoryProposal) => { decision: string; issues: Array<{ message: string }> },
  options: CommitOptions = {},
): CommitOutcome[] {
  const duplicateThreshold = options.duplicateThreshold ?? 0.85;
  const supersede = options.supersede ?? true;

  const known: MemoryRecord[] = [...store.all()];
  const outcomes: CommitOutcome[] = [];

  for (const proposal of proposals) {
    const validation = validate(proposal);
    if (validation.decision === 'reject') {
      outcomes.push({
        proposal,
        status: 'rejected',
        reason: validation.issues.map((i) => i.message).join('; '),
      });
      continue;
    }

    const duplicate = findDuplicate(proposal, known, duplicateThreshold);
    if (duplicate) {
      outcomes.push({ proposal, status: 'duplicate', recordId: duplicate.id });
      continue;
    }

    const stale = supersede ? findSuperseded(proposal, known) : [];
    const record = store.append({
      ...proposal,
      supersedes: stale.length > 0 ? stale.map((r) => r.id) : undefined,
    });

    // Mirror the store's supersession into the local view so a later proposal
    // in this same batch cannot match an already-retired record.
    for (const old of stale) {
      const index = known.findIndex((r) => r.id === old.id);
      if (index !== -1) known[index] = { ...known[index], status: 'superseded' };
    }
    known.push(record);

    outcomes.push({
      proposal,
      status: qualifiesForAutoWrite(proposal) ? 'stored' : 'needs-review',
      recordId: record.id,
      superseded: stale.length > 0 ? stale.map((r) => r.id) : undefined,
    });
  }

  return outcomes;
}
