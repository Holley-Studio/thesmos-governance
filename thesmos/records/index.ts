// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — internal surface.
 *
 * One import site for the CLI and tests. Deliberately not re-exported from
 * `thesmos/index.ts`: the record layer is CLI-internal for now, the same
 * decision taken for `council/` (§15.2) and `mission/`, so its shape can change
 * without a breaking release of the published library.
 */

export {
  GENESIS_HASH,
  RECORD_CODES,
  RECORD_EVENT_KINDS,
  RECORD_SCHEMA_VERSION,
  SUPPORTED_RECORD_SCHEMA_VERSIONS,
  hasRecordErrors,
  isExecutedOutcome,
  isRecordEventKind,
  recordIssue,
  sortRecordIssues,
  type CouncilRecord,
  type JournalVerification,
  type RecordActor,
  type RecordAttestation,
  type RecordAuthority,
  type RecordContent,
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
  hashRecordContent,
  sealRecord,
  type RecordInput,
} from './record.js';

export {
  MAX_JOURNAL_BYTES,
  MAX_JOURNAL_RECORDS,
  MAX_RECORD_BYTES,
  appendRecord,
  exportJournal,
  journalPath,
  readJournal,
  type AppendResult,
  type JournalReadResult,
} from './journal.js';

export {
  executedRecords,
  readRecords,
  recordsForCorrelation,
  recordsForMission,
  verifyRecords,
  writeRecord,
  type RecordStoreOptions,
  type WriteResult,
} from './store.js';
