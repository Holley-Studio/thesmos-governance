// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph — bounds.
 *
 * Every numeric bound is combined by taking the minimum, in the same spirit as
 * the permission resolver's most-restrictive-wins: a mission may tighten what
 * the ceilings allow and a contract may tighten what the mission allows, but
 * neither can widen anything. That makes the combination order-independent.
 *
 * There is no configuration read here. `.thesmos/config.json` is guard-
 * protected, so absent values fall back to `COUNCIL_LIMIT_CEILINGS` rather than
 * to anything an operator has to remember to set.
 */

import { COUNCIL_LIMIT_CEILINGS, type CouncilLimits } from '../council/contract.js';
import { MISSION_CODES, missionIssue, type MissionIssue } from './types.js';

/**
 * Absent-key defaults. A mission that declares nothing still executes under the
 * published ceilings — never unbounded.
 */
export const DEFAULT_MISSION_LIMITS: CouncilLimits = {
  maximumSteps: COUNCIL_LIMIT_CEILINGS.maximumSteps,
  maximumChildren: COUNCIL_LIMIT_CEILINGS.maximumChildren,
  maximumParallelChildren: COUNCIL_LIMIT_CEILINGS.maximumParallelChildren,
  timeoutMs: COUNCIL_LIMIT_CEILINGS.timeoutMs,
};

/** A positive integer at or below `ceiling`, or the ceiling itself. */
function boundedInt(value: unknown, ceiling: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return ceiling;
  return Math.min(value, ceiling);
}

/**
 * Clamp a declared limit set into the ceilings.
 *
 * Values that are absent, non-integer, or below 1 fall back to the ceiling
 * rather than to zero — a malformed limit must not silently disable a task.
 */
export function ceilingBoundedLimits(declared?: Partial<CouncilLimits>): CouncilLimits {
  return {
    maximumSteps: boundedInt(declared?.maximumSteps, COUNCIL_LIMIT_CEILINGS.maximumSteps),
    maximumChildren: boundedInt(declared?.maximumChildren, COUNCIL_LIMIT_CEILINGS.maximumChildren),
    maximumParallelChildren: boundedInt(
      declared?.maximumParallelChildren,
      COUNCIL_LIMIT_CEILINGS.maximumParallelChildren
    ),
    timeoutMs: boundedInt(declared?.timeoutMs, COUNCIL_LIMIT_CEILINGS.timeoutMs),
  };
}

/**
 * Combine mission limits with a contract's own.
 *
 * Symmetric in its arguments by construction — `min` does not care which side a
 * value came from — so merging a roster in a different order cannot change what
 * a task is allowed to spend.
 */
export function effectiveTaskLimits(
  mission: CouncilLimits,
  contract?: Partial<CouncilLimits>
): CouncilLimits {
  const bounded = ceilingBoundedLimits(contract);
  const missionBounded = ceilingBoundedLimits(mission);
  return {
    maximumSteps: Math.min(missionBounded.maximumSteps, bounded.maximumSteps),
    maximumChildren: Math.min(missionBounded.maximumChildren, bounded.maximumChildren),
    maximumParallelChildren: Math.min(
      missionBounded.maximumParallelChildren,
      bounded.maximumParallelChildren
    ),
    timeoutMs: Math.min(
      missionBounded.timeoutMs ?? COUNCIL_LIMIT_CEILINGS.timeoutMs,
      bounded.timeoutMs ?? COUNCIL_LIMIT_CEILINGS.timeoutMs
    ),
  };
}

/**
 * A mission-wide step budget.
 *
 * Deliberately a plain counter with no clock: the executor must be able to
 * replay a mission and consume exactly the same budget.
 */
export class StepBudget {
  private spent = 0;

  constructor(private readonly ceiling: number) {}

  get used(): number {
    return this.spent;
  }

  get remaining(): number {
    return Math.max(0, this.ceiling - this.spent);
  }

  get exhausted(): boolean {
    return this.spent >= this.ceiling;
  }

  /** Charge `n` steps. Returns false when the charge would breach the ceiling. */
  charge(n = 1): boolean {
    if (n < 0) return false;
    if (this.spent + n > this.ceiling) {
      this.spent = this.ceiling;
      return false;
    }
    this.spent += n;
    return true;
  }
}

export function stepsExceededIssue(taskId: string, ceiling: number): MissionIssue {
  return missionIssue(
    MISSION_CODES.limitStepsExceeded,
    'error',
    `tasks.${taskId}`,
    `mission step budget of ${ceiling} is exhausted`,
    'raise `council_max_steps`, or split the work across missions'
  );
}

export function childrenExceededIssue(
  taskId: string,
  requested: number,
  ceiling: number
): MissionIssue {
  return missionIssue(
    MISSION_CODES.limitChildrenExceeded,
    'error',
    `tasks.${taskId}.children`,
    `task "${taskId}" delegated ${requested} children, exceeding its limit of ${ceiling}`,
    'raise `council_max_children`, or delegate less'
  );
}

export function parallelExceededIssue(
  requested: number,
  ceiling: number,
  layerIndex: number
): MissionIssue {
  return missionIssue(
    MISSION_CODES.limitParallelExceeded,
    'warning',
    `layers[${layerIndex}]`,
    `layer of ${requested} tasks was throttled to ${ceiling} at a time`,
    'raise `council_max_parallel_children` to widen the wave'
  );
}
