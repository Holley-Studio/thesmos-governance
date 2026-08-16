// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { computePlan } from './plan.ts';
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
});
