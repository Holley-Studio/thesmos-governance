// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — the head anchor.
 *
 * A backward hash chain proves that each record follows its predecessor. It
 * cannot prove that no record followed the *last* one, so deleting a valid
 * suffix leaves a journal that verifies perfectly. That was a real defect: a
 * three-record journal truncated to one still reported `valid: true`.
 *
 * The anchor is a sibling file recording how far the journal is known to have
 * reached. Comparing it to the journal turns "the chain is intact" into "the
 * chain is intact *and* nothing was cut off the end".
 *
 * **Assurance boundary, stated once and meant literally.** The anchor is a
 * local file next to the journal. It detects crashes, truncation and accidental
 * loss. It does **not** detect an attacker who can rewrite the journal and the
 * anchor together — nothing stored beside the data it protects can. That needs
 * an external signed attestation, which this repository does not have.
 */

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { serializeStable } from '../council/contract.js';
import { fsyncDirectory, writeAllSync } from './io.js';
import {
  GENESIS_HASH,
  RECORD_CODES,
  RECORD_SCHEMA_VERSION,
  recordIssue,
  type CouncilRecord,
  type HeadState,
  type JournalHead,
  type RecordIssue,
} from './types.js';

export function newJournalId(): string {
  return randomUUID();
}

export function readHead(path: string): { head: JournalHead | null; corrupt: boolean } {
  if (!existsSync(path)) return { head: null, corrupt: false };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<JournalHead>;
    if (
      typeof parsed.schemaVersion !== 'string' ||
      typeof parsed.journalId !== 'string' ||
      typeof parsed.sequence !== 'number' ||
      !Number.isInteger(parsed.sequence) ||
      typeof parsed.tipRecordHash !== 'string'
    ) {
      return { head: null, corrupt: true };
    }
    return { head: parsed as JournalHead, corrupt: false };
  } catch {
    return { head: null, corrupt: true };
  }
}

/**
 * Commit a new head, atomically and durably.
 *
 * Temp file → fsync → rename → fsync parent directory. The directory fsync is
 * what makes the rename itself survive a crash; without it the file contents
 * are durable but the name pointing at them may not be.
 */
export function commitHead(path: string, head: JournalHead): { ok: boolean; issues: RecordIssue[] } {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const temp = `${path}.partial`;
  const body = `${serializeStable(head)}\n`;

  const fd = openSync(temp, 'w');
  try {
    const written = writeAllSync(fd, Buffer.from(body, 'utf8'));
    if (!written.ok) {
      return {
        ok: false,
        issues: [
          recordIssue(RECORD_CODES.writeIncomplete, 'error', -1, 'head anchor was not fully written'),
        ],
      };
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(temp, path);
  fsyncDirectory(dir);
  return { ok: true, issues: [] };
}

export function headPathFor(journalFile: string): string {
  return journalFile.replace(/\.jsonl$/, '') + '.head.json';
}

export interface HeadComparison {
  state: HeadState;
  issues: RecordIssue[];
  /** True when a head existed and could be compared at all. */
  anchored: boolean;
}

/**
 * Compare an anchor against the records actually present.
 *
 * The interesting case is `journal-ahead-recoverable`: a crash between the
 * journal append and the head commit leaves the journal one or more records
 * ahead of the anchor. That is expected and safe *provided the journal extends
 * the anchored tip* — which is checked, not assumed. A journal that is ahead
 * but does not contain the anchored tip is a different journal, not a newer
 * one.
 */
export function compareHead(
  head: JournalHead | null,
  corrupt: boolean,
  records: readonly CouncilRecord[]
): HeadComparison {
  const issues: RecordIssue[] = [];
  const lastIndex = records.length - 1;
  const tip = lastIndex >= 0 ? (records[lastIndex] as CouncilRecord).recordHash : GENESIS_HASH;

  if (corrupt) {
    issues.push(
      recordIssue(
        RECORD_CODES.headCorrupt,
        'error',
        -1,
        'journal head anchor is unreadable',
        'suffix truncation cannot be ruled out; restore the anchor from a backup or re-anchor deliberately'
      )
    );
    return { state: 'corrupt', issues, anchored: false };
  }

  if (!head) {
    if (records.length === 0) return { state: 'agreed', issues, anchored: false };
    // Degraded, not verified. Saying otherwise would be the overclaim the
    // anchor exists to remove.
    issues.push(
      recordIssue(
        RECORD_CODES.headMissing,
        'warning',
        -1,
        'journal has no head anchor, so suffix truncation cannot be detected',
        'this journal predates anchoring or the anchor was deleted'
      )
    );
    return { state: 'missing', issues, anchored: false };
  }

  if (head.sequence === lastIndex && head.tipRecordHash === tip) {
    return { state: 'agreed', issues, anchored: true };
  }

  if (head.sequence > lastIndex) {
    issues.push(
      recordIssue(
        RECORD_CODES.headAhead,
        'error',
        -1,
        `anchor commits sequence ${head.sequence} but the journal ends at ${lastIndex}`,
        'records were removed from the end of the journal'
      )
    );
    return { state: 'head-ahead', issues, anchored: true };
  }

  if (head.sequence === lastIndex) {
    issues.push(
      recordIssue(
        RECORD_CODES.headTipMismatch,
        'error',
        -1,
        'anchor and journal agree on length but not on the final record',
        'the last record was replaced'
      )
    );
    return { state: 'tip-mismatch', issues, anchored: true };
  }

  // Journal is longer than the anchor. Safe only if it genuinely extends it.
  const anchoredAt = head.sequence >= 0 ? records[head.sequence] : undefined;
  const extendsAnchor =
    head.sequence < 0 ? head.tipRecordHash === GENESIS_HASH : anchoredAt?.recordHash === head.tipRecordHash;

  if (!extendsAnchor) {
    issues.push(
      recordIssue(
        RECORD_CODES.headTipMismatch,
        'error',
        -1,
        `journal does not contain the anchored tip at sequence ${head.sequence}`,
        'the journal was replaced rather than extended'
      )
    );
    return { state: 'tip-mismatch', issues, anchored: true };
  }

  issues.push(
    recordIssue(
      RECORD_CODES.headRecovered,
      'warning',
      -1,
      `journal is ${lastIndex - head.sequence} record(s) ahead of its anchor`,
      'a previous write completed but its anchor commit did not; the anchor advances on the next write'
    )
  );
  return { state: 'journal-ahead-recoverable', issues, anchored: true };
}

export function headFor(journalId: string, records: readonly CouncilRecord[]): JournalHead {
  const lastIndex = records.length - 1;
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    journalId,
    sequence: lastIndex,
    tipRecordHash: lastIndex >= 0 ? (records[lastIndex] as CouncilRecord).recordHash : GENESIS_HASH,
  };
}

/** Remove a stale temporary anchor left by an interrupted commit. */
export function clearPartialHead(path: string): void {
  const temp = `${path}.partial`;
  if (existsSync(temp)) {
    try {
      unlinkSync(temp);
    } catch {
      // Best effort; a leftover temp file is inert.
    }
  }
}
