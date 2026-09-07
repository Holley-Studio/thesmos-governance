// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — the transactional store.
 *
 * One write path. Every structural precondition lives here, inside an exclusive
 * lock, because they are only meaningful together: the chain tip, the anchor
 * agreement and the torn-tail state are all facts about the journal at one
 * instant, and checking them outside the lock checks a journal that may already
 * have changed.
 *
 * The transaction, in order:
 *
 *   acquire lock → scan and verify → repair torn tail → compare anchor
 *   → resolve tip → seal → append completely → fsync
 *   → commit anchor (temp, fsync, rename, fsync dir) → release lock
 *
 * A crash between the append and the anchor commit is the one expected
 * inconsistency, and it is recoverable: the journal is ahead of its anchor, the
 * next transaction confirms the journal extends the anchored tip, advances the
 * anchor, and reports the recovery.
 */

import { existsSync } from 'node:fs';
import {
  appendRecordInternal,
  exportJournal as exportJournalFile,
  journalPath,
  repairTornTail,
  scanJournal,
  verificationFrom,
} from './journal.js';
import {
  clearPartialHead,
  commitHead,
  compareHead,
  headFor,
  headPathFor,
  newJournalId,
  readHead,
} from './head.js';
import { acquireLock, releaseLock } from './lock.js';
import { buildRecordContent, sealRecord, type RecordInput } from './record.js';
import {
  GENESIS_HASH,
  RECORD_CODES,
  isExecutedOutcome,
  recordIssue,
  type CouncilRecord,
  type JournalVerification,
  type RecordIssue,
} from './types.js';

export interface RecordStoreOptions {
  root: string;
  name?: string;
  /** Injectable clock. Must return canonical ISO-8601 UTC with milliseconds. */
  now?: () => string;
  /** Injectable monotonic-ish clock for lock ageing, in milliseconds. */
  monotonicNow?: () => number;
  lockTimeoutMs?: number;
  lockStaleMs?: number;
}

export interface WriteResult {
  ok: boolean;
  record?: CouncilRecord;
  issues: RecordIssue[];
  /** Bytes removed by torn-tail repair before this write, if any. */
  repairedBytes?: number;
  /** True when this write advanced an anchor left behind by a crash. */
  recoveredHead?: boolean;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function lockPathFor(journalFile: string): string {
  return journalFile.replace(/\.jsonl$/, '') + '.lock';
}

/**
 * Append one record inside an exclusive transaction.
 *
 * Refuses rather than repairs when the journal has interior damage: extending a
 * chain whose earlier links are already broken produces evidence that looks
 * sound from the tip and is not.
 */
export function writeRecord(options: RecordStoreOptions, input: RecordInput): WriteResult {
  const path = journalPath(options.root, options.name);
  const headPath = headPathFor(path);
  const lockPath = lockPathFor(path);

  const lock = acquireLock(lockPath, {
    ...(options.monotonicNow ? { now: options.monotonicNow } : {}),
    ...(options.lockTimeoutMs !== undefined ? { timeoutMs: options.lockTimeoutMs } : {}),
    ...(options.lockStaleMs !== undefined ? { staleMs: options.lockStaleMs } : {}),
  });
  if (!lock.ok || !lock.owner) return { ok: false, issues: lock.issues };

  const carried: RecordIssue[] = [...lock.issues];

  try {
    clearPartialHead(headPath);

    let scan = scanJournal(path);
    let repairedBytes = 0;

    // Interior damage is fatal; a torn tail is not.
    const interiorError = scan.issues.find((i) => i.severity === 'error');
    if (interiorError) {
      return { ok: false, issues: [...carried, ...scan.issues] };
    }

    if (scan.tornTail) {
      const repair = repairTornTail(path, scan.intactBytes);
      repairedBytes = repair.repaired;
      carried.push(
        recordIssue(
          RECORD_CODES.tornTailRepaired,
          'warning',
          scan.records.length,
          `repaired a torn final record by removing ${repairedBytes} incomplete byte(s)`,
          'a previous write was interrupted; the journal is now consistent'
        )
      );
      scan = scanJournal(path);
      if (scan.issues.some((i) => i.severity === 'error')) {
        return { ok: false, issues: [...carried, ...scan.issues] };
      }
    }

    const { head, corrupt } = readHead(headPath);
    const comparison = compareHead(head, corrupt, scan.records);
    carried.push(...comparison.issues);

    // Only a journal that is ahead of its anchor is recoverable. Every other
    // disagreement means records were removed or replaced.
    if (comparison.state === 'head-ahead' || comparison.state === 'tip-mismatch' || comparison.state === 'corrupt') {
      return { ok: false, issues: carried };
    }

    const recoveredHead = comparison.state === 'journal-ahead-recoverable';
    const journalId = head?.journalId ?? newJournalId();

    const tip = scan.records[scan.records.length - 1];
    const content = buildRecordContent(input, options.root);
    const record = sealRecord(
      content,
      tip ? tip.recordHash : GENESIS_HASH,
      scan.records.length,
      (options.now ?? defaultNow)()
    );

    const appended = appendRecordInternal(path, record);
    if (!appended.ok) return { ok: false, issues: [...carried, ...appended.issues] };

    const committed = commitHead(headPath, headFor(journalId, [...scan.records, record]));
    if (!committed.ok) {
      // The record is durable; only the anchor lagged. The next transaction
      // detects the journal is ahead and advances it, so this is reported
      // rather than treated as a failed write.
      carried.push(...committed.issues);
    }

    return {
      ok: true,
      record,
      issues: carried,
      ...(repairedBytes > 0 ? { repairedBytes } : {}),
      ...(recoveredHead ? { recoveredHead } : {}),
    };
  } finally {
    const released = releaseLock(lockPath, lock.owner);
    if (!released.ok) carried.push(...released.issues);
  }
}

// ── Reading ───────────────────────────────────────────────────────────────────

function verify(options: RecordStoreOptions): {
  records: CouncilRecord[];
  verification: JournalVerification;
} {
  const path = journalPath(options.root, options.name);
  const scan = scanJournal(path);
  const { head, corrupt } = readHead(headPathFor(path));
  const comparison = compareHead(head, corrupt, scan.records);
  return {
    records: scan.records,
    verification: verificationFrom(scan, comparison.issues, comparison.state, comparison.anchored),
  };
}

export function readRecords(options: RecordStoreOptions): {
  records: CouncilRecord[];
  verification: JournalVerification;
} {
  return verify(options);
}

export function verifyRecords(options: RecordStoreOptions): JournalVerification {
  return verify(options).verification;
}

/**
 * Export a verified journal.
 *
 * Refuses to export a journal that does not verify — including one whose anchor
 * disagrees. Exporting damaged evidence without saying so would let it travel
 * as though it were sound.
 */
export function exportRecords(
  options: RecordStoreOptions,
  destination: string
): { ok: boolean; issues: RecordIssue[]; exported: number } {
  const path = journalPath(options.root, options.name);
  if (!existsSync(path)) return { ok: true, issues: [], exported: 0 };
  const { verification } = verify(options);
  return exportJournalFile(path, destination, verification);
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
 * not permit an `executed` outcome without one.
 */
export function executedRecords(records: readonly CouncilRecord[]): CouncilRecord[] {
  return records.filter((r) => isExecutedOutcome(r.outcome));
}
