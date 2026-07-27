// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Bounds: minimum-wins, order-independent, never widening.
 *
 * Mirrors the permission suite's central concern — combining two declarations
 * must not depend on which one was written first, and neither side may end up
 * with more than the published ceiling.
 */

import { describe, expect, it } from 'vitest';
import { COUNCIL_LIMIT_CEILINGS, type CouncilLimits } from '../council/contract.js';
import {
  DEFAULT_MISSION_LIMITS,
  StepBudget,
  ceilingBoundedLimits,
  childrenExceededIssue,
  effectiveTaskLimits,
  parallelExceededIssue,
  stepsExceededIssue,
} from './limits.js';
import { MISSION_CODES } from './types.js';

describe('absent-key defaults', () => {
  it('falls back to the ceilings when nothing is declared', () => {
    expect(ceilingBoundedLimits()).toEqual(DEFAULT_MISSION_LIMITS);
    expect(ceilingBoundedLimits({})).toEqual(DEFAULT_MISSION_LIMITS);
  });

  it('never leaves a bound unset', () => {
    const limits = ceilingBoundedLimits({ maximumSteps: 5 });
    expect(limits.maximumChildren).toBe(COUNCIL_LIMIT_CEILINGS.maximumChildren);
    expect(limits.maximumParallelChildren).toBe(COUNCIL_LIMIT_CEILINGS.maximumParallelChildren);
  });
});

describe('ceilings', () => {
  it('clamps a declaration above the ceiling', () => {
    const limits = ceilingBoundedLimits({
      maximumSteps: COUNCIL_LIMIT_CEILINGS.maximumSteps * 10,
      maximumChildren: 9999,
    });
    expect(limits.maximumSteps).toBe(COUNCIL_LIMIT_CEILINGS.maximumSteps);
    expect(limits.maximumChildren).toBe(COUNCIL_LIMIT_CEILINGS.maximumChildren);
  });

  it('keeps a declaration below the ceiling', () => {
    expect(ceilingBoundedLimits({ maximumSteps: 3 }).maximumSteps).toBe(3);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to the ceiling for the malformed value %p',
    (value) => {
      expect(ceilingBoundedLimits({ maximumSteps: value as number }).maximumSteps).toBe(
        COUNCIL_LIMIT_CEILINGS.maximumSteps
      );
    }
  );
});

describe('combination', () => {
  const mission: CouncilLimits = {
    maximumSteps: 50,
    maximumChildren: 4,
    maximumParallelChildren: 2,
    timeoutMs: 1000,
  };

  it('takes the minimum of each bound', () => {
    const effective = effectiveTaskLimits(mission, {
      maximumSteps: 10,
      maximumChildren: 8,
      maximumParallelChildren: 1,
    });
    expect(effective.maximumSteps).toBe(10);
    expect(effective.maximumChildren).toBe(4);
    expect(effective.maximumParallelChildren).toBe(1);
  });

  it('never lets a contract widen its mission', () => {
    const effective = effectiveTaskLimits(mission, {
      maximumSteps: 9999,
      maximumChildren: 9999,
      maximumParallelChildren: 9999,
    });
    expect(effective.maximumSteps).toBe(mission.maximumSteps);
    expect(effective.maximumChildren).toBe(mission.maximumChildren);
    expect(effective.maximumParallelChildren).toBe(mission.maximumParallelChildren);
  });

  it('is symmetric — swapping the sides changes nothing', () => {
    const contract: CouncilLimits = {
      maximumSteps: 12,
      maximumChildren: 9,
      maximumParallelChildren: 5,
      timeoutMs: 2000,
    };
    expect(effectiveTaskLimits(mission, contract)).toEqual(effectiveTaskLimits(contract, mission));
  });

  it('treats an absent contract as no additional narrowing', () => {
    expect(effectiveTaskLimits(mission)).toEqual(ceilingBoundedLimits(mission));
  });
});

describe('limit issue constructors', () => {
  it('reports an exhausted step budget against the task that hit it', () => {
    const issue = stepsExceededIssue('build-api', 12);
    expect(issue.code).toBe(MISSION_CODES.limitStepsExceeded);
    expect(issue.severity).toBe('error');
    expect(issue.path).toBe('tasks.build-api');
    expect(issue.message).toContain('12');
  });

  it('reports over-delegation with both the request and the ceiling', () => {
    const issue = childrenExceededIssue('planner', 9, 4);
    expect(issue.code).toBe(MISSION_CODES.limitChildrenExceeded);
    expect(issue.severity).toBe('error');
    expect(issue.message).toContain('9');
    expect(issue.message).toContain('4');
  });

  it('reports a throttled wave as a warning, since the work still runs', () => {
    const issue = parallelExceededIssue(10, 3, 2);
    expect(issue.code).toBe(MISSION_CODES.limitParallelExceeded);
    expect(issue.severity).toBe('warning');
    expect(issue.path).toBe('layers[2]');
  });

  it('carries a remediation on every limit issue', () => {
    for (const issue of [
      stepsExceededIssue('t', 1),
      childrenExceededIssue('t', 2, 1),
      parallelExceededIssue(2, 1, 0),
    ]) {
      expect(issue.remediation, `${issue.code} has no remediation`).toBeTruthy();
    }
  });
});

describe('StepBudget', () => {
  it('charges and reports what is left', () => {
    const budget = new StepBudget(5);
    expect(budget.charge(2)).toBe(true);
    expect(budget.used).toBe(2);
    expect(budget.remaining).toBe(3);
    expect(budget.exhausted).toBe(false);
  });

  it('refuses a charge that would breach the ceiling and pins to it', () => {
    const budget = new StepBudget(5);
    expect(budget.charge(6)).toBe(false);
    expect(budget.used).toBe(5);
    expect(budget.remaining).toBe(0);
    expect(budget.exhausted).toBe(true);
  });

  it('reports exhaustion exactly at the ceiling', () => {
    const budget = new StepBudget(2);
    expect(budget.charge(2)).toBe(true);
    expect(budget.exhausted).toBe(true);
    expect(budget.charge(1)).toBe(false);
  });

  it('rejects a negative charge', () => {
    const budget = new StepBudget(5);
    expect(budget.charge(-1)).toBe(false);
    expect(budget.used).toBe(0);
  });
});
