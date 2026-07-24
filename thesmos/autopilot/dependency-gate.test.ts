// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, expect, it } from 'vitest';
import type { AutopilotSession, AutopilotTask } from '../types.js';
import { dependencyBlockReason, unmetDependencyNumbers } from './dependency-gate.js';

function makeSession(partial: Partial<AutopilotSession> = {}): AutopilotSession {
  return {
    id: 'test',
    planPath: 'MASTER_PLAN.md',
    planSlug: 'test',
    branch: 'autopilot/test',
    restoreTag: 'restore-test',
    startedAt: '2026-07-23T00:00:00Z',
    adapter: 'claude',
    completedTaskIndexes: [],
    blockedTasks: [],
    timedOutTaskIndexes: [],
    decisionLog: [],
    journalPath: '/tmp/journal.md',
    permissionsBackupPath: null,
    lastTaskStash: null,
    ...partial,
  };
}

function makeTask(partial: Partial<AutopilotTask> & { index: number }): AutopilotTask {
  return {
    title: `Task ${partial.index + 1}`,
    doneCriteria: [],
    isCheckpoint: false,
    dependsOn: [],
    ...partial,
  };
}

describe('unmetDependencyNumbers', () => {
  it('returns empty when no dependsOn', () => {
    const task = makeTask({ index: 1 });
    expect(unmetDependencyNumbers(task, makeSession())).toEqual([]);
  });

  it('returns unmet 1-based numbers until completed', () => {
    const task = makeTask({ index: 2, dependsOn: [1, 2] });
    const session = makeSession({ completedTaskIndexes: [0] }); // task 1 done
    expect(unmetDependencyNumbers(task, session)).toEqual([2]);
  });

  it('returns empty when all deps completed', () => {
    const task = makeTask({ index: 2, dependsOn: [1, 2] });
    const session = makeSession({ completedTaskIndexes: [0, 1] });
    expect(unmetDependencyNumbers(task, session)).toEqual([]);
  });
});

describe('dependencyBlockReason', () => {
  it('returns null when ready', () => {
    const task = makeTask({ index: 1, dependsOn: [1] });
    const session = makeSession({ completedTaskIndexes: [0] });
    expect(dependencyBlockReason(task, session)).toBeNull();
  });

  it('names blocked vs not-completed vs timed-out deps', () => {
    const task = makeTask({ index: 3, dependsOn: [1, 2, 3] });
    const session = makeSession({
      completedTaskIndexes: [],
      blockedTasks: [{ index: 0, reason: 'gate failed' }],
      timedOutTaskIndexes: [1],
    });
    const reason = dependencyBlockReason(task, session);
    expect(reason).toContain('task 1 (blocked)');
    expect(reason).toContain('task 2 (timed out)');
    expect(reason).toContain('task 3 (not completed)');
  });
});
