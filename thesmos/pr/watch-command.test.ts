// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWatch } from '../bin/commands/pr.ts';
import { appendEntry } from './ledger.ts';
import { isAutonomyDisabled, setAutonomy } from './execute.ts';
import type { GhRunner } from './execute.ts';
import type { Runner } from './sync.ts';

const okGit: Runner = () => ({ ok: true, stdout: 'main\n', stderr: '' });
const PUBLISHED = { ok: true };

let root: string;
const now = () => new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-watch-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

/** Answers the commit-list and check-runs lookups from fixtures — the
 * check-runs response is a realistic one-conclusion-per-line payload
 * (matching `.check_runs[] | (.conclusion // "pending")`), not a
 * pre-reduced count — plus the `gh pr revert` / `gh pr merge` calls
 * performRevert issues. */
function fakeWatchGh(opts: { shas: string[]; failingShas: Set<string> }): GhRunner {
  return (args) => {
    if (args[0] === 'api' && args[1]?.includes('/check-runs')) {
      const sha = args[1].split('/commits/')[1]?.split('/check-runs')[0];
      return { ok: true, stdout: `${opts.failingShas.has(sha ?? '') ? 'failure' : 'success'}\n`, stderr: '' };
    }
    if (args[0] === 'api' && args[1]?.includes('/commits?')) {
      return { ok: true, stdout: opts.shas.join('\n') + '\n', stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'revert') {
      return { ok: true, stdout: 'https://github.com/o/r/pull/999\n', stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'merge') {
      return { ok: true, stdout: '', stderr: '' };
    }
    throw new Error(`unexpected gh call in runWatch test: ${JSON.stringify(args)}`);
  };
}

describe('runWatch — the kill switch reaches the unattended half (spec §6.3)', () => {
  it('makes zero gh calls of any kind while autonomy is off', () => {
    // pr:watch performs two real mutations — `gh pr revert` opens a PR and
    // `gh pr merge` lands it on main — and had no autonomy check anywhere in
    // its path. "A single AUTONOMY_DISABLED sentinel is checked before any
    // mutation" was true of pr:merge only. Asserting zero calls rather than
    // "no revert call": the check must come before the commit-list lookup,
    // so a disabled repo makes no network requests at all.
    setAutonomy(root, false);
    appendEntry(root, { action: 'merge', pr: 7, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const calls: string[][] = [];
    const gh: GhRunner = (args) => { calls.push(args); throw new Error('gh must not be called'); };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'autonomy-off' });
    expect(calls).toEqual([]);
  });

  it('resumes checking once autonomy is back on', () => {
    // Guards against the check being written in a way that never lets go.
    setAutonomy(root, false);
    setAutonomy(root, true);
    const gh = fakeWatchGh({ shas: ['aaa'], failingShas: new Set() });
    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'green' });
  });

  it('does not retry a revert that already failed and switched autonomy off', () => {
    // Spec §6.2: one revert attempt per incident, it must never thrash. The
    // setAutonomy(root, false) inside performRevert was the guard meant to
    // enforce that, and nothing read it — so every subsequent push retried.
    appendEntry(root, { action: 'merge', pr: 3, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const failingRevert: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'revert') return { ok: false, stdout: '', stderr: 'no permission' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    expect(runWatch(root, { range: 5 }, { gh: failingRevert, now, git: okGit }).status).toBe('revert-failed');

    // The next push to main. Nothing about the repository changed.
    const secondRun: string[][] = [];
    const gh: GhRunner = (args) => { secondRun.push(args); return failingRevert(args); };
    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'autonomy-off' });
    expect(secondRun).toEqual([]);
  });
});

describe('runWatch', () => {
  it('reports green and never calls gh pr revert when main has no failing check runs', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa', 'zzz'], failingShas: new Set() });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'green' });
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });

  it('reports no-culprit when main is red but the ledger holds no Thesmos merge in range', () => {
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa'], failingShas: new Set(['aaa']) });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'no-culprit' });
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });

  it('reaches chooseCulprit and performRevert, reverting the culprit through the real two-call sequence', () => {
    appendEntry(root, { action: 'merge', pr: 7, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa', 'zzz'], failingShas: new Set(['aaa']) });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'reverted', pr: 7, sync: PUBLISHED });
    // The revert PR (#999) is what gets merged, never the original (#7) —
    // proves this drives performRevert's actual create-then-merge sequence,
    // not a stub that just reports success.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert' && c[2] === '7')).toBe(true);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'merge' && c[2] === '999')).toBe(true);
  });

  it('reports revert-failed and leaves autonomy off when the revert itself fails', () => {
    appendEntry(root, { action: 'merge', pr: 3, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'revert') return { ok: false, stdout: '', stderr: 'no permission' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'revert-failed', pr: 3, sync: PUBLISHED });
    expect(isAutonomyDisabled(root)).toBe(true);
  });

  it('reports unknown, not green, when the Checks API call itself fails', () => {
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: false, stdout: '', stderr: 'HTTP 403' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'unknown' });
  });

  it('reports pending, not green, and never consults the ledger while a check run is still in progress', () => {
    // The realistic mid-build shape: one check settled green, one still
    // running (conclusion null, printed by jq as the literal "pending").
    // watch is a single fast `gh api` call reacting to the same push event
    // a multi-minute CI matrix does — this is what it will normally see.
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'success\npending\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'pending' });
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });

  it('reports unreadable-history when the commit-list lookup fails, and never queries check-runs', () => {
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      return { ok: false, stdout: '', stderr: 'not logged in' };
    };

    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'unreadable-history' });
    expect(calls.some((c) => c[1]?.includes('/check-runs'))).toBe(false);
  });

  it('honors the requested range when asking gh for recent commits', () => {
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'success\n', stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    runWatch(root, { range: 10 }, { gh, now, git: okGit });

    const commitsCall = calls.find((c) => c[0] === 'api' && c[1]?.includes('/commits?'));
    expect(commitsCall?.[1]).toContain('per_page=10');
  });
});
