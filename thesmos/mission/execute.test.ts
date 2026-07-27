// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * The runtime end to end.
 *
 * Covers the four things that make a mission governed rather than merely
 * scheduled: dependency order is honoured, budgets actually bound, a handoff
 * cannot claim more than it proves, and two identical runs hash identically.
 */

import { describe, expect, it } from 'vitest';
import { compileAgentContract } from '../council/compiler.js';
import {
  emptyPermissionPolicy,
  type CouncilAgentContract,
  type CouncilLimits,
  type CouncilPermissionPolicy,
} from '../council/contract.js';
import { AGENT_HANDOFF_SCHEMA_VERSION } from '../council/handoff.js';
import { createMission } from './create.js';
import { executeMission, type TaskRunContext, type TaskRunResult } from './execute.js';
import { MISSION_CODES, type Mission, type MissionTaskInput } from './types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function contractFor(
  agentId: string,
  permissions: CouncilPermissionPolicy = emptyPermissionPolicy(),
  limits?: Partial<CouncilLimits>
): CouncilAgentContract {
  const { contract } = compileAgentContract({
    content: `---
id: ${agentId}
name: ${agentId}
type: agent
version: 1.0.0
owner: local
enabled: true
---

Instructions.
`,
    sourcePath: `.thesmos/agents/${agentId}.md`,
    ownership: 'adopted',
    root: '/repo',
  });
  const clone = JSON.parse(JSON.stringify(contract)) as CouncilAgentContract;
  clone.permissions = permissions;
  if (limits) clone.limits = { ...clone.limits, ...limits };
  return clone;
}

function task(id: string, agentId = 'worker', dependsOn: string[] = []): MissionTaskInput {
  return { id, agentId, title: `Task ${id}`, intent: `do ${id}`, dependsOn };
}

function missionFor(tasks: MissionTaskInput[], limits?: Partial<CouncilLimits>): Mission {
  const result = createMission({
    goal: 'ship it',
    tasks,
    permissions: emptyPermissionPolicy(),
    ...(limits ? { limits } : {}),
  });
  if (!result.mission) throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  return result.mission;
}

/** A handoff carrying every category of evidence, so `complete` is provable. */
function richHandoff(ctx: TaskRunContext, over: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: AGENT_HANDOFF_SCHEMA_VERSION,
    missionId: ctx.mission.id,
    taskId: ctx.binding.task.id,
    agentId: ctx.binding.contract.identity.id,
    status: 'complete',
    summary: `finished ${ctx.binding.task.id}`,
    evidenceRefs: ['docs/notes.md'],
    changedFiles: ['src/app.ts'],
    commandsRun: ['npm test'],
    testResults: [{ name: 'unit', status: 'passed', total: 3, passed: 3, failed: 0 }],
    unresolvedRisks: ['none identified'],
    recommendedNextTasks: ['review'],
    ...over,
  };
}

/** A handoff with no evidence at all. */
function thinHandoff(ctx: TaskRunContext, over: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: AGENT_HANDOFF_SCHEMA_VERSION,
    missionId: ctx.mission.id,
    taskId: ctx.binding.task.id,
    agentId: ctx.binding.contract.identity.id,
    status: 'complete',
    summary: 'claims to be done',
    evidenceRefs: [],
    changedFiles: [],
    commandsRun: [],
    testResults: [],
    unresolvedRisks: [],
    recommendedNextTasks: [],
    ...over,
  };
}

const CONTRACTS = [contractFor('worker'), contractFor('helper'), contractFor('child-agent')];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ordering', () => {
  it('runs dependencies before dependents', async () => {
    const order: string[] = [];
    const mission = missionFor([task('c', 'worker', ['b']), task('b', 'worker', ['a']), task('a')]);

    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => {
        order.push(ctx.binding.task.id);
        return { handoff: richHandoff(ctx) };
      },
    });

    expect(order).toEqual(['a', 'b', 'c']);
    expect(result.state.status).toBe('complete');
  });

  it('hands a task the validated handoffs of what it depends on', async () => {
    const seen: Record<string, string[]> = {};
    const mission = missionFor([task('a'), task('b', 'worker', ['a'])]);

    await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => {
        seen[ctx.binding.task.id] = ctx.upstream.map((h) => h.taskId);
        return { handoff: richHandoff(ctx) };
      },
    });

    expect(seen['a']).toEqual([]);
    expect(seen['b']).toEqual(['a']);
  });
});

