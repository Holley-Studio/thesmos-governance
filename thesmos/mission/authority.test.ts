// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Task authority.
 *
 * The invariant under test throughout: a task's permission is the intersection
 * with its mission's, never its own claim. Every "agent allows, mission denies"
 * case must resolve to denied — that is the property the whole runtime rests on.
 */

import { describe, expect, it } from 'vitest';
import { compileAgentContract } from '../council/compiler.js';
import {
  emptyPermissionPolicy,
  type CouncilAgentContract,
  type CouncilLimits,
  type CouncilPermissionPolicy,
} from '../council/contract.js';
import { authorizationIssue, authorizeTaskAction, bindMission } from './authority.js';
import { createMission } from './create.js';
import { MISSION_CODES, type Mission, type MissionTaskInput } from './types.js';

function policy(overrides: Partial<CouncilPermissionPolicy>): CouncilPermissionPolicy {
  return { ...emptyPermissionPolicy(), ...overrides };
}

function contractFor(
  agentId: string,
  permissions: CouncilPermissionPolicy,
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

function task(id: string, agentId: string): MissionTaskInput {
  return { id, agentId, title: `Task ${id}`, intent: `do ${id}` };
}

function missionWith(
  permissions: CouncilPermissionPolicy,
  tasks: MissionTaskInput[] = [task('a', 'worker')],
  limits?: Partial<CouncilLimits>
): Mission {
  const result = createMission({ goal: 'g', tasks, permissions, ...(limits ? { limits } : {}) });
  if (!result.mission) throw new Error(`fixture mission invalid: ${JSON.stringify(result.issues)}`);
  return result.mission;
}

describe('binding', () => {
  it('binds each task to exactly one contract', () => {
    const mission = missionWith(emptyPermissionPolicy());
    const result = bindMission(mission, [contractFor('worker', emptyPermissionPolicy())]);
    expect(result.valid).toBe(true);
    expect(result.bindings).toHaveLength(1);
    expect(result.bindings[0]?.contract.identity.id).toBe('worker');
  });

  it('fails on an unknown agent rather than skipping the task', () => {
    const mission = missionWith(emptyPermissionPolicy());
    const result = bindMission(mission, []);
    expect(result.valid).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(MISSION_CODES.taskAgentUnknown);
    expect(result.bindings).toHaveLength(0);
  });

  it('narrows a contract limit against the mission', () => {
    const mission = missionWith(emptyPermissionPolicy(), [task('a', 'worker')], {
      maximumSteps: 10,
    });
    const contract = contractFor('worker', emptyPermissionPolicy(), { maximumSteps: 999 });
    const [binding] = bindMission(mission, [contract]).bindings;
    expect(binding?.limits.maximumSteps).toBe(10);
  });
});

describe('a task cannot exceed its mission', () => {
  it('denies when the mission denies and the agent allows', () => {
    const mission = missionWith(policy({ edit: [{ decision: 'deny', patterns: ['**'] }] }));
    const contract = contractFor(
      'worker',
      policy({ edit: [{ decision: 'allow', patterns: ['src/**'] }] })
    );
    const [binding] = bindMission(mission, [contract]).bindings;
    const auth = authorizeTaskAction(mission, binding!, 'edit', 'src/app.ts');
    expect(auth.resolution.decision).toBe('deny');
    expect(auth.permitted).toBe(false);
  });

  it('explains a denial as bounded by the parent mission', () => {
    const mission = missionWith(policy({ edit: [{ decision: 'deny', patterns: ['**'] }] }));
    const contract = contractFor(
      'worker',
      policy({ edit: [{ decision: 'allow', patterns: ['src/**'] }] })
    );
    const [binding] = bindMission(mission, [contract]).bindings;
    const auth = authorizeTaskAction(mission, binding!, 'edit', 'src/app.ts');
    expect(auth.resolution.reason).toContain('bounded by parent mission');
  });

  it('lets an agent narrow what the mission granted', () => {
    const mission = missionWith(policy({ edit: [{ decision: 'allow', patterns: ['**'] }] }));
    const contract = contractFor(
      'worker',
      policy({
        edit: [
          { decision: 'allow', patterns: ['**'] },
          { decision: 'deny', patterns: ['secrets/**'] },
        ],
      })
    );
    const [binding] = bindMission(mission, [contract]).bindings;
    expect(authorizeTaskAction(mission, binding!, 'edit', 'secrets/key.pem').permitted).toBe(false);
    expect(authorizeTaskAction(mission, binding!, 'edit', 'src/app.ts').permitted).toBe(true);
  });

  it('does not let an agent inherit a grant it never made', () => {
    // The mission allows everything; the agent is silent on this target. Silence
    // resolves to `ask`, so the task still may not act — permission is the
    // intersection of two grants, never the mission's grant alone.
    const mission = missionWith(policy({ edit: [{ decision: 'allow', patterns: ['**'] }] }));
    const [binding] = bindMission(mission, [contractFor('worker', emptyPermissionPolicy())])
      .bindings;
    const auth = authorizeTaskAction(mission, binding!, 'edit', 'src/app.ts');
    expect(auth.resolution.decision).toBe('ask');
    expect(auth.permitted).toBe(false);
  });

  it('permits only when both sides allow', () => {
    const grant = policy({ edit: [{ decision: 'allow', patterns: ['src/**'] }] });
    const mission = missionWith(grant);
    const [binding] = bindMission(mission, [contractFor('worker', grant)]).bindings;
    const auth = authorizeTaskAction(mission, binding!, 'edit', 'src/app.ts');
    expect(auth.resolution.decision).toBe('allow');
    expect(auth.permitted).toBe(true);
  });

  it('treats "ask" as not permitted', () => {
    const mission = missionWith(policy({ shell: [{ decision: 'ask', patterns: ['npm *'] }] }));
    const contract = contractFor(
      'worker',
      policy({ shell: [{ decision: 'allow', patterns: ['npm *'] }] })
    );
    const [binding] = bindMission(mission, [contract]).bindings;
    const auth = authorizeTaskAction(mission, binding!, 'shell', 'npm test');
    expect(auth.resolution.decision).toBe('ask');
    expect(auth.permitted).toBe(false);
  });

  it('denies an unmatched target rather than defaulting open', () => {
    const mission = missionWith(emptyPermissionPolicy());
    const [binding] = bindMission(mission, [contractFor('worker', emptyPermissionPolicy())])
      .bindings;
    expect(authorizeTaskAction(mission, binding!, 'edit', 'anything.ts').permitted).toBe(false);
  });
});

describe('escalation reporting', () => {
  it('reports a contract that claims more than its mission', () => {
    const mission = missionWith(policy({ edit: [{ decision: 'deny', patterns: ['**'] }] }));
    const contract = contractFor(
      'worker',
      policy({ edit: [{ decision: 'allow', patterns: ['src/**'] }] })
    );
    const result = bindMission(mission, [contract]);
    expect(result.issues.map((i) => i.code)).toContain(MISSION_CODES.taskEscalation);
  });

  it('reports escalation as a warning, not a gate failure', () => {
    const mission = missionWith(policy({ edit: [{ decision: 'deny', patterns: ['**'] }] }));
    const contract = contractFor(
      'worker',
      policy({ edit: [{ decision: 'allow', patterns: ['src/**'] }] })
    );
    const result = bindMission(mission, [contract]);
    expect(result.valid).toBe(true);
    expect(
      result.issues.filter((i) => i.code === MISSION_CODES.taskEscalation).every((i) => i.severity === 'warning')
    ).toBe(true);
  });

  it('reports nothing when the contract stays inside its mission', () => {
    const mission = missionWith(policy({ edit: [{ decision: 'allow', patterns: ['**'] }] }));
    const contract = contractFor(
      'worker',
      policy({ edit: [{ decision: 'allow', patterns: ['src/**'] }] })
    );
    const result = bindMission(mission, [contract]);
    expect(result.issues.filter((i) => i.code === MISSION_CODES.taskEscalation)).toHaveLength(0);
  });
});

describe('authorization issues', () => {
  it('produces no issue for an allowed action', () => {
    const grant = policy({ read: [{ decision: 'allow', patterns: ['**'] }] });
    const mission = missionWith(grant);
    const [binding] = bindMission(mission, [contractFor('worker', grant)]).bindings;
    expect(authorizationIssue(authorizeTaskAction(mission, binding!, 'read', 'a.ts'))).toBeUndefined();
  });

  it('produces an error for a denial and a warning for a question', () => {
    const denyMission = missionWith(policy({ edit: [{ decision: 'deny', patterns: ['**'] }] }));
    const [denyBinding] = bindMission(denyMission, [
      contractFor('worker', emptyPermissionPolicy()),
    ]).bindings;
    expect(authorizationIssue(authorizeTaskAction(denyMission, denyBinding!, 'edit', 'a.ts'))?.severity).toBe(
      'error'
    );

    const askMission = missionWith(policy({ edit: [{ decision: 'ask', patterns: ['**'] }] }));
    const [askBinding] = bindMission(askMission, [
      contractFor('worker', policy({ edit: [{ decision: 'ask', patterns: ['**'] }] })),
    ]).bindings;
    expect(authorizationIssue(authorizeTaskAction(askMission, askBinding!, 'edit', 'a.ts'))?.severity).toBe(
      'warning'
    );
  });
});
