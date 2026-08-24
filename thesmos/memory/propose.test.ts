// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Closed-loop memory: missions producing governed records.
 *
 * The property under test is restraint. It is easy to make a mission write
 * memory; the work is making it write only what is worth remembering, with
 * honest provenance, without duplicating what is already known.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifySummary,
  commitProposals,
  confidenceFromTests,
  isDurableContent,
  proposeFromHandoff,
  proposeFromMission,
  qualifiesForAutoWrite,
} from './propose.js';
import { MemoryStore } from './store.js';
import { validateMemoryProposal } from './validate.js';
import { CONFIG_DEFAULTS } from '../config.js';
import type { AgentHandoff } from '../council/handoff.js';
import type { Mission, MissionState } from '../mission/types.js';

let root: string;
let store: MemoryStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'propose-'));
  store = new MemoryStore(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const validate = (p: Parameters<typeof validateMemoryProposal>[0]) =>
  validateMemoryProposal(p, { secretPatterns: CONFIG_DEFAULTS.secretPatterns });

function handoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return {
    schemaVersion: '1',
    missionId: 'mission-1',
    taskId: 'task-1',
    agentId: 'argus',
    status: 'complete',
    summary: 'Staging migration repair requires a validated project ref before replay.',
    evidenceRefs: ['receipt-abc123'],
    changedFiles: ['thesmos/migrate.ts'],
    commandsRun: ['npm test'],
    testResults: [{ name: 'unit', status: 'passed', passed: 120, total: 120 }],
    unresolvedRisks: [],
    recommendedNextTasks: [],
    ...overrides,
  };
}

describe('durability filter', () => {
  it('accepts a substantive finding', () => {
    expect(isDurableContent('Staging migration repair requires a validated project ref.')).toBe(true);
  });

  it('rejects conversational filler', () => {
    for (const junk of ['ok', 'Done.', 'complete', 'No changes', 'n/a', 'see above', 'WIP']) {
      expect(isDurableContent(junk)).toBe(false);
    }
  });

  it('rejects anything too short to carry a fact', () => {
    expect(isDurableContent('fixed it')).toBe(false);
  });

  it('rejects a pasted log', () => {
    const log = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
    expect(isDurableContent(log)).toBe(false);
    expect(isDurableContent('2026-08-07T10:00:00 something happened during the run')).toBe(false);
    expect(isDurableContent('Error occurred\n    at doThing (/src/x.ts:1:1)')).toBe(false);
  });

  it('rejects code and diffs — Git already stores those', () => {
    expect(isDurableContent('Here is the fix:\n```ts\nconst x = 1;\n```')).toBe(false);
    expect(isDurableContent('--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@')).toBe(false);
  });

  it('rejects a summary long enough to be a document', () => {
    expect(isDurableContent('x'.repeat(1500))).toBe(false);
  });
});

describe('confidence from evidence', () => {
  it('treats a passing suite with counts as verified', () => {
    expect(confidenceFromTests([{ name: 'unit', status: 'passed', passed: 10 }])).toBe('verified');
  });

  it('treats a bare pass as high, not verified', () => {
    expect(confidenceFromTests([{ name: 'unit', status: 'passed' }])).toBe('high');
  });

  it('treats a crashed suite the same as a failure', () => {
    // A suite that errored proved nothing; "not passed" would overstate it.
    expect(confidenceFromTests([{ name: 'unit', status: 'errored' }])).toBe('low');
    expect(confidenceFromTests([{ name: 'unit', status: 'failed' }])).toBe('low');
  });

  it('does not invent confidence from an absent suite', () => {
    expect(confidenceFromTests([])).toBe('high');
    expect(confidenceFromTests([{ name: 'unit', status: 'skipped' }])).toBe('medium');
  });
});

describe('classification', () => {
  it('recognizes decisions, constraints and procedures', () => {
    expect(classifySummary('We decided to standardize on the runtime provider path.')).toBe(
      'architecture-decision',
    );
    expect(classifySummary('Production deploys must never run without approval.')).toBe('constraint');
    expect(classifySummary('Procedure to repair a staging migration after failure.')).toBe('procedure');
  });

  it('defaults to observation', () => {
    expect(classifySummary('CI run 4821 completed on the staging branch.')).toBe('observation');
  });
});

