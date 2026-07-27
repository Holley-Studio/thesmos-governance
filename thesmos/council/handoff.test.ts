// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Typed handoffs.
 *
 * The central assertion: an agent cannot mark its own homework. A `complete`
 * status without the contract's required evidence is reported *and* downgraded.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_HANDOFF_SCHEMA_VERSION,
  HANDOFF_CODES,
  normalizeHandoff,
  renderHandoffMarkdown,
  serializeHandoff,
  validateHandoff,
  type AgentHandoff,
} from './handoff.js';
import { compileAgentContract } from './compiler.js';
import {
  evidenceBaselineForRole,
  evidenceBaselinesAreDistinct,
  handoffRequiredFieldsForRole,
} from './evidence.js';
import { COUNCIL_PRIMARY_ROLES, type CouncilPrimaryRole } from './contract.js';

function buildContract(tags: string[]) {
  return compileAgentContract({
    content: `---\nid: worker-agent\nname: Worker\ntype: agent\nversion: 1.0.0\nowner: local\ntags:\n${tags
      .map((t) => `  - ${t}`)
      .join('\n')}\nenabled: true\n---\n\nInstructions.\n`,
    sourcePath: '.thesmos/agents/worker-agent.md',
    ownership: 'adopted',
    root: '/repo',
  }).contract;
}

function handoff(overrides: Partial<AgentHandoff> = {}): AgentHandoff {
  return normalizeHandoff({
    schemaVersion: AGENT_HANDOFF_SCHEMA_VERSION,
    missionId: 'mission-1',
    taskId: 'task-1',
    agentId: 'worker-agent',
    status: 'complete',
    summary: 'Did the work.',
    evidenceRefs: [],
    changedFiles: [],
    commandsRun: [],
    testResults: [],
    unresolvedRisks: [],
    recommendedNextTasks: [],
    ...overrides,
  });
}

describe('normalization', () => {
  it('deduplicates and sorts paths and commands deterministically', () => {
    const result = handoff({
      changedFiles: ['src/b.ts', 'src/a.ts', 'src/b.ts'] as never,
      commandsRun: ['npm test', 'npm  test', 'git status'] as never,
    });
    expect(result.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.commandsRun).toEqual(['git status', 'npm test']);
  });

  it('normalizes Windows separators in changed files', () => {
    expect(handoff({ changedFiles: ['src\\nested\\a.ts'] as never }).changedFiles).toEqual([
      'src/nested/a.ts',
    ]);
  });

  it('relativizes absolute paths against the repo root', () => {
    const result = normalizeHandoff(
      { agentId: 'worker-agent', changedFiles: ['/repo/src/a.ts'] },
      '/repo'
    );
    expect(result.changedFiles).toEqual(['src/a.ts']);
  });

  it('never throws on malformed input and yields a valid shape', () => {
    for (const input of [null, undefined, 42, 'text', { status: 'weird' }]) {
      const result = normalizeHandoff(input);
      expect(Array.isArray(result.changedFiles)).toBe(true);
      expect(typeof result.summary).toBe('string');
    }
    expect(normalizeHandoff({ status: 'weird' }).status).toBe('failed');
  });

  it('produces stable JSON', () => {
    expect(serializeHandoff(handoff())).toBe(serializeHandoff(handoff()));
  });
});

describe('secret handling', () => {
  it('redacts credentials out of a summary', () => {
    const result = handoff({ summary: 'exported GITHUB_TOKEN=ghp_0123456789abcdefghijABCDEF ok' as never });
    expect(result.summary).not.toContain('ghp_0123456789abcdefghijABCDEF');
    expect(result.summary).toContain('[redacted]');
  });

  it('redacts credentials out of command output excerpts', () => {
    const result = normalizeHandoff({
      agentId: 'worker-agent',
      testResults: [
        { name: 'auth', status: 'passed', excerpt: 'using sk-abcdefghijklmnopqrstuvwxyz01' },
      ],
    });
    expect(serializeHandoff(result)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz01');
  });

  it('strips absolute home paths', () => {
    const result = handoff({ evidenceRefs: ['/Users/someone/repo/notes.md'] as never });
    expect(serializeHandoff(result)).not.toContain('someone');
  });

  it('flags a credential that survives into a validated handoff', () => {
    const raw = handoff();
    // Bypass normalization to prove validation is a second, independent gate.
    const tampered: AgentHandoff = { ...raw, summary: 'token AKIAIOSFODNN7EXAMPLE' };
    const result = validateHandoff(tampered);
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.secretSerialized)).toBe(true);
  });
});

describe('required fields', () => {
  it('rejects a handoff missing its identifiers', () => {
    const result = validateHandoff(handoff({ missionId: '' as never, taskId: '' as never }));
    expect(result.valid).toBe(false);
    expect(result.issues.filter((i) => i.code === HANDOFF_CODES.fieldMissing).length).toBeGreaterThanOrEqual(2);
  });

  it('rejects an unsupported schema version', () => {
    const result = validateHandoff({ ...handoff(), schemaVersion: '9.9.9' });
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.schemaVersionUnsupported)).toBe(true);
  });

  it('rejects an unknown agent id', () => {
    const result = validateHandoff(handoff(), { knownAgentIds: ['other-agent'] });
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.agentUnknown)).toBe(true);
  });

  it('rejects a handoff validated against a different agent’s contract', () => {
    const contract = buildContract(['testing']);
    const result = validateHandoff(handoff({ agentId: 'someone-else' as never }), { contract });
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.agentMismatch)).toBe(true);
  });
});

