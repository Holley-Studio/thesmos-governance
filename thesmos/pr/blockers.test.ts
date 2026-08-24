// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { deriveBlockers, governanceCoverage } from './blockers.ts';
import type { CheckContext, PullRequest } from './types.ts';

function pr(number: number, checks: CheckContext[]): PullRequest {
  return {
    number, title: `chore(deps): bump p${number} from 1.0.0 to 1.0.1`, isDraft: false,
    baseRefName: 'main', headRefName: `b${number}`, mergeStateStatus: 'CLEAN',
    changedFiles: 1, files: ['package-lock.json'], checks,
  };
}

const THESMOS_CHECK = { name: 'Governance Review', workflowName: 'Thesmos Governance PR Review' };

describe('deriveBlockers', () => {
  it('names a PR whose Thesmos governance check concluded as a failure', () => {
    const blockers = deriveBlockers([pr(1, [{ ...THESMOS_CHECK, conclusion: 'FAILURE' }])]);
    expect([...blockers]).toEqual([1]);
  });

  it('leaves a PR alone when its Thesmos governance check passed', () => {
    const blockers = deriveBlockers([pr(1, [{ ...THESMOS_CHECK, conclusion: 'SUCCESS' }])]);
    expect([...blockers]).toEqual([]);
  });

  it('ignores a failing check that is not the governance gate — that is RED_BASE, not BLOCKER', () => {
    // Conflating the two would relabel every ordinary CI failure as "Thesmos
    // found something that must not ship", which is both wrong and the kind
    // of false alarm that gets a safety mechanism switched off.
    const blockers = deriveBlockers([pr(1, [
      { name: 'build (ubuntu-latest)', workflowName: 'CI', conclusion: 'FAILURE' },
    ])]);
    expect([...blockers]).toEqual([]);
  });

  it('does not treat a governance check that has not concluded yet as a BLOCKER', () => {
    // conclusion is null while queued/in progress. "Not finished" is not
    // "found something" — halting on it would block every freshly pushed PR.
    const blockers = deriveBlockers([pr(1, [{ ...THESMOS_CHECK, conclusion: null as unknown as undefined }])]);
    expect([...blockers]).toEqual([]);
  });

  it('reads the legacy commit-status shape too, where the verdict is `state` on a `context`', () => {
    const blockers = deriveBlockers([pr(1, [{ context: 'thesmos/validate', state: 'FAILURE' }])]);
    expect([...blockers]).toEqual([1]);
  });

  it('treats every concluded-and-not-passing verdict as the gate firing, not only "FAILURE"', () => {
    for (const verdict of ['FAILURE', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE']) {
      expect([...deriveBlockers([pr(1, [{ ...THESMOS_CHECK, conclusion: verdict }])]), verdict])
        .toEqual([1, verdict]);
    }
  });

  it('names nothing when a PR reports no checks at all', () => {
    expect([...deriveBlockers([pr(1, [])])]).toEqual([]);
  });
});

describe('governanceCoverage', () => {
  it('counts how many PRs actually reported a governance check', () => {
    // The gate is only as real as the check it reads. When nothing reports
    // one, the caller must be able to say so out loud rather than let an
    // empty blocker set read as "governance passed".
    const prs = [
      pr(1, [{ ...THESMOS_CHECK, conclusion: 'SUCCESS' }]),
      pr(2, [{ name: 'build', workflowName: 'CI', conclusion: 'SUCCESS' }]),
      pr(3, []),
    ];
    expect(governanceCoverage(prs)).toEqual({ seen: 1, total: 3 });
  });

  it('reports zero coverage when no PR reports a governance check', () => {
    expect(governanceCoverage([pr(1, []), pr(2, [])])).toEqual({ seen: 0, total: 2 });
  });
});