describe('failure containment', () => {
  it('skips a dependent when its dependency did not complete', async () => {
    const ran: string[] = [];
    const mission = missionFor([task('a'), task('b', 'worker', ['a'])]);

    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => {
        ran.push(ctx.binding.task.id);
        return { handoff: richHandoff(ctx, { status: 'failed' }) };
      },
    });

    expect(ran).toEqual(['a']);
    const b = result.state.tasks.find((t) => t.taskId === 'b');
    expect(b?.status).toBe('skipped');
    expect(b?.issues.map((i) => i.code)).toContain(MISSION_CODES.dependencyUnsatisfied);
    expect(result.state.status).toBe('failed');
  });

  it('records a throwing runner as failed without losing the rest of the mission', async () => {
    const mission = missionFor([task('a'), task('b')]);

    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => {
        if (ctx.binding.task.id === 'a') throw new Error('agent exploded');
        return { handoff: richHandoff(ctx) };
      },
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    const b = result.state.tasks.find((t) => t.taskId === 'b');
    expect(a?.status).toBe('failed');
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.taskThrew);
    expect(b?.status).toBe('complete');
  });

  it('contains an asynchronously rejected runner', async () => {
    const mission = missionFor([task('a'), task('b')]);

    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: async (ctx) => {
        if (ctx.binding.task.id === 'a') return Promise.reject(new Error('async boom'));
        return { handoff: richHandoff(ctx) };
      },
    });

    expect(result.state.tasks.find((t) => t.taskId === 'a')?.status).toBe('failed');
    expect(result.state.tasks.find((t) => t.taskId === 'b')?.status).toBe('complete');
  });

  it('never rejects, even when the runner itself is unusable', async () => {
    const mission = missionFor([task('a')]);

    // A whole wave failing must still resolve to a report. If this rejects, one
    // bad dispatch has taken down the record of everything else in the mission.
    await expect(
      executeMission(mission, {
        contracts: CONTRACTS,
        runTask: undefined as unknown as (ctx: TaskRunContext) => TaskRunResult,
      })
    ).resolves.toMatchObject({ state: { status: 'failed' } });
  });

  it('fails the mission when an agent id cannot be bound', async () => {
    const mission = missionFor([task('a', 'ghost-agent')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: richHandoff(ctx) }),
    });

    expect(result.state.status).toBe('failed');
    expect(result.issues.map((i) => i.code)).toContain(MISSION_CODES.taskAgentUnknown);
  });
});

describe('handoff validation', () => {
  it('downgrades a completion the evidence does not support', async () => {
    const mission = missionFor([task('a')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: thinHandoff(ctx) }),
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.status).toBe('partial');
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.handoffDowngraded);
  });

  it('a downgraded task does not satisfy a dependency', async () => {
    const mission = missionFor([task('a'), task('b', 'worker', ['a'])]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) =>
        ctx.binding.task.id === 'a'
          ? { handoff: thinHandoff(ctx) }
          : { handoff: richHandoff(ctx) },
    });

    expect(result.state.tasks.find((t) => t.taskId === 'b')?.status).toBe('skipped');
  });

  it('fails a task whose handoff names a different task', async () => {
    const mission = missionFor([task('a')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: richHandoff(ctx, { taskId: 'someone-else' }) }),
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.status).toBe('failed');
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.handoffTaskMismatch);
  });

  it('fails a task whose handoff names a different mission', async () => {
    // A handoff carrying another mission's id is either a routing bug or a
    // forged result. Accepting it would let work done under one permission
    // envelope be recorded as proof under another.
    const mission = missionFor([task('a')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({
        handoff: richHandoff(ctx, { missionId: 'sha256:' + 'b'.repeat(64) }),
      }),
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.status).toBe('failed');
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.handoffMissionMismatch);
  });

  it('keeps absolute machine paths out of the recorded handoff', async () => {
    const mission = missionFor([task('a')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      root: '/repo',
      runTask: (ctx) => ({
        handoff: richHandoff(ctx, { changedFiles: ['/repo/src/app.ts'] }),
      }),
    });

    const recorded = result.state.tasks.find((t) => t.taskId === 'a')?.handoff;
    expect(recorded?.changedFiles.every((f) => !f.startsWith('/repo/'))).toBe(true);
  });
});