describe('completion requires evidence', () => {
  const contract = buildContract(['implementation', 'typescript']);

  it('does not let an unproven claim of completion stand', () => {
    const result = validateHandoff(handoff({ status: 'complete' }), { contract });
    expect(contract.classification.primaryRole).toBe('build');
    expect(result.valid).toBe(false);
    expect(result.effectiveStatus).toBe('partial');
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.completionUnproven)).toBe(true);
  });

  it('names every missing evidence field', () => {
    const result = validateHandoff(handoff({ status: 'complete' }), { contract });
    const missing = result.issues.filter((i) => i.code === HANDOFF_CODES.evidenceMissing).map((i) => i.path);
    expect(missing).toContain('changedFiles');
    expect(missing).toContain('commandsRun');
    expect(missing).toContain('testResults');
    expect(missing).toContain('unresolvedRisks');
  });

  it('accepts a completion that carries its evidence', () => {
    const result = validateHandoff(
      handoff({
        status: 'complete',
        changedFiles: ['src/a.ts'] as never,
        commandsRun: ['npm test'] as never,
        testResults: [{ name: 'unit', status: 'passed', total: 10, passed: 10, failed: 0 }] as never,
        unresolvedRisks: ['none identified in the touched paths'] as never,
      }),
      { contract }
    );
    expect(result.valid).toBe(true);
    expect(result.effectiveStatus).toBe('complete');
  });

  it('leaves a self-reported partial status alone', () => {
    const result = validateHandoff(handoff({ status: 'partial' }), { contract });
    expect(result.effectiveStatus).toBe('partial');
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.completionUnproven)).toBe(false);
  });
});

describe('test results', () => {
  it('rejects counts that do not add up', () => {
    const result = validateHandoff(
      handoff({ testResults: [{ name: 'unit', status: 'failed', total: 5, passed: 4, failed: 3 }] as never })
    );
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.testResultInvalid)).toBe(true);
  });

  it('rejects a suite reported as passed while carrying failures', () => {
    const result = validateHandoff(
      handoff({ testResults: [{ name: 'unit', status: 'passed', total: 5, passed: 3, failed: 2 }] as never })
    );
    expect(result.issues.some((i) => i.code === HANDOFF_CODES.testResultInvalid)).toBe(true);
  });

  it('treats an unrecognized runner status as errored rather than passed', () => {
    const result = normalizeHandoff({
      agentId: 'a',
      testResults: [{ name: 'unit', status: 'probably fine' }],
    });
    expect(result.testResults[0]!.status).toBe('errored');
  });
});

describe('evidence baselines', () => {
  it('gives every role a distinct required list', () => {
    expect(evidenceBaselinesAreDistinct()).toBe(true);
  });

  it.each(COUNCIL_PRIMARY_ROLES)('gives %s a non-empty, sorted baseline', (role) => {
    const baseline = evidenceBaselineForRole(role as CouncilPrimaryRole);
    expect(baseline.required.length).toBeGreaterThan(0);
    expect(baseline.required).toEqual([...baseline.required].sort());
  });

  it('requires reproduction and residual risk from security, not from growth', () => {
    expect(evidenceBaselineForRole('security').required).toContain('reproduction');
    expect(evidenceBaselineForRole('security').required).toContain('residual-risk');
    expect(evidenceBaselineForRole('growth').required).not.toContain('reproduction');
    expect(evidenceBaselineForRole('growth').required).toContain('measurement-plan');
  });

  it('maps role evidence onto concrete handoff fields', () => {
    expect(handoffRequiredFieldsForRole('build')).toContain('changedFiles');
    expect(handoffRequiredFieldsForRole('build')).toContain('testResults');
    expect(handoffRequiredFieldsForRole('review')).toContain('evidenceRefs');
    expect(handoffRequiredFieldsForRole('design')).toEqual([...handoffRequiredFieldsForRole('design')].sort());
  });
});

describe('rendering', () => {
  it('renders Markdown from the typed structure', () => {
    const rendered = renderHandoffMarkdown(
      handoff({
        changedFiles: ['src/a.ts'] as never,
        testResults: [{ name: 'unit', status: 'passed', total: 3, passed: 3 }] as never,
      })
    );
    expect(rendered).toContain('## Handoff — worker-agent');
    expect(rendered).toContain('- src/a.ts');
    expect(rendered).toContain('unit — passed (3 total, 3 passed)');
  });

  it('omits empty sections rather than printing empty headings', () => {
    const rendered = renderHandoffMarkdown(handoff());
    expect(rendered).not.toContain('**Changed files**');
  });
});
