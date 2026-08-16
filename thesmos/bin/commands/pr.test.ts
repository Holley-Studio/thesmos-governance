// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { classifyGhResult, detectDefaultBranch, formatExplain, type RawGhResult } from './pr.ts';
import type { MergePlan } from '../../pr/plan.ts';
import { buildGraph } from '../../pr/graph.ts';
import type { PullRequest } from '../../pr/types.ts';

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