describe('bounds', () => {
  it('blocks tasks once the mission step budget is exhausted', async () => {
    const mission = missionFor([task('a'), task('b'), task('c')], { maximumSteps: 2 });
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: richHandoff(ctx), stepsUsed: 1 }),
    });

    expect(result.state.stepsUsed).toBe(2);
    expect(result.state.tasks.filter((t) => t.status === 'blocked')).toHaveLength(1);
    expect(result.state.status).toBe('blocked');
  });

  it('enforces the per-task step limit, not just the mission budget', async () => {
    // The contract narrows itself to 2 steps inside a mission that allows 100.
    // A task claiming 50 must not be able to spend the mission's budget on the
    // strength of the mission's ceiling alone — limits only ever narrow.
    const contracts = [contractFor('worker', emptyPermissionPolicy(), { maximumSteps: 2 })];
    const mission = missionFor([task('a')], { maximumSteps: 100 });

    const result = await executeMission(mission, {
      contracts,
      runTask: (ctx) => ({ handoff: richHandoff(ctx), stepsUsed: 50 }),
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.limitStepsExceeded);
    expect(result.state.stepsUsed).toBeLessThanOrEqual(2);
    expect(a?.status).toBe('failed');
  });

  it('charges what a task reports, never less than one step', async () => {
    const mission = missionFor([task('a')], { maximumSteps: 50 });
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: richHandoff(ctx), stepsUsed: 0 }),
    });
    expect(result.state.stepsUsed).toBe(1);
  });

  it('reports a wave wider than the parallel limit', async () => {
    const mission = missionFor([task('a'), task('b'), task('c')], {
      maximumParallelChildren: 2,
    });
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: richHandoff(ctx) }),
    });

    expect(result.issues.map((i) => i.code)).toContain(MISSION_CODES.limitParallelExceeded);
    expect(result.state.status).toBe('complete');
  });
});

describe('delegation', () => {
  it('executes a task the parent brought into existence', async () => {
    const mission = missionFor([task('a')]);
    const ran: string[] = [];

    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx): TaskRunResult => {
        ran.push(ctx.binding.task.id);
        if (ctx.binding.task.id === 'a') {
          return {
            handoff: richHandoff(ctx),
            delegated: [
              { id: 'a-child', agentId: 'child-agent', title: 'Child', intent: 'help' },
            ],
          };
        }
        return { handoff: richHandoff(ctx) };
      },
    });

    expect(ran).toEqual(['a', 'a-child']);
    expect(result.state.tasks.find((t) => t.taskId === 'a')?.childTaskIds).toEqual(['a-child']);
    expect(result.state.tasks.find((t) => t.taskId === 'a-child')?.status).toBe('complete');
  });

  it('truncates delegation at the contract child limit and reports the breach', async () => {
    const contracts = [contractFor('worker', emptyPermissionPolicy(), { maximumChildren: 1 })];
    const mission = missionFor([task('a')], { maximumChildren: 1 });

    const result = await executeMission(mission, {
      contracts: [...contracts, contractFor('child-agent')],
      runTask: (ctx): TaskRunResult => {
        if (ctx.binding.task.id === 'a') {
          return {
            handoff: richHandoff(ctx),
            delegated: [
              { id: 'kid-b', agentId: 'child-agent', title: 'B', intent: 'b' },
              { id: 'kid-a', agentId: 'child-agent', title: 'A', intent: 'a' },
            ],
          };
        }
        return { handoff: richHandoff(ctx) };
      },
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.childTaskIds).toEqual(['kid-a']); // sorted, first only
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.limitChildrenExceeded);
    expect(result.state.tasks.some((t) => t.taskId === 'kid-b')).toBe(false);
  });

  it('rejects a delegated id that collides with an existing task', async () => {
    const mission = missionFor([task('a'), task('b')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx): TaskRunResult => {
        if (ctx.binding.task.id === 'a') {
          return {
            handoff: richHandoff(ctx),
            delegated: [{ id: 'b', agentId: 'child-agent', title: 'clash', intent: 'x' }],
          };
        }
        return { handoff: richHandoff(ctx) };
      },
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.graphDuplicateTask);
  });
});

