// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Mission CLI: output modes, exit codes, and the boundaries it must hold.
 *
 * Exit codes are the contract CI depends on, so they are asserted explicitly:
 * 0 for a valid mission (warnings included), 1 for usage and unreadable specs,
 * 2 for an invalid mission.
 *
 * Two properties get more attention than the formatting does. These commands
 * must never execute a mission — planning is the whole surface — and they must
 * never print an agent's instruction body or an absolute machine path, which is
 * the same boundary `agent:show` holds.
 *
 * `HOME` is redirected to a temporary directory for every test, because agent
 * discovery reads `~/.claude/agents` and these assertions must not depend on
 * whichever agents a developer happens to have installed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdMissionPlan, cmdMissionShow, cmdMissionValidate } from './mission.ts';

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function run(fn: (argv: string[]) => Promise<void>, argv: string[]): Promise<Run> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk: unknown) => { stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk: unknown) => { stderr.push(String(chunk)); return true; };

  let exitCode = 0;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit__${exitCode}`);
  }) as never);

  try {
    await fn(argv);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('__exit__')) throw err;
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    exitSpy.mockRestore();
  }

  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode };
}

const BODY_MARKER = 'BODY_ONLY_MARKER_DO_NOT_PRINT';

const AGENT = (id: string): string => `---
id: ${id}
name: ${id}
type: agent
version: 1.0.0
owner: local
enabled: true
---

