// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyGhResult, detectDefaultBranch, formatExplain, formatWatchResult, mainCheckStatus, makeGhRunner, parseRangeArg, parseWaveArg, runPr, type RawGhResult, type WatchResult } from './pr.ts';
import type { MergePlan } from '../../pr/plan.ts';
import { buildGraph } from '../../pr/graph.ts';
import { isAutonomyDisabled, setAutonomy, type GhRunner } from '../../pr/execute.ts';
import { appendEntry } from '../../pr/ledger.ts';
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

// ── runPr — OBSOLETE wiring: the plan actually fetches the target branch's tree ──
//
// Task 10 built detectObsolete as a pure function in thesmos/pr/lock.ts, but
// a pure function nobody calls in production is dead code. These tests
// prove runPr itself (not just detectObsolete in isolation) fetches the
// target branch's file listing via gh and threads it into computePlan as
// pathsOnTarget, and that a lookup gh can't answer degrades safely — never
// silently marks every open PR obsolete.

const treeJson = (paths: string[], truncated = false): string => JSON.stringify({ truncated, paths });

/** A GhRunner answering `gh repo view`, `gh pr list`, and the git-trees lookup used for pathsOnTarget. */
function fakeGhWithTree(
  defaultBranch: string,
  prListJson: string,
  tree: { ok: boolean; stdout?: string },
): GhRunner {
  return (args) => {
    if (args[0] === 'repo') return { ok: true, stdout: `${defaultBranch}\n`, stderr: '' };
    if (args[0] === 'api' && args[1]?.includes('git/trees')) {
      return { ok: tree.ok, stdout: tree.stdout ?? '', stderr: tree.ok ? '' : 'HTTP 404' };
    }
    return { ok: true, stdout: prListJson, stderr: '' };
  };
}

describe('runPr — OBSOLETE fires end-to-end through pr:queue via a real gh-shaped tree lookup', () => {
  it('halts a PR whose only changed file is absent from the fetched target-branch tree', () => {
    // Mirrors the #9/#6 case from the spec: a PR bumping a workflow file a
    // merged PR has already deleted.
    const prListJson = ghPrListJson([
      { number: 9, title: 'chore(deps): bump codeql-action', baseRefName: 'main', headRefName: 'dep', files: ['.github/workflows/codeql.yml'] },
    ]);
    const gh = fakeGhWithTree('main', prListJson, { ok: true, stdout: treeJson(['.github/workflows/ci.yml', 'README.md']) });

    let out = '';
    runPr(['queue'], { gh, write: (s) => { out += s; }, root: UNUSED_ROOT, now: testNow });

    expect(out).toMatch(/✗ #9/);
    expect(out).toMatch(/files it changes no longer exist/);
    expect(out).not.toMatch(/ready to merge/);
  });

  it('never touches a PR whose changed file is still present in the fetched tree', () => {
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', baseRefName: 'main', headRefName: 'a', files: ['package-lock.json'] },
    ]);
    const gh = fakeGhWithTree('main', prListJson, { ok: true, stdout: treeJson(['package-lock.json', 'README.md']) });

    let out = '';
    runPr(['queue'], { gh, write: (s) => { out += s; }, root: UNUSED_ROOT, now: testNow });

    expect(out).toContain('✓ 1 ready to merge');
  });
});

