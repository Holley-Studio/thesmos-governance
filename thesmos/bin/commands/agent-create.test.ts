// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Direct command tests for cmdAgentCreate.
 *
 * Scope: argument parsing, ID derivation, output labels, exit codes,
 * canonical-file creation, registry update, and --no-sync flag.
 *
 * Deliberately avoids re-testing the lifecycle internals already covered
 * by agent-lifecycle.test.ts. Adapter sync is bypassed via --no-sync in
 * all tests to avoid requiring a real Thesmos config.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'thesmos-cmd-create-'));
}

/** Capture stdout/stderr and exit code from a command invocation. */
async function runCreate(
  argv: string[],
  root: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = console.log.bind(console);
  const origConsoleError = console.error.bind(console);

  // Capture all output channels
  process.stdout.write = (chunk: unknown) => { stdoutChunks.push(String(chunk)); return true; };
  process.stderr.write = (chunk: unknown) => { stderrChunks.push(String(chunk)); return true; };
  console.log = (...args: unknown[]) => { stdoutChunks.push(args.join(' ') + '\n'); };
  console.error = (...args: unknown[]) => { stderrChunks.push(args.join(' ') + '\n'); };

  // Redirect process.exit() to a throw so the test can catch it
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw Object.assign(new Error(`process.exit(${code})`), { exitCode: Number(code ?? 0) });
  });

  const prevCwd = process.cwd();
  let exitCode = 0;

  try {
    process.chdir(root);
    const { cmdAgentCreate } = await import('./agent-create.js');
    await cmdAgentCreate(argv);
    exitCode = 0;
  } catch (err: unknown) {
    if (err instanceof Error && 'exitCode' in err) {
      exitCode = (err as Error & { exitCode: number }).exitCode;
    } else {
      exitCode = 1;
    }
  } finally {
    process.chdir(prevCwd);
    process.stdout.write = origStdoutWrite;
    process.stderr.write = origStderrWrite;
    console.log = origConsoleLog;
    console.error = origConsoleError;
    exitSpy.mockRestore();
  }

  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join(''),
    exitCode,
  };
}

function readRegistry(root: string): Record<string, unknown> {
  const p = join(root, '.thesmos', 'registry.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cmdAgentCreate — argument parsing', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /**/ } });

  it('exits nonzero with usage message when no arguments provided', async () => {
    const { stderr, exitCode } = await runCreate([], root);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('agent:create');
    expect(stderr).toContain('missing');
  });

  it('single positional: uses it as the display name, derives id automatically', async () => {
    const { exitCode } = await runCreate(['My Custom Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'my-custom-agent.md'))).toBe(true);
  });

  it('two positionals: first is the id, second is the display name', async () => {
    const { exitCode } = await runCreate(['my-agent-id', 'My Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'my-agent-id.md'))).toBe(true);
  });

  it('--no-sync does not appear in the derived id', async () => {
    const { exitCode } = await runCreate(['My Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    // id should be 'my-agent', not include 'no-sync'
    const agentsDir = join(root, '.thesmos', 'agents');
    const files = existsSync(agentsDir) ? readdirSync(agentsDir) : [];
    expect(files.some((f) => f.includes('no-sync'))).toBe(false);
    expect(files).toContain('my-agent.md');
  });
});

describe('cmdAgentCreate — output labels', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /**/ } });

  it('success output includes agent id and canonical path', async () => {
    const { stdout, exitCode } = await runCreate(['Test Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('test-agent');
    expect(stdout).toContain('.thesmos/agents/');
  });

  it('--no-sync output mentions adapters skipped', async () => {
    const { stdout, exitCode } = await runCreate(['Test Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('skipped');
  });

  it('success output includes edit hint', async () => {
    const { stdout, exitCode } = await runCreate(['Test Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Edit');
  });
});

describe('cmdAgentCreate — registry and file creation', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /**/ } });

  it('creates .thesmos/agents/<id>.md', async () => {
    const { exitCode } = await runCreate(['Test Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'test-agent.md'))).toBe(true);
  });

  it('registry contains the new agent id after create', async () => {
    const { exitCode } = await runCreate(['Test Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('test-agent');
  });

  it('exits nonzero when agent already exists (no overwrite)', async () => {
    // First create
    await runCreate(['Test Agent', '--no-sync'], root);
    // Second create (duplicate)
    const { stderr, exitCode } = await runCreate(['Test Agent', '--no-sync'], root);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('already exists');
  });

  it('generated file contains the id and name from arguments', async () => {
    const { exitCode } = await runCreate(['My Named Agent', '--no-sync'], root);
    expect(exitCode).toBe(0);
    const content = readFileSync(
      join(root, '.thesmos', 'agents', 'my-named-agent.md'),
      'utf8'
    );
    expect(content).toContain('my-named-agent');
    expect(content).toContain('My Named Agent');
  });
});
