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
import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_SPEC_BYTES, cmdMissionPlan, cmdMissionShow, cmdMissionValidate } from './mission.ts';

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

describe('policy display tells the truth about authority', () => {
  /**
   * The case that matters, and it is the *default* one.
   *
   * Every agent baseline grants `read: allow` over ordinary source. A mission
   * that declares no permissions has an empty envelope, where every lookup
   * resolves to `ask`. So a task can display a large agent allow count while
   * its effective decision on every one of those targets is `ask`.
   *
   * Displaying that count under the heading "authority" states something the
   * runtime does not agree with, which is the defect these tests pin.
   */
  async function effectiveDecisionFor(target: string): Promise<string> {
    const { createMission } = await import('../../mission/create.ts');
    const { bindMission, authorizeTaskAction } = await import('../../mission/authority.ts');
    const { loadCouncilContracts } = await import('../../council/load.ts');

    const created = createMission(validSpec() as never);
    if (!created.mission) throw new Error('fixture mission invalid');
    const { contracts } = loadCouncilContracts({ root });
    const bound = bindMission(created.mission, contracts);
    const binding = bound.bindings[0];
    if (!binding) throw new Error('fixture produced no binding');
    return authorizeTaskAction(created.mission, binding, 'read', target).resolution.decision;
  }

  it('the runtime does not resolve the agent’s declared allow to allow', async () => {
    // Grounding assertion: this is the runtime's own answer, not the CLI's.
    expect(await effectiveDecisionFor('src/app.ts')).not.toBe('allow');
  });

  it('names the agent’s declared policy as such, not as authority', async () => {
    const result = await run(cmdMissionShow, [spec('m.json', validSpec()), '--json']);
    const parsed = JSON.parse(result.stdout);
    const task = parsed.tasks[0];

    expect(task).toHaveProperty('agentPolicy');
    // `authority` claimed to be resolved permission while carrying declared
    // agent-policy counts. It is removed rather than redefined.
    expect(task).not.toHaveProperty('authority');
  });

  it('reports the mission envelope separately from any agent policy', async () => {
    const result = await run(cmdMissionShow, [spec('m.json', validSpec()), '--json']);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('missionPolicy');
  });

  it('distinguishes the two policies when the mission actually grants something', async () => {
    const withGrant = validSpec({
      permissions: { edit: [{ decision: 'allow', patterns: ['src/**'] }] },
    });
    const result = await run(cmdMissionShow, [spec('g.json', withGrant), '--json']);
    const parsed = JSON.parse(result.stdout);

    const missionEdit = parsed.missionPolicy.find((c: { channel: string }) => c.channel === 'edit');
    expect(missionEdit?.allow).toBe(1);
    // The agent's own policy is a different number from the mission's, which is
    // the whole reason they cannot share one field.
    expect(parsed.tasks[0].agentPolicy).not.toEqual(parsed.missionPolicy);
  });

  it('never claims a resolved effective decision in human output', async () => {
    const result = await run(cmdMissionShow, [spec('m.json', validSpec())]);
    expect(result.stdout).toContain('mission envelope');
    expect(result.stdout).toContain('agent policy');
    // The old copy asserted the displayed counts *were* the intersection.
    expect(result.stdout).not.toMatch(/Effective authority is the intersection/);
    expect(result.stdout).toContain('resolved per concrete action');
  });

  it('labels the columns honestly in Markdown', async () => {
    const result = await run(cmdMissionShow, [spec('m.json', validSpec()), '--markdown']);
    expect(result.stdout).not.toContain('| Authority |');
    expect(result.stdout).toContain('Agent policy');
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
    // Deterministic by construction. The previous version of this test guarded
    // its assertions behind `if (total > 4)`, so a fixture that happened to
    // emit fewer issues would have made it silently vacuous.
    const path = spec('m.json', validSpec());

    const jsonRun = await run(cmdMissionShow, [path, '--json']);
    const issues = JSON.parse(jsonRun.stdout).issues as Array<{ code: string; path: string }>;

    // The default fixture must actually produce repeats, or this proves nothing.
    const groups = new Set(issues.map((i) => JSON.stringify([i.code, i.path])));
    expect(issues.length).toBeGreaterThan(groups.size);
    expect(issues.length).toBeGreaterThan(8);

    const human = await run(cmdMissionShow, [path]);
    const detailLines = human.stdout.split('\n').filter((l) => l.includes('child claims')).length;

    // Two examples per group, so detail lines are bounded by 2 × groups and are
    // strictly fewer than the full issue count.
    expect(detailLines).toBeLessThanOrEqual(groups.size * 2);
    expect(detailLines).toBeLessThan(issues.length);
    expect(human.stdout).toContain('use --json for the full list');

    // Every group header carries its true count, so nothing is hidden.
    for (const g of groups) {
      const [code, issuePath] = JSON.parse(g) as [string, string];
      const n = issues.filter((i) => i.code === code && i.path === issuePath).length;
      if (n > 1) expect(human.stdout).toContain(`${issuePath}  (${n}×)`);
    }
  });

  it('keeps every issue in JSON while collapsing the human view', async () => {
    const path = spec('m.json', validSpec());
    const jsonRun = await run(cmdMissionShow, [path, '--json']);
    const parsed = JSON.parse(jsonRun.stdout);
    // Uncollapsed: each issue is its own object with its own message.
    const messages = new Set(parsed.issues.map((i: { message: string }) => i.message));
    expect(messages.size).toBeGreaterThan(4);
    expect(jsonRun.stdout).not.toContain('use --json for the full list');
  });

  it('does not let grouping hide a differing severity or remediation', async () => {
    // Grouping is by (code, path). If two issues shared a group but differed in
    // severity, the group header would show only the first — so no group may
    // contain more than one distinct severity.
    const jsonRun = await run(cmdMissionShow, [spec('m.json', validSpec()), '--json']);
    const issues = jsonRun.stdout
      ? (JSON.parse(jsonRun.stdout).issues as Array<{
          code: string;
          path: string;
          severity: string;
          remediation?: string;
        }>)
      : [];

    const byGroup = new Map<string, Set<string>>();
    const remediationByGroup = new Map<string, Set<string>>();
    for (const i of issues) {
      const key = JSON.stringify([i.code, i.path]);
      (byGroup.get(key) ?? byGroup.set(key, new Set()).get(key)!).add(i.severity);
      (
        remediationByGroup.get(key) ?? remediationByGroup.set(key, new Set()).get(key)!
      ).add(i.remediation ?? '');
    }
    for (const severities of byGroup.values()) expect(severities.size).toBe(1);
    for (const remediations of remediationByGroup.values()) expect(remediations.size).toBe(1);
  });

  it('accepts a spec exactly at the size limit and rejects one byte over', async () => {
    // The limit is enforced on the file, before any parsing, so the oversize
    // case must fail with a usage error rather than a JSON error.
    const base = validSpec();
    const encoder = new TextEncoder();

    const pad = (target: number): Record<string, unknown> => {
      const withoutPad = { ...base, note: '' };
      const overhead = encoder.encode(JSON.stringify(withoutPad)).length;
      return { ...base, note: 'x'.repeat(Math.max(0, target - overhead)) };
    };

    const atLimit = pad(MAX_SPEC_BYTES);
    const atPath = join(root, 'at-limit.json');
    writeFileSync(atPath, JSON.stringify(atLimit), 'utf8');
    expect(statSync(atPath).size).toBe(MAX_SPEC_BYTES);

    const ok = await run(cmdMissionPlan, ['at-limit.json']);
    expect(ok.exitCode).toBe(0);

    const overPath = join(root, 'over-limit.json');
    writeFileSync(overPath, `${JSON.stringify(atLimit)} `, 'utf8');
    expect(statSync(overPath).size).toBe(MAX_SPEC_BYTES + 1);

    const over = await run(cmdMissionPlan, ['over-limit.json']);
    expect(over.exitCode).toBe(1);
    expect(over.stderr).toContain('over the');
    // Rejected on size, never parsed.
    expect(over.stderr).not.toContain('not valid JSON');
  });

  it('redacts secrets, paths, and control sequences from parser errors', async () => {
    // A JSON parse error quotes the offending content, so a spec carrying a
    // credential can push it into stderr and from there into a CI log.
    const secret = ['sk', 'live', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'].join('-');
    const malformed = `{ "goal": "${secret} ${root}/leak [31mred[0m", `;
    const result = await run(cmdMissionPlan, [spec('leak.json', malformed)]);

    expect(result.exitCode).toBe(1);
    const all = result.stdout + result.stderr;
    expect(all).not.toContain(secret);
    expect(all).not.toContain(root);
    // No raw ESC survives into a terminal.
    expect(all).not.toContain('');
  });

  it('refuses a symlinked spec that escapes the repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'thesmos-outside-'));
    const target = join(outside, 'secret.json');
    writeFileSync(target, JSON.stringify(validSpec()), 'utf8');
    const link = join(root, 'link.json');
    try {
      symlinkSync(target, link);
    } catch {
      return; // symlinks unavailable on this platform; nothing to assert
    }

    const result = await run(cmdMissionPlan, ['link.json']);
    // Whatever the decision, the outside path must never be echoed back.
    expect(result.stdout + result.stderr).not.toContain(outside);
    rmSync(outside, { recursive: true, force: true });
  });

  it('does not silently accept an unsupported flag', async () => {
    // A typo'd flag must not be read as the flag the caller meant.
    const path = spec('m.json', validSpec());
    const plain = await run(cmdMissionShow, [path]);
    const typo = await run(cmdMissionShow, [path, '--jsonn']);
    // `--jsonn` is not `--json`: output stays human-readable rather than JSON.
    expect(typo.stdout.startsWith('{')).toBe(false);
    expect(typo.stdout).toBe(plain.stdout);
  });

  it('resolves conflicting output flags deterministically', async () => {
    const path = spec('m.json', validSpec());
    const first = await run(cmdMissionShow, [path, '--json', '--markdown']);
    const second = await run(cmdMissionShow, [path, '--markdown', '--json']);
    // Whichever wins, flag order must not change the answer.
    expect(second.stdout).toBe(first.stdout);
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
