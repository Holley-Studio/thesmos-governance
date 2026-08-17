// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWatch } from '../bin/commands/pr.ts';
import { appendEntry } from './ledger.ts';
import { isAutonomyDisabled, setAutonomy } from './execute.ts';
import { MERGED_LABEL, REVERTED_LABEL } from './marks.ts';
import type { GhRunner } from './execute.ts';
import type { Runner } from './sync.ts';

const okGit: Runner = () => ({ ok: true, stdout: 'main\n', stderr: '' });
const PUBLISHED = { ok: true };
const MARKED = { ok: true };

let root: string;
const now = () => new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-watch-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

/** A merge Thesmos has marked on GitHub — the Action's only record of it. */
interface Marked { pr: number; sha: string; reverted?: boolean }

/** The JSON `gh pr list --state merged --label thesmos-merged --json ...` prints. */
function mergedListJson(marked: Marked[]): string {
  return JSON.stringify(marked.map((m, i) => ({
    number: m.pr,
    labels: [{ name: MERGED_LABEL }, ...(m.reverted ? [{ name: REVERTED_LABEL }] : [])],
    mergeCommit: { oid: m.sha },
    mergedAt: `2026-08-16T11:0${i}:00Z`,
  })));
}

/** Newest commit first, one minute apart — the shape `.[] | [.sha,
 *  .commit.committer.date] | @tsv` actually prints. */
const COMMIT_BASE = Date.parse('2026-08-16T11:30:00Z');
export function commitLines(shas: string[]): string {
  return shas.map((sha, i) => `${sha}\t${new Date(COMMIT_BASE - i * 60_000).toISOString()}`).join('\n') + '\n';
}

/** Answers the commit-list and check-runs lookups from fixtures — the
 * check-runs response is a realistic one-conclusion-per-line payload
 * (matching `.check_runs[] | (.conclusion // "pending")`), not a
 * pre-reduced count — the merged-pull-request listing the Action rebuilds
 * its view from, and the `gh pr revert` / `gh pr merge` / `gh pr edit` calls
 * performRevert issues. */
