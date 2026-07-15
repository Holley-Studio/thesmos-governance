// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Direct command tests for cmdAgentInstall.
 *
 * Scope: argument parsing, control flow, output labels, exit codes, --dry-run,
 * --force, --no-sync, single-file and directory install, missing-file error.
 *
 * Adapter sync is bypassed via --no-sync in all tests to avoid requiring a
 * real Thesmos config. Lifecycle correctness is tested in agent-lifecycle.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AGENT_A = `---
id: agent-a
name: Agent A
type: agent
version: 1.0.0
owner: local
tags:
  - test
enabled: true
---

# Agent A
`;

const AGENT_B = `---
id: agent-b
name: Agent B
type: agent
version: 1.0.0
owner: local
tags:
  - test
enabled: true
---

# Agent B
`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'thesmos-cmd-install-'));
}

/** Write a registry file so tests start with a known state. */
function writeRegistry(root: string, data: unknown): void {
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(join(root, '.thesmos', 'registry.json'), JSON.stringify(data, null, 2), 'utf8');
}

function readRegistry(root: string): Record<string, unknown> {
  const p = join(root, '.thesmos', 'registry.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

/** Write an agent fixture file and return its absolute path. */
function writeAgentFile(dir: string, filename: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const absPath = join(dir, filename);
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

/** Capture stdout/stderr and exit code from a command invocation. */
async function runInstall(
  argv: string[],
  root: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = console.log.bind(console);
  const origConsoleError = console.error.bind(console);

  process.stdout.write = (chunk: unknown) => { stdoutChunks.push(String(chunk)); return true; };
  process.stderr.write = (chunk: unknown) => { stderrChunks.push(String(chunk)); return true; };
  console.log = (...args: unknown[]) => { stdoutChunks.push(args.join(' ') + '\n'); };
  console.error = (...args: unknown[]) => { stderrChunks.push(args.join(' ') + '\n'); };

  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw Object.assign(new Error(`process.exit(${code})`), { exitCode: Number(code ?? 0) });
  });

  const prevCwd = process.cwd();
  let exitCode = 0;

  try {
    process.chdir(root);
    const { cmdAgentInstall } = await import('./agent-install.js');
    await cmdAgentInstall(argv);
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

// ── Argument parsing ──────────────────────────────────────────────────────────

describe('cmdAgentInstall — argument parsing', () => {
  let root: string;
  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /**/ } });

  it('exits nonzero with usage message when no arguments provided', async () => {
    const { stderr, exitCode } = await runInstall([], root);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('agent:install');
    expect(stderr).toContain('missing');
  });

  it('exits nonzero when the target file does not exist', async () => {
    const { stderr, exitCode } = await runInstall([join(root, 'nonexistent.md'), '--no-sync'], root);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('not found');
  });
});

// ── Single-file install ───────────────────────────────────────────────────────

describe('cmdAgentInstall — single file', () => {
  let root: string;
  let srcFile: string;
  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    srcFile = writeAgentFile(root, 'agent-a.md', AGENT_A);
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /**/ } });

  it('installs canonical file and exits 0', async () => {
    const { exitCode } = await runInstall([srcFile, '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'agent-a.md'))).toBe(true);
  });

  it('adds agent to registry', async () => {
    const { exitCode } = await runInstall([srcFile, '--no-sync'], root);
    expect(exitCode).toBe(0);
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('agent-a');
  });

  it('output contains agent id and canonical path', async () => {
    const { stdout, exitCode } = await runInstall([srcFile, '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('agent-a');
    expect(stdout).toContain('.thesmos/agents/agent-a.md');
  });

  it('--no-sync output mentions adapters skipped', async () => {
    const { stdout, exitCode } = await runInstall([srcFile, '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('skipped');
  });

  it('exits nonzero on duplicate without --force', async () => {
    // First install
    await runInstall([srcFile, '--no-sync'], root);
    // Second install (duplicate)
    const { stderr, exitCode } = await runInstall([srcFile, '--no-sync'], root);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('already exists');
  });

  it('--force overwrites existing canonical file and exits 0', async () => {
    // First install
    await runInstall([srcFile, '--no-sync'], root);
    // Second install with --force
    const { stdout, exitCode } = await runInstall([srcFile, '--force', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('agent-a');
  });
});

// ── Dry-run ───────────────────────────────────────────────────────────────────

describe('cmdAgentInstall — --dry-run', () => {
  let root: string;
  let srcFile: string;
  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    srcFile = writeAgentFile(root, 'agent-a.md', AGENT_A);
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /**/ } });

  it('does not create canonical file in dry-run mode', async () => {
    const { exitCode } = await runInstall([srcFile, '--dry-run', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'agent-a.md'))).toBe(false);
  });

  it('does not write registry.json in dry-run mode', async () => {
    await runInstall([srcFile, '--dry-run', '--no-sync'], root);
    // registry.json should not exist (we started fresh)
    expect(existsSync(join(root, '.thesmos', 'registry.json'))).toBe(false);
  });

  it('dry-run output includes "(dry-run)" label', async () => {
    const { stdout, exitCode } = await runInstall([srcFile, '--dry-run', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('dry-run');
  });
});

// ── Directory install ─────────────────────────────────────────────────────────

describe('cmdAgentInstall — directory install', () => {
  let root: string;
  let agentsDir: string;
  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    agentsDir = join(root, 'src-agents');
    mkdirSync(agentsDir, { recursive: true });
    writeAgentFile(agentsDir, 'agent-a.md', AGENT_A);
    writeAgentFile(agentsDir, 'agent-b.md', AGENT_B);
    // README.md should be skipped
    writeFileSync(join(agentsDir, 'README.md'), '# README', 'utf8');
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch { /**/ } });

  it('installs all .md files (except README.md) and exits 0', async () => {
    const { exitCode } = await runInstall([agentsDir, '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'agent-a.md'))).toBe(true);
    expect(existsSync(join(root, '.thesmos', 'agents', 'agent-b.md'))).toBe(true);
  });

  it('skips README.md silently', async () => {
    const { exitCode } = await runInstall([agentsDir, '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'readme.md'))).toBe(false);
    expect(existsSync(join(root, '.thesmos', 'agents', 'README.md'))).toBe(false);
  });

  it('both agents appear in registry', async () => {
    const { exitCode } = await runInstall([agentsDir, '--no-sync'], root);
    expect(exitCode).toBe(0);
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('agent-a');
    expect(reg['agents']).toContain('agent-b');
  });

  it('dry-run does not create files', async () => {
    const { exitCode } = await runInstall([agentsDir, '--dry-run', '--no-sync'], root);
    expect(exitCode).toBe(0);
    expect(existsSync(join(root, '.thesmos', 'agents', 'agent-a.md'))).toBe(false);
    expect(existsSync(join(root, '.thesmos', 'agents', 'agent-b.md'))).toBe(false);
  });

  it('directory dry-run output includes agent count', async () => {
    const { stdout, exitCode } = await runInstall([agentsDir, '--dry-run', '--no-sync'], root);
    expect(exitCode).toBe(0);
    // Should mention how many agents would be installed
    expect(stdout).toContain('2');
  });
});
