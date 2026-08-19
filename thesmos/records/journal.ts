// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — the journal.
 *
 * Append-only, with a durability barrier, a two-level integrity check and
 * physical crash repair. What each of those does, and where each stops:
 *
 * - **Accidental corruption** in the middle of a journal fails closed. The
 *   existing receipt and governance logs skip malformed lines silently, which
 *   makes a damaged journal look like a shorter one.
 * - **Interior tampering** — editing, reordering or deleting a record in the
 *   middle — is detected by the envelope chain.
 * - **Suffix truncation** is detected only by comparing against the head anchor
 *   (`head.ts`). The chain alone cannot see it, because a truncated journal is
 *   a perfectly valid shorter chain.
 * - **A writable local attacker** is *not* defended against. Someone who can
 *   rewrite the journal and the anchor together can produce a consistent
 *   forgery. No purely local artifact can prevent that; it needs an external
 *   signed attestation, which this repository does not have.
 *
 * "Crash-safe" here means: appended bytes are fsynced before an append is
 * acknowledged, a torn final record is physically truncated before the journal
 * is extended, and the anchor is committed by atomic rename with a directory
 * fsync. On POSIX. See `io.ts` for the Windows limitation.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { contentOf, envelopeOf, hashRecordContent, hashRecordEnvelope } from './record.js';
import { findRedactionViolations } from './redact.js';
import { fsyncDirectory, writeAllSync } from './io.js';
import {
  GENESIS_HASH,
  RECORD_CODES,
  SUPPORTED_RECORD_SCHEMA_VERSIONS,
  hasRecordErrors,
  isCanonicalTimestamp,
  isRecordAttestation,
  recordIssue,
  sortRecordIssues,
  type CouncilRecord,
  type JournalVerification,
  type RecordIssue,
} from './types.js';

/** Compiled ceilings. No configuration raises them. */
export const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;
export const MAX_JOURNAL_RECORDS = 100_000;
export const MAX_RECORD_BYTES = 64 * 1024;

export function journalPath(root: string, name = 'council'): string {
  return join(root, '.thesmos', 'records', `${name}.jsonl`);
}

// ── Reading ───────────────────────────────────────────────────────────────────

export interface ScanResult {
  records: CouncilRecord[];
  issues: RecordIssue[];
  tornTail: boolean;
  /** Byte offset just past the last intact newline-terminated record. */
  intactBytes: number;
  recordCount: number;
}

function parseLine(line: string): CouncilRecord | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as CouncilRecord;
  } catch {
    return null;
  }
}

/**
 * Scan a journal, verifying every record independently of whatever wrote it.
 *
 * Both digests are recomputed. `contentHash` establishes semantic identity;
 * `recordHash` establishes that this content sits at this position, at this
 * time, with this attestation, behind this predecessor. Checking only the
 * former is what previously left timestamps forgeable.
 */