describe('proposals from a handoff', () => {
  it('produces an observed memory with provenance from evidence', () => {
    const [proposal] = proposeFromHandoff(handoff(), { repoId: 'repo-a' });
    expect(proposal.provenance).toMatchObject({
      sourceKind: 'mission',
      sourceId: 'mission-1',
      creator: 'argus',
      derivation: 'observed',
      evidenceRef: 'receipt-abc123',
    });
    expect(proposal.confidence).toBe('verified');
    expect(proposal.repoId).toBe('repo-a');
  });

  it('downgrades to stated when there is no evidence ref', () => {
    // Claiming "observed" without evidence is what the validator rejects — and
    // it is right to, so the proposer must not manufacture it.
    const [proposal] = proposeFromHandoff(handoff({ evidenceRefs: [] }));
    expect(proposal.provenance.derivation).toBe('stated');
    expect(validate(proposal).decision).toBe('accept');
  });

  it('produces nothing from a failed or blocked task', () => {
    // Recording what a failed attempt claimed would assert things that never happened.
    expect(proposeFromHandoff(handoff({ status: 'failed' }))).toEqual([]);
    expect(proposeFromHandoff(handoff({ status: 'blocked' }))).toEqual([]);
  });

  it('produces nothing from a junk summary', () => {
    expect(proposeFromHandoff(handoff({ summary: 'Done.' }))).toEqual([]);
  });

  it('records unresolved risks as hypotheses, never observations', () => {
    const proposals = proposeFromHandoff(
      handoff({
        unresolvedRisks: ['The rollback path has not been exercised against a partial migration.'],
      }),
    );
    const risk = proposals.find((p) => p.type === 'hypothesis');
    expect(risk).toBeDefined();
    expect(risk!.provenance.derivation).toBe('inferred');
    expect(risk!.confidence).toBe('medium');
  });

  it('produces a hypothesis that survives validation', () => {
    // A hypothesis claiming `verified` is rejected outright, so the proposer
    // must never emit one.
    const [, risk] = proposeFromHandoff(
      handoff({ unresolvedRisks: ['The rollback path has not been exercised end to end.'] }),
    );
    expect(validate(risk).decision).toBe('accept');
  });

  it('filters junk risks', () => {
    expect(proposeFromHandoff(handoff({ unresolvedRisks: ['none', 'n/a'] }))).toHaveLength(1);
  });
});

describe('proposals from a mission', () => {
  function mission(): Mission {
    return {
      schemaVersion: '1',
      id: 'mission-1',
      goal: 'repair staging certification',
      permissions: {} as Mission['permissions'],
      limits: {} as Mission['limits'],
      graph: { tasks: [] } as unknown as Mission['graph'],
    };
  }

  /**
   * A minimal MissionState.
   *
   * Cast through `unknown` because the fixture supplies only the fields
   * `proposeFromMission` actually reads — task ids and statuses. Filling in
   * `limits` and the rest would add noise without testing anything.
   */
  function state(statuses: Record<string, string>): MissionState {
    return {
      schemaVersion: '1',
      missionId: 'mission-1',
      status: 'complete',
      stepsUsed: 2,
      issues: [],
      tasks: Object.entries(statuses).map(([taskId, status]) => ({
        taskId,
        agentId: 'argus',
        status,
        stepsUsed: 1,
        childTaskIds: [],
        limits: {},
        authorizations: [],
      })),
    } as unknown as MissionState;
  }

  it('only harvests completed tasks', () => {
    const proposals = proposeFromMission(
      mission(),
      state({ 'task-1': 'complete', 'task-2': 'failed' }),
      [
        handoff({ taskId: 'task-1' }),
        handoff({ taskId: 'task-2', summary: 'A different durable finding about migrations.' }),
      ],
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].metadata.taskId).toBe('task-1');
  });

  it('is deterministic in ordering', () => {
    const handoffs = [
      handoff({ taskId: 'task-b', summary: 'Beta finding about the staging replay order.' }),
      handoff({ taskId: 'task-a', summary: 'Alpha finding about the project ref validation.' }),
    ];
    const s = state({ 'task-a': 'complete', 'task-b': 'complete' });
    const first = proposeFromMission(mission(), s, handoffs).map((p) => p.metadata.taskId);
    const second = proposeFromMission(mission(), s, [...handoffs].reverse()).map((p) => p.metadata.taskId);
    expect(first).toEqual(['task-a', 'task-b']);
    expect(second).toEqual(first);
  });
});

describe('auto-write gate', () => {
  it('permits an evidence-backed project-scoped finding', () => {
    const [proposal] = proposeFromHandoff(handoff());
    expect(qualifiesForAutoWrite(proposal)).toBe(true);
  });

  it('refuses a hypothesis', () => {
    const [, risk] = proposeFromHandoff(
      handoff({ unresolvedRisks: ['Rollback has not been exercised against a partial migration.'] }),
    );
    expect(qualifiesForAutoWrite(risk)).toBe(false);
  });

  it('refuses low confidence', () => {
    const [proposal] = proposeFromHandoff(
      handoff({ testResults: [{ name: 'unit', status: 'failed' }] }),
    );
    expect(qualifiesForAutoWrite(proposal)).toBe(false);
  });

  it('refuses sensitive or unscoped records', () => {
    const [base] = proposeFromHandoff(handoff());
    expect(qualifiesForAutoWrite({ ...base, sensitivity: 'sensitive' })).toBe(false);
    expect(qualifiesForAutoWrite({ ...base, scope: 'global' })).toBe(false);
  });

  it('refuses a claim with no evidence at all', () => {
    const [base] = proposeFromHandoff(handoff());
    expect(
      qualifiesForAutoWrite({
        ...base,
        provenance: { sourceKind: 'mission', creator: 'x', derivation: 'stated' },
      }),
    ).toBe(false);
  });
});

