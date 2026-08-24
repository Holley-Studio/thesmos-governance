// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMerge } from '../bin/commands/pr.ts';
import { setAutonomy } from './execute.ts';
import { acquireLock } from './lock.ts';
import type { Runner } from './sync.ts';

/** Publishing the ledger is proven in sync.test.ts and ledger-handoff.test.ts;
 *  here it only has to not get in the way. */
const okGit: Runner = () => ({ ok: true, stdout: 'main\n', stderr: '' });

let root: string;
const now = () => new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-merge-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

const PRS = JSON.stringify([
  { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'main',
    headRefName: 'a', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
  { number: 2, title: 'chore(deps): bump b from 1.0.0 to 2.0.0', isDraft: false, baseRefName: 'main',
    headRefName: 'b', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
]);

describe('runMerge', () => {
  it('merges the reversible PR and never the major bump', () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: args[0] === 'pr' && args[1] === 'list' ? PRS : '', stderr: '' };
    };

    const result = runMerge(root, { wave: 0 }, { gh, now, git: okGit });

    expect(result.merged).toEqual([1]);
    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['1']);
    // Governing property 1: a one-way PR must never be merged, however green.
    expect(merges).not.toContain('2');
  });

  it('never issues a merge call for the one-way PR even under --all', () => {
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: args[0] === 'pr' && args[1] === 'list' ? PRS : '', stderr: '' };
    };

    const result = runMerge(root, { wave: 'all' }, { gh, now, git: okGit });

    expect(result.merged).toEqual([1]);
    expect(result.failed).toEqual([]);
    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['1']);
  });

  it('halts before a later wave once an earlier wave fails — never continues past a failure', () => {
    // PR 10 is a reversible root; PR 11 is stacked on PR 10's branch and is
    // itself reversible/recoverable, so the plan produces two waves. If gh
    // fails on PR 10, PR 11 (wave 1) must never be attempted.
    const stackedPrs = JSON.stringify([
      { number: 10, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'main',
        headRefName: 'a', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
      { number: 11, title: 'chore(deps): bump c from 1.0.0 to 1.1.0', isDraft: false, baseRefName: 'a',
        headRefName: 'c', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'README.md' }] },
    ]);

    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: stackedPrs, stderr: '' };
      if (args[1] === 'merge') return { ok: false, stdout: '', stderr: 'boom' };
      return { ok: true, stdout: '', stderr: '' };
    };

    const result = runMerge(root, { wave: 'all' }, { gh, now, git: okGit });

    expect(result.merged).toEqual([]);
    expect(result.failed).toEqual([10]);
    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['10']);
    expect(merges).not.toContain('11');
  });

  it('merges every wave in order when --all is requested and everything succeeds', () => {
    const stackedPrs = JSON.stringify([
      { number: 10, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'main',
        headRefName: 'a', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
      { number: 11, title: 'chore(deps): bump c from 1.0.0 to 1.1.0', isDraft: false, baseRefName: 'a',
        headRefName: 'c', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'README.md' }] },
    ]);

    const gh = (args: string[]) => {
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: stackedPrs, stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };

    const result = runMerge(root, { wave: 'all' }, { gh, now, git: okGit });

    expect(result.merged).toEqual([10, 11]);
    expect(result.failed).toEqual([]);
  });

  it('does not attempt any merge while autonomy is disabled — executeWave refuses silently', () => {
    setAutonomy(root, false);
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: args[0] === 'pr' && args[1] === 'list' ? PRS : '', stderr: '' };
    };

    const result = runMerge(root, { wave: 0 }, { gh, now, git: okGit });

    expect(result.merged).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(calls.some((c) => c[1] === 'merge')).toBe(false);
  });

  it('derives the default branch from gh instead of assuming "main"', () => {
    // Repo default branch is "develop". PR 1's branch happens to be literally
    // named "develop" (a realistic incidental collision, e.g. a one-off
    // sync/mirror PR) and is a major bump — one-way, so it is halted. PR 2 is
    // an independent PR based on the repo's real default branch, "develop".
    // A hardcoded defaultBranch of 'main' looks up "develop" (PR 2's base) in
    // the head-ref map, wrongly nests PR 2 underneath halted PR 1, and PR 2's
    // PARENT_BLOCKED cascade removes it from every wave — it would never be
    // merged. Deriving the branch correctly recognizes PR 2 as its own root.
    const developPrs = JSON.stringify([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 2.0.0', isDraft: false, baseRefName: 'main',
        headRefName: 'develop', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
      { number: 2, title: 'chore(deps): bump b from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'develop',
        headRefName: 'feature-x', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
    ]);
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'repo') return { ok: true, stdout: 'develop\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: developPrs, stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };

    const result = runMerge(root, { wave: 0 }, { gh, now, git: okGit });

    expect(result.merged).toEqual([2]);
    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['2']);
  });

  // ── the concurrency lock — two runs merging at once must not double-merge a wave ──

  it('refuses to merge at all while another run holds the lock, without ever calling gh', () => {
    acquireLock(root, now()); // simulates a concurrent Thesmos run already in progress
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      return { ok: true, stdout: args[0] === 'pr' && args[1] === 'list' ? PRS : '', stderr: '' };
    };

    const result = runMerge(root, { wave: 0 }, { gh, now, git: okGit });

    expect(result.locked).toBe(true);
    expect(result.merged).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('releases the lock even when the merge path throws, so a crash cannot wedge the tool', () => {
    const throwingGh = (): never => { throw new Error('boom — simulated crash before any merge'); };

    expect(() => runMerge(root, { wave: 0 }, { gh: throwingGh, now, git: okGit })).toThrow('boom');

    // If the lock were still held, this would return false.
    expect(acquireLock(root, now())).toBe(true);
  });

  it('never merges a PR that is obsolete — every file it changes is already gone from the target branch', () => {
    // #1 and #9 are deliberately identical in every way classify() cares
    // about — patch bump, single lockfile-only diff — so both would
    // otherwise be planned as reversible and merged. Only #9's file
    // (pnpm-lock.yaml) is absent from the fetched target tree, mirroring
    // the #9/#6 case: a PR editing a file a merge already deleted. If #9 is
    // excluded here for any reason other than the OBSOLETE check firing —
    // e.g. because its shape happens to classify as one-way regardless —
    // this test would pass without the wiring actually doing anything,
    // which is exactly the failure mode this test exists to rule out.
    const prsWithObsolete = JSON.stringify([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'main',
        headRefName: 'a', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
      { number: 9, title: 'chore(deps): bump c from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'main',
        headRefName: 'c', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'pnpm-lock.yaml' }] },
    ]);
    const calls: string[][] = [];
    const gh = (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: prsWithObsolete, stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('git/trees')) {
        // pnpm-lock.yaml is not in the target tree — this repo dropped pnpm.
        return { ok: true, stdout: JSON.stringify({ truncated: false, paths: ['package-lock.json', 'README.md'] }), stderr: '' };
      }
      return { ok: true, stdout: '', stderr: '' };
    };

    const result = runMerge(root, { wave: 'all' }, { gh, now, git: okGit });

    expect(result.merged).toEqual([1]);
    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['1']);
    expect(merges).not.toContain('9');
  });
});
