// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * The handoff between the two halves of the system, tested from the reading
 * end: everything else in this suite reads state back from the very directory
 * that just wrote it, which is precisely why nothing caught the bug.
 * `thesmos pr:watch` runs on a GitHub Action against a fresh
 * `actions/checkout` — a directory the merging process never touched.
 *
 * The load-bearing half of this file is the last describe block, which proves
 * auto-revert fires with NO `.thesmos/pr-ledger.jsonl` on the Action side at
 * all. That is the exact production condition on any repository whose default
 * branch is protected: the ledger push is rejected, so the Action's checkout
 * never contains one. The handoff runs through GitHub itself
 * (thesmos/pr/marks.ts) instead.
 *
 * The blocks above it cover what the ledger still is — a local audit trail
 * the CLI publishes when it can — and the autonomy sentinel, which does still
 * travel through the repository.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runMerge, runWatch } from '../bin/commands/pr.ts';
import { ledgerPath, readEntries } from './ledger.ts';
import { chooseCulprit } from './revert.ts';
import { isAutonomyDisabled } from './execute.ts';
import { MERGED_LABEL, REVERTED_LABEL } from './marks.ts';
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

// ── the condition that actually holds in production ────────────────────────
//
// This repository's `main` carries an active ruleset enforcing pull_request
// and required_status_checks with an empty bypass_actors list, so the ledger
// push in thesmos/pr/sync.ts is rejected on every run. The Action's checkout
// therefore has no `.thesmos/pr-ledger.jsonl` at all — not a stale one, none.
// Every other test in this suite hands the watcher a ledger from somewhere.
// This one hands it nothing, and auto-revert must still fire.

/**
 * A fake GitHub that keeps state across calls: merging a pull request records
 * its merge commit, labelling it really attaches the label (and fails until
 * the label has been created, exactly as gh does on a repository that has
 * never had it), and the merged-pull-request listing is served from that same
 * state. Nothing in the test writes a label or a SHA by hand — if the two
 * halves ever disagree about the label name, the listing comes back empty and
 * the revert never happens.
 */
function fakeGitHub(open: Array<{ number: number; title: string; files: string[] }>) {
  const merged = new Map<number, { sha: string; labels: Set<string>; mergedAt: string }>();
  const labelsInRepo = new Set<string>();
  const calls: string[][] = [];
  let seq = 0;

  const openJson = JSON.stringify(open.map((p) => ({
    number: p.number, title: p.title, isDraft: false, baseRefName: 'main',
    headRefName: `branch-${p.number}`, mergeStateStatus: 'CLEAN',
    changedFiles: p.files.length, files: p.files.map((path) => ({ path })), statusCheckRollup: [],
  })));

  const ok = { ok: true, stdout: '', stderr: '' };
  const gh: GhRunner = (args) => {
    calls.push(args);
    const [a, b] = args;
    const arg = (flag: string): string => args[args.indexOf(flag) + 1];

    if (a === 'repo') return { ok: true, stdout: 'main\n', stderr: '' };
    // Declining the tree lookup leaves pathsOnTarget undefined, which disables
    // the OBSOLETE check — irrelevant to this test and safest when unknown.
    if (a === 'api' && args[1].includes('git/trees')) return { ok: false, stdout: '', stderr: 'HTTP 404' };

    if (a === 'api' && args[1].includes('/commits?')) {
      // Newest first, exactly as the GitHub commits endpoint returns them. The
      // tip is an unrelated commit so that the check-run lookup below and the
      // culprit match are genuinely separate facts.
      const shas = [...merged.values()].map((m) => m.sha).reverse();
      return { ok: true, stdout: ['tip-of-main', ...shas].join('\n') + '\n', stderr: '' };
    }
    if (a === 'api' && args[1].includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };

    if (a === 'pr' && b === 'list') {
      if (arg('--state') === 'open') return { ok: true, stdout: openJson, stderr: '' };
      const want = arg('--label');
      const rows = [...merged.entries()]
        .filter(([, m]) => m.labels.has(want))
        .map(([number, m]) => ({
          number,
          labels: [...m.labels].map((name) => ({ name })),
          mergeCommit: { oid: m.sha },
          mergedAt: m.mergedAt,
        }));
      return { ok: true, stdout: JSON.stringify(rows), stderr: '' };
    }

    if (a === 'pr' && b === 'merge') {
      const n = Number(args[2]);
      seq += 1;
      if (!merged.has(n)) {
        merged.set(n, { sha: `merge-sha-${n}`, labels: new Set(), mergedAt: `2026-08-16T12:00:${String(seq).padStart(2, '0')}Z` });
      }
      return ok;
    }
    if (a === 'pr' && b === 'view') return { ok: true, stdout: `${merged.get(Number(args[2]))?.sha ?? ''}\n`, stderr: '' };
    if (a === 'pr' && b === 'edit') {
      const label = arg('--add-label');
      if (!labelsInRepo.has(label)) return { ok: false, stdout: '', stderr: `could not add label: '${label}' not found` };
      const m = merged.get(Number(args[2]));
      if (!m) return { ok: false, stdout: '', stderr: 'no such merged pull request' };
      m.labels.add(label);
      return ok;
    }
    if (a === 'label' && b === 'create') {
      if (labelsInRepo.has(args[2])) return { ok: false, stdout: '', stderr: 'label already exists' };
      labelsInRepo.add(args[2]);
      return ok;
    }
    if (a === 'pr' && b === 'revert') return { ok: true, stdout: 'https://github.com/o/r/pull/999\n', stderr: '' };

    throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
  };

  return { gh, calls, merged, labelsInRepo };
}

