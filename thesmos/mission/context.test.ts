// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission → memory integration.
 *
 * The claim under test: a task receives memory chosen by Thesmos authority, and
 * neither a task nor a delegated child can widen what it is allowed to
 * remember — for the same structural reason it cannot widen what it may do.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionContextProvider, memoryScopeForTask } from './context.js';
import { MnemosyneService } from '../memory/service.js';
import { CONFIG_DEFAULTS } from '../config.js';
import type { Mission, TaskBinding } from './types.js';
import type { MemoryProposal } from '../memory/types.js';

let root: string;
let svc: MnemosyneService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mission-ctx-'));
  svc = new MnemosyneService(root, { secretPatterns: CONFIG_DEFAULTS.secretPatterns });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function remember(content: string, overrides: Partial<MemoryProposal> = {}): void {
  svc.remember({
    scope: 'repository',
    type: 'procedure',
    content,
    provenance: { sourceKind: 'user', creator: 'test', derivation: 'stated' },
    confidence: 'high',
    sensitivity: 'project',
    metadata: {},
    ...overrides,
  });
}

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    schemaVersion: '1',
    id: 'mission-a',
    goal: 'fix the staging migration certification failure',
    permissions: {} as Mission['permissions'],
    limits: {} as Mission['limits'],
    graph: { tasks: [] } as unknown as Mission['graph'],
    ...overrides,
  };
}

function binding(overrides: Partial<TaskBinding['task']> = {}): TaskBinding {
  return {
    task: {
      id: 'task-1',
      agentId: 'argus',
      title: 'repair staging migration',
      intent: 'validate the project ref before replaying schema changes',
      dependsOn: [],
      depth: 0,
      ...overrides,
    },
    contract: { identity: { id: 'argus' } } as unknown as TaskBinding['contract'],
    limits: {} as TaskBinding['limits'],
    escalations: [],
  };
}

describe('scope derivation', () => {
  it('caps a task at mission scope, never wider', () => {
    // Not `global`, not `workspace` — a task is bound to one mission.
    expect(memoryScopeForTask()).toBe('mission');
  });
});

describe('createMissionContextProvider', () => {
  it('supplies governed memory to a task', async () => {
    remember('Staging migration repair requires a validated project ref before replay.');
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });

    const context = await provider(mission(), binding());
    expect(context).toBeDefined();
    expect(context!.capsule).toContain('<retrieved-memory>');
    expect(context!.memoryIds).toHaveLength(1);
    expect(context!.tokensEstimate).toBeGreaterThan(0);
  });

  it('returns undefined rather than an empty block when nothing qualifies', async () => {
    // An empty capsule would still cost tokens for zero signal.
    remember('Completely unrelated note about typography kerning.');
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });
    await expect(provider(mission(), binding())).resolves.toBeUndefined();
  });

  it('declines when the repo has no identity', async () => {
    remember('Staging migration repair requires a validated project ref.');
    const provider = createMissionContextProvider({ root });
    await expect(provider(mission(), binding())).resolves.toBeUndefined();
  });

  it('never surfaces another repository’s memory', async () => {
    remember('Staging migration repair requires a validated project ref.', { repoId: 'repo-b' });
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });
    await expect(provider(mission(), binding())).resolves.toBeUndefined();
  });

  it('does not surface another mission’s private memory', async () => {
    remember('Staging migration repair requires a validated project ref.', {
      scope: 'mission',
      missionId: 'mission-z',
    });
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });
    await expect(provider(mission({ id: 'mission-a' }), binding())).resolves.toBeUndefined();
  });

  it('gives a delegated child no more reach than its parent', async () => {
    // Both run under the same mission object, so the ceiling is structural.
    remember('Staging migration repair requires a validated project ref.', {
      scope: 'mission',
      missionId: 'other-mission',
    });
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });
    const child = binding({ id: 'task-2', parentTaskId: 'task-1', depth: 1 });
    await expect(provider(mission(), child)).resolves.toBeUndefined();
  });

  it('honours an explicit memory-off run', async () => {
    remember('Staging migration repair requires a validated project ref.');
    const provider = createMissionContextProvider({ root, repoId: 'repo-a', recall: false });
    await expect(provider(mission(), binding())).resolves.toBeUndefined();
  });

  it('reports diagnostics per task for receipts and explain', async () => {
    remember('Staging migration repair requires a validated project ref before replay.');
    const seen: string[] = [];
    const provider = createMissionContextProvider({
      root,
      repoId: 'repo-a',
      onDiagnostics: (taskId, result) => {
        seen.push(`${taskId}:${result.diagnostics.included}`);
      },
    });
    await provider(mission(), binding());
    expect(seen).toEqual(['task-1:1']);
  });

  it('degrades to no memory when the store is missing', async () => {
    const provider = createMissionContextProvider({ root: join(root, 'nope'), repoId: 'repo-a' });
    await expect(provider(mission(), binding())).resolves.toBeUndefined();
  });

  it('is deterministic across repeated calls', async () => {
    for (const topic of ['validating the project ref', 'replaying schema changes', 'the denylist']) {
      remember(`Staging migration certification requires ${topic}.`);
    }
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });
    const a = await provider(mission(), binding());
    const b = await provider(mission(), binding());
    expect(a!.memoryIds).toEqual(b!.memoryIds);
  });

  it('does not mutate memory while reading', async () => {
    remember('Staging migration repair requires a validated project ref.');
    const before = JSON.stringify(svc.store.all());
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });
    await provider(mission(), binding());
    expect(JSON.stringify(svc.store.all())).toBe(before);
  });
});