${BODY_MARKER} — these instructions must never reach mission output.
`;

let root = '';
let home = '';
let originalCwd = '';
let originalHome: string | undefined;

/** Write a spec into the repo root and return the argv path. */
function spec(name: string, value: unknown): string {
  const path = join(root, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return name;
}

function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    goal: 'harden the surface',
    tasks: [
      { id: 'audit', agentId: 'alpha-agent', title: 'Audit', intent: 'look' },
      { id: 'fix', agentId: 'beta-agent', title: 'Fix', intent: 'patch', dependsOn: ['audit'] },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-mission-cli-'));
  home = mkdtempSync(join(tmpdir(), 'thesmos-mission-home-'));
  mkdirSync(join(root, '.thesmos', 'agents'), { recursive: true });
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.thesmos', 'agents', 'alpha-agent.md'), AGENT('alpha-agent'), 'utf8');
  writeFileSync(join(root, '.thesmos', 'agents', 'beta-agent.md'), AGENT('beta-agent'), 'utf8');

  originalCwd = process.cwd();
  originalHome = process.env['HOME'];
  process.env['HOME'] = home;
  process.chdir(root);
});

afterEach(() => {
  process.chdir(originalCwd);
  if (originalHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = originalHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

describe('usage', () => {
  it.each([
    ['mission:plan', cmdMissionPlan],
    ['mission:show', cmdMissionShow],
    ['mission:validate', cmdMissionValidate],
  ])('%s exits 1 with no spec path', async (_name, fn) => {
    const result = await run(fn, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('mission spec path is required');
  });

  it('exits 1 for a missing spec', async () => {
    const result = await run(cmdMissionPlan, ['nope.json']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no mission spec at');
  });

  it('exits 1 for malformed JSON', async () => {
    const result = await run(cmdMissionPlan, [spec('bad.json', '{ not json')]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('not valid JSON');
  });

  it('exits 1 for a directory rather than a file', async () => {
    const result = await run(cmdMissionPlan, ['.thesmos']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('is not a file');
  });
});

describe('mission:plan', () => {
  it('prints dependency order and exits 0', async () => {
    const result = await run(cmdMissionPlan, [spec('m.json', validSpec())]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('audit → fix');
    expect(result.stdout).toContain('sha256:');
  });

  it('emits stable JSON with --json', async () => {
    const path = spec('m.json', validSpec());
    const first = await run(cmdMissionPlan, [path, '--json']);
    const second = await run(cmdMissionPlan, [path, '--json']);
    expect(first.stdout).toBe(second.stdout);
    expect(JSON.parse(first.stdout)).toMatchObject({
      order: ['audit', 'fix'],
      layers: [['audit'], ['fix']],
      valid: true,
    });
  });

  it('exits 2 for a cyclic mission', async () => {
    const result = await run(cmdMissionPlan, [
      spec('cycle.json', {
        goal: 'g',
        tasks: [
          { id: 'a', agentId: 'alpha-agent', title: 'A', intent: 'a', dependsOn: ['b'] },
          { id: 'b', agentId: 'beta-agent', title: 'B', intent: 'b', dependsOn: ['a'] },
        ],
      }),
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('MISSION_GRAPH_CYCLE');
  });

  it('exits 2 for an unknown agent', async () => {
    const result = await run(cmdMissionPlan, [
      spec('ghost.json', {
        goal: 'g',
        tasks: [{ id: 'a', agentId: 'ghost-agent', title: 'A', intent: 'a' }],
      }),
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('MISSION_TASK_AGENT_UNKNOWN');
  });

  it('exits 2 for an empty mission', async () => {
    const result = await run(cmdMissionPlan, [spec('empty.json', { goal: 'g', tasks: [] })]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('MISSION_GRAPH_EMPTY');
  });
});

describe('mission:show', () => {
  it('reports the agent, role, and effective limits per task', async () => {
    const result = await run(cmdMissionShow, [spec('m.json', validSpec())]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('audit  →  alpha-agent');
    expect(result.stdout).toContain('limits  steps ≤');
  });

  it('narrows the mission limit to the agent contract', async () => {
    const result = await run(cmdMissionShow, [
      spec('m.json', validSpec({ limits: { maximumSteps: 3 } })),
      '--json',
    ]);
    const parsed = JSON.parse(result.stdout);
    for (const task of parsed.tasks) {
      expect(task.limits.maximumSteps).toBeLessThanOrEqual(3);
    }
  });

  it('emits Markdown with --markdown', async () => {
    const result = await run(cmdMissionShow, [spec('m.json', validSpec()), '--markdown']);
    expect(result.stdout).toContain('# Mission —');
    expect(result.stdout).toContain('| Task | Agent | Role |');
  });

  it('emits stable JSON with --json', async () => {
    const path = spec('m.json', validSpec());
    const first = await run(cmdMissionShow, [path, '--json']);
    const second = await run(cmdMissionShow, [path, '--json']);
    expect(first.stdout).toBe(second.stdout);
  });
});

describe('mission:validate', () => {
  it('exits 0 for a valid mission, warnings notwithstanding', async () => {
    const result = await run(cmdMissionValidate, [spec('m.json', validSpec())]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('valid');
  });

  it('exits 2 and names the failure for an invalid mission', async () => {
    const result = await run(cmdMissionValidate, [
      spec('dup.json', {
        goal: 'g',
        tasks: [
          { id: 'a', agentId: 'alpha-agent', title: 'A', intent: 'a' },
          { id: 'a', agentId: 'beta-agent', title: 'A2', intent: 'a2' },
        ],
      }),
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('invalid');
    expect(result.stdout).toContain('MISSION_GRAPH_DUPLICATE_TASK');
  });

  it('counts errors and warnings separately in JSON', async () => {
    const result = await run(cmdMissionValidate, [spec('m.json', validSpec()), '--json']);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toBe(0);
  });
});

describe('boundaries these commands must hold', () => {
  it.each([
    ['mission:plan', cmdMissionPlan],
    ['mission:show', cmdMissionShow],
    ['mission:validate', cmdMissionValidate],
  ])('%s never prints an agent instruction body', async (_name, fn) => {
    for (const argv of [[], ['--json'], ['--markdown']]) {
      const result = await run(fn, [spec('m.json', validSpec()), ...argv]);
      expect(result.stdout).not.toContain(BODY_MARKER);
      expect(result.stderr).not.toContain(BODY_MARKER);
    }
  });

  it.each([
    ['mission:plan', cmdMissionPlan],
    ['mission:show', cmdMissionShow],
    ['mission:validate', cmdMissionValidate],
  ])('%s never prints an absolute machine path', async (_name, fn) => {
    const result = await run(fn, [spec('m.json', validSpec())]);
    // The temp root is an absolute path; it must be reported repo-relative.
    expect(result.stdout).not.toContain(root);
    expect(result.stderr).not.toContain(root);
  });

  it('reports an unreadable spec without leaking its absolute path', async () => {
    const result = await run(cmdMissionPlan, ['missing.json']);
    expect(result.stderr).toContain('missing.json');
    expect(result.stderr).not.toContain(root);
  });

  it('collapses repeated issues instead of printing every one', async () => {
    // Escalation is reported per glob pattern, so a real roster produces dozens
    // of identical-shaped warnings. Human output must summarize them.
    const result = await run(cmdMissionShow, [spec('m.json', validSpec())]);
    const lines = result.stdout.split('\n');
    const perIssueLines = lines.filter((l) => l.includes('child claims')).length;
    const jsonRun = await run(cmdMissionShow, [spec('m.json', validSpec()), '--json']);
    const total = JSON.parse(jsonRun.stdout).issues.length;
    if (total > 4) {
      expect(perIssueLines).toBeLessThan(total);
      expect(result.stdout).toContain('use --json for the full list');
    }
    // --json keeps every issue, uncollapsed.
    expect(total).toBeGreaterThanOrEqual(perIssueLines);
  });

  it('does not execute the mission', async () => {
    // Planning must not consume steps or produce task state. If a future change
    // wires execution into these commands, these keys start appearing.
    const result = await run(cmdMissionShow, [spec('m.json', validSpec()), '--json']);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).not.toHaveProperty('stepsUsed');
    expect(parsed).not.toHaveProperty('stateHash');
    expect(parsed.tasks.every((t: Record<string, unknown>) => !('status' in t))).toBe(true);
  });
});
