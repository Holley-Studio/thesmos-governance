// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
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
