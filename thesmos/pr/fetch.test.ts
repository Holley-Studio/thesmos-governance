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
    expect(out).not.toMatch(/rebase|topolog|speculat/i);
  });
});