// ── Closed loop: a mission writes what a later mission recalls ────────────────

describe('closed loop', () => {
  it('a completed mission produces memory that a later mission retrieves', async () => {
    // The whole point of Phase 4: recall was live, but the store only filled by
    // hand. This proves the loop closes without a human in it.
    const { proposeFromHandoff, commitProposals } = await import('../memory/propose.js');
    const { validateMemoryProposal } = await import('../memory/validate.js');

    const outcomes = commitProposals(
      svc.store,
      proposeFromHandoff(
        {
          schemaVersion: '1',
          missionId: 'mission-earlier',
          taskId: 'task-1',
          agentId: 'argus',
          status: 'complete',
          summary: 'Staging migration repair requires a validated project ref before replay.',
          evidenceRefs: ['receipt-abc123'],
          changedFiles: [],
          commandsRun: [],
          testResults: [{ name: 'unit', status: 'passed', passed: 10 }],
          unresolvedRisks: [],
          recommendedNextTasks: [],
        },
        { repoId: 'repo-a' },
      ),
      (p) => validateMemoryProposal(p, { secretPatterns: CONFIG_DEFAULTS.secretPatterns }),
    );
    expect(outcomes[0].status).toBe('stored');

    // A later, different mission asks about the same subject.
    const provider = createMissionContextProvider({ root, repoId: 'repo-a' });
    const context = await provider(mission({ id: 'mission-later' }), binding());

    expect(context).toBeDefined();
    expect(context!.capsule).toMatch(/validated project ref/i);
  });

  it('does not leak a harvested memory into another repository', async () => {
    const { proposeFromHandoff, commitProposals } = await import('../memory/propose.js');
    const { validateMemoryProposal } = await import('../memory/validate.js');

    commitProposals(
      svc.store,
      proposeFromHandoff(
        {
          schemaVersion: '1',
          missionId: 'm',
          taskId: 't',
          agentId: 'argus',
          status: 'complete',
          summary: 'Staging migration repair requires a validated project ref before replay.',
          evidenceRefs: ['r1'],
          changedFiles: [],
          commandsRun: [],
          testResults: [],
          unresolvedRisks: [],
          recommendedNextTasks: [],
        },
        { repoId: 'repo-a' },
      ),
      (p) => validateMemoryProposal(p, { secretPatterns: CONFIG_DEFAULTS.secretPatterns }),
    );

    const provider = createMissionContextProvider({ root, repoId: 'repo-b' });
    await expect(provider(mission(), binding())).resolves.toBeUndefined();
  });
});