export function scanJournal(path: string): ScanResult {
  const issues: RecordIssue[] = [];

  if (!existsSync(path)) {
    return { records: [], issues, tornTail: false, intactBytes: 0, recordCount: 0 };
  }

  const raw = readFileSync(path, 'utf8');
  if (raw === '') return { records: [], issues, tornTail: false, intactBytes: 0, recordCount: 0 };

  const endsCleanly = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const records: CouncilRecord[] = [];
  let prevRecordHash = GENESIS_HASH;
  let tornTail = false;
  let intactBytes = 0;

  const fail = (code: string, index: number, message: string, remediation?: string): void => {
    issues.push(recordIssue(code, 'error', index, message, remediation));
  };

  for (const [index, line] of lines.entries()) {
    const isLast = index === lines.length - 1;
    const parsed = parseLine(line);

    if (parsed === null) {
      if (isLast && !endsCleanly) {
        tornTail = true;
        issues.push(
          recordIssue(
            RECORD_CODES.tornTail,
            'warning',
            index,
            'final record was partially written',
            'a write was interrupted; the next write repairs it before extending the journal'
          )
        );
        break;
      }
      fail(
        RECORD_CODES.malformed,
        index,
        'record is not readable JSON',
        'the journal is damaged at this position and cannot be trusted past it'
      );
      break;
    }

    if (!SUPPORTED_RECORD_SCHEMA_VERSIONS.includes(parsed.schemaVersion)) {
      fail(
        RECORD_CODES.schemaUnsupported,
        index,
        `record schema "${String(parsed.schemaVersion)}" is not supported by this build`,
        'upgrade Thesmos to read this journal'
      );
      break;
    }

    if (!isCanonicalTimestamp(parsed.recordedAt)) {
      fail(
        RECORD_CODES.timestampInvalid,
        index,
        'record timestamp is missing or not canonical ISO-8601 UTC',
        'the record cannot be placed in time and is not trustworthy'
      );
      break;
    }

    if (!isRecordAttestation(parsed.attestation)) {
      fail(
        RECORD_CODES.attestationInvalid,
        index,
        'record attestation is missing or not a recognized state',
        'every record must persist its signing state explicitly'
      );
      break;
    }

    if (parsed.contentHash !== hashRecordContent(contentOf(parsed))) {
      fail(
        RECORD_CODES.contentHashMismatch,
        index,
        'record content does not match its semantic hash',
        'the record body was altered after it was written'
      );
      break;
    }

    if (parsed.recordHash !== hashRecordEnvelope(envelopeOf(parsed))) {
      fail(
        RECORD_CODES.recordHashMismatch,
        index,
        'record envelope does not match its hash',
        'the timestamp, sequence, attestation or chain link was altered after it was written'
      );
      break;
    }

    if (parsed.prevRecordHash !== prevRecordHash) {
      fail(
        RECORD_CODES.chainBroken,
        index,
        'record does not chain to its predecessor',
        'a record was inserted, removed, or reordered'
      );
      break;
    }

    if (parsed.sequence !== index) {
      fail(
        RECORD_CODES.sequenceGap,
        index,
        `record claims position ${parsed.sequence} but is at ${index}`,
        'the journal has been reordered or truncated mid-file'
      );
      break;
    }

    for (const finding of findRedactionViolations(contentOf(parsed))) {
      fail(
        finding.kind === 'secret'
          ? RECORD_CODES.secretPresent
          : finding.kind === 'absolute-path'
            ? RECORD_CODES.absolutePath
            : RECORD_CODES.controlCharacter,
        index,
        `record field "${finding.path}" contains ${finding.kind.replace('-', ' ')}`,
        'this record was written by a build with weaker redaction'
      );
    }

    records.push(parsed);
    prevRecordHash = parsed.recordHash;
    intactBytes += Buffer.byteLength(line, 'utf8') + 1;
  }

  return { records, issues, tornTail, intactBytes, recordCount: lines.length };
}

/**
 * Physically remove a torn final record.
 *
 * Reading around partial bytes is not repairing them. Leaving them in place and
 * appending puts the fragment in the *middle* of the journal, which fails
 * closed forever — a crash would permanently destroy the journal on the next
 * write, and that write would report success.
 */
