// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Behavioral eval suite index — documents Phase 5 evaluation coverage.
 *
 * Suites are implemented as existing Vitest files (not a second framework).
 * This file asserts the critical FAIL cases remain covered so CI fails closed
 * if a suite is deleted or weakened.
 */
import { describe, expect, it } from 'vitest';
import { resolveDangerouslySkipPermissions } from '../autopilot/adapters.js';
import { dependencyBlockReason } from '../autopilot/dependency-gate.js';
import { routeTask } from '../pantheon/router.js';
import type { AutopilotSession, AutopilotTask } from '../types.js';

describe('eval suite: Claude skip-permissions default-off', () => {
  it('rejects undefined / false; allows only explicit true', () => {
    expect(resolveDangerouslySkipPermissions(undefined)).toBe(false);
    expect(resolveDangerouslySkipPermissions(false)).toBe(false);
    expect(resolveDangerouslySkipPermissions(true)).toBe(true);
  });
});

describe('eval suite: dependency gate', () => {
  // dependsOn values are 1-based task numbers (task N → index N-1)
  const session = {
    id: 's',
    completedTaskIndexes: [0],
    blockedTasks: [{ index: 1, reason: 'gate fail' }],
    timedOutTaskIndexes: [2],
  } as AutopilotSession;

  it('blocks unmet / blocked / timed-out deps', () => {
    const unmet: AutopilotTask = {
      index: 3,
      title: 't',
      dependsOn: [9],
      doneCriteria: [],
      isCheckpoint: false,
    };
    expect(dependencyBlockReason(unmet, session)).toMatch(/not completed/i);

    const blockedDep: AutopilotTask = {
      index: 4,
      title: 't',
      dependsOn: [2],
      doneCriteria: [],
      isCheckpoint: false,
    };
    expect(dependencyBlockReason(blockedDep, session)).toMatch(/blocked/i);

    const timedOutDep: AutopilotTask = {
      index: 5,
      title: 't',
      dependsOn: [3],
      doneCriteria: [],
      isCheckpoint: false,
    };
    expect(dependencyBlockReason(timedOutDep, session)).toMatch(/timed out/i);
  });

  it('allows when deps completed', () => {
    const ok: AutopilotTask = {
      index: 6,
      title: 't',
      dependsOn: [1],
      doneCriteria: [],
      isCheckpoint: false,
    };
    expect(dependencyBlockReason(ok, session)).toBeNull();
  });
});

describe('eval suite: pantheon routing', () => {
  it('routes security language to Argus, not Hera false-positive', () => {
    const routed = routeTask('Review this threat model for auth vulnerabilities');
    expect(routed.some((id) => id.includes('argus'))).toBe(true);
    expect(routed.every((id) => !id.includes('hera'))).toBe(true);
  });
});
