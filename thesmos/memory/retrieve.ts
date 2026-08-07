// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — retrieval and ranking.
 *
 * Deliberately deterministic. Given the same store and query, the same records
 * come back in the same order, every time. A learned ranker would be harder to
 * justify, impossible to test, and would make "why was this in my context?"
 * unanswerable — which is the question this subsystem must always be able to
 * answer.
 *
 * Similarity is never the final authority. A ten-month-old superseded guess can
 * be lexically closer to a query than the current architectural decision, so
 * cosine distance is one weighted input among several.
 *
 * Pure: records and a query in, ranked results out. Embedding I/O happens in
 * `embeddings.ts`; this module only consumes vectors it is handed.
 */

import {
  CONFIDENCE_WEIGHT,
  MEMORY_SCOPE_ORDER,
  type MemoryConflict,
  type MemoryRecord,
  type MemoryScope,
  type MemorySearchResult,
  type MemoryType,
} from './types.js';

/** Cosine similarity. Returns 0 for mismatched or degenerate vectors. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  // Length mismatch means different vector spaces. Comparing them anyway would
  // return a plausible number, which is worse than returning nothing.
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Lexical fallback for when no embedding provider is available.
 *
 * Jaccard overlap on lowercased word sets. Crude by design — it exists so the
 * system degrades to "still useful" rather than "returns nothing" when Ollama
 * is offline, and it is never presented as semantic search.
 */
export function lexicalSimilarity(query: string, content: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2),
    );
  const q = tokenize(query);
  const c = tokenize(content);
  if (q.size === 0 || c.size === 0) return 0;
  let shared = 0;
  for (const word of q) if (c.has(word)) shared++;
  return shared / new Set([...q, ...c]).size;
}

/** Type weighting. Durable decisions outrank incidental observations. */
const TYPE_WEIGHT: Readonly<Record<MemoryType, number>> = {
  'user-decision': 1,
  'architecture-decision': 1,
  constraint: 0.95,
  procedure: 0.9,
  observation: 0.7,
  summary: 0.65,
  // An inference must never outrank a stated fact on type alone.
  hypothesis: 0.4,
  ephemeral: 0.25,
};

export interface MemoryQuery {
  text: string;
  /** Narrowest scope the caller is authorized to read. */
  scope?: MemoryScope;
  repoId?: string;
  projectId?: string;
  missionId?: string;
  limit?: number;
  /** Include superseded/expired records. Off by default — stale is not truth. */
  includeInactive?: boolean;
  /** Minimum final relevance to return at all. */
  minRelevance?: number;
}

/** Vector lookup for one namespace, supplied by the caller. */
export type VectorLookup = (memoryId: string) => readonly number[] | undefined;

function isExpired(record: MemoryRecord, now: Date): boolean {
  const expiresAt = record.retention?.expiresAt;
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) && parsed <= now.getTime();
}

/**
 * Scope and project isolation.
 *
 * The rule that prevents one repository contaminating another: a record
 * carrying a `repoId` is only visible to a query for that repo. A record
 * without one is scope-global knowledge and stays visible.
 */
export function isVisible(record: MemoryRecord, query: MemoryQuery): boolean {
  if (record.repoId && query.repoId && record.repoId !== query.repoId) return false;
  if (record.projectId && query.projectId && record.projectId !== query.projectId) return false;

  // Mission/session records are private to their mission unless it is the one asking.
  if (record.scope === 'mission' && record.missionId && query.missionId !== record.missionId) {
    return false;
  }

  if (query.scope) {
    const recordRank = MEMORY_SCOPE_ORDER.indexOf(record.scope);
    const queryRank = MEMORY_SCOPE_ORDER.indexOf(query.scope);
    // A query may read its own scope and anything wider, never anything narrower.
    if (recordRank === -1 || queryRank === -1) return false;
    if (recordRank > queryRank) return false;
  }
  return true;
}

/** Recency decay over ~180 days, floored so old decisions never hit zero. */
function recencyWeight(record: MemoryRecord, now: Date): number {
  const updated = Date.parse(record.updatedAt || record.createdAt);
  if (!Number.isFinite(updated)) return 0.5;
  const days = Math.max(0, (now.getTime() - updated) / 86_400_000);
  return Math.max(0.35, 1 - days / 180);
}

/** Provenance quality — observed-with-evidence beats an unattributed inference. */
function provenanceWeight(record: MemoryRecord): number {
  switch (record.provenance?.derivation) {
    case 'observed':
      return 1;
    case 'stated':
      return 0.95;
    case 'consolidated':
      return 0.85;
    case 'inferred':
      return 0.6;
    default:
      return 0.5;
  }
}

