// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Council CLI: output modes and exit codes.
 *
 * Exit codes are the contract other tools depend on, so they are asserted
 * explicitly: 0 for valid (warnings included), 1 for usage errors, 2 for
 * safety-critical contract errors.
 *
 * `HOME` is redirected to a temporary directory for every test. Discovery reads
 * `~/.claude/agents`, so without that these assertions would depend on whichever
 * agents the developer happens to have installed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdAgentShow, cmdAgentValidate, cmdAgentsValidate, buildMigrationReport } from './council.ts';
import { cmdAgentsList } from './agents-federation.ts';

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
  const origLog = console.log.bind(console);

  process.stdout.write = (chunk: unknown) => { stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk: unknown) => { stderr.push(String(chunk)); return true; };
  console.log = (...args: unknown[]) => { stdout.push(`${args.join(' ')}\n`); };

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
    console.log = origLog;
    exitSpy.mockRestore();
  }

  return { stdout: stdout.join(''), stderr: stderr.join(''), exitCode };
}

let root = '';
let home = '';
let originalCwd = '';
let originalHome: string | undefined;

const VALID_AGENT = `---
id: local-build-agent
name: Local Build Agent
type: agent
version: 1.0.0
owner: local
description: Implements changes in this repository.
tags:
  - implementation
  - typescript
enabled: true
---

BODY_ONLY_MARKER — prompt text that inspection must never print.
`;

/** Opts into explicit mode, then omits safety-critical fields — an error, by design. */
const INVALID_AGENT = `---
id: broken-council-agent
name: Broken Council Agent
type: agent
version: 1.0.0
owner: local
tags:
  - testing
enabled: true
council_risk_tier: low
---

Instructions.
`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-council-cli-'));
  home = mkdtempSync(join(tmpdir(), 'thesmos-council-cli-home-'));
  mkdirSync(join(root, '.thesmos', 'agents'), { recursive: true });
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  writeFileSync(join(root, '.thesmos', 'agents', 'local-build-agent.md'), VALID_AGENT, 'utf8');
  writeFileSync(join(root, '.thesmos', 'agents', 'broken-council-agent.md'), INVALID_AGENT, 'utf8');

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

