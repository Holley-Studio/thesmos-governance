// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The handoff between the two halves of the system, tested from the reading
 * end: everything else in this suite reads the ledger back from the very
 * directory that just wrote it, which is precisely why nothing caught the
 * bug. `thesmos pr:watch` runs on a GitHub Action against a fresh
 * `actions/checkout` — a directory the merging process never touched. These
 * tests exercise that shape by wiring a fake `git` that really moves bytes
 * into a "remote", and then reading from a *different* root entirely.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runMerge, runWatch } from '../bin/commands/pr.ts';
import { readEntries } from './ledger.ts';
import { chooseCulprit } from './revert.ts';
import { isAutonomyDisabled } from './execute.ts';
import { LEDGER_PATH, SENTINEL_PATH, type Runner } from './sync.ts';
import type { GhRunner } from './execute.ts';

const now = () => new Date('2026-08-16T12:00:00Z');

let authorRoot: string;   // the laptop that merges
let remote: string;       // "origin"
let actionRoot: string;   // the runner's fresh checkout

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'thesmos-handoff-'));
  authorRoot = join(base, 'laptop');
  remote = join(base, 'remote');
  actionRoot = join(base, 'runner');
  for (const d of [authorRoot, remote, actionRoot]) mkdirSync(join(d, '.thesmos'), { recursive: true });
});

/**
 * A git that actually publishes: `push` copies the tracked paths from the
 * working root into `remote`. Enough to prove state crosses the boundary,
 * without needing a real repository. `staged` stands in for the index.
 */
function publishingGit(root: string): { git: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const staged = new Set<string>();
  const git: Runner = (args) => {
    calls.push(args);
    const rest = args.slice(2); // drop ['-C', root]
    const verb = rest.find((a) => ['add', 'diff', 'commit', 'rev-parse', 'push'].includes(a));
    const paths = rest.slice(rest.lastIndexOf('--') + 1).filter((p) => p.startsWith('.thesmos/'));

    if (verb === 'add') {
      for (const p of paths) if (existsSync(join(root, p))) staged.add(p);
      return { ok: true, stdout: '', stderr: '' };
    }
    if (verb === 'diff') return { ok: true, stdout: [...staged].join('\n'), stderr: '' };
    if (verb === 'commit') return { ok: true, stdout: '', stderr: '' };
    if (verb === 'rev-parse') return { ok: true, stdout: 'main\n', stderr: '' };
    if (verb === 'push') {
      for (const p of staged) {
        mkdirSync(dirname(join(remote, p)), { recursive: true });
        cpSync(join(root, p), join(remote, p));
      }
      // A deletion staged for a path that no longer exists locally must also
      // reach the remote — otherwise `autonomy on` never clears the sentinel.
      for (const p of [LEDGER_PATH, SENTINEL_PATH]) {
        if (!existsSync(join(root, p)) && existsSync(join(remote, p))) rmSync(join(remote, p));
      }
      return { ok: true, stdout: '', stderr: '' };
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  return { git, calls };
}

/** What `actions/checkout` gives the runner: whatever is on the remote. */
function checkout(): void {
  for (const p of [LEDGER_PATH, SENTINEL_PATH]) {
    const from = join(remote, p);
    const to = join(actionRoot, p);
    rmSync(to, { force: true });
    if (existsSync(from)) { mkdirSync(dirname(to), { recursive: true }); cpSync(from, to); }
  }
}

const PRS = JSON.stringify([
  { number: 42, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', isDraft: false, baseRefName: 'main',
    headRefName: 'a', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'package-lock.json' }] },
]);

const mergingGh: GhRunner = (args) => {
  if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: PRS, stderr: '' };
  if (args[0] === 'pr' && args[1] === 'view') return { ok: true, stdout: 'deadbeef\n', stderr: '' };
  return { ok: true, stdout: '', stderr: '' };
};

describe('the merge ledger reaches a checkout the merging process never wrote to', () => {
  it('lets the watcher, reading a fresh checkout, find the culprit for a red main', () => {
    const { git } = publishingGit(authorRoot);
    const result = runMerge(authorRoot, { wave: 'all' }, { gh: mergingGh, now, git });
    expect(result.merged).toEqual([42]);
    expect(result.sync?.ok).toBe(true);

    checkout(); // the Action starts here, with nothing of its own

    const entries = readEntries(actionRoot);
    expect(entries.length, 'the runner must be able to read the ledger at all').toBeGreaterThan(0);

    const culprit = chooseCulprit(entries, ['deadbeef']);
    expect(culprit, 'auto-revert is inert unless the culprit is findable from the runner').not.toBeNull();
    expect(culprit!.pr).toBe(42);
  });

  it('is genuinely a different directory — the runner has no ledger of its own before checkout', () => {
    // Guards the test itself: if actionRoot ever shared a path with
    // authorRoot the assertion above would pass without anything crossing
    // the boundary, which is the exact class of mistake being tested for.
    const { git } = publishingGit(authorRoot);
    runMerge(authorRoot, { wave: 'all' }, { gh: mergingGh, now, git });

    expect(actionRoot).not.toBe(authorRoot);
    expect(readEntries(actionRoot)).toEqual([]);
    expect(readEntries(authorRoot).length).toBeGreaterThan(0);
  });

  it('reports the merges as real even when the push is rejected, and says the watcher cannot see them', () => {
    const rejectingGit: Runner = (args) => {
      if (args.includes('push')) return { ok: false, stdout: '', stderr: 'protected branch hook declined' };
      if (args.includes('diff')) return { ok: true, stdout: `${LEDGER_PATH}\n`, stderr: '' };
      if (args.includes('rev-parse')) return { ok: true, stdout: 'main\n', stderr: '' };
      return { ok: true, stdout: '', stderr: '' };
    };

    const result = runMerge(authorRoot, { wave: 'all' }, { gh: mergingGh, now, git: rejectingGit });

    expect(result.merged, 'a merge that happened must never be reported as not-happened').toEqual([42]);
    expect(result.sync?.ok).toBe(false);
    expect(result.sync?.detail).toMatch(/protected branch/);
    checkout();
    expect(readEntries(actionRoot)).toEqual([]);
  });
});

describe('the autonomy sentinel reaches the unattended half', () => {
  it('is visible to a fresh checkout after a failed revert turns autonomy off', () => {
    // Spec §6.2: one revert attempt per incident, never thrash. The guard
    // that enforces it is setAutonomy(root, false) inside performRevert —
    // worthless if it only ever lands on a runner that is about to be
    // destroyed.
    writeFileSync(join(authorRoot, LEDGER_PATH), JSON.stringify({
      ts: '2026-08-16T11:00:00Z', action: 'merge', pr: 7, phase: 'outcome', ok: true, mergeCommit: 'aaa',
    }) + '\n');
    const { git } = publishingGit(authorRoot);
    const failingGh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'revert') return { ok: false, stdout: '', stderr: 'no permission' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    const result = runWatch(authorRoot, { range: 5 }, { gh: failingGh, now, git });
    expect(result.status).toBe('revert-failed');

    checkout();
    expect(isAutonomyDisabled(actionRoot), 'the next push must find autonomy already off, or it will retry').toBe(true);
    expect(readFileSync(join(actionRoot, LEDGER_PATH), 'utf8')).toMatch(/"ok":false/);
  });
});