describe('runPr — a failed or unusable tree lookup never marks every PR obsolete', () => {
  it('still plans a normal PR when the git-trees gh call fails outright', () => {
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', baseRefName: 'main', headRefName: 'a', files: ['package-lock.json'] },
    ]);
    const gh = fakeGhWithTree('main', prListJson, { ok: false });

    let out = '';
    runPr(['queue'], { gh, write: (s) => { out += s; }, root: UNUSED_ROOT, now: testNow });

    expect(out).toContain('✓ 1 ready to merge');
    expect(out).not.toMatch(/no longer exist/);
  });

  it('still plans a normal PR when gh reports the tree as truncated', () => {
    // GitHub truncates very large recursive tree listings — a truncated
    // response cannot be trusted to prove absence, so it must be treated
    // the same as a failed lookup, not as ground truth.
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', baseRefName: 'main', headRefName: 'a', files: ['package-lock.json'] },
    ]);
    const gh = fakeGhWithTree('main', prListJson, { ok: true, stdout: treeJson(['package-lock.json'], true) });

    let out = '';
    runPr(['queue'], { gh, write: (s) => { out += s; }, root: UNUSED_ROOT, now: testNow });

    expect(out).toContain('✓ 1 ready to merge');
  });

  it('still plans a normal PR when gh returns an empty tree', () => {
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', baseRefName: 'main', headRefName: 'a', files: ['package-lock.json'] },
    ]);
    const gh = fakeGhWithTree('main', prListJson, { ok: true, stdout: treeJson([]) });

    let out = '';
    runPr(['queue'], { gh, write: (s) => { out += s; }, root: UNUSED_ROOT, now: testNow });

    expect(out).toContain('✓ 1 ready to merge');
  });
});