function fakeWatchGh(opts: { shas: string[]; failingShas: Set<string>; marked?: Marked[] }): GhRunner {
  return (args) => {
    if (args[0] === 'api' && args[1]?.includes('/check-runs')) {
      const sha = args[1].split('/commits/')[1]?.split('/check-runs')[0];
      return { ok: true, stdout: `${opts.failingShas.has(sha ?? '') ? 'failure' : 'success'}\n`, stderr: '' };
    }
    if (args[0] === 'api' && args[1]?.includes('/commits?')) {
      return { ok: true, stdout: commitLines(opts.shas), stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      return { ok: true, stdout: mergedListJson(opts.marked ?? []), stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'edit') {
      return { ok: true, stdout: '', stderr: '' };
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
    const failingRevert: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: mergedListJson([{ pr: 3, sha: 'aaa' }]), stderr: '' };
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
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa', 'zzz'], failingShas: new Set(), marked: [{ pr: 1, sha: 'aaa' }] });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'green' });
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
    // A green main must not even ask which merges were ours.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'list')).toBe(false);
  });

  it('reports no-culprit when main is red but GitHub holds no marked Thesmos merge in range', () => {
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa'], failingShas: new Set(['aaa']) });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'no-culprit' });
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });

  it('reaches chooseCulprit and performRevert, reverting the culprit through the real two-call sequence', () => {
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa', 'zzz'], failingShas: new Set(['aaa']), marked: [{ pr: 7, sha: 'aaa' }] });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result).toEqual({ status: 'reverted', pr: 7, sync: PUBLISHED, mark: MARKED });
    // The revert PR (#999) is what gets merged, never the original (#7) —
    // proves this drives performRevert's actual create-then-merge sequence,
    // not a stub that just reports success.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert' && c[2] === '7')).toBe(true);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'merge' && c[2] === '999')).toBe(true);
    // And the culprit is marked reverted, so a later red build cannot pick it
    // again and re-land the change by reverting the revert.
    expect(calls).toContainEqual(['pr', 'edit', '7', '--add-label', REVERTED_LABEL]);
  });

  it('reports revert-failed and leaves autonomy off when the revert itself fails', () => {
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: mergedListJson([{ pr: 3, sha: 'aaa' }]), stderr: '' };
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

  it('reports pending, not green, and never looks for a culprit while a check run is still in progress', () => {
    // The realistic mid-build shape: one check settled green, one still
    // running (conclusion null, printed by jq as the literal "pending").
    // watch is a single fast `gh api` call reacting to the same push event
    // a multi-minute CI matrix does — this is what it will normally see.
    // The gh fake throws on anything past the two lookups, so reaching the
    // merged-list query at all fails this test.
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

  it('is not armed by the local ledger at all — GitHub is the only source', () => {
    // The transport this replaces. A ledger row used to be the ONLY thing
    // that armed a revert, and on a fresh runner there is never one. If
    // runWatch ever reads the ledger again, this test goes green for the
    // wrong reason and the production failure comes straight back.
    appendEntry(root, { action: 'merge', pr: 7, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, now());
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa'], failingShas: new Set(['aaa']), marked: [] });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'no-culprit' });
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });

  it('never picks a merge GitHub already has marked reverted', () => {
    const gh = fakeWatchGh({
      shas: ['aaa'], failingShas: new Set(['aaa']), marked: [{ pr: 7, sha: 'aaa', reverted: true }],
    });
    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'no-culprit' });
  });

  it('reports that it could not read its own merges, rather than standing down as if there were none', () => {
    // "None of these commits are mine" and "I could not find out" have
    // opposite consequences, and rendering the second as the first is the
    // failure mode that made this whole mechanism inert once already.
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: false, stdout: '', stderr: 'HTTP 403' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result.status).toBe('unreadable-merges');
    expect(result.status === 'unreadable-merges' && result.detail).toMatch(/403/);
  });

  it('will not say "nothing of ours" off the back of a list that might be incomplete', () => {
    // GitHub returned a full page, so a merge in the failing range could be
    // sitting on page two. Standing down here would be a guess dressed as a
    // fact.
    const limit = 100;
    const page = Array.from({ length: limit }, (_, i) => ({
      number: i + 1,
      labels: [{ name: MERGED_LABEL }],
      mergeCommit: { oid: `other-sha-${i}` },
      mergedAt: `2026-08-16T11:3${i % 10}:00Z`,
      // Every row on the page was touched after the oldest commit in range
      // (11:29Z), so page two genuinely could hold one still in that range.
      updatedAt: `2026-08-16T11:3${i % 10}:00Z`,
    }));
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: commitLines(['aaa', 'bbb']), stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') {
        expect(Number(args[args.indexOf('--limit') + 1]), 'the fixture must fill exactly one page').toBe(limit);
        return { ok: true, stdout: JSON.stringify(page), stderr: '' };
      }
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit }).status).toBe('unreadable-merges');
  });

  it('switches autonomy off when the revert lands but cannot be marked', () => {
    // The revert succeeded, so the change is off main — but nothing now
    // stops a later red build choosing the same pull request again, and
    // reverting a revert re-lands the regression. Failing closed is the only
    // safe answer.
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: mergedListJson([{ pr: 7, sha: 'aaa' }]), stderr: '' };
      if (args[0] === 'pr' && args[1] === 'revert') return { ok: true, stdout: 'https://github.com/o/r/pull/999\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'merge') return { ok: true, stdout: '', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'edit') return { ok: false, stdout: '', stderr: 'HTTP 403' };
      if (args[0] === 'label') return { ok: false, stdout: '', stderr: 'HTTP 403' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    const result = runWatch(root, { range: 5 }, { gh, now, git: okGit });

    expect(result.status, 'the revert really did happen').toBe('reverted');
    expect(result.status === 'reverted' && result.mark?.ok).toBe(false);
    expect(isAutonomyDisabled(root)).toBe(true);
  });

  it('judges the commit it was given, not whatever main has become since', () => {
    // The ninth built-but-never-invoked bug. The watcher now runs from a
    // workflow_run event once CI has concluded, and by then the tip of main
    // may already be a newer commit whose own checks have not started. Judging
    // range[0] would read that newer commit — pending, or green — and stand
    // down on a regression CI has already reported.
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) {
        const sha = args[1].split('/commits/')[1]?.split('/check-runs')[0];
        return { ok: true, stdout: sha === 'judged' ? 'failure\n' : 'success\n', stderr: '' };
      }
      // Deliberately tip-first and ignoring the sha= parameter: a run that
      // trusts range[0] sees 'tip', whose checks are green.
      if (args[0] === 'api' && args[1]?.includes('/commits?')) {
        return { ok: true, stdout: commitLines(['tip', 'judged']), stderr: '' };
      }
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: '[]', stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    const result = runWatch(root, { range: 5, sha: 'judged' }, { gh, now, git: okGit });

    // Reaching the merged-pull-request lookup at all proves it read red.
    expect(result).toEqual({ status: 'no-culprit' });
    expect(calls.find((c) => c[1]?.includes('/check-runs'))?.[1]).toContain('/commits/judged/check-runs');
  });

  it('asks GitHub for the commits reachable from the judged SHA, not from the branch tip', () => {
    // Without sha=, the listing is rooted at the default branch, so a tip that
    // has moved on puts commits CI never saw into the failing range — and
    // chooseCulprit takes the newest match in that range.
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'success\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: commitLines(['judged']), stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    runWatch(root, { range: 5, sha: 'judged' }, { gh, now, git: okGit });

    expect(calls.find((c) => c[0] === 'api' && c[1]?.includes('/commits?'))?.[1]).toContain('sha=judged');
  });

  it('falls back to the tip of main when no SHA is supplied, for a hand-run check', () => {
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'success\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: commitLines(['tip', 'older']), stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'green' });
    expect(calls.find((c) => c[0] === 'api' && c[1]?.includes('/commits?'))?.[1]).not.toContain('sha=');
    expect(calls.find((c) => c[1]?.includes('/check-runs'))?.[1]).toContain('/commits/tip/check-runs');
  });

  it('stands down on a full page of marked merges only when one could still be in range', () => {
    // A repository that has ever merged 100 pull requests through Thesmos
    // fills the lookup page forever, and nothing removes the mark. Treating a
    // full page as unreadable would turn every honest "nothing of ours" into
    // an alarm on every red-main run — and a warning that fires every time is
    // wallpaper. A page whose oldest row predates the whole failing range
    // cannot be hiding one on page two.
    const page = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      labels: [{ name: MERGED_LABEL }],
      mergeCommit: { oid: `other-sha-${i}` },
      mergedAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
    }));
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: commitLines(['aaa', 'bbb']), stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: JSON.stringify(page), stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    expect(runWatch(root, { range: 5 }, { gh, now, git: okGit })).toEqual({ status: 'no-culprit' });
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
