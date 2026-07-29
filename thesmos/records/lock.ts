// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Records — the transaction lock.
 *
 * Concurrent agents and CLI invocations are ordinary Thesmos use, so the
 * critical section — verify, repair, resolve tip, seal, append, fsync, commit
 * head — has to be serialized. Without it two writers derive from the same tip,
 * both are told they succeeded, and the journal is left with a broken chain and
 * a lost record.
 *
 * An earlier revision rejected locking on the grounds that a stale lock is a
 * worse failure mode than a race. That was the wrong trade for an authoritative
 * evidence journal: a stale lock is recoverable and visible, while a corrupted
 * journal is neither. The stale-lock concern is answered directly instead —
 * bounded age, owner token, liveness check, and a refusal that says exactly
 * what to do.
 *
 * Exclusivity comes from `wx`, which is `O_CREAT | O_EXCL` and atomic on every
 * supported platform. No advisory locking, no fcntl, nothing NFS-dependent.
 */

import { openSync, closeSync, readFileSync, unlinkSync, writeSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { RECORD_CODES, recordIssue, type RecordIssue } from './types.js';

/**
 * How long a lock may be held before another writer may reclaim it.
 *
 * The critical section is a handful of synchronous filesystem operations, so a
 * lock older than this means the holder died. Generous enough that a slow disk
 * does not trigger it, short enough that a crashed writer does not block work
 * for long.
 */
export const LOCK_STALE_MS = 30_000;

/** Total time a writer waits for a held lock before refusing. */
export const LOCK_TIMEOUT_MS = 5_000;

/** Pause between attempts. Busy-waiting is acceptable for a sub-second section. */
export const LOCK_RETRY_MS = 25;

export interface LockOwner {
  /** Unique per acquisition. Only this token may release the lock. */
  token: string;
  /** For operator diagnosis. Never a path, never an environment value. */
  pid: number;
  acquiredAt: number;
}

export interface LockResult {
  ok: boolean;
  owner?: LockOwner;
  issues: RecordIssue[];
}

function readOwner(path: string): LockOwner | null {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockOwner>;
    if (typeof parsed.token !== 'string' || typeof parsed.acquiredAt !== 'number') return null;
    return { token: parsed.token, pid: Number(parsed.pid) || 0, acquiredAt: parsed.acquiredAt };
  } catch {
    return null;
  }
}

/**
 * Is the recorded holder still running?
 *
 * `kill(pid, 0)` tests for existence without signalling. A pid we cannot signal
 * because it belongs to another user (`EPERM`) is still alive, so only `ESRCH`
 * counts as dead. Deliberately conservative: wrongly declaring a live holder
 * dead would reintroduce exactly the race the lock prevents.
 */
function ownerAlive(pid: number): boolean {
  if (!pid || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code !== 'ESRCH';
  }
}

/**
 * Acquire the journal transaction lock.
 *
 * Never steals a lock that is both young and held by a live process. A stale
 * lock is reclaimed only when it is past `LOCK_STALE_MS` *and* its recorded
 * holder is gone, and the reclaim itself races safely: the unlink is followed
 * by another `wx` attempt, so if two writers both decide to reclaim, exactly
 * one wins the create.
 */
export function acquireLock(
  path: string,
  options: { now?: () => number; timeoutMs?: number; staleMs?: number } = {}
): LockResult {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
  const staleMs = options.staleMs ?? LOCK_STALE_MS;
  const issues: RecordIssue[] = [];

  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const deadline = now() + timeoutMs;
  let reclaimed = false;

  for (;;) {
    const owner: LockOwner = { token: globalThis.crypto.randomUUID(), pid: process.pid, acquiredAt: now() };
    try {
      const fd = openSync(path, 'wx');
      try {
        writeSync(fd, JSON.stringify(owner));
      } finally {
        closeSync(fd);
      }
      if (reclaimed) {
        issues.push(
          recordIssue(
            RECORD_CODES.lockStaleRecovered,
            'warning',
            -1,
            'reclaimed a stale journal lock whose holder is no longer running',
            'a previous write was interrupted; the journal was repaired before this one'
          )
        );
      }
      return { ok: true, owner, issues };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        issues.push(
          recordIssue(RECORD_CODES.lockHeld, 'error', -1, 'could not create the journal lock')
        );
        return { ok: false, issues };
      }
    }

    const held = readOwner(path);

    // An unreadable lock is *not* automatically stale. `wx` creates the file
    // before its contents are written, so a competing writer can observe an
    // empty lock that is about to become a live one. Treating that as
    // abandoned lets a second writer steal a held lock — a real race that
    // corrupted the chain under ten concurrent writers.
    //
    // When the contents cannot be parsed, fall back to the file's own age.
    let age: number;
    if (held) {
      age = now() - held.acquiredAt;
    } else {
      try {
        age = Date.now() - statSync(path).mtimeMs;
      } catch {
        // Vanished between checks: another writer released it. Retry the create.
        continue;
      }
    }

    const stale = age > staleMs && (!held || !ownerAlive(held.pid));

    if (stale) {
      try {
        unlinkSync(path);
        reclaimed = true;
      } catch {
        // Another writer reclaimed it first; fall through and retry.
      }
      continue;
    }

    if (now() >= deadline) {
      issues.push(
        recordIssue(
          RECORD_CODES.lockHeld,
          'error',
          -1,
          `journal is locked by another writer (pid ${held?.pid ?? 0}, held ${Math.round(age)}ms)`,
          `wait and retry; a lock older than ${staleMs}ms whose holder has exited is reclaimed automatically`
        )
      );
      return { ok: false, issues };
    }

    // Synchronous spin. The critical section is sub-millisecond in practice, and
    // a blocking wait keeps the whole transaction on one call stack.
    const until = now() + LOCK_RETRY_MS;
    while (now() < until) {
      /* spin */
    }
  }
}

/**
 * Release a lock, but only if we still hold it.
 *
 * If the token no longer matches, our lock was reclaimed as stale and someone
 * else owns the file. Deleting it then would drop *their* lock, so this refuses
 * and reports rather than forcing.
 */
export function releaseLock(path: string, owner: LockOwner): { ok: boolean; issues: RecordIssue[] } {
  const held = readOwner(path);
  if (!held) return { ok: true, issues: [] };

  if (held.token !== owner.token) {
    return {
      ok: false,
      issues: [
        recordIssue(
          RECORD_CODES.lockHeld,
          'warning',
          -1,
          'lock is held by a different owner and was not released',
          'this writer was reclaimed as stale while it worked'
        ),
      ],
    };
  }

  try {
    unlinkSync(path);
  } catch {
    // Already gone. Releasing an absent lock is not an error.
  }
  return { ok: true, issues: [] };
}
