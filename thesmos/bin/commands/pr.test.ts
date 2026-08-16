// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyGhResult, detectDefaultBranch, formatExplain, makeGhRunner, runPr, type RawGhResult } from './pr.ts';
import type { MergePlan } from '../../pr/plan.ts';
import { buildGraph } from '../../pr/graph.ts';
import { isAutonomyDisabled, setAutonomy, type GhRunner } from '../../pr/execute.ts';
import type { PullRequest } from '../../pr/types.ts';

const testNow = () => new Date('2026-08-16T12:00:00Z');

/** A root dir for tests that never touch the filesystem (queue/explain paths). */
const UNUSED_ROOT = '/dev/null/thesmos-unused-root';

const pr = (number: number): PullRequest => ({
  number,
  title: `pr #${number}`,
  isDraft: false,
  baseRefName: 'main',
  headRefName: `branch-${number}`,
  mergeStateStatus: 'CLEAN',
  changedFiles: 1,
  files: ['a.ts'],
});

/** Builds the raw JSON `gh pr list --json ...` would return, from plain fixtures. */
const ghPrListJson = (list: Array<{
  number: number; title: string; baseRefName: string; headRefName: string; files?: string[];
}>): string => JSON.stringify(list.map((p) => ({
  number: p.number,
  title: p.title,
  isDraft: false,
  baseRefName: p.baseRefName,
  headRefName: p.headRefName,
  mergeStateStatus: 'CLEAN',
  changedFiles: p.files?.length ?? 0,
  files: (p.files ?? []).map((path) => ({ path })),
})));

/** A GhRunner that answers both `gh repo view` and `gh pr list` from fixtures. */
const fakeGh = (defaultBranch: string, prListJson: string): GhRunner => (args) =>
  args[0] === 'repo'
    ? { ok: true, stdout: `${defaultBranch}\n`, stderr: '' }
    : { ok: true, stdout: prListJson, stderr: '' };

describe('classifyGhResult', () => {
  it('names the missing CLI clearly when gh is not installed (ENOENT)', () => {
    const r: RawGhResult = {
      error: Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' }),
      status: null,
      stdout: null,
      stderr: null,
    };
    const out = classifyGhResult(r);
    expect(out.ok).toBe(false);
    expect(out.stdout).toBe('');
    expect(out.stderr).toMatch(/gh.*not found/i);
    expect(out.stderr).toMatch(/cli\.github\.com/);
  });

  it('falls back to the raw error message for a non-ENOENT spawn error', () => {
    const r: RawGhResult = {
      error: Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }),
      status: null,
      stdout: null,
      stderr: null,
    };
    const out = classifyGhResult(r);
    expect(out.ok).toBe(false);
    expect(out.stderr).toBe('EACCES: permission denied');
  });

  it('reports ok:true and passes stdout/stderr through on a clean run', () => {
    const out = classifyGhResult({ error: undefined, status: 0, stdout: '[]', stderr: '' });
    expect(out).toEqual({ ok: true, stdout: '[]', stderr: '' });
  });

  it('reports ok:false with the process stderr when gh runs but exits non-zero', () => {
    const out = classifyGhResult({ error: undefined, status: 1, stdout: '', stderr: 'not logged in' });
    expect(out.ok).toBe(false);
    expect(out.stderr).toBe('not logged in');
  });
});

describe('detectDefaultBranch', () => {
  it('uses the branch gh reports', () => {
    const branch = detectDefaultBranch(() => ({ ok: true, stdout: 'develop\n', stderr: '' }));
    expect(branch).toBe('develop');
  });

  it('falls back to main when gh fails, so a repo with no default-branch access still gets a plan', () => {
    const branch = detectDefaultBranch(() => ({ ok: false, stdout: '', stderr: 'not logged in' }));
    expect(branch).toBe('main');
  });

  it('falls back to main when gh succeeds but returns nothing usable', () => {
    const branch = detectDefaultBranch(() => ({ ok: true, stdout: '', stderr: '' }));
    expect(branch).toBe('main');
  });

  it('rooting a real repo graph by the derived branch differs from — and corrects — a hardcoded "main"', () => {
    // Repo default branch is "develop". PR #1 happens to have a branch
    // literally named "develop" (e.g. a one-off sync/mirror PR) — an
    // incidental but realistic collision. PR #2 is an independent PR based
    // on the true default branch. A hardcoded defaultBranch of 'main'
    // (the brief's original, unconditional value) looks up "develop" in
    // the head-ref map and wrongly nests #2 underneath #1; deriving the
    // branch correctly recognizes #2 as its own root.
    const prs: PullRequest[] = [
      { ...pr(1), baseRefName: 'main', headRefName: 'develop' },
      { ...pr(2), baseRefName: 'develop', headRefName: 'feature-x' },
    ];

    const derived = detectDefaultBranch(() => ({ ok: true, stdout: 'develop\n', stderr: '' }));
    expect(derived).toBe('develop');

    const correctGraph = buildGraph(prs, derived);
    expect(correctGraph.nodes.get(2)?.parent).toBeNull();
    expect(correctGraph.roots).toContain(2);

    // The bug this replaces: hardcoding 'main' silently mis-roots #2 as a
    // child of #1 instead of an independent PR — no error, just a wrong plan.
    const hardcodedGraph = buildGraph(prs, 'main');
    expect(hardcodedGraph.nodes.get(2)?.parent).toBe(1);
  });
});

