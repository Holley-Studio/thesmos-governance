// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — governed memory contracts.
 *
 * The governing principle: **memory is not truth**. A stored statement is
 * evidence with a history, not an instruction and not an authority. Every
 * record therefore keeps enough metadata to answer where it came from, who
 * made it, whether it was observed or inferred, how confident we are, and
 * whether something newer has replaced it.
 *
 * This is distinct from `brain.ts`, which learns about *Thesmos rules* from
 * scan sessions. Mnemosyne remembers *project knowledge*. They are not merged
 * because they answer different questions and have different lifecycles.
 *
 * Dependency-free and `vscode`-free: the same store backs the CLI, the editor
 * and a future headless runtime.
 */

/**
 * Where a memory applies.
 *
 * Ordered widest to narrowest. Retrieval never widens: a mission-scoped query
 * may read `repository` memory, but a `repository` query must not surface
 * another repository's records. One project silently contaminating another's
 * context is the failure mode this exists to prevent.
 */
export type MemoryScope =
  | 'global'
  | 'workspace'
  | 'repository'
  | 'project'
  | 'mission'
  | 'session'
  | 'agent';

/** Widest-to-narrowest ordering, used for containment checks. */
export const MEMORY_SCOPE_ORDER: readonly MemoryScope[] = [
  'global',
  'workspace',
  'repository',
  'project',
  'mission',
  'session',
  'agent',
];

/**
 * What kind of claim a record makes.
 *
 * The critical split is `observation` (something happened, verifiable) versus
 * `hypothesis` (something inferred). Ranking and capsule rendering must never
 * treat them identically — an inference promoted to fact is how a memory
 * system starts lying confidently.
 */
export type MemoryType =
  | 'observation'
  | 'user-decision'
  | 'architecture-decision'
  | 'procedure'
  | 'constraint'
  | 'summary'
  | 'hypothesis'
  | 'ephemeral';

/** Where a record originated. Not free text — routing and trust depend on it. */
export type MemorySourceKind =
  | 'user'
  | 'repository'
  | 'git'
  | 'tool'
  | 'agent'
  | 'mission'
  | 'council-record'
  | 'execution-receipt'
  | 'generated-summary'
  | 'import';

/** How the content came to exist. Inferred content can never claim `observed`. */
export type MemoryDerivation = 'observed' | 'stated' | 'inferred' | 'consolidated';

/**
 * Lifecycle state.
 *
 * `superseded` records are kept, not deleted — historical evidence stays
 * useful for "why did we decide that?" — but they are excluded from active
 * retrieval so stale facts do not re-enter context as current truth.
 */
export type MemoryStatus = 'active' | 'superseded' | 'expired' | 'disputed';

/**
 * How much a record may be trusted.
 *
 * Coarse and deterministic on purpose. A continuous score would invite
 * false precision on a value nobody can calibrate.
 */
export type MemoryConfidence = 'low' | 'medium' | 'high' | 'verified';

export const CONFIDENCE_WEIGHT: Readonly<Record<MemoryConfidence, number>> = {
  low: 0.25,
  medium: 0.5,
  high: 0.8,
  verified: 1,
};

/**
 * How freely content may travel.
 *
 * `secret` content is never embedded and never leaves the machine. Embedding
 * does not launder sensitivity — a vector derived from a credential is still
 * derived from a credential.
 */
export type SensitivityClass = 'public' | 'project' | 'private' | 'sensitive' | 'secret';

export const SENSITIVITY_ORDER: readonly SensitivityClass[] = [
  'public',
  'project',
  'private',
  'sensitive',
  'secret',
];

/** Provenance. Structured, never flattened into prose. */
export interface MemoryProvenance {
  sourceKind: MemorySourceKind;
  /** Stable identifier within the source — a SHA, a mission id, a receipt id. */
  sourceId?: string;
  /** Who or what created it: a user, an agent id, a command. */
  creator: string;
  derivation: MemoryDerivation;
  /** Pointer to supporting evidence (receipt id, council record, file path). */
  evidenceRef?: string;
  /** Records this one was derived from, for consolidation lineage. */
  derivedFrom?: string[];
}

/** A stored vector, tied to the exact content and model that produced it. */
export interface EmbeddingReference {
  providerId: string;
  model: string;
  dimensions: number;
  /** Hash of the embedded content. A content change invalidates the vector. */
  contentHash: string;
  createdAt: string;
}

/**
 * Vector-space identity.
 *
 * Vectors from different providers, models or widths are not comparable.
 * Namespacing them makes an incompatible comparison impossible rather than
 * merely discouraged — cosine similarity between two unrelated spaces returns
 * a plausible number, which is the dangerous kind of wrong.
 */
export function embeddingNamespace(providerId: string, model: string, dimensions: number): string {
  return `${providerId}:${model}:${dimensions}`;
}

export interface RetentionPolicy {
  /** ISO timestamp after which the record is treated as expired. */
  expiresAt?: string;
  /** Advisory: whether consolidation may fold this record into a summary. */
  consolidatable?: boolean;
}

/** One governed memory. */
export interface MemoryRecord {
  id: string;
  schemaVersion: number;

  scope: MemoryScope;
  type: MemoryType;
  status: MemoryStatus;

  content: string;

  provenance: MemoryProvenance;
  confidence: MemoryConfidence;
  sensitivity: SensitivityClass;

  createdAt: string;
  updatedAt: string;

  repoId?: string;
  projectId?: string;
  missionId?: string;
  sessionId?: string;
  agentId?: string;

  /** Ids this record replaces, and ids that replaced it. */
  supersedes?: string[];
  supersededBy?: string[];

  retention?: RetentionPolicy;
  embedding?: EmbeddingReference;

  /** Free-form, non-authoritative. Never consulted for governance decisions. */
  metadata: Record<string, unknown>;
}

/** The current on-disk schema. Bumping this requires a migration path. */
export const MEMORY_SCHEMA_VERSION = 1;

/** A candidate memory, before validation and persistence. */
export type MemoryProposal = Omit<
  MemoryRecord,
  'id' | 'schemaVersion' | 'createdAt' | 'updatedAt' | 'status' | 'embedding'
> & {
  status?: MemoryStatus;
};

/** One retrieval hit, with the reasoning that produced its rank. */
export interface MemorySearchResult {
  memory: MemoryRecord;
  /** Raw vector similarity, or a lexical fallback score. 0–1. */
  similarity: number;
  /** Final deterministic rank after scope, recency, confidence, type. 0–1. */
  relevanceScore: number;
  /** Human-readable factors, so a ranking can be explained rather than trusted. */
  reasons: string[];
}

/** Two active, high-confidence records that appear to contradict each other. */
export interface MemoryConflict {
  a: MemoryRecord;
  b: MemoryRecord;
  reason: string;
}

/** Bounded contribution memory may make to a context capsule. */
export interface MemoryBudget {
  /** Hard ceiling on characters of memory content injected. */
  maxChars: number;
  /** Hard ceiling on record count, applied after ranking. */
  maxRecords: number;
}

export const DEFAULT_MEMORY_BUDGET: MemoryBudget = { maxChars: 6000, maxRecords: 12 };

/** Content bound. Prevents one record from consuming an entire capsule. */
export const MAX_MEMORY_CONTENT_CHARS = 4000;
