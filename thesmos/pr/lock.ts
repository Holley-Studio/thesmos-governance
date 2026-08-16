// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Single-holder lock so two Thesmos runs cannot double-merge a wave, plus
 * obsolete-PR detection: a PR editing only files that no longer exist on the
 * target can never be useful, and should be closed rather than merged.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PullRequest } from './types.ts';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function lockPath(root: string): string {
  return join(root, '.thesmos', 'pr-lock.json');
}

export function acquireLock(root: string, now: Date, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const path = lockPath(root);

  if (existsSync(path)) {
    try {
      const held = JSON.parse(readFileSync(path, 'utf8')) as { at: string };
      if (now.getTime() - new Date(held.at).getTime() < ttlMs) return false;
    } catch {
      // A corrupt lock is treated as stale rather than wedging the tool forever.
    }
  }

  writeFileSync(path, JSON.stringify({ at: now.toISOString(), pid: process.pid }) + '\n', 'utf8');
  return true;
}

export function releaseLock(root: string): void {
  rmSync(lockPath(root), { force: true });
}

/** True when every file the PR touches is absent from the target branch. */
export function detectObsolete(pr: PullRequest, pathsOnTarget: Set<string>): boolean {
  if (pr.files.length === 0) return false;
  return pr.files.every((f) => !pathsOnTarget.has(f));
}
