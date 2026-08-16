// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Single-holder lock so two Thesmos runs cannot double-merge a wave, plus
 * obsolete-PR detection: a PR editing only files that no longer exist on the
 * target can never be useful, and should be closed rather than merged.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PullRequest } from './types.ts';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function lockPath(root: string): string {
  return join(root, '.thesmos', 'pr-lock.json');
}

/**
 * Creates the lock file only if it does not already exist ('wx' is
 * Node/POSIX O_EXCL), so "does it exist" and "I created it" are answered by
 * a single atomic syscall. A plain existsSync-then-writeFileSync check has
 * a window between the two calls where a second process can observe "not
 * held" and also win — the exact double-merge bug this lock exists to
 * prevent. Returns false only for EEXIST; any other filesystem error (e.g.
 * a missing directory) is a real failure and must propagate, not be read
 * as "someone else holds it".
 */
function tryCreateLockFile(path: string, now: Date): boolean {
  try {
    writeFileSync(path, JSON.stringify({ at: now.toISOString(), pid: process.pid }) + '\n', { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export function acquireLock(root: string, now: Date, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const path = lockPath(root);

  if (tryCreateLockFile(path, now)) return true;

  // Something already holds the file. If it is older than its ttl (or
  // unreadable/corrupt), a crashed run must not wedge this tool forever:
  // reclaim it and retry the exclusive create once. If a third process wins
  // that retry, this call correctly reports "not acquired" rather than
  // looping — the retry is a single reclaim attempt, not a spin-wait.
  let stale = false;
  try {
    const held = JSON.parse(readFileSync(path, 'utf8')) as { at: string };
    stale = now.getTime() - new Date(held.at).getTime() >= ttlMs;
  } catch {
    stale = true; // a corrupt lock is treated as stale rather than wedging the tool forever
  }
  if (!stale) return false;

  rmSync(path, { force: true });
  return tryCreateLockFile(path, now);
}

export function releaseLock(root: string): void {
  rmSync(lockPath(root), { force: true });
}

/** True when every file the PR touches is absent from the target branch. */
export function detectObsolete(pr: PullRequest, pathsOnTarget: Set<string>): boolean {
  if (pr.files.length === 0) return false;
  return pr.files.every((f) => !pathsOnTarget.has(f));
}
