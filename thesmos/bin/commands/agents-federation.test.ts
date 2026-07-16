// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cmdAgentAdopt,
  cmdAgentRelease,
  cmdAgentsDoctor,
  cmdAgentsList,
} from './agents-federation.ts';
import { loadManagedManifest } from '../../agent-ownership.ts';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'thesmos-fed-'));
}

async function withRoot(root: string, fn: () => Promise<void>): Promise<{ exitCode: number }> {
  const prev = process.cwd();
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
    throw Object.assign(new Error(`process.exit(${code})`), { exitCode: Number(code ?? 0) });
  });
  let exitCode = 0;
  process.chdir(root);
  try {
    await fn();
  } catch (err: unknown) {
    if (err instanceof Error && 'exitCode' in err) {
      exitCode = (err as Error & { exitCode: number }).exitCode;
    } else {
      throw err;
    }
  } finally {
    process.chdir(prev);
    exitSpy.mockRestore();
  }
  return { exitCode };
}

describe('agent:adopt / agent:release', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(
      join(root, '.thesmos', 'config.json'),
      JSON.stringify({ version: '1.0.0', project: 'test' }),
      'utf8'
    );
    writeFileSync(
      join(root, '.thesmos', 'registry.json'),
      JSON.stringify({ rules: ['@thesmos/core'], agents: [], skills: [] }),
      'utf8'
    );
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true });
    } catch {
      /* */
    }
  });

  it('adopt copies and registers without deleting the original', async () => {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    const src = join(root, '.claude', 'agents', 'my-custom.md');
    writeFileSync(src, '---\nid: my-custom\nname: My Custom\n---\n\nHello\n', 'utf8');

    await withRoot(root, async () => {
      await cmdAgentAdopt([src, '--no-sync']);
    });

    expect(existsSync(src)).toBe(true);
    expect(existsSync(join(root, '.thesmos', 'agents', 'my-custom.md'))).toBe(true);
    const reg = JSON.parse(readFileSync(join(root, '.thesmos', 'registry.json'), 'utf8')) as {
      agents: string[];
    };
    expect(reg.agents).toContain('my-custom');
    const manifest = loadManagedManifest(root);
    expect(manifest.files['.thesmos/agents/my-custom.md']?.source).toBe('adopted');
  });

  it('adopt --dry-run does not mutate', async () => {
    mkdirSync(join(root, 'inbox'), { recursive: true });
    const src = join(root, 'inbox', 'dry.md');
    writeFileSync(src, '---\nid: dry-agent\nname: Dry\n---\n\nx\n', 'utf8');

    await withRoot(root, async () => {
      await cmdAgentAdopt([src, '--dry-run', '--no-sync']);
    });

    expect(existsSync(join(root, '.thesmos', 'agents', 'dry-agent.md'))).toBe(false);
  });

  it('release stops management without deleting the file', async () => {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    const src = join(root, '.claude', 'agents', 'release-me.md');
    writeFileSync(src, '---\nid: release-me\nname: Release Me\n---\n\nx\n', 'utf8');

    await withRoot(root, async () => {
      await cmdAgentAdopt([src, '--no-sync']);
      await cmdAgentRelease(['release-me']);
    });

    expect(existsSync(join(root, '.thesmos', 'agents', 'release-me.md'))).toBe(true);
    const manifest = loadManagedManifest(root);
    expect(manifest.files['.thesmos/agents/release-me.md']).toBeUndefined();
  });
});

describe('agents:doctor hostile manifest', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(root, '.thesmos', 'config.json'),
      JSON.stringify({ version: '1.0.0', project: 'test' }),
      'utf8'
    );
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true });
    } catch {
      /* */
    }
  });

  it('does not crash when managed-agents.json contains traversal keys', async () => {
    writeFileSync(
      join(root, '.thesmos', 'managed-agents.json'),
      JSON.stringify({
        version: 1,
        files: {
          '../../../tmp/evil.md': {
            owner: 'thesmos',
            source: 'pantheon',
            agentId: 'evil',
            hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
        },
      }),
      'utf8'
    );

    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { exitCode } = await withRoot(root, async () => {
      await cmdAgentsDoctor(['--json']);
    });
    writeSpy.mockRestore();
    // Must exit with a status code (error/warn), never throw an uncaught path error
    expect(exitCode).toBeGreaterThan(0);
  });
});

describe('agents:list', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(
      join(root, '.thesmos', 'config.json'),
      JSON.stringify({ version: '1.0.0', project: 'test' }),
      'utf8'
    );
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true });
    } catch {
      /* */
    }
  });

  it('lists external project agents', async () => {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'agents', 'personal-reviewer.md'),
      '---\nid: personal-reviewer\nname: Personal Reviewer\n---\n\nx\n',
      'utf8'
    );

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });

    await withRoot(root, async () => {
      await cmdAgentsList(['--all']);
    });
    spy.mockRestore();

    const out = logs.join('\n');
    expect(out).toMatch(/personal-reviewer/);
    expect(out).toMatch(/Project|External|Active/i);
  });
});