/**
 * Rank candidates.
 *
 * Weighting is explicit and summed rather than multiplied so one weak factor
 * cannot zero out an otherwise strong record, and every contribution is
 * reportable in `reasons`.
 */
export function rankMemories(
  records: readonly MemoryRecord[],
  query: MemoryQuery,
  vectorFor?: VectorLookup,
  queryVector?: readonly number[],
  now: Date = new Date(),
): MemorySearchResult[] {
  const results: MemorySearchResult[] = [];
  const semantic = Boolean(queryVector && vectorFor);

  for (const record of records) {
    if (!isVisible(record, query)) continue;

    const inactive = record.status !== 'active' || isExpired(record, now);
    if (inactive && !query.includeInactive) continue;

    let similarity = 0;
    const reasons: string[] = [];

    if (semantic) {
      const vector = vectorFor!(record.id);
      if (vector) {
        similarity = cosineSimilarity(queryVector!, vector);
        reasons.push(`semantic similarity ${similarity.toFixed(3)}`);
      } else {
        // No vector yet — fall back rather than dropping the record entirely,
        // or a partially-indexed store would look empty.
        similarity = lexicalSimilarity(query.text, record.content);
        reasons.push(`lexical fallback ${similarity.toFixed(3)} (not embedded)`);
      }
    } else {
      similarity = lexicalSimilarity(query.text, record.content);
      reasons.push(`lexical ${similarity.toFixed(3)}`);
    }

    const confidence = CONFIDENCE_WEIGHT[record.confidence] ?? 0.5;
    const type = TYPE_WEIGHT[record.type] ?? 0.5;
    const recency = recencyWeight(record, now);
    const provenance = provenanceWeight(record);

    let relevance =
      similarity * 0.45 + type * 0.2 + confidence * 0.15 + provenance * 0.1 + recency * 0.1;

    reasons.push(`type ${record.type} (${type})`, `confidence ${record.confidence}`);

    if (inactive) {
      // Included only because the caller asked; must never outrank live truth.
      relevance *= 0.3;
      reasons.push(`${record.status === 'active' ? 'expired' : record.status} — heavily demoted`);
    }

    if (query.missionId && record.missionId === query.missionId) {
      relevance = Math.min(1, relevance + 0.05);
      reasons.push('same mission');
    }

    results.push({ memory: record, similarity, relevanceScore: relevance, reasons });
  }

  const minRelevance = query.minRelevance ?? 0;
  return results
    .filter((r) => r.relevanceScore >= minRelevance)
    // Ties break on id so ordering is stable across runs — a flapping order
    // would make retrieval non-reproducible and untestable.
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.memory.id.localeCompare(b.memory.id))
    .slice(0, query.limit ?? 10);
}

/**
 * Drop near-duplicates so one repeated fact cannot consume the budget.
 *
 * Keeps the highest-ranked of each near-identical group; the survivor records
 * how many it stood in for, so nothing silently vanishes.
 */
export function deduplicate(
  results: readonly MemorySearchResult[],
  threshold = 0.82,
): MemorySearchResult[] {
  const kept: MemorySearchResult[] = [];
  for (const candidate of results) {
    const duplicate = kept.find(
      (k) => lexicalSimilarity(k.memory.content, candidate.memory.content) >= threshold,
    );
    if (duplicate) {
      duplicate.reasons.push('absorbed a near-duplicate');
      continue;
    }
    kept.push(candidate);
  }
  return kept;
}

/**
 * Words that carry polarity rather than subject matter.
 *
 * Excluded from the subject-overlap comparison: two statements that disagree
 * naturally share their polarity vocabulary ("...requires approval" vs
 * "...without approval" both contain "approval"-adjacent modal words), and
 * counting those as shared subject inflates similarity for the wrong reason.
 */
const POLARITY_WORDS = new Set([
  'never',
  'not',
  'cannot',
  'without',
  'must',
  'always',
  'require',
  'requires',
  'required',
  'may',
  'automatically',
  'optional',
  'mandatory',
  'need',
  'needs',
  'allowed',
  'forbidden',
]);

/**
 * Explicit waivers.
 *
 * Tested before the requirement check, because a negated modal reads as a
 * requirement to any naive keyword match: "must not require approval" contains
 * "must", and "never requires review" contains "requires". Order matters here.
 */
