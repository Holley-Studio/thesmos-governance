// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — governed memory and context intelligence.
 *
 * Public surface. Consumers (CLI, VS Code, mission runtime, a future headless
 * runtime) import from here rather than reaching into internals.
 *
 * The vocabulary this subsystem keeps distinct:
 *   - **memory** — something recorded, with provenance and a lifecycle
 *   - **evidence** — memory offered in support of a claim
 *   - **instruction** — what the user or mission asks for
 *   - **authority** — what governance permits
 *
 * Memory can become evidence. It can never become instruction or authority.
 */

export * from './types.js';
export {
  MemoryStore,
  hashContent,
  migrateRecord,
  MEMORY_DIR,
  RECORDS_PATH,
  VECTORS_PATH,
  META_PATH,
  type StoredVector,
  type MemoryStoreMeta,
  type LoadResult,
} from './store.js';
export {
  validateMemoryProposal,
  detectSecret,
  scopeWithin,
  type MemoryValidationResult,
  type MemoryValidationIssue,
  type MemoryWriteContext,
  type MemoryWriteDecision,
} from './validate.js';
export {
  applyBudget,
  cosineSimilarity,
  deduplicate,
  detectConflicts,
  isVisible,
  lexicalSimilarity,
  rankMemories,
  type MemoryQuery,
  type VectorLookup,
} from './retrieve.js';
export {
  embedQuery,
  indexMemories,
  isEmbeddable,
  resolveEmbeddingModel,
  type EmbeddingContext,
  type IndexResult,
} from './embeddings.js';
export {
  renderMemoryCapsule,
  sanitizeMemoryContent,
  sectionize,
  type MemoryCapsuleSection,
  type MemoryTelemetry,
  type RenderedMemoryCapsule,
} from './capsule.js';
export { MnemosyneService, type RecallOptions, type RecallOutcome } from './service.js';
export {
  classifySummary,
  commitProposals,
  confidenceFromTests,
  isDurableContent,
  proposeFromHandoff,
  proposeFromMission,
  qualifiesForAutoWrite,
  type CommitOptions,
  type CommitOutcome,
  type ProposalContext,
} from './propose.js';
