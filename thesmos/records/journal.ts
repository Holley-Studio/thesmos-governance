// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — the journal.
 *
 * Append-only, crash-safe, tamper-evident. The three properties the existing
 * receipt and governance logs lack, and the reason this layer exists:
 *
 * 1. **A durability barrier.** Each append is written and `fsync`ed before it
 *    is treated as recorded. Without that, a crash can leave a torn line that
 *    is indistinguishable from a line that was never written.
 * 2. **Corruption that fails closed.** A malformed record in the *middle* of a
 *    journal is an error. The existing logs skip malformed lines silently,
 *    which makes a tampered journal look like a shorter one.
 * 3. **A chain.** Each record binds to its predecessor's hash, so removing or
 *    editing any record breaks verification at a determinate position.
 *
 * The one recoverable corruption is a torn *final* record — the crash
 * signature. Distinguishing that from mid-journal damage is the whole point:
 * one is expected and survivable, the other means the evidence is untrustworthy.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { contentOf, hashRecordContent } from './record.js';
import { findRedactionViolations } from './redact.js';
import {
  GENESIS_HASH,
  RECORD_CODES,
  SUPPORTED_RECORD_SCHEMA_VERSIONS,
  hasRecordErrors,
  recordIssue,
  sortRecordIssues,
  type CouncilRecord,
  type JournalVerification,
  type RecordIssue,
} from './types.js';

/**
 * Refusal threshold for a single journal.
 *
 * A journal is evidence, not storage. Past this size something is emitting
 * records in a loop, and continuing to append would turn a bug into an
 * unbounded disk consumer. Compiled in; no configuration raises it.
 */
export const MAX_JOURNAL_BYTES = 64 * 1024 * 1024;

/** Refusal threshold for record count in one journal. */
export const MAX_JOURNAL_RECORDS = 100_000;

/** Bound on a single serialized record, checked before it is written. */
export const MAX_RECORD_BYTES = 64 * 1024;

export function journalPath(root: string, name = 'council'): string {
  return join(root, '.thesmos', 'records', `${name}.jsonl`);
}

// ── Reading ───────────────────────────────────────────────────────────────────

