// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { fetchPullRequests, renderPlan } from './fetch.ts';
import { computePlan } from './plan.ts';

const GH_JSON = JSON.stringify([
  { number: 140, title: 'feat: runtime', isDraft: false, baseRefName: 'main',
    headRefName: 'runtime', mergeStateStatus: 'UNSTABLE', changedFiles: 37, files: [{ path: 'a.ts' }] },
  { number: 141, title: 'feat: memory', isDraft: false, baseRefName: 'runtime',
    headRefName: 'memory', mergeStateStatus: 'CLEAN', changedFiles: 25, files: [{ path: 'b.ts' }] },
]);

describe('fetchPullRequests', () => {
  it('flattens gh file objects into plain paths', () => {
    const prs = fetchPullRequests(() => ({ ok: true, stdout: GH_JSON, stderr: '' }));
    expect(prs[0].files).toEqual(['a.ts']);
    expect(prs[1].number).toBe(141);
  });

  it('throws a clear error when gh fails', () => {
    expect(() => fetchPullRequests(() => ({ ok: false, stdout: '', stderr: 'not logged in' })))
      .toThrow(/not logged in/);
  });

  it('throws a named error instead of a raw parse exception when gh returns malformed JSON', () => {
    expect(() => fetchPullRequests(() => ({ ok: true, stdout: 'not valid json{', stderr: '' })))
      .toThrow(/could not read pull requests.*not valid JSON/i);
  });

  it('marks a PR missing mergeStateStatus as UNKNOWN — which the planner must refuse, not accept', () => {
    // Renamed from "degrades ... to safe defaults". UNKNOWN is not a safe
    // default: it is the absence of an answer. It is only safe because
    // computePlan's allowlist refuses to plan it — asserted here so the two
    // halves cannot drift apart.
    const sparse = JSON.stringify([
      { number: 200, title: 'chore: sparse', isDraft: false, baseRefName: 'main', headRefName: 'sparse' },
    ]);
    const prs = fetchPullRequests(() => ({ ok: true, stdout: sparse, stderr: '' }));
    expect(prs[0].files).toEqual([]);
    expect(prs[0].mergeStateStatus).toBe('UNKNOWN');
    expect(prs[0].changedFiles).toBe(0);

    const plan = computePlan(prs, { defaultBranch: 'main', blockers: new Set(), autonomy: 'recoverable' });
    expect(plan.waves.flat()).toEqual([]);
    expect(plan.halted[0].reason).toBe('UNKNOWN_STATE');
  });

  it('asks gh for far more than one page of pull requests', () => {
    let seen: string[] = [];
    fetchPullRequests((args) => { seen = args; return { ok: true, stdout: '[]', stderr: '' }; });
    const limit = Number(seen[seen.indexOf('--limit') + 1]);
    expect(limit).toBeGreaterThan(100);
  });

  it('refuses to plan at all when the fetch may have been truncated, rather than dropping PRs silently', () => {
    // A truncated list is the worst possible input for this tool: a PR whose
    // parent fell off the end looks like an independent root and merges ahead
    // of it. Better to refuse loudly than to plan against a partial graph.
    let limit = 0;
    const probe = (args: string[]): string[] => args;
    fetchPullRequests((args) => { limit = Number(probe(args)[args.indexOf('--limit') + 1]); return { ok: true, stdout: '[]', stderr: '' }; });

    const full = JSON.stringify(Array.from({ length: limit }, (_, i) => ({
      number: i + 1, title: `chore: ${i}`, isDraft: false, baseRefName: 'main',
      headRefName: `b${i}`, mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'a.ts' }],
    })));
    expect(() => fetchPullRequests(() => ({ ok: true, stdout: full, stderr: '' })))
      .toThrow(/too many open pull requests/i);
  });
});

describe('renderPlan', () => {
  it('names the blocked PRs and avoids jargon', () => {
    const prs = fetchPullRequests(() => ({ ok: true, stdout: GH_JSON, stderr: '' }));
    const out = renderPlan(
      computePlan(prs, { defaultBranch: 'main', blockers: new Set(), autonomy: 'recoverable' }),
      prs,
    );
    expect(out).toMatch(/#140/);
    expect(out).toMatch(/#141/);
    expect(out).not.toMatch(/rebase|topolog|speculat|wave/i);
  });

  it('names the PR a stacked one waits on instead of an internal wave index', () => {
    const stacked = JSON.stringify([
      { number: 140, title: 'feat: runtime', isDraft: false, baseRefName: 'main',
        headRefName: 'runtime', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'README.md' }] },
      { number: 141, title: 'feat: memory', isDraft: false, baseRefName: 'runtime',
        headRefName: 'memory', mergeStateStatus: 'CLEAN', changedFiles: 1, files: [{ path: 'docs/a.md' }] },
    ]);
    const prs = fetchPullRequests(() => ({ ok: true, stdout: stacked, stderr: '' }));
    const out = renderPlan(
      computePlan(prs, { defaultBranch: 'main', blockers: new Set(), autonomy: 'recoverable' }),
      prs,
    );
    expect(out).toMatch(/#141.*goes in after #140 lands/);
    expect(out).not.toMatch(/wave/i);
  });

  it('says plainly that there is nothing to do when there are no pull requests at all', () => {
    const out = renderPlan({ waves: [], halted: [] }, []);
    expect(out).toContain('Nothing to do.');
  });
});