describe('commit pipeline', () => {
  it('stores a valid proposal', () => {
    const outcomes = commitProposals(store, proposeFromHandoff(handoff()), validate);
    expect(outcomes[0].status).toBe('stored');
    expect(store.all()).toHaveLength(1);
  });

  it('marks a hypothesis for review rather than presenting it as settled', () => {
    const proposals = proposeFromHandoff(
      handoff({ summary: 'Done.', unresolvedRisks: ['Rollback is unexercised against partial state.'] }),
    );
    const outcomes = commitProposals(store, proposals, validate);
    expect(outcomes[0].status).toBe('needs-review');
    // Still stored — a risk nobody can see is worse than one flagged for review.
    expect(store.all()).toHaveLength(1);
  });

  it('rejects a proposal carrying a secret and stores nothing', () => {
    const credential = ['AWS', 'SECRET', 'ACCESS', 'KEY'].join('_') + '=' + 'A1b2C3d4E5f6G7h8I9j0K1l2';
    const outcomes = commitProposals(
      store,
      proposeFromHandoff(handoff({ summary: `Deployment configured with ${credential} for staging.` })),
      validate,
    );
    expect(outcomes[0].status).toBe('rejected');
    expect(store.all()).toHaveLength(0);
  });

  it('deduplicates against what is already known', () => {
    commitProposals(store, proposeFromHandoff(handoff()), validate);
    const outcomes = commitProposals(store, proposeFromHandoff(handoff({ taskId: 'task-2' })), validate);
    expect(outcomes[0].status).toBe('duplicate');
    expect(store.all()).toHaveLength(1);
  });

  it('deduplicates within a single batch', () => {
    const proposals = [
      ...proposeFromHandoff(handoff({ taskId: 'a' })),
      ...proposeFromHandoff(handoff({ taskId: 'b' })),
    ];
    const outcomes = commitProposals(store, proposals, validate);
    expect(outcomes.map((o) => o.status)).toEqual(['stored', 'duplicate']);
  });

  it('supersedes a stale governance record and keeps its history', () => {
    commitProposals(
      store,
      proposeFromHandoff(
        handoff({ summary: 'We decided staging migrations replay against the production ref.' }),
      ),
      validate,
    );
    const outcomes = commitProposals(
      store,
      proposeFromHandoff(
        handoff({
          taskId: 'task-2',
          summary: 'We decided staging migrations must never replay against the production ref.',
        }),
      ),
      validate,
    );

    expect(outcomes[0].superseded).toHaveLength(1);
    const records = store.all();
    expect(records).toHaveLength(2);
    expect(records.filter((r) => r.status === 'superseded')).toHaveLength(1);
    expect(records.filter((r) => r.status === 'active')).toHaveLength(1);
  });

  it('does not supersede an unrelated record', () => {
    commitProposals(
      store,
      proposeFromHandoff(handoff({ summary: 'We decided to standardize on the wide homepage hero.' })),
      validate,
    );
    const outcomes = commitProposals(
      store,
      proposeFromHandoff(
        handoff({ taskId: 't2', summary: 'We decided the staging replay order follows dependency graph.' }),
      ),
      validate,
    );
    expect(outcomes[0].superseded).toBeUndefined();
    expect(store.all().every((r) => r.status === 'active')).toBe(true);
  });

  it('does not let an observation retire another observation', () => {
    // One CI run does not invalidate another.
    const a = handoff({ summary: 'CI run 4821 completed on the staging branch successfully.' });
    const b = handoff({ taskId: 't2', summary: 'CI run 4822 completed on the staging branch with warnings.' });
    commitProposals(store, proposeFromHandoff(a), validate);
    const outcomes = commitProposals(store, proposeFromHandoff(b), validate);
    expect(outcomes[0].superseded).toBeUndefined();
  });

  it('can be told not to supersede', () => {
    commitProposals(
      store,
      proposeFromHandoff(handoff({ summary: 'We decided staging replays against the production ref.' })),
      validate,
    );
    const outcomes = commitProposals(
      store,
      proposeFromHandoff(
        handoff({ taskId: 't2', summary: 'We decided staging must never replay against the production ref.' }),
      ),
      validate,
      { supersede: false },
    );
    expect(outcomes[0].superseded).toBeUndefined();
  });
});