/** A git that rejects every push, as a protected default branch really does. */
const protectedBranchGit: Runner = (args) => args.includes('push')
  ? { ok: false, stdout: '', stderr: 'GH013: Repository rule violations found for refs/heads/main' }
  : { ok: true, stdout: 'main\n', stderr: '' };

describe('auto-revert fires with no ledger on the Action side at all', () => {
  it('reverts the merge it made, from a fresh directory that has never held a ledger', () => {
    const github = fakeGitHub([{ number: 42, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', files: ['package-lock.json'] }]);

    // The laptop merges. Every push is rejected, so nothing about this run
    // reaches the repository.
    const merge = runMerge(authorRoot, { wave: 'all' }, { gh: github.gh, now, git: protectedBranchGit });
    expect(merge.merged, 'the merge itself must succeed').toEqual([42]);
    expect(merge.unmarked, 'and it must have been marked on GitHub').toEqual([]);
    expect(merge.sync?.ok, 'while the ledger push is rejected, as it really is here').toBe(false);

    // The runner. No checkout step is simulated because there is nothing to
    // check out — this is a directory that has never seen a ledger.
    expect(existsSync(ledgerPath(actionRoot)), 'the Action side must genuinely have no ledger').toBe(false);
    expect(readEntries(actionRoot)).toEqual([]);

    const watch = runWatch(actionRoot, { range: 5 }, { gh: github.gh, now, git: protectedBranchGit });

    expect(watch.status, 'auto-revert must fire without the ledger ever crossing').toBe('reverted');
    expect(watch).toMatchObject({ status: 'reverted', pr: 42 });
    // The revert PR (#999) is what gets merged, never the original — proof
    // this drove performRevert's real create-then-merge sequence.
    expect(github.calls.some((c) => c[0] === 'pr' && c[1] === 'revert' && c[2] === '42')).toBe(true);
    expect(github.calls.some((c) => c[0] === 'pr' && c[1] === 'merge' && c[2] === '999')).toBe(true);
  });

  it('does not revert the same merge twice, because the revert is marked on GitHub too', () => {
    // The ledger's armedMerges bookkeeping did this for the local CLI. On the
    // Action side, where the ledger is empty and thrown away after every run,
    // the label is the only record that survives. Reverting an already-
    // reverted pull request would re-land the very change that broke main.
    const github = fakeGitHub([{ number: 42, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', files: ['package-lock.json'] }]);
    runMerge(authorRoot, { wave: 'all' }, { gh: github.gh, now, git: protectedBranchGit });

    const first = runWatch(actionRoot, { range: 5 }, { gh: github.gh, now, git: protectedBranchGit });
    expect(first.status).toBe('reverted');
    expect(github.merged.get(42)!.labels.has(REVERTED_LABEL)).toBe(true);

    // The next push to main, from another brand-new runner. main is still red.
    const secondRunner = mkdtempSync(join(tmpdir(), 'thesmos-runner2-'));
    const second = runWatch(secondRunner, { range: 5 }, { gh: github.gh, now, git: protectedBranchGit });
    expect(second.status).toBe('no-culprit');
  });

  it('creates the label on its very first merge, on a repository that has never had one', () => {
    const github = fakeGitHub([{ number: 42, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', files: ['package-lock.json'] }]);
    expect(github.labelsInRepo.size).toBe(0);

    runMerge(authorRoot, { wave: 'all' }, { gh: github.gh, now, git: protectedBranchGit });

    expect(github.labelsInRepo.has(MERGED_LABEL)).toBe(true);
    expect(github.merged.get(42)!.labels.has(MERGED_LABEL)).toBe(true);
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
    // The candidate comes from GitHub's marks, not that ledger line — the
    // ledger row above is only here so the published file has content to
    // carry the failed-revert outcome.
    const markedJson = JSON.stringify([{
      number: 7, labels: [{ name: MERGED_LABEL }], mergeCommit: { oid: 'aaa' }, mergedAt: '2026-08-16T11:00:00Z',
    }]);
    const failingGh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { ok: true, stdout: markedJson, stderr: '' };
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