describe('formatExplain', () => {
  const prs = [pr(101), pr(102)];

  it('rejects a missing argument without crashing', () => {
    const plan: MergePlan = { waves: [], halted: [] };
    expect(formatExplain(undefined, prs, plan)).toMatch(/is not a pull request number/);
  });

  it('rejects a non-numeric argument', () => {
    const plan: MergePlan = { waves: [], halted: [] };
    expect(formatExplain('abc', prs, plan)).toMatch(/"abc" is not a pull request number/);
  });

  it('reports the halt reason for a PR that is stuck', () => {
    const plan: MergePlan = {
      waves: [],
      halted: [{ number: 101, reason: 'DIRTY', detail: 'merge conflict — needs a human', blocks: [] }],
    };
    expect(formatExplain('101', prs, plan)).toBe('  #101 — merge conflict — needs a human\n');
  });

  it('says a PR is ready when it is in the list and not halted', () => {
    const plan: MergePlan = { waves: [[{ number: 102, wave: 0 }]], halted: [] };
    expect(formatExplain('102', prs, plan)).toBe('  #102 is ready to merge.\n');
  });

  it('distinguishes "not found" from "ready" for a PR number that was never open, instead of misreporting it as ready', () => {
    const plan: MergePlan = { waves: [[{ number: 102, wave: 0 }]], halted: [] };
    const out = formatExplain('99999', prs, plan);
    expect(out).toMatch(/#99999 is not among the 2 open pull requests/);
    expect(out).not.toMatch(/ready to merge/);
  });
});

// ── runPr — proves the wiring, not just the extracted pieces ───────────────
//
// classifyGhResult, detectDefaultBranch, and formatExplain were all tested
// above in isolation, but nothing proved cmdPr actually calls them with the
// right arguments. These tests drive runPr — the function cmdPr delegates
// to with real dependencies — with fake gh/write, so a regression in the
// *wiring* (not just the extracted logic) fails a test.

describe('runPr — default branch derivation is actually used by pr:queue', () => {
  it('roots the plan by the branch gh reports, not a hardcoded "main"', () => {
    // PR #1's branch happens to be literally named "develop" (a realistic
    // incidental collision — e.g. a one-off sync/mirror PR). PR #2 is an
    // independent PR based on the repo's real default branch, "develop".
    // If runPr ever hardcodes defaultBranch back to 'main', PR #2's base
    // ("develop") gets looked up in the head-ref map, finds PR #1, and #2
    // is wrongly nested underneath it instead of being its own root.
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore: sync', baseRefName: 'main', headRefName: 'develop', files: ['README.md'] },
      { number: 2, title: 'feat: on develop', baseRefName: 'develop', headRefName: 'feature-x', files: ['README.md'] },
    ]);

    let out = '';
    runPr(['queue'], { gh: fakeGh('develop', prListJson), write: (s) => { out += s; }, root: UNUSED_ROOT, now: testNow });

    expect(out).toContain('✓ 2 ready to merge');
    const line2 = out.split('\n').find((l) => l.includes('#2'));
    expect(line2).toBeDefined();
    expect(line2).not.toMatch(/after wave/);
  });
});