export interface JournalReadResult {
  records: CouncilRecord[];
  verification: JournalVerification;
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
 * Read and verify a journal.
 *
 * Verification is independent of whatever wrote the file: hashes are
 * recomputed, the chain is walked, and redaction is re-checked. A journal is
 * only as trustworthy as a reader that does not take the writer's word for it.
 */
export function readJournal(path: string): JournalReadResult {
  const issues: RecordIssue[] = [];
  const empty: JournalVerification = {
    valid: true,
    recordCount: 0,
    intactCount: 0,
    tornTail: false,
    issues: [],
  };

  if (!existsSync(path)) return { records: [], verification: empty };

  const raw = readFileSync(path, 'utf8');
  if (raw === '') return { records: [], verification: empty };

  // A trailing newline means the last record was fully flushed. Its absence is
  // the torn-tail signature, and is the only corruption treated as recoverable.
  const endsCleanly = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  const records: CouncilRecord[] = [];
  let prevHash = GENESIS_HASH;
  let tornTail = false;

  for (const [index, line] of lines.entries()) {
    const isLast = index === lines.length - 1;
    const parsed = parseLine(line);

    if (parsed === null) {
      if (isLast && !endsCleanly) {
        // Expected after a crash: the process died mid-write.
        tornTail = true;
        issues.push(
          recordIssue(
            RECORD_CODES.tornTail,
            'warning',
            index,
            'final record was partially written and has been dropped',
            'the journal is intact up to this point; re-run the operation that was interrupted'
          )
        );
        break;
      }
      // Anywhere else, unreadable means tampered or damaged. Fail closed.
      issues.push(
        recordIssue(
          RECORD_CODES.malformed,
          'error',
          index,
          'record is not readable JSON',
          'the journal is damaged at this position and cannot be trusted past it'
        )
      );
      break;
    }

    if (!SUPPORTED_RECORD_SCHEMA_VERSIONS.includes(parsed.schemaVersion)) {
      // Refused, never reinterpreted. Guessing at an unknown future shape is
      // how a reader silently corrupts what it does not understand.
      issues.push(
        recordIssue(
          RECORD_CODES.schemaUnsupported,
          'error',
          index,
          `record schema "${String(parsed.schemaVersion)}" is not supported by this build`,
          'upgrade Thesmos to read this journal'
        )
      );
      break;
    }

    const expected = hashRecordContent(contentOf(parsed));
    if (parsed.contentHash !== expected) {
      issues.push(
        recordIssue(
          RECORD_CODES.contentHashMismatch,
          'error',
          index,
          'record content does not match its hash',
          'the record was altered after it was written'
        )
      );
      break;
    }

    if (parsed.prevHash !== prevHash) {
      issues.push(
        recordIssue(
          RECORD_CODES.chainBroken,
          'error',
          index,
          'record does not chain to its predecessor',
          'a record was inserted, removed, or reordered'
        )
      );
      break;
    }

    if (parsed.sequence !== index) {
      issues.push(
        recordIssue(
          RECORD_CODES.sequenceGap,
          'error',
          index,
          `record claims position ${parsed.sequence} but is at ${index}`,
          'the journal has been reordered or truncated mid-file'
        )
      );
      break;
    }

    for (const finding of findRedactionViolations(contentOf(parsed))) {
      const code =
        finding.kind === 'secret'
          ? RECORD_CODES.secretPresent
          : finding.kind === 'absolute-path'
            ? RECORD_CODES.absolutePath
            : RECORD_CODES.controlCharacter;
      issues.push(
        recordIssue(
          code,
          'error',
          index,
          `record field "${finding.path}" contains ${finding.kind.replace('-', ' ')}`,
          'this record was written by a build with weaker redaction'
        )
      );
    }

    records.push(parsed);
    prevHash = parsed.contentHash;
  }

  const sorted = sortRecordIssues(issues);
  return {
    records,
    verification: {
      valid: !hasRecordErrors(sorted),
      recordCount: lines.length,
      intactCount: records.length,
      tornTail,
      issues: sorted,
    },
  };
}

// ── Appending ─────────────────────────────────────────────────────────────────

export interface AppendResult {
  ok: boolean;
  record?: CouncilRecord;
  issues: RecordIssue[];
}

/**
 * Append one sealed record, durably.
 *
 * Opened with `a` so the write is positioned at end-of-file by the kernel
 * rather than by a remembered offset, which keeps concurrent appenders from
 * overwriting one another. `fsyncSync` before returning is what makes the
 * "recorded" claim true across a crash.
 */
export function appendRecord(path: string, record: CouncilRecord): AppendResult {
  const issues: RecordIssue[] = [];
  const line = `${JSON.stringify(record)}\n`;
  const bytes = Buffer.byteLength(line, 'utf8');

  if (bytes > MAX_RECORD_BYTES) {
    issues.push(
      recordIssue(
        RECORD_CODES.malformed,
        'error',
        record.sequence,
        `record is ${bytes} bytes, over the ${MAX_RECORD_BYTES}-byte limit`,
        'record digests and identifiers, not payloads'
      )
    );
    return { ok: false, issues };
  }

  const violations = findRedactionViolations(contentOf(record));
  if (violations.length > 0) {
    // Refuse rather than write. An append-only journal cannot be corrected
    // later, so a leaked secret would be permanent.
    for (const finding of violations) {
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
    return { ok: false, issues };
  }

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(path) && statSync(path).size + bytes > MAX_JOURNAL_BYTES) {
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
  try {
    writeSync(fd, line);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }

  return { ok: true, record, issues };
}

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Copy a journal to a destination, atomically.
 *
 * Refuses to export a journal that does not verify. Exporting damaged evidence
 * without saying so would let a tampered journal travel as though it were
 * sound, which is worse than refusing.
 */
export function exportJournal(
  path: string,
  destination: string
): { ok: boolean; issues: RecordIssue[]; exported: number } {
  const { records, verification } = readJournal(path);
  if (!verification.valid) {
    return { ok: false, issues: verification.issues, exported: 0 };
  }

  const dir = dirname(destination);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Write to a sibling then rename: a reader never observes a partial export.
  const temp = `${destination}.partial`;
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length > 0 ? '\n' : '');
  writeFileSync(temp, body, 'utf8');
  const fd = openSync(temp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, destination);

  return { ok: true, issues: verification.issues, exported: records.length };
}
