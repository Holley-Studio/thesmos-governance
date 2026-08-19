// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — internal surface.
 *
 * One import site for the CLI and tests. Deliberately not re-exported from
 * `thesmos/index.ts`: the record layer is CLI-internal, the same decision taken
 * for `council/` (§15.2) and `mission/`.
 *
 * `appendRecordInternal` is **not** exported. An earlier revision exported a raw
 * append that validated only size and redaction, so a caller could write a
 * record with a forged hash, wrong sequence and unsupported schema, be told
 * `ok: true`, and leave the journal permanently unverifiable. Structural
 * preconditions are only meaningful inside the transaction that holds the lock,
 * so `writeRecord` is the only way in.
 */

export {
  GENESIS_HASH,
  RECORD_CODES,
  RECORD_EVENT_KINDS,
  RECORD_SCHEMA_VERSION,
  SUPPORTED_RECORD_SCHEMA_VERSIONS,
  hasRecordErrors,
  isCanonicalTimestamp,
  isExecutedOutcome,
  isRecordAttestation,
  isRecordEventKind,
  recordIssue,
  sortRecordIssues,
  type CouncilRecord,
  type HeadState,
  type JournalHead,
  type JournalVerification,
  type RecordActor,
  type RecordAttestation,
  type RecordAuthority,
  type RecordContent,
  type RecordEnvelope,
  type RecordEventKind,
  type RecordIdentity,
  type RecordIssue,
  type RecordOutcome,
} from './types.js';

export {
  MAX_FIELD_LENGTH,
  MAX_MAP_ENTRIES,
  findRedactionViolations,
  redactField,
  redactMap,
  type RedactionFinding,
} from './redact.js';

export {
  buildRecordContent,
  contentOf,
  envelopeOf,
  hashRecordContent,
  hashRecordEnvelope,
  sealRecord,
  type RecordInput,
} from './record.js';

export {
  MAX_JOURNAL_BYTES,
  MAX_JOURNAL_RECORDS,
  MAX_RECORD_BYTES,
  journalPath,
  scanJournal,
  type ScanResult,
} from './journal.js';

export {
  compareHead,
  headFor,
  headPathFor,
  readHead,
  type HeadComparison,
} from './head.js';

export {
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  acquireLock,
  releaseLock,
  type LockOwner,
  type LockResult,
} from './lock.js';

export { fsyncDirectory, writeAllSync, type WriteAllResult } from './io.js';

export {
  executedRecords,
  exportRecords,
  readRecords,
  recordsForCorrelation,
  recordsForMission,
  verifyRecords,
  writeRecord,
  type RecordStoreOptions,
  type WriteResult,
} from './store.js';
