// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — durable write primitives.
 *
 * Two things the record layer got wrong before and cannot get wrong again:
 * ignoring how many bytes `writeSync` actually wrote, and stopping the
 * durability barrier at the file descriptor.
 */

import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { RECORD_CODES, recordIssue, type RecordIssue } from './types.js';

/**
 * Bound on write attempts for one buffer.
 *
 * A short write is legitimate; an endless sequence of them is a failing device.
 * The loop refuses zero-progress rather than spinning forever.
 */
const MAX_WRITE_ATTEMPTS = 64;

export interface WriteAllResult {
  ok: boolean;
  written: number;
  issues: RecordIssue[];
}

/**
 * Write a buffer completely, or report exactly how far it got.
 *
 * `writeSync` may write fewer bytes than requested — that is the documented
 * contract of `write(2)`, not an exotic edge case. The previous implementation
 * discarded the return value, so a short write produced a torn record and still
 * reported success.
 *
 * Zero progress is treated as failure rather than retried indefinitely: if the
 * descriptor accepted nothing, waiting will not change that, and a caller
 * blocked forever is worse than a caller told the write failed.
 */
export function writeAllSync(fd: number, buffer: Buffer): WriteAllResult {
  const issues: RecordIssue[] = [];
  let offset = 0;
  let attempts = 0;

  while (offset < buffer.length) {
    if (attempts >= MAX_WRITE_ATTEMPTS) {
      issues.push(
        recordIssue(
          RECORD_CODES.writeIncomplete,
          'error',
          -1,
          `write stalled after ${attempts} attempts with ${offset} of ${buffer.length} bytes written`
        )
      );
      return { ok: false, written: offset, issues };
    }

    let n: number;
    try {
      n = writeSync(fd, buffer, offset, buffer.length - offset);
    } catch (error) {
      // A throw after partial progress still leaves a torn record on disk. The
      // caller repairs by truncating; what matters here is not claiming success.
      issues.push(
        recordIssue(
          RECORD_CODES.writeIncomplete,
          'error',
          -1,
          `write failed after ${offset} of ${buffer.length} bytes: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      );
      return { ok: false, written: offset, issues };
    }

    if (n <= 0) {
      issues.push(
        recordIssue(
          RECORD_CODES.writeIncomplete,
          'error',
          -1,
          `write made no progress at byte ${offset} of ${buffer.length}`
        )
      );
      return { ok: false, written: offset, issues };
    }

    offset += n;
    attempts += 1;
  }

  return { ok: true, written: offset, issues };
}

/**
 * Fsync a directory so a creation or rename within it survives a crash.
 *
 * Fsyncing a file makes its *contents* durable; it does not make the directory
 * entry naming that file durable. Without this, a crash can leave a journal
 * whose bytes are on disk under a name that is not.
 *
 * **Platform boundary.** This is a POSIX guarantee. Windows does not permit
 * opening a directory as a file, so the call fails there and is deliberately
 * swallowed: the alternative is either a crash on every write or a fabricated
 * claim of durability. On Windows the guarantee is therefore weaker — file
 * contents are fsynced, directory metadata is left to the filesystem. That
 * limitation is documented rather than hidden, and no Windows durability claim
 * is made anywhere in this module.
 */
export function fsyncDirectory(path: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch {
    return false;
  }
  try {
    fsyncSync(fd);
    return true;
  } catch {
    return false;
  } finally {
    closeSync(fd);
  }
}