describe('parseWaveArg', () => {
  it('defaults to wave 0 when no flag is given', () => {
    // Number(undefined) is NaN, and NaN ?? 0 stays NaN because ?? only
    // replaces null/undefined — a naive `Number(argv[i+1] ?? 0)` reads as a
    // safe default but silently produces NaN here, which downstream turns
    // into "merge nothing, report success" instead of merging wave 0.
    expect(parseWaveArg(['merge'])).toBe(0);
  });

  it('reads the number after --wave', () => {
    expect(parseWaveArg(['merge', '--wave', '2'])).toBe(2);
  });

  it("returns 'all' when --all is present, taking priority over --wave", () => {
    expect(parseWaveArg(['merge', '--all'])).toBe('all');
    expect(parseWaveArg(['merge', '--wave', '1', '--all'])).toBe('all');
  });

  it('falls back to wave 0 for a non-numeric --wave value instead of propagating NaN', () => {
    expect(parseWaveArg(['merge', '--wave', 'banana'])).toBe(0);
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

  it('merges wave 0 by default when no --wave flag is given at all', () => {
    const root = freshRoot();
    const prListJson = ghPrListJson([
      { number: 1, title: 'chore(deps): bump a from 1.0.0 to 1.0.1', baseRefName: 'main', headRefName: 'a', files: ['package-lock.json'] },
    ]);
    const baseGh = fakeGh('main', prListJson);
    const calls: string[][] = [];
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    let out = '';
    runPr(['merge'], { gh, write: (s) => { out += s; }, root, now: testNow });

    const merges = calls.filter((c) => c[1] === 'merge').map((c) => c[2]);
    expect(merges).toEqual(['1']);
    expect(out).toContain('#1');
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

// ── pr:watch — reads main's check state, then reaches chooseCulprit/performRevert ──
//
// Task 8 built chooseCulprit/performRevert and the workflow that invokes
// `thesmos pr:watch`, but nothing registered the subcommand. These tests
// prove: (1) pr:watch actually determines whether main is currently red
// before doing anything (a push-triggered workflow fires on every push, not
// just failures, so watch must check this itself), and (2) when it is red,
// the wiring genuinely reaches chooseCulprit and performRevert — not just a
// message that looks right.

describe('parseRangeArg', () => {
  it('defaults to 5 when no --range flag is given', () => {
    expect(parseRangeArg(['watch'])).toBe(5);
  });

  it('reads the number after --range', () => {
    expect(parseRangeArg(['watch', '--range', '10'])).toBe(10);
  });

  it('falls back to 5 for a non-numeric --range value instead of propagating NaN', () => {
    // Same NaN trap as parseWaveArg: Number(undefined) is NaN and NaN ?? 5
    // stays NaN, so this must be an explicit Number.isFinite check.
    expect(parseRangeArg(['watch', '--range', 'banana'])).toBe(5);
  });
});

// mainCheckStatus is driven by realistic Checks API payloads — one
// conclusion string per check run, exactly what
// `.check_runs[] | (.conclusion // "pending")` actually prints (verified
// against a real `gh api` call: gh's --jq output is raw/unquoted, matching
// jq -r, not JSON-encoded) — not a pre-reduced count. A count-based mock
// can't distinguish "0 failures, all settled" from "0 failures, one still
// running", which is exactly the bug this rule exists to catch.
describe('mainCheckStatus', () => {
  it('reports green when every check run has concluded successfully', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: 'success\nsuccess\n', stderr: '' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('green');
  });

  it('reports red when at least one check run concluded as a failure', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: 'success\nfailure\n', stderr: '' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('red');
  });

  it('reports red for any concluded-but-not-passing conclusion, not just "failure" literally', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: 'cancelled\n', stderr: '' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('red');
  });

  it('reports pending, not green, when a settled success sits alongside a still-running check run', () => {
    // conclusion is null while a check run is queued/in_progress — GitHub
    // only sets it once status is "completed". The real jq filter maps
    // that null to the literal string "pending". thesmos-watch.yml fires
    // on the same push event a multi-job, multi-minute ci.yml matrix
    // reacts to, and watch is a single fast `gh api` call, so this mixed
    // shape — one check already green, others still running — is the
    // *normal* case on a real push, not an edge case.
    const gh: GhRunner = () => ({ ok: true, stdout: 'success\npending\n', stderr: '' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('pending');
  });

  it('reports pending when every check run is still queued or in progress', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: 'pending\npending\n', stderr: '' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('pending');
  });

  it('reports red even when a failure is mixed with still-pending checks — a real failure outranks a pending one', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: 'pending\nfailure\n', stderr: '' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('red');
  });

  it('reports unknown when the API call itself fails, rather than guessing a color', () => {
    const gh: GhRunner = () => ({ ok: false, stdout: '', stderr: 'HTTP 403' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('unknown');
  });

  it('reports unknown when no check runs were reported for the commit at all', () => {
    const gh: GhRunner = () => ({ ok: true, stdout: '', stderr: '' });
    expect(mainCheckStatus(gh, 'abc123')).toBe('unknown');
  });
});

describe('formatWatchResult', () => {
  it('formats each status without user-facing jargon', () => {
    const cases: Array<[WatchResult, RegExp]> = [
      [{ status: 'unreadable-history' }, /could not read.*history/i],
      [{ status: 'no-history' }, /no commit history/i],
      [{ status: 'unknown' }, /could not tell whether main/i],
      [{ status: 'pending' }, /still running/i],
      [{ status: 'green' }, /currently green/i],
      [{ status: 'no-culprit' }, /nothing of ours/i],
      [{ status: 'reverted', pr: 12 }, /reverted #12/],
      [{ status: 'revert-failed', pr: 12 }, /could not revert #12/],
    ];
    for (const [result, expected] of cases) {
      expect(formatWatchResult(result)).toMatch(expected);
    }
  });
});

function freshWatchRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'thesmos-pr-watch-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  return root;
}

/** A GhRunner covering the calls pr:watch makes: the recent-commit list, the
 * check-runs lookup for a given sha (a realistic one-conclusion-per-line
 * payload, matching `.check_runs[] | (.conclusion // "pending")`, not a
 * pre-reduced count), and (when a revert is warranted) `gh pr revert` /
 * `gh pr merge`, matching performRevert's own expectations. */
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
    throw new Error(`unexpected gh call in pr:watch test: ${JSON.stringify(args)}`);
  };
}

describe('runPr — pr:watch does nothing when main is green', () => {
  it('checks the newest commit, reports green, and never calls gh pr revert', () => {
    const root = freshWatchRoot();
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, testNow());
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa', 'zzz'], failingShas: new Set() });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    let out = '';
    runPr(['watch'], { gh, write: (s) => { out += s; }, root, now: testNow });

    expect(out).toMatch(/green/i);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });
});

describe('runPr — pr:watch treats outstanding checks as pending, never as green', () => {
  it('does not consult the ledger or revert while a check run is still in progress', () => {
    // The exact shape watch will typically see on a real push: this repo's
    // ci.yml runs a multi-job, multi-minute matrix on the same push event
    // thesmos-watch.yml reacts to, and watch is one fast `gh api` call —
    // some checks settled green, one still running. Reading that as green
    // is the bug this test exists to catch.
    const root = freshWatchRoot();
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, testNow());
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'success\npending\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\nzzz\n', stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    let out = '';
    runPr(['watch'], { gh, write: (s) => { out += s; }, root, now: testNow });

    expect(out).toMatch(/still running/i);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });
});

describe('runPr — pr:watch when main is red but nothing of ours is in range', () => {
  it('reports plainly and never calls gh pr revert', () => {
    const root = freshWatchRoot(); // empty ledger — no Thesmos merges at all
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa'], failingShas: new Set(['aaa']) });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    let out = '';
    runPr(['watch'], { gh, write: (s) => { out += s; }, root, now: testNow });

    expect(out).toMatch(/nothing of ours/i);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert')).toBe(false);
  });
});

describe('runPr — pr:watch reaches chooseCulprit and performRevert when main is red', () => {
  it('reverts the Thesmos merge inside the failing range and reports success', () => {
    const root = freshWatchRoot();
    appendEntry(root, { action: 'merge', pr: 7, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, testNow());
    const calls: string[][] = [];
    const baseGh = fakeWatchGh({ shas: ['aaa', 'zzz'], failingShas: new Set(['aaa']) });
    const gh: GhRunner = (args) => { calls.push(args); return baseGh(args); };

    let out = '';
    runPr(['watch'], { gh, write: (s) => { out += s; }, root, now: testNow });

    expect(out).toMatch(/reverted #7/);
    // Proves the wiring reaches performRevert's actual two-call sequence
    // (create, then merge the *new* PR — #999, not #7), not a stub.
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'revert' && c[2] === '7')).toBe(true);
    expect(calls.some((c) => c[0] === 'pr' && c[1] === 'merge' && c[2] === '999')).toBe(true);
  });
});

describe('runPr — pr:watch surfaces a failed revert and leaves autonomy off', () => {
  it('reports the failure instead of crashing or claiming success', () => {
    const root = freshWatchRoot();
    appendEntry(root, { action: 'merge', pr: 3, phase: 'outcome', ok: true, mergeCommit: 'aaa' }, testNow());
    const gh: GhRunner = (args) => {
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'failure\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'revert') return { ok: false, stdout: '', stderr: 'no permission' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    let out = '';
    runPr(['watch'], { gh, write: (s) => { out += s; }, root, now: testNow });

    expect(out).toMatch(/could not revert #3/i);
    expect(isAutonomyDisabled(root)).toBe(true);
  });
});

describe('runPr — pr:watch honors --range for how much history to check', () => {
  it('passes the requested count through to the commit-list lookup', () => {
    const root = freshWatchRoot();
    const calls: string[][] = [];
    const gh: GhRunner = (args) => {
      calls.push(args);
      if (args[0] === 'api' && args[1]?.includes('/commits?')) return { ok: true, stdout: 'aaa\n', stderr: '' };
      if (args[0] === 'api' && args[1]?.includes('/check-runs')) return { ok: true, stdout: 'success\n', stderr: '' };
      throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    };

    runPr(['watch', '--range', '10'], { gh, write: () => {}, root, now: testNow });

    const commitsCall = calls.find((c) => c[0] === 'api' && c[1]?.includes('/commits?'));
    expect(commitsCall?.[1]).toContain('per_page=10');
  });
});
