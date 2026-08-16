// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { syncState, formatSyncFailure, LEDGER_PATH, type Runner } from './sync.ts';

/** Records every git invocation and answers from a table of prefixes. */
function fakeGit(answers: Record<string, { ok: boolean; stdout?: string; stderr?: string }>, calls: string[][]): Runner {
  return (args) => {
    calls.push(args);
    const verb = args.find((a) => !a.startsWith('-') && a !== args[1]) ?? '';
    const key = Object.keys(answers).find((k) => args.includes(k)) ?? verb;
    const a = answers[key] ?? { ok: true };
    return { ok: a.ok, stdout: a.stdout ?? '', stderr: a.stderr ?? '' };
  };
}

const STAGED = { 'diff': { ok: true, stdout: `${LEDGER_PATH}\n` } };
const ON_MAIN = { 'rev-parse': { ok: true, stdout: 'main\n' } };

describe('syncState', () => {
  it('stages, commits only the named paths, and pushes the current branch', () => {
    const calls: string[][] = [];
    const git = fakeGit({ ...STAGED, ...ON_MAIN }, calls);

    const result = syncState('/repo', [LEDGER_PATH], 'chore(thesmos): record merged pull requests', { git });

    expect(result.ok).toBe(true);
    const commit = calls.find((c) => c.includes('commit'))!;
    expect(commit).toContain('-C');
    expect(commit).toContain('/repo');
    // `-- <paths>` is what keeps a user's unrelated staged work out of an
    // automated commit.
    expect(commit.slice(commit.indexOf('--') + 1)).toEqual([LEDGER_PATH]);
    expect(calls.some((c) => c.includes('push') && c.includes('main'))).toBe(true);
  });

  it('marks every automated commit [skip ci], so a ledger push cannot re-trigger the watcher that wrote it', () => {
    const calls: string[][] = [];
    syncState('/repo', [LEDGER_PATH], 'chore(thesmos): record merged pull requests', { git: fakeGit({ ...STAGED, ...ON_MAIN }, calls) });

    const commit = calls.find((c) => c.includes('commit'))!;
    expect(commit[commit.indexOf('-m') + 1]).toMatch(/\[skip ci\]$/);
  });

  it('reports nothing-to-do rather than an empty commit when the state has not changed', () => {
    const calls: string[][] = [];
    const git = fakeGit({ 'diff': { ok: true, stdout: '' }, ...ON_MAIN }, calls);

    expect(syncState('/repo', [LEDGER_PATH], 'msg', { git })).toEqual({ ok: true, noop: true });
    expect(calls.some((c) => c.includes('commit'))).toBe(false);
  });

  it('reports a rejected push honestly instead of throwing or claiming success', () => {
    // A protected default branch rejects a direct push. This is the expected
    // outcome on many real repos, including this one — it must be reported,
    // never swallowed, and never allowed to look like success.
    const git = fakeGit({
      ...STAGED, ...ON_MAIN,
      'push': { ok: false, stderr: 'protected branch hook declined' },
    }, []);

    const result = syncState('/repo', [LEDGER_PATH], 'msg', { git });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/protected branch/);
  });

  it('refuses to guess a branch when HEAD is detached', () => {
    const git = fakeGit({ ...STAGED, 'rev-parse': { ok: true, stdout: 'HEAD\n' } }, []);
    const result = syncState('/repo', [LEDGER_PATH], 'msg', { git });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no branch checked out/);
  });

  it('survives a git runner that throws rather than returning a failure', () => {
    const git: Runner = () => { throw new Error('git exploded'); };
    const result = syncState('/repo', [LEDGER_PATH], 'msg', { git });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/git exploded/);
  });

  it('tolerates a path that has never existed, so an absent sentinel is not an error', () => {
    const calls: string[][] = [];
    const git = fakeGit({
      'add': { ok: false, stderr: "pathspec '.thesmos/autonomy-disabled' did not match any files" },
      ...STAGED, ...ON_MAIN,
    }, calls);

    expect(syncState('/repo', [LEDGER_PATH, '.thesmos/autonomy-disabled'], 'msg', { git }).ok).toBe(true);
  });
});

describe('formatSyncFailure', () => {
  it('says the actions really happened before it says the record did not save', () => {
    const out = formatSyncFailure({ ok: false, detail: 'protected branch hook declined' });
    expect(out.indexOf('really did happen')).toBeLessThan(out.indexOf('could not save'));
    expect(out).toMatch(/automatic revert.*cannot see/i);
  });

  it('says nothing at all when the state was published', () => {
    expect(formatSyncFailure({ ok: true })).toBe('');
  });
});

describe('the ledger is committed, not ignored', () => {
  it('is not excluded by this repo\'s own .gitignore', () => {
    // The bug this file exists to close, asserted against the real repo
    // rather than a fixture: while this path was git-ignored, the GitHub
    // Action's fresh checkout never contained it, readEntries returned []
    // every time, and auto-revert could not fire in production at all. No
    // unit test could catch that — only asking git itself.
    const r = spawnSync('git', ['check-ignore', '-q', LEDGER_PATH], { encoding: 'utf8' });
    expect(r.status, `${LEDGER_PATH} must not be git-ignored`).not.toBe(0);
  });
});