describe('authority in context', () => {
  it('gives a task an authorize() bounded by the mission', async () => {
    const missionPolicy = { ...emptyPermissionPolicy() };
    missionPolicy.edit = [{ decision: 'deny', patterns: ['**'] }];
    const created = createMission({
      goal: 'g',
      tasks: [task('a')],
      permissions: missionPolicy,
    });

    const agentPolicy = { ...emptyPermissionPolicy() };
    agentPolicy.edit = [{ decision: 'allow', patterns: ['src/**'] }];

    let permitted: boolean | undefined;
    await executeMission(created.mission!, {
      contracts: [contractFor('worker', agentPolicy)],
      runTask: (ctx) => {
        permitted = ctx.authorize('edit', 'src/app.ts').permitted;
        return { handoff: richHandoff(ctx) };
      },
    });

    expect(permitted).toBe(false);
  });
});

describe('authority is recorded whether or not it is honoured', () => {
  function deniedMission(): Mission {
    const missionPolicy = { ...emptyPermissionPolicy() };
    missionPolicy.edit = [{ decision: 'deny', patterns: ['**'] }];
    const created = createMission({ goal: 'g', tasks: [task('a')], permissions: missionPolicy });
    if (!created.mission) throw new Error('fixture invalid');
    return created.mission;
  }

  it('records a denial even when the runner ignores it and reports success', async () => {
    // The whole point: a runner that asks, is refused, and carries on anyway
    // must not be able to erase the refusal from the report.
    const result = await executeMission(deniedMission(), {
      contracts: [contractFor('worker')],
      runTask: (ctx) => {
        ctx.authorize('edit', 'src/app.ts');
        return { handoff: richHandoff(ctx) };
      },
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.authorizations).toEqual([
      { channel: 'edit', target: 'src/app.ts', decision: 'deny' },
    ]);
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.actionDenied);
  });

  it('records an ask as a question, not as permission', async () => {
    const askPolicy = { ...emptyPermissionPolicy() };
    askPolicy.edit = [{ decision: 'ask', patterns: ['**'] }];
    const created = createMission({ goal: 'g', tasks: [task('a')], permissions: askPolicy });

    const result = await executeMission(created.mission!, {
      contracts: [contractFor('worker', askPolicy)],
      runTask: (ctx) => {
        expect(ctx.authorize('edit', 'src/app.ts').permitted).toBe(false);
        return { handoff: richHandoff(ctx) };
      },
    });

    const a = result.state.tasks.find((t) => t.taskId === 'a');
    expect(a?.authorizations[0]?.decision).toBe('ask');
    expect(a?.issues.map((i) => i.code)).toContain(MISSION_CODES.actionConfirmationRequired);
  });

  it('deduplicates repeated questions about the same target', async () => {
    const result = await executeMission(deniedMission(), {
      contracts: [contractFor('worker')],
      runTask: (ctx) => {
        for (let i = 0; i < 50; i += 1) ctx.authorize('edit', 'src/app.ts');
        return { handoff: richHandoff(ctx) };
      },
    });

    expect(result.state.tasks.find((t) => t.taskId === 'a')?.authorizations).toHaveLength(1);
  });

  it('records nothing when a task never asks', async () => {
    const mission = missionFor([task('a')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: richHandoff(ctx) }),
    });
    expect(result.state.tasks.find((t) => t.taskId === 'a')?.authorizations).toEqual([]);
  });
});

