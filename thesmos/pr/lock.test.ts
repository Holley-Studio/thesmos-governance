// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, releaseLock, detectObsolete } from './lock.ts';
import type { PullRequest } from './types.ts';

let root: string;
const T0 = new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-lock-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

describe('lock', () => {
  it('refuses a second concurrent holder', () => {
    expect(acquireLock(root, T0)).toBe(true);
    expect(acquireLock(root, T0)).toBe(false);
  });

  it('reclaims a stale lock after its ttl', () => {
    acquireLock(root, T0);
    const later = new Date(T0.getTime() + 60 * 60 * 1000);
    expect(acquireLock(root, later, 30 * 60 * 1000)).toBe(true);
  });

  it('can be re-acquired after release', () => {
    acquireLock(root, T0);
    releaseLock(root);
    expect(acquireLock(root, T0)).toBe(true);
  });

  it('refuses a fresh lock file that was written by something other than this process\'s acquireLock call', () => {
    // Simulates the exclusive-create path (O_EXCL / 'wx') seeing a winner
    // from a genuinely concurrent process: the file exists on disk before
    // acquireLock ever runs, not because this process wrote it.
    writeFileSync(join(root, '.thesmos', 'pr-lock.json'), JSON.stringify({ at: T0.toISOString(), pid: 999999 }) + '\n', 'utf8');
    expect(acquireLock(root, T0)).toBe(false);
  });

  it('treats a corrupt lock file as stale rather than wedging the tool forever', () => {
    writeFileSync(join(root, '.thesmos', 'pr-lock.json'), 'not valid json{{{', 'utf8');
    expect(acquireLock(root, T0)).toBe(true);
  });

  it('propagates a genuine filesystem error instead of silently reporting "not acquired"', () => {
    // No .thesmos directory exists under this root, so the exclusive write
    // fails with ENOENT, not EEXIST. The lock must only treat EEXIST as
    // "someone else holds it" — swallowing every error here would hide a
    // real infrastructure failure behind a false "lock is held" reading.
    const missingRoot = mkdtempSync(join(tmpdir(), 'thesmos-lock-missing-'));
    expect(() => acquireLock(missingRoot, T0)).toThrow();
  });
});

describe('detectObsolete', () => {
  const pr: PullRequest = {
    number: 9, title: 'bump codeql-action', isDraft: false, baseRefName: 'main',
    headRefName: 'dep', mergeStateStatus: 'CLEAN', changedFiles: 1,
    files: ['.github/workflows/codeql.yml'],
  };

  it('flags a PR whose only file no longer exists on the target', () => {
    expect(detectObsolete(pr, new Set(['.github/workflows/ci.yml']))).toBe(true);
  });

  it('does not flag a PR whose files still exist', () => {
    expect(detectObsolete(pr, new Set(['.github/workflows/codeql.yml']))).toBe(false);
  });
});