describe('agent:show', () => {
  it('prints an inspection view and exits 0', async () => {
    const result = await run(cmdAgentShow, ['local-build-agent']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('local-build-agent');
    expect(result.stdout).toContain('Build (build)');
    expect(result.stdout).toContain('permissions');
    expect(result.stdout).toContain('evidence');
  });

  it('never prints the agent’s instructions', async () => {
    const result = await run(cmdAgentShow, ['local-build-agent']);
    expect(result.stdout).not.toContain("BODY_ONLY_MARKER");
  });

  it('emits parseable JSON with --json', async () => {
    const result = await run(cmdAgentShow, ['local-build-agent', '--json']);
    const parsed = JSON.parse(result.stdout) as {
      contract: { identity: { id: string } };
      validation: { valid: boolean };
    };
    expect(parsed.contract.identity.id).toBe('local-build-agent');
    expect(parsed.validation.valid).toBe(true);
  });

  it('emits Markdown with --markdown', async () => {
    const result = await run(cmdAgentShow, ['local-build-agent', '--markdown']);
    expect(result.stdout).toContain('# Local Build Agent');
    expect(result.stdout).toContain('**Role:**');
  });

  it('exits 1 with no agent id', async () => {
    const result = await run(cmdAgentShow, []);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('requires an agent id');
  });

  it('exits 1 for an unknown agent', async () => {
    const result = await run(cmdAgentShow, ['no-such-agent']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown agent');
  });
});

describe('agent:validate', () => {
  it('exits 0 for a valid contract, warnings notwithstanding', async () => {
    const result = await run(cmdAgentValidate, ['local-build-agent']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('valid');
  });

  it('exits 2 for a contract with safety-critical errors', async () => {
    const result = await run(cmdAgentValidate, ['broken-council-agent']);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('COUNCIL_MISSING_SAFETY_METADATA');
  });

  it('emits stable JSON with --json', async () => {
    const first = await run(cmdAgentValidate, ['local-build-agent', '--json']);
    const second = await run(cmdAgentValidate, ['local-build-agent', '--json']);
    expect(first.stdout).toBe(second.stdout);
    expect(JSON.parse(first.stdout)).toMatchObject({ agentId: 'local-build-agent', valid: true });
  });

  it('exits 1 for an unknown agent rather than reporting it invalid', async () => {
    const result = await run(cmdAgentValidate, ['no-such-agent']);
    expect(result.exitCode).toBe(1);
  });
});

describe('agents:validate', () => {
  it('exits 2 when any contract has errors', async () => {
    const result = await run(cmdAgentsValidate, []);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain('COUNCIL_MISSING_SAFETY_METADATA');
  });

  it('exits 0 when the filtered set is clean', async () => {
    const result = await run(cmdAgentsValidate, ['--role=build']);
    expect(result.exitCode).toBe(0);
  });

  it('exits 1 for an unknown role', async () => {
    const result = await run(cmdAgentsValidate, ['--role=wizardry']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown role');
  });

  it('emits stable JSON with --json', async () => {
    const first = await run(cmdAgentsValidate, ['--role=build', '--json']);
    const second = await run(cmdAgentsValidate, ['--role=build', '--json']);
    expect(first.stdout).toBe(second.stdout);
    expect(JSON.parse(first.stdout)).toHaveProperty('issues');
  });

  it('reports migration status without writing anything', async () => {
    const result = await run(cmdAgentsValidate, ['--role=build', '--migration']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('migration status');
    expect(result.stdout).toContain('baseline metadata');
  });
});

describe('agents:list council views', () => {
  it('lists exactly the eight primary roles', async () => {
    const result = await run(cmdAgentsList, ['--primary']);
    expect(result.exitCode).toBe(0);
    for (const role of ['Build', 'Plan', 'Debug', 'Review', 'Security', 'Design', 'Growth', 'Operations']) {
      expect(result.stdout).toContain(role);
    }
  });

  it('emits primary roles as JSON', async () => {
    const result = await run(cmdAgentsList, ['--primary', '--json']);
    const parsed = JSON.parse(result.stdout) as { roles: unknown[] };
    expect(parsed.roles).toHaveLength(8);
  });

  it('lists specialists only when asked', async () => {
    const result = await run(cmdAgentsList, ['--specialists', '--json']);
    const parsed = JSON.parse(result.stdout) as { specialists: Array<{ agentId: string }> };
    expect(parsed.specialists.length).toBeGreaterThan(0);
    // Role leads are not specialists — they are the eight selectable entries.
    expect(parsed.specialists.some((s) => s.agentId === 'argus-security-agent')).toBe(false);
  });

  it('filters specialists by role', async () => {
    const result = await run(cmdAgentsList, ['--specialists', '--role=security', '--json']);
    const parsed = JSON.parse(result.stdout) as { specialists: Array<{ role: string }> };
    expect(parsed.specialists.length).toBeGreaterThan(0);
    expect(parsed.specialists.every((s) => s.role === 'security')).toBe(true);
  });

  it('exits 1 for an unknown role filter', async () => {
    const result = await run(cmdAgentsList, ['--specialists', '--role=wizardry']);
    expect(result.exitCode).toBe(1);
  });

  it('does not print agent instructions in any view', async () => {
    for (const argv of [['--primary'], ['--specialists']]) {
      const result = await run(cmdAgentsList, argv);
      expect(result.stdout).not.toContain("BODY_ONLY_MARKER");
    }
  });
});

describe('migration report', () => {
  it('counts derived fields deterministically', () => {
    const report = buildMigrationReport([
      {
        identity: { id: 'b' },
        classification: { primaryRole: 'build' },
        completeness: { complete: false, derivedFields: ['limits.maximumSteps', 'risk.tier'] },
      },
      {
        identity: { id: 'a' },
        classification: { primaryRole: 'plan' },
        completeness: { complete: false, derivedFields: ['risk.tier'] },
      },
      {
        identity: { id: 'c' },
        classification: { primaryRole: 'plan' },
        completeness: { complete: true, derivedFields: [] },
      },
    ] as never);

    expect(report.total).toBe(3);
    expect(report.explicit).toBe(1);
    expect(report.compatibility).toBe(2);
    expect(report.pending.map((p) => p.agentId)).toEqual(['a', 'b']);
    expect(report.fieldCounts[0]).toEqual({ field: 'risk.tier', count: 2 });
  });
});