export function repairTornTail(path: string, intactBytes: number): { repaired: number } {
  const before = statSync(path).size;
  if (before <= intactBytes) return { repaired: 0 };

  const fd = openSync(path, 'r+');
  try {
    ftruncateSync(fd, intactBytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  fsyncDirectory(dirname(path));
  return { repaired: before - intactBytes };
}

// ── Appending ─────────────────────────────────────────────────────────────────

export interface AppendResult {
  ok: boolean;
  issues: RecordIssue[];
}

/**
 * Append one sealed record, durably.
 *
 * Internal on purpose. Every structural precondition — chain position, digests,
 * schema, anchor agreement — belongs to the transaction in `store.ts`, and an
 * exported raw append let a caller poison a journal and be told it succeeded.
 * This validates what it can see locally and trusts the transaction for the
 * rest.
 *
 * On a partial write the bytes already on disk are truncated away before
 * returning, so a failed append leaves the journal exactly as it found it.
 */
export function appendRecordInternal(path: string, record: CouncilRecord): AppendResult {
  const issues: RecordIssue[] = [];
  const line = `${JSON.stringify(record)}\n`;
  const buffer = Buffer.from(line, 'utf8');

  if (buffer.length > MAX_RECORD_BYTES) {
    issues.push(
      recordIssue(
        RECORD_CODES.malformed,
        'error',
        record.sequence,
        `record is ${buffer.length} bytes, over the ${MAX_RECORD_BYTES}-byte limit`,
        'record digests and identifiers, not payloads'
      )
    );
    return { ok: false, issues };
  }

  for (const finding of findRedactionViolations(contentOf(record))) {
    issues.push(
      recordIssue(
        finding.kind === 'secret'
          ? RECORD_CODES.secretPresent
          : finding.kind === 'absolute-path'
            ? RECORD_CODES.absolutePath
            : RECORD_CODES.controlCharacter,
        'error',
        record.sequence,
        `refused: field "${finding.path}" contains ${finding.kind.replace('-', ' ')}`,
        'the journal is append-only, so this cannot be redacted after the fact'
      )
    );
  }
  if (issues.length > 0) return { ok: false, issues };

  const dir = dirname(path);
  const creating = !existsSync(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sizeBefore = creating ? 0 : statSync(path).size;
  if (sizeBefore + buffer.length > MAX_JOURNAL_BYTES) {
    issues.push(
      recordIssue(
        RECORD_CODES.malformed,
        'error',
        record.sequence,
        `journal would exceed ${MAX_JOURNAL_BYTES} bytes`,
        'export and rotate the journal'
      )
    );
    return { ok: false, issues };
  }

  const fd = openSync(path, 'a');
  let result;
  try {
    result = writeAllSync(fd, buffer);
    if (result.ok) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  if (!result.ok) {
    // Undo the partial bytes so the journal is unchanged by a failed append.
    try {
      const fixFd = openSync(path, 'r+');
      try {
        ftruncateSync(fixFd, sizeBefore);
        fsyncSync(fixFd);
      } finally {
        closeSync(fixFd);
      }
    } catch {
      // If truncation fails the torn tail remains and is repaired on next write.
    }
    return { ok: false, issues: result.issues };
  }

  if (creating) fsyncDirectory(dir);
  return { ok: true, issues };
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportJournal(
  path: string,
  destination: string,
  verification: JournalVerification
): { ok: boolean; issues: RecordIssue[]; exported: number } {
  if (!verification.valid) {
    return { ok: false, issues: verification.issues, exported: 0 };
  }

  const { records } = scanJournal(path);
  const dir = dirname(destination);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const temp = `${destination}.partial`;
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');

  const fd = openSync(temp, 'w');
  try {
    const written = writeAllSync(fd, Buffer.from(body, 'utf8'));
    if (!written.ok) return { ok: false, issues: written.issues, exported: 0 };
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  renameSync(temp, destination);
  fsyncDirectory(dir);

  return { ok: true, issues: verification.issues, exported: records.length };
}

/** Assemble a verification result from a scan and an anchor comparison. */
export function verificationFrom(
  scan: ScanResult,
  headIssues: readonly RecordIssue[],
  headState: JournalVerification['headState'],
  anchored: boolean
): JournalVerification {
  const issues = sortRecordIssues([...scan.issues, ...headIssues]);
  return {
    valid: !hasRecordErrors(issues),
    recordCount: scan.recordCount,
    intactCount: scan.records.length,
    tornTail: scan.tornTail,
    headState,
    suffixAnchored: anchored,
    issues,
  };
}
