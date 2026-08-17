// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncState, formatSyncFailure, LEDGER_PATH, type Runner } from './sync.ts';

// Repo root, derived from this file's own location rather than process.cwd() —
// other tests in this suite chdir into temp directories, and inheriting an
// ambient cwd would make this check order-dependent on whatever ran before it.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

  it('fails loudly when a file that is on disk cannot be staged, instead of reporting a quiet no-op', () => {
    // The revival scenario for CRITICAL 1: if the ledger were git-ignored
    // again, `git add` refuses it, nothing lands in the index, and the
    // "nothing to publish" branch would otherwise report ok — leaving
    // auto-revert blind with no signal at all. Distinguishing "absent" from
    // "refused" is what makes the tolerance above safe.
    const root = mkdtempSync(join(tmpdir(), 'thesmos-sync-'));
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, LEDGER_PATH), '{"pr":1}\n');

    const git = fakeGit({
      'add': { ok: false, stderr: 'The following paths are ignored by one of your .gitignore files:\n.thesmos/pr-ledger.jsonl' },
      'diff': { ok: true, stdout: '' },
    }, []);

    const result = syncState(root, [LEDGER_PATH], 'msg', { git });
    expect(result.ok).toBe(false);
    expect(result.noop).toBeUndefined();
    expect(result.detail).toMatch(/on disk but git refused to stage it/);
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
  it('says the actions really happened before it says the record did not publish', () => {
    const out = formatSyncFailure({ ok: false, detail: 'protected branch hook declined' });
    expect(out.indexOf('really did happen')).toBeLessThan(out.indexOf('could not publish'));
    expect(out).toContain('protected branch hook declined');
  });

  it('no longer claims auto-revert has gone blind, because it has not', () => {
    // The old wording said "the automatic revert that runs on GitHub cannot
    // see these merges", which was true while the ledger was the transport
    // and is now false: the Action reconstructs its view from GitHub's own
    // record (thesmos/pr/marks.ts). A warning that is no longer true is worse
    // than no warning — it teaches the reader to ignore the next one.
    const out = formatSyncFailure({ ok: false, detail: 'protected branch hook declined' });
    expect(out).not.toMatch(/cannot see these merges/i);
    expect(out).toMatch(/does not read this file/i);
  });

  it('does not go quiet either — the audit trail really did stay local', () => {
    const out = formatSyncFailure({ ok: false, detail: 'protected branch hook declined' });
    expect(out).toMatch(/only on this machine/i);
    expect(out).toContain(LEDGER_PATH);
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
    const r = spawnSync('git', ['check-ignore', '-q', LEDGER_PATH], { encoding: 'utf8', cwd: REPO_ROOT });
    // git check-ignore exits 1 for "not ignored" (what we want) and 0 for
    // "ignored" (the bug). It also exits 128 when it cannot even ask — e.g.
    // outside a git repo — which must not be mistaken for a pass.
    if (r.status === 128) {
      throw new Error(`git check-ignore could not run (status 128): ${r.stderr}`);
    }
    expect(r.status, `${LEDGER_PATH} must not be git-ignored`).toBe(1);
  });
});