describe('determinism', () => {
  it('produces the same state hash for the same run twice', async () => {
    const mission = missionFor([task('a'), task('b', 'worker', ['a']), task('c')]);
    const run = async (): Promise<string> =>
      (
        await executeMission(mission, {
          contracts: CONTRACTS,
          runTask: (ctx) => ({ handoff: richHandoff(ctx) }),
        })
      ).stateHash;

    expect(await run()).toBe(await run());
  });

  it('produces the same state hash regardless of which task finishes first', async () => {
    const mission = missionFor([task('a'), task('b'), task('c')]);
    const runWithDelays = async (delays: Record<string, number>): Promise<string> =>
      (
        await executeMission(mission, {
          contracts: CONTRACTS,
          runTask: async (ctx) => {
            await new Promise((r) => setTimeout(r, delays[ctx.binding.task.id] ?? 0));
            return { handoff: richHandoff(ctx) };
          },
        })
      ).stateHash;

    const forward = await runWithDelays({ a: 5, b: 1, c: 0 });
    const reversed = await runWithDelays({ a: 0, b: 1, c: 5 });
    expect(reversed).toBe(forward);
  });

  it('is unaffected by completion order across five tasks with mixed outcomes', async () => {
    // One success, one failure, one throw, one downgrade, one plain task — the
    // combination most likely to expose order-sensitive folding.
    const mission = missionFor([task('a'), task('b'), task('c'), task('d'), task('e')], {
      maximumParallelChildren: 8,
    });

    const runWith = async (delays: Record<string, number>): Promise<string> =>
      (
        await executeMission(mission, {
          contracts: CONTRACTS,
          runTask: async (ctx) => {
            const id = ctx.binding.task.id;
            await new Promise((r) => setTimeout(r, delays[id] ?? 0));
            if (id === 'b') return { handoff: richHandoff(ctx, { status: 'failed' }) };
            if (id === 'c') throw new Error('boom');
            if (id === 'd') return { handoff: thinHandoff(ctx) };
            return { handoff: richHandoff(ctx) };
          },
        })
      ).stateHash;

    const forward = await runWith({ a: 8, b: 6, c: 4, d: 2, e: 0 });
    const reversed = await runWith({ a: 0, b: 2, c: 4, d: 6, e: 8 });
    const scattered = await runWith({ a: 3, b: 0, c: 7, d: 1, e: 5 });

    expect(reversed).toBe(forward);
    expect(scattered).toBe(forward);
  });

  it('is unaffected by the order tasks were declared in', async () => {
    const run = async (tasks: MissionTaskInput[]): Promise<string> =>
      (
        await executeMission(missionFor(tasks), {
          contracts: CONTRACTS,
          runTask: (ctx) => ({ handoff: richHandoff(ctx) }),
        })
      ).stateHash;

    const forward = await run([task('a'), task('b', 'worker', ['a']), task('c', 'worker', ['a'])]);
    const shuffled = await run([task('c', 'worker', ['a']), task('a'), task('b', 'worker', ['a'])]);
    expect(shuffled).toBe(forward);
  });

  it('resolves contention by task id, not by which task finished first', async () => {
    // Two tasks in one wave both try to delegate the same child id. Exactly one
    // can win, and which one must be decided by the sorted fold — never by the
    // race. This is the case that actually observes fold order: with ample
    // budget and no contention, completion order is invisible, which is why an
    // earlier version of this suite let a completion-ordered fold pass.
    const mission = missionFor([task('a'), task('b')], { maximumParallelChildren: 4 });

    const runWith = async (
      delays: Record<string, number>
    ): Promise<{ hash: string; winner: string | undefined; loser: string | undefined }> => {
      const result = await executeMission(mission, {
        contracts: CONTRACTS,
        runTask: async (ctx): Promise<TaskRunResult> => {
          await new Promise((r) => setTimeout(r, delays[ctx.binding.task.id] ?? 0));
          return {
            handoff: richHandoff(ctx),
            delegated: [{ id: 'shared', agentId: 'child-agent', title: 'S', intent: 's' }],
          };
        },
      });
      const winner = result.state.tasks.find((t) => t.childTaskIds.includes('shared'))?.taskId;
      const loser = result.state.tasks.find((t) =>
        t.issues.some((i) => i.code === MISSION_CODES.graphDuplicateTask)
      )?.taskId;
      return { hash: result.stateHash, winner, loser };
    };

    const aFirst = await runWith({ a: 0, b: 20 });
    const bFirst = await runWith({ a: 20, b: 0 });

    // 'a' sorts before 'b', so 'a' takes the child in both runs.
    expect(aFirst.winner).toBe('a');
    expect(bFirst.winner).toBe('a');
    expect(aFirst.loser).toBe('b');
    expect(bFirst.loser).toBe('b');
    expect(bFirst.hash).toBe(aFirst.hash);
  });

  it('hashes the state it returns', async () => {
    const mission = missionFor([task('a')]);
    const result = await executeMission(mission, {
      contracts: CONTRACTS,
      runTask: (ctx) => ({ handoff: richHandoff(ctx) }),
    });
    expect(result.stateHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