describe('runPr — pr:explain formatting is actually used for a PR that was never open', () => {
  it('reports "not among the open pull requests", not "ready to merge"', () => {
    const prListJson = ghPrListJson([
      { number: 100, title: 'chore: a', baseRefName: 'main', headRefName: 'a', files: ['README.md'] },
      { number: 101, title: 'chore: b', baseRefName: 'main', headRefName: 'b', files: ['README.md'] },
    ]);

    let out = '';
    runPr(['explain', '999'], { gh: fakeGh('main', prListJson), write: (s) => { out += s; }, root: UNUSED_ROOT, now: testNow });

    expect(out).toBe('  #999 is not among the 2 open pull requests I looked at. Run "thesmos pr:queue" to see the current list.\n');
  });
});

// ── runPr — pr:merge and autonomy dispatch ──────────────────────────────────
//
// runMerge itself is exercised directly (with a fake gh) in
// thesmos/pr/merge-command.test.ts. These tests drive the dispatch inside
// runPr — the same seam queue/explain are proven through above — so a
// regression in the *wiring* between the CLI subcommand and runMerge/
// setAutonomy/isAutonomyDisabled fails a test, not just a regression in the
// extracted logic.

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'thesmos-pr-cmd-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  return root;
}

describe('runPr — pr:merge is actually wired to runMerge', () => {
  it('merges the reversible PR, never the one-way PR, and reports it in the output', () => {
    const root = freshRoot();
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', baseRefName: 'main', headRefName: 'a', files: ['package-lock.json'] },
      { number: 2, title: 'chore(deps): bump b from 1.0.0 to 2.0.0', baseRefName: 'main', headRefName: 'b', files: ['package-lock.json'] },
    ]);
    const baseGh = fakeGh('main', prListJson);
    const calls: string[][] = [];
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    let out = '';
    runPr(['merge', '--wave', '0'], { gh, write: (s) => { out += s; }, root, now: testNow });

    expect(out).toContain('#1');
    expect(out).not.toContain('#2');
    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['1']);
  });
});

describe('runPr — pr:merge refuses when autonomy is off (governing property 3)', () => {
  it('never calls gh at all and says plainly that autonomy is off', () => {
    const root = freshRoot();
    setAutonomy(root, false);
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', baseRefName: 'main', headRefName: 'a', files: ['package-lock.json'] },
    ]);
    const baseGh = fakeGh('main', prListJson);
    const calls: string[][] = [];
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    let out = '';
    runPr(['merge'], { gh, write: (s) => { out += s; }, root, now: testNow });

    expect(out).toMatch(/autonomy is off/i);
    expect(calls).toEqual([]);
  });
});

describe('runPr — autonomy on/off/status', () => {
  it('toggles the sentinel via setAutonomy and reports plain-language state, without ever calling gh', () => {
    const root = freshRoot();
    const gh: GhRunner = () => { throw new Error('gh must never be called to toggle a local switch'); };

    let out = '';
    runPr(['autonomy', 'off'], { gh, write: (s) => { out += s; }, root, now: testNow });
    expect(isAutonomyDisabled(root)).toBe(true);
    expect(out).toMatch(/off/i);

    out = '';
    runPr(['autonomy'], { gh, write: (s) => { out += s; }, root, now: testNow });
    expect(out).toMatch(/off/i);

    out = '';
    runPr(['autonomy', 'on'], { gh, write: (s) => { out += s; }, root, now: testNow });
    expect(isAutonomyDisabled(root)).toBe(false);
    expect(out).toMatch(/on/i);
  });
});

// ── makeGhRunner — proves classifyGhResult is wired into realGh's exact composition ──
//
// realGh is defined as makeGhRunner(spawn), so testing makeGhRunner with a
// fake spawn function exercises the identical composition that produces
// realGh, not a parallel reimplementation. The one thing this cannot prove
// without an actual missing `gh` binary or a mocked child_process module is
// that `spawnSync` itself (Node's real implementation) is the function
// passed in — that seam is accepted as untested here.

describe('makeGhRunner', () => {
  it('surfaces the ENOENT hint through the same spawn-then-classify path realGh uses', () => {
    const enoent = Object.assign(new Error('spawnSync gh ENOENT'), { code: 'ENOENT' });
    const gh = makeGhRunner(() => ({ error: enoent, status: null, stdout: null, stderr: null }));
    const result = gh(['pr', 'list']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toMatch(/gh.*not found/i);
    expect(result.stderr).toMatch(/cli\.github\.com/);
  });

  it('passes a clean spawn result through unchanged', () => {
    const gh = makeGhRunner(() => ({ error: undefined, status: 0, stdout: '[]', stderr: '' }));
    expect(gh(['pr', 'list'])).toEqual({ ok: true, stdout: '[]', stderr: '' });
  });
});
