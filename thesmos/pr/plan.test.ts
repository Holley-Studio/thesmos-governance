// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { computePlan, detectObsolete } from './plan.ts';
import type { PullRequest } from './types.ts';

function pr(number: number, head: string, base: string, over: Partial<PullRequest> = {}): PullRequest {
  return {
    number, title: `chore(deps): bump p${number} from 1.0.0 to 1.0.1`, isDraft: false,
    baseRefName: base, headRefName: head, mergeStateStatus: 'CLEAN',
    changedFiles: 1, files: ['package-lock.json'], ...over,
  };
}

const opts = { defaultBranch: 'main', blockers: new Set<number>(), autonomy: 'recoverable' as const };

describe('computePlan', () => {
  it('orders a stack into successive waves', () => {
    const plan = computePlan([
      pr(1, 'a', 'main'), pr(2, 'b', 'a'), pr(3, 'c', 'b'),
    ], opts);
    expect(plan.waves[0].map((e) => e.number)).toEqual([1]);
    expect(plan.waves[1].map((e) => e.number)).toEqual([2]);
    expect(plan.waves[2].map((e) => e.number)).toEqual([3]);
  });

  it('halts a whole column on a red base and names what it blocks', () => {
    // Mirrors #140 failing beneath five dependents.
    const plan = computePlan([
      pr(140, 'runtime', 'main', { mergeStateStatus: 'UNSTABLE' }),
      pr(141, 'memory', 'runtime'),
      pr(142, 'context', 'memory'),
    ], opts);

    const red = plan.halted.find((h) => h.number === 140)!;
    expect(red.reason).toBe('RED_BASE');
    expect(red.blocks.sort()).toEqual([141, 142]);
    expect(plan.waves.flat()).toEqual([]);
  });

  it('never plans a one-way PR', () => {
    const plan = computePlan([
      pr(1, 'a', 'main', { title: 'chore(deps): bump x from 1.0.0 to 2.0.0' }),
    ], opts);
    expect(plan.waves.flat()).toEqual([]);
    expect(plan.halted[0].reason).toBe('ONE_WAY');
  });

  it('refuses to plan a BLOCKER finding', () => {
    const plan = computePlan([pr(1, 'a', 'main')], { ...opts, blockers: new Set([1]) });
    expect(plan.waves.flat()).toEqual([]);
    expect(plan.halted[0].reason).toBe('BLOCKER');
  });

  it('skips a conflicted PR without attempting resolution', () => {
    const plan = computePlan([pr(1, 'a', 'main', { mergeStateStatus: 'DIRTY' })], opts);
    expect(plan.halted[0].reason).toBe('DIRTY');
  });

  it('orders smallest-first inside a wave', () => {
    const plan = computePlan([
      pr(1, 'a', 'main', { changedFiles: 40 }),
      pr(2, 'b', 'main', { changedFiles: 2 }),
    ], opts);
    expect(plan.waves[0].map((e) => e.number)).toEqual([2, 1]);
  });

  it('reports a cycle rather than planning it', () => {
    const plan = computePlan([pr(1, 'a', 'b'), pr(2, 'b', 'a')], opts);
    expect(plan.halted.every((h) => h.reason === 'CYCLE')).toBe(true);
    expect(plan.waves.flat()).toEqual([]);
  });

  it('halts a PR stacked on a cycle instead of letting it escape quarantine', () => {
    // Regression: #3 is stacked on #2, which is itself a cycle member.
    // descendantsOf() must be cycle-safe (1 and 2 are mutual descendants of
    // each other) — an unguarded walk here would hang instead of returning.
    // If the walk regresses this test times out rather than passing.
    const plan = computePlan([
      pr(1, 'a', 'b'), pr(2, 'b', 'a'), pr(3, 'c', 'b'),
    ], opts);

    expect(plan.waves.flat()).toEqual([]);

    const cycleEntries = plan.halted.filter((h) => h.number === 1 || h.number === 2);
    expect(cycleEntries).toHaveLength(2);
    expect(cycleEntries.every((h) => h.reason === 'CYCLE')).toBe(true);

    const three = plan.halted.find((h) => h.number === 3);
    expect(three).toBeDefined();
    expect(three!.reason).not.toBe('CYCLE');
  });

  it('halts a PR as OBSOLETE when every file it changes is gone from the target', () => {
    // Mirrors the #9/#6 case: a PR bumping a dependency file a merged PR has
    // already deleted. Unmergeable and pointless — close it, don't merge it.
    // pr()'s default files (package-lock.json only) classify as reversible,
    // so a non-empty halted[] here can only be the OBSOLETE check firing.
    const plan = computePlan(
      [pr(9, 'dep', 'main')],
      { ...opts, pathsOnTarget: new Set(['some-other-file.txt']) },
    );
    expect(plan.waves.flat()).toEqual([]);
    expect(plan.halted[0].reason).toBe('OBSOLETE');
  });

  it('does not halt a PR as OBSOLETE when at least one changed file still exists', () => {
    const plan = computePlan(
      [pr(9, 'dep', 'main')],
      { ...opts, pathsOnTarget: new Set(['package-lock.json']) },
    );
    expect(plan.waves.flat().map((e) => e.number)).toEqual([9]);
    expect(plan.halted).toEqual([]);
  });

  it('skips the OBSOLETE check entirely when pathsOnTarget is not supplied, rather than treating "no data" as "everything is obsolete"', () => {
    const plan = computePlan([pr(9, 'dep', 'main')], opts); // no pathsOnTarget
    expect(plan.waves.flat().map((e) => e.number)).toEqual([9]);
    expect(plan.halted).toEqual([]);
  });

  it('names every branch a red base blocks in a non-linear stack, leaving an unrelated tree untouched', () => {
    const plan = computePlan([
      pr(100, 'runtime', 'main', { mergeStateStatus: 'UNSTABLE' }),
      pr(101, 'a', 'runtime'), pr(102, 'b', 'runtime'),
      pr(103, 'c', 'a'), pr(104, 'd', 'b'),
      pr(300, 'p', 'main'), pr(301, 'q', 'p'),
    ], opts);

    const red = plan.halted.find((h) => h.number === 100)!;
    expect(red.reason).toBe('RED_BASE');
    expect(red.blocks.sort((a, b) => a - b)).toEqual([101, 102, 103, 104]);
    expect(plan.halted.filter((h) => h.number !== 100).every((h) => h.reason === 'PARENT_BLOCKED')).toBe(true);

    expect(plan.waves[0].map((e) => e.number)).toEqual([300]);
    expect(plan.waves[1].map((e) => e.number)).toEqual([301]);
  });

  it('names the repo\'s actual default branch in the OBSOLETE detail, not a hardcoded "main"', () => {
    const plan = computePlan(
      [pr(9, 'dep', 'develop')],
      { ...opts, defaultBranch: 'develop', pathsOnTarget: new Set(['some-other-file.txt']) },
    );
    expect(plan.halted[0].reason).toBe('OBSOLETE');
    expect(plan.halted[0].detail).toContain('develop');
    expect(plan.halted[0].detail).not.toContain('main');
  });

  it('carries the reversibility class on every planned entry, so the ledger can record what it landed', () => {
    // Without this the ledger's `class` field has no writer at all and every
    // merge row records only a number — no way to audit afterwards whether
    // what Thesmos landed unattended was ever supposed to be automatic.
    const plan = computePlan([
      pr(1, 'a', 'main'),
      pr(2, 'b', 'main', { title: 'docs: readme', files: ['README.md'] }),
    ], opts);
    const byNumber = new Map(plan.waves.flat().map((e) => [e.number, e.class]));
    expect(byNumber.get(1)).toBe('reversible');
    expect(byNumber.get(2)).toBe('recoverable');
  });
});

// Moved here from lock.test.ts along with the function itself: detectObsolete
// is the planner's, and plan.ts must not import from a module that does file I/O.
describe('detectObsolete', () => {
  const obsoletePr: PullRequest = {
    number: 9, title: 'bump codeql-action', isDraft: false, baseRefName: 'main',
    headRefName: 'dep', mergeStateStatus: 'CLEAN', changedFiles: 1,
    files: ['.github/workflows/codeql.yml'],
  };

  it('flags a PR whose only file no longer exists on the target', () => {
    expect(detectObsolete(obsoletePr, new Set(['.github/workflows/ci.yml']))).toBe(true);
  });

  it('does not flag a PR whose files still exist', () => {
    expect(detectObsolete(obsoletePr, new Set(['.github/workflows/codeql.yml']))).toBe(false);
  });
});
