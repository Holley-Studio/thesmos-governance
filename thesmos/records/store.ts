// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — the store.
 *
 * The seam callers use. It owns the one piece of state a record cannot compute
 * for itself — its position in the chain — and it re-reads that from disk on
 * every append rather than caching it, so a second process appending to the
 * same journal cannot be silently overwritten.
 *
 * That re-read is the concurrency control. It is not a lock: two processes can
 * still interleave, and the loser of a race gets a chain break reported on the
 * next verification rather than a corrupted file. For a local, repository-
 * scoped evidence log that is the right trade — a lock file adds a stale-lock
 * failure mode that is worse than the race it prevents.
 */

import { appendRecord, journalPath, readJournal } from './journal.js';
import { buildRecordContent, sealRecord, type RecordInput } from './record.js';
import {
  GENESIS_HASH,
  isExecutedOutcome,
  type CouncilRecord,
  type JournalVerification,
  type RecordIssue,
} from './types.js';

export interface RecordStoreOptions {
  root: string;
  /** Journal name, for separating unrelated streams. Defaults to `council`. */
  name?: string;
  /**
   * Clock, injectable so tests produce byte-identical journals. Only ever used
   * for `recordedAt`, which is outside the hashed projection.
   */
  now?: () => string;
}

export interface WriteResult {
  ok: boolean;
  record?: CouncilRecord;
  issues: RecordIssue[];
}

function defaultNow(): string {
  return new Date().toISOString();
}

/**
 * Append one record.
 *
 * Reads the journal first to find the chain tip. If the existing journal does
 * not verify, the append is refused: extending a chain whose earlier links are
 * already broken would produce evidence that looks intact from the tip and is
 * not.
 */
export function writeRecord(options: RecordStoreOptions, input: RecordInput): WriteResult {
  const path = journalPath(options.root, options.name);
  const { records, verification } = readJournal(path);

  if (!verification.valid) {
    return {
      ok: false,
      issues: verification.issues,
    };
  }

  const tip = records[records.length - 1];
  const content = buildRecordContent(input, options.root);
  const record = sealRecord(
    content,
    tip ? tip.contentHash : GENESIS_HASH,
    records.length,
    (options.now ?? defaultNow)()
  );

  return appendRecord(path, record);
}

/** Read every intact record, with the verification that produced them. */
export function readRecords(options: RecordStoreOptions): {
  records: CouncilRecord[];
  verification: JournalVerification;
} {
  return readJournal(journalPath(options.root, options.name));
}

/** Verify without materializing records for the caller. */
export function verifyRecords(options: RecordStoreOptions): JournalVerification {
  return readJournal(journalPath(options.root, options.name)).verification;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export function recordsForCorrelation(
  records: readonly CouncilRecord[],
  correlationId: string
): CouncilRecord[] {
  return records.filter((r) => r.identity.correlationId === correlationId);
}

export function recordsForMission(
  records: readonly CouncilRecord[],
  missionId: string
): CouncilRecord[] {
  return records.filter((r) => r.identity.missionId === missionId);
}

/**
 * Records that claim something actually ran.
 *
 * Every one carries a receipt reference by construction — the type system does
 * not permit an `executed` outcome without one. This function exists so a
 * caller asking "what has run?" gets an answer that is structurally incapable
 * of including work that only got as far as being planned.
 */
export function executedRecords(records: readonly CouncilRecord[]): CouncilRecord[] {
  return records.filter((r) => isExecutedOutcome(r.outcome));
}
