import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installFromPack } from './pantheon.ts';

const AGENT = (id: string) => `---
name: ${id}
description: Test agent ${id} for pack install
---

# ${id}

Test body.
`;

let root: string;
let pack: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-pack-root-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(join(root, '.thesmos', 'config.json'), '{"project":"t"}');
  pack = mkdtempSync(join(tmpdir(), 'thesmos-pack-src-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(pack, { recursive: true, force: true });
});

describe('installFromPack', () => {
  it('installs every agent from a for-claude/ pack directory', () => {
    const dir = join(pack, 'for-claude');
    mkdirSync(dir);
    writeFileSync(join(dir, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    writeFileSync(join(dir, 'tyche-analytics-agent.md'), AGENT('tyche-analytics-agent'));
    // Non-agent files that must be skipped, not errored on:
    writeFileSync(join(dir, 'INSTALL.md'), '# How to install\nNo frontmatter here.');
    writeFileSync(join(dir, 'PANTHEON.md'), '# Routing map\nNo frontmatter here.');
    mkdirSync(join(dir, 'hooks'));

    const result = installFromPack(pack, root);

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(2);
    expect(existsSync(join(root, '.thesmos', 'agents', 'ares-sales-agent.md'))).toBe(true);
    expect(existsSync(join(root, '.thesmos', 'agents', 'tyche-analytics-agent.md'))).toBe(true);
  });

  it('accepts a bare directory of agent files (no for-claude wrapper)', () => {
    writeFileSync(join(pack, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    const result = installFromPack(pack, root);
    expect(result.installed).toBe(1);
  });

  it('is idempotent — re-running updates in place without errors', () => {
    writeFileSync(join(pack, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    const first = installFromPack(pack, root);
    const second = installFromPack(pack, root);
    expect(first.installed).toBe(1);
    expect(second.errors).toEqual([]);
    expect(second.installed + second.skipped).toBe(1);
  });

  it('throws an actionable error for a missing path', () => {
    expect(() => installFromPack(join(pack, 'nope'), root)).toThrow(/not found/i);
  });

  it('throws an actionable error when the pack contains no agents', () => {
    writeFileSync(join(pack, 'notes.txt'), 'hi');
    expect(() => installFromPack(pack, root)).toThrow(/no agent/i);
  });

  it('does not follow a symlinked for-claude/ directory pointing outside the pack', () => {
    const outside = mkdtempSync(join(tmpdir(), 'thesmos-pack-outside-'));
    try {
      writeFileSync(join(outside, 'stolen-agent.md'), AGENT('stolen-agent'));
      symlinkSync(outside, join(pack, 'for-claude'), 'dir');

      expect(() => installFromPack(pack, root)).toThrow(/no agent/i);
      expect(existsSync(join(root, '.thesmos', 'agents', 'stolen-agent.md'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('skips symlinked .md entries pointing to files outside the pack', () => {
    const outside = mkdtempSync(join(tmpdir(), 'thesmos-pack-outside-'));
    try {
      writeFileSync(join(outside, 'secret.md'), AGENT('stolen-agent'));
      const dir = join(pack, 'for-claude');
      mkdirSync(dir);
      writeFileSync(join(dir, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
      symlinkSync(join(outside, 'secret.md'), join(dir, 'stolen-agent.md'), 'file');

      const result = installFromPack(pack, root);

      expect(result.errors).toEqual([]);
      expect(result.installed).toBe(1);
      expect(existsSync(join(root, '.thesmos', 'agents', 'ares-sales-agent.md'))).toBe(true);
      expect(existsSync(join(root, '.thesmos', 'agents', 'stolen-agent.md'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('registers installed agents in registry.json', () => {
    writeFileSync(join(pack, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    installFromPack(pack, root);
    const reg = JSON.parse(readFileSync(join(root, '.thesmos', 'registry.json'), 'utf8')) as { agents?: string[] };
    expect(reg.agents).toContain('ares-sales-agent');
  });
});

describe('exportClaudeCode skill section', () => {
  it('includes ## Skills section when agent has skillIds', async () => {
    const { exportClaudeCodeForTest } = await import('./pantheon.ts');
    const agent = {
      id: 'argus-security-agent',
      name: 'God Agent Argus — Security Agent',
      god: 'Argus',
      role: 'Security & Threat Modeling',
      emoji: '👁',
      mythology: 'All-seeing giant.',
      color: '#27AE60',
      avatar: 'argus.svg',
      version: '1.0.0',
      tags: ['security'],
      governanceRules: ['SEC_001'],
      skillIds: ['security-scan', 'secret-scan'],
      body: '## Identity\nArgus body here.',
    };
    const output = exportClaudeCodeForTest(agent);
    expect(output).toContain('## Skills');
    expect(output).toContain('`/security-scan`');
    expect(output).toContain('`/secret-scan`');
  });

  it('omits ## Skills section when agent has no skillIds', async () => {
    const { exportClaudeCodeForTest } = await import('./pantheon.ts');
    const agent = {
      id: 'zeus-executive-agent',
      name: 'God Agent Zeus — Executive Agent',
      god: 'Zeus',
      role: 'Executive Orchestration',
      emoji: '⚡',
      mythology: 'King of gods.',
      color: '#F1C40F',
      avatar: 'zeus.svg',
      version: '1.0.0',
      tags: ['executive'],
      governanceRules: [],
      skillIds: [],
      body: '## Identity\nZeus body here.',
    };
    const output = exportClaudeCodeForTest(agent);
    expect(output).not.toContain('## Skills');
  });
});