const WAIVER =
  /\b(must\s+not|shall\s+not|should\s+not|do(?:es)?\s+not\s+require|not\s+require[sd]?|no\s+longer\s+require[sd]?|never\s+require[sd]?|not\s+required|no\s+approval|without\s+\w+|automatically|optional)\b/i;

/**
 * "Never do X without Y" — a double negative that *asserts* Y is required.
 *
 * Checked before WAIVER because the sentence contains "without", which on its
 * own reads as a waiver and inverts the meaning completely. This is the single
 * most common way a real requirement gets written down.
 */
const DOUBLE_NEGATIVE = /\b(never|not|don'?t|do\s+not|no)\b[^.!?]*\bwithout\b/i;

/** Does the statement assert that something is required? */
function assertsRequirement(text: string): boolean {
  if (DOUBLE_NEGATIVE.test(text)) return true;
  if (WAIVER.test(text)) return false;
  return /\b(must|requires?|required|always|mandatory|needs?)\b/i.test(text);
}

/** Does the statement assert that something is *not* required? */
function assertsPermission(text: string): boolean {
  if (DOUBLE_NEGATIVE.test(text)) return false;
  if (WAIVER.test(text)) return true;
  return /\b(may|can)\b/i.test(text);
}

/** Subject overlap with polarity vocabulary removed. */
function subjectOverlap(a: string, b: string): number {
  const subject = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 2 && !POLARITY_WORDS.has(w)),
    );
  const sa = subject(a);
  const sb = subject(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const word of sa) if (sb.has(word)) shared++;
  // Overlap coefficient rather than Jaccard: two statements about the same
  // subject at different lengths should still register as the same subject.
  return shared / Math.min(sa.size, sb.size);
}

/**
 * Polarity-aware conflict detection.
 *
 * Fires when two active, well-trusted governance records describe the same
 * subject with opposite requirement polarity — "deployment requires approval"
 * against "deployment may run automatically".
 *
 * Deliberately narrow. A broad heuristic would cry conflict constantly and
 * train everyone to ignore the warning, which is worse than silence. It
 * therefore *will* miss subtly-worded contradictions; that is an accepted
 * trade, documented rather than hidden, and the reason conflicts are surfaced
 * for a human rather than auto-resolved.
 *
 * An earlier version tested "does exactly one statement contain a negator",
 * which cancelled out whenever both sentences happened to contain a word like
 * "without" — precisely the canonical case it existed to catch.
 */
export function detectConflicts(records: readonly MemoryRecord[]): MemoryConflict[] {
  const conflicts: MemoryConflict[] = [];

  const eligible = records.filter(
    (r) =>
      r.status === 'active' &&
      (r.confidence === 'high' || r.confidence === 'verified') &&
      (r.type === 'user-decision' || r.type === 'architecture-decision' || r.type === 'constraint'),
  );

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i];
      const b = eligible[j];
      // Already reconciled — supersession is the resolution, not a conflict.
      if (a.supersededBy?.includes(b.id) || b.supersededBy?.includes(a.id)) continue;

      const overlap = subjectOverlap(a.content, b.content);
      if (overlap < 0.34) continue;

      const aRequires = assertsRequirement(a.content);
      const bRequires = assertsRequirement(b.content);
      const aPermits = assertsPermission(a.content);
      const bPermits = assertsPermission(b.content);

      // Opposite polarity: one demands, the other waives.
      const opposed = (aRequires && bPermits && !bRequires) || (bRequires && aPermits && !aRequires);
      if (!opposed) continue;

      conflicts.push({
        a,
        b,
        reason: `both active and ${a.confidence}/${b.confidence} on the same subject (overlap ${overlap.toFixed(2)}), but one asserts a requirement the other waives`,
      });
    }
  }
  return conflicts;
}

/**
 * Trim ranked results to a bounded contribution.
 *
 * Applied after ranking so the budget spends on the best records rather than
 * whichever happened to be stored first.
 */
export function applyBudget(
  results: readonly MemorySearchResult[],
  budget: { maxChars: number; maxRecords: number },
): { kept: MemorySearchResult[]; droppedForBudget: number; chars: number } {
  const kept: MemorySearchResult[] = [];
  let chars = 0;
  for (const result of results) {
    if (kept.length >= budget.maxRecords) break;
    const cost = result.memory.content.length;
    if (chars + cost > budget.maxChars) continue;
    kept.push(result);
    chars += cost;
  }
  return { kept, droppedForBudget: results.length - kept.length, chars };
}
