// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Content addressing: same inputs, same hash — always.
 *
 * If any of these fail, mission state has stopped being comparable across runs
 * or machines, which is the property the whole runtime is built on.
 */

import { describe, expect, it } from 'vitest';
import { emptyPermissionPolicy } from '../council/contract.js';
import { createMission } from './create.js';
import { ceilingBoundedLimits } from './limits.js';
import {
  deriveMissionStatus,
  initialMissionState,
  missionId,
  missionStateHash,
} from './state.js';
import type { MissionRequest, MissionState, MissionTaskInput, MissionTaskState } from './types.js';

const LIMITS = ceilingBoundedLimits();

function task(id: string, dependsOn: string[] = []): MissionTaskInput {
  return { id, agentId: `${id}-agent`, title: `Task ${id}`, intent: `do ${id}`, dependsOn };
}

function request(overrides: Partial<MissionRequest> = {}): MissionRequest {
  return { goal: 'ship the thing', tasks: [task('a'), task('b', ['a'])], ...overrides };
}

function taskState(overrides: Partial<MissionTaskState>): MissionTaskState {
  return {
    taskId: 'a',
    agentId: 'a-agent',
    status: 'complete',
    stepsUsed: 1,
    childTaskIds: [],
    issues: [],
    ...overrides,
  };
}

describe('mission id', () => {
  it('is a sha256 digest', () => {
    expect(missionId('goal', [task('a')], emptyPermissionPolicy(), LIMITS)).toMatch(
      /^sha256:[a-f0-9]{64}$/
    );
  });

  it('is stable across declaration order', () => {
    const forward = missionId('goal', [task('a'), task('b')], emptyPermissionPolicy(), LIMITS);
    const reversed = missionId('goal', [task('b'), task('a')], emptyPermissionPolicy(), LIMITS);
    expect(reversed).toBe(forward);
  });

  it('is stable across dependency order', () => {
    const forward = missionId('goal', [task('c', ['a', 'b'])], emptyPermissionPolicy(), LIMITS);
    const reversed = missionId('goal', [task('c', ['b', 'a'])], emptyPermissionPolicy(), LIMITS);
    expect(reversed).toBe(forward);
  });

  it('changes when the goal changes', () => {
    const a = missionId('goal one', [task('a')], emptyPermissionPolicy(), LIMITS);
    const b = missionId('goal two', [task('a')], emptyPermissionPolicy(), LIMITS);
    expect(b).not.toBe(a);
  });

  it('changes when a task changes', () => {
    const a = missionId('goal', [task('a')], emptyPermissionPolicy(), LIMITS);
    const b = missionId('goal', [task('a'), task('b')], emptyPermissionPolicy(), LIMITS);
    expect(b).not.toBe(a);
  });

  it('changes when the permission envelope changes', () => {
    const open = emptyPermissionPolicy();
    open.edit = [{ decision: 'allow', patterns: ['src/**'] }];
    const a = missionId('goal', [task('a')], emptyPermissionPolicy(), LIMITS);
    const b = missionId('goal', [task('a')], open, LIMITS);
    expect(b).not.toBe(a);
  });

  it('is reproduced identically by createMission across declaration order', () => {
    const forward = createMission(request({ tasks: [task('a'), task('b', ['a'])] }));
    const reversed = createMission(request({ tasks: [task('b', ['a']), task('a')] }));
    expect(forward.valid && reversed.valid).toBe(true);
    expect(reversed.mission?.id).toBe(forward.mission?.id);
  });

  it('ignores whitespace differences in the goal', () => {
    const a = createMission(request({ goal: 'ship the thing' }));
    const b = createMission(request({ goal: '  ship the thing  ' }));
    expect(b.mission?.id).toBe(a.mission?.id);
  });
});

describe('state hash', () => {
  function stateWith(tasks: MissionTaskState[]): MissionState {
    return {
      schemaVersion: '1.0.0',
      missionId: 'sha256:' + 'a'.repeat(64),
      status: 'complete',
      stepsUsed: 2,
      issues: [],
      tasks,
    };
  }

  it('is a sha256 digest', () => {
    expect(missionStateHash(stateWith([taskState({})]))).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('is identical for the same state hashed twice', () => {
    const state = stateWith([taskState({ taskId: 'a' }), taskState({ taskId: 'b' })]);
    expect(missionStateHash(state)).toBe(missionStateHash(state));
  });

  it('does not depend on task insertion order', () => {
    const forward = stateWith([taskState({ taskId: 'a' }), taskState({ taskId: 'b' })]);
    const reversed = stateWith([taskState({ taskId: 'b' }), taskState({ taskId: 'a' })]);
    expect(missionStateHash(reversed)).toBe(missionStateHash(forward));
  });

  it('does not depend on child id order', () => {
    const forward = stateWith([taskState({ childTaskIds: ['x', 'y'] })]);
    const reversed = stateWith([taskState({ childTaskIds: ['y', 'x'] })]);
    expect(missionStateHash(reversed)).toBe(missionStateHash(forward));
  });

  it('changes when a task status changes', () => {
    const complete = stateWith([taskState({ status: 'complete' })]);
    const failed = stateWith([taskState({ status: 'failed' })]);
    expect(missionStateHash(failed)).not.toBe(missionStateHash(complete));
  });

  it('changes when steps consumed change', () => {
    const cheap = stateWith([taskState({ stepsUsed: 1 })]);
    const dear = stateWith([taskState({ stepsUsed: 9 })]);
    expect(missionStateHash(dear)).not.toBe(missionStateHash(cheap));
  });
});

describe('initial state', () => {
  it('starts every task pending with nothing spent', () => {
    const { mission } = createMission(request());
    const state = initialMissionState(mission!);
    expect(state.stepsUsed).toBe(0);
    expect(state.tasks.every((t) => t.status === 'pending')).toBe(true);
    expect(state.tasks.map((t) => t.taskId)).toEqual(['a', 'b']);
  });
});

describe('status rollup', () => {
  it('is complete only when every task completed', () => {
    expect(deriveMissionStatus([taskState({}), taskState({ taskId: 'b' })])).toBe('complete');
  });

  it('is failed when any task failed, however much else succeeded', () => {
    expect(
      deriveMissionStatus([taskState({}), taskState({ taskId: 'b', status: 'failed' })])
    ).toBe('failed');
  });

  it('prefers failed over blocked', () => {
    expect(
      deriveMissionStatus([
        taskState({ status: 'blocked' }),
        taskState({ taskId: 'b', status: 'failed' }),
      ])
    ).toBe('failed');
  });

  it('is blocked when a task is blocked and none failed', () => {
    expect(
      deriveMissionStatus([taskState({}), taskState({ taskId: 'b', status: 'blocked' })])
    ).toBe('blocked');
  });

  it('is partial when work remains but nothing broke', () => {
    expect(
      deriveMissionStatus([taskState({}), taskState({ taskId: 'b', status: 'pending' })])
    ).toBe('partial');
  });

  it('treats an empty task set as failed rather than complete', () => {
    expect(deriveMissionStatus([])).toBe('failed');
  });
});
