// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contentHash,
  ensureManagedMarker,
  isClaudeAgentsPath,
  isManagedPath,
  loadManagedManifest,
  managedClaudeAgentRel,
  normalizeRelPath,
  parseManagedMarker,
  resolveSafePath,
  upsertManagedRecord,
  writeManagedManifestAtomic,
  EMPTY_MANIFEST,
} from './agent-ownership.js';
import { checkScope, saveScopeConfig, SCOPE_DEFAULTS, type ScopeConfig } from './scope.js';
import { syncManagedClaudeAgents } from './agent-sync.js';
import { discoverAgents } from './agent-discovery.js';

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), 'thesmos-own-'));
}

describe('agent-ownership path helpers', () => {
  it('normalizes windows-style paths', () => {
    expect(normalizeRelPath('.claude\\agents\\foo.md')).toBe('.claude/agents/foo.md');
  });

  it('detects claude agents paths', () => {
    expect(isClaudeAgentsPath('.claude/agents/custom.md')).toBe(true);
    expect(isClaudeAgentsPath('.claude/skills/x.md')).toBe(false);
  });

  it('rejects path traversal', () => {
    expect(() => resolveSafePath('/tmp/proj', '../etc/passwd')).toThrow(/traversal/i);
    expect(() => resolveSafePath('/tmp/proj', '/etc/passwd')).toThrow();
  });

  it('parses and ensures managed markers', () => {
    const marked = ensureManagedMarker('---\nname: X\n---\n\nBody\n', 'zeus-executive-agent');
    expect(parseManagedMarker(marked)?.agent).toBe('zeus-executive-agent');
    expect(contentHash('a')).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});

describe('managed manifest atomic writes', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true });
    } catch {
      /* */
    }
  });

  it('writes and reloads atomically', () => {
    let m = { ...EMPTY_MANIFEST, files: {} };
    m = upsertManagedRecord(m, managedClaudeAgentRel('zeus-executive-agent'), 'zeus-executive-agent', 'content');
    writeManagedManifestAtomic(root, m);
    const loaded = loadManagedManifest(root);
    expect(isManagedPath(loaded, '.claude/agents/thesmos/zeus-executive-agent.md')).toBe(true);
    expect(loaded.files['.claude/agents/thesmos/zeus-executive-agent.md']?.hash).toBe(contentHash('content'));
  });

  it('rejects traversal keys on write', () => {
    const m = {
      version: 1 as const,
      files: {
        '../evil.md': {
          owner: 'thesmos' as const,
          source: 'pantheon' as const,
          agentId: 'evil',
          hash: contentHash('x'),
        },
      },
    };
    expect(() => writeManagedManifestAtomic(root, m)).toThrow();
  });
});

describe('scope: federated .claude/agents/', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
    const cfg: ScopeConfig = {
      ...SCOPE_DEFAULTS,
      workspace: {
        ...SCOPE_DEFAULTS.workspace,
        allowedPaths: ['src/'],
        blockedPaths: ['.claude/', 'node_modules/', '.env'],
      },
    };
    saveScopeConfig(root, cfg);
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true });
    } catch {
      /* */
    }
  });

  it('allows creating an external project agent', () => {
    const v = checkScope({
      toolName: 'Write',
      filePath: '.claude/agents/custom-agent.md',
      root,
    });
    expect(v).toBeNull();
  });

  it('allows editing an external agent', () => {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'custom-agent.md'), '# hi\n', 'utf8');
    expect(
      checkScope({ toolName: 'Edit', filePath: '.claude/agents/custom-agent.md', root })
    ).toBeNull();
  });

  it('blocks overwrite of a Thesmos-managed file', () => {
    let m = { ...EMPTY_MANIFEST, files: {} };
    const rel = managedClaudeAgentRel('zeus-executive-agent');
    m = upsertManagedRecord(m, rel, 'zeus-executive-agent', 'managed');
    writeManagedManifestAtomic(root, m);
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    writeFileSync(join(root, rel), 'managed', 'utf8');

    const v = checkScope({ toolName: 'Write', filePath: rel, root });
    expect(v).not.toBeNull();
    expect(v!.suggestion).toMatch(/agent:release|adapters/);
  });

  it('still blocks destructive commands from any agent context', () => {
    const v = checkScope({
      toolName: 'Bash',
      command: 'rm -rf /',
      root,
    });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('destructive_command');
  });

  it('still blocks path traversal via absolute system paths', () => {
    const v = checkScope({
      toolName: 'Write',
      filePath: '/etc/passwd',
      root,
    });
    expect(v).not.toBeNull();
    expect(v!.type).toBe('absolute_blocked_path');
  });
});

describe('syncManagedClaudeAgents', () => {
  let root: string;
  beforeEach(() => {
    root = tmpRoot();
  });
  afterEach(() => {
    try {
      rmSync(root, { recursive: true });
    } catch {
      /* */
    }
  });

  it('preserves external files and never overwrites untracked collisions', () => {
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'custom.md'), 'external\n', 'utf8');
    // Occupy managed path with untracked file
    writeFileSync(
      join(root, '.claude', 'agents', 'thesmos', 'zeus-executive-agent.md'),
      'customer-owned\n',
      'utf8'
    );

    const result = syncManagedClaudeAgents({
      root,
      desired: [{ agentId: 'zeus-executive-agent', content: '---\nname: Zeus\n---\n\nbody\n' }],
    });

    expect(result.collisions).toBeGreaterThanOrEqual(1);
    expect(readFileSync(join(root, '.claude', 'agents', 'custom.md'), 'utf8')).toBe('external\n');
    expect(
      readFileSync(join(root, '.claude', 'agents', 'thesmos', 'zeus-executive-agent.md'), 'utf8')
    ).toBe('customer-owned\n');
  });

  it('writes new managed files under .claude/agents/thesmos/', () => {
    const result = syncManagedClaudeAgents({
      root,
      desired: [{ agentId: 'argus-security-agent', content: '---\nname: Argus\n---\n\nbody\n' }],
    });
    expect(result.written).toBe(1);
    const path = join(root, '.claude', 'agents', 'thesmos', 'argus-security-agent.md');
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('THESMOS:MANAGED');
    expect(isManagedPath(loadManagedManifest(root), managedClaudeAgentRel('argus-security-agent'))).toBe(
      true
    );
  });

  it('preserves modified managed files and reports them', () => {
    const first = syncManagedClaudeAgents({
      root,
      desired: [{ agentId: 'apollo-content-agent', content: '---\nname: Apollo\n---\n\nv1\n' }],
    });
    expect(first.written).toBe(1);
    const abs = join(root, '.claude', 'agents', 'thesmos', 'apollo-content-agent.md');
    writeFileSync(abs, readFileSync(abs, 'utf8') + '\n# local edit\n', 'utf8');

    const second = syncManagedClaudeAgents({
      root,
      desired: [{ agentId: 'apollo-content-agent', content: '---\nname: Apollo\n---\n\nv2\n' }],
    });
    expect(second.preserved).toBe(1);
    expect(readFileSync(abs, 'utf8')).toContain('local edit');
  });

  it('removes stale managed files only when unmodified', () => {
    syncManagedClaudeAgents({
      root,
      desired: [
        { agentId: 'keep-agent', content: '---\nname: Keep\n---\n\nk\n' },
        { agentId: 'stale-agent', content: '---\nname: Stale\n---\n\ns\n' },
      ],
    });
    const staleAbs = join(root, '.claude', 'agents', 'thesmos', 'stale-agent.md');
    expect(existsSync(staleAbs)).toBe(true);

    const result = syncManagedClaudeAgents({
      root,
      desired: [{ agentId: 'keep-agent', content: '---\nname: Keep\n---\n\nk\n' }],
    });
    expect(result.removed).toBe(1);
    expect(existsSync(staleAbs)).toBe(false);
    expect(existsSync(join(root, '.claude', 'agents', 'thesmos', 'keep-agent.md'))).toBe(true);
  });

  it('dry-run does not mutate files', () => {
    const result = syncManagedClaudeAgents({
      root,
      dryRun: true,
      desired: [{ agentId: 'dry-agent', content: '---\nname: Dry\n---\n\nd\n' }],
    });
    expect(result.dryRun).toBe(true);
    expect(existsSync(join(root, '.claude', 'agents', 'thesmos', 'dry-agent.md'))).toBe(false);
    expect(existsSync(join(root, '.thesmos', 'managed-agents.json'))).toBe(false);
  });
});

describe('discoverAgents federation', () => {
  let root: string;
  let home: string;
  beforeEach(() => {
    root = tmpRoot();
    home = tmpRoot();
  });
  afterEach(() => {
    for (const p of [root, home]) {
      try {
        rmSync(p, { recursive: true });
      } catch {
        /* */
      }
    }
  });

  it('discovers project and user agents with project precedence', () => {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'agents', 'reviewer.md'),
      '---\nid: reviewer\nname: Project Reviewer\n---\n\np\n',
      'utf8'
    );
    writeFileSync(
      join(home, '.claude', 'agents', 'reviewer.md'),
      '---\nid: reviewer\nname: User Reviewer\n---\n\nu\n',
      'utf8'
    );

    const result = discoverAgents({ root, homeDir: home });
    const active = result.agents.find((a) => a.invocationName === 'reviewer' && a.status === 'active');
    expect(active?.origin).toBe('project');
    const shadowed = result.agents.find((a) => a.invocationName === 'reviewer' && a.status === 'shadowed');
    expect(shadowed?.origin).toBe('user');
  });

  it('keeps scoped pantheon names when project shadows unscoped id', () => {
    mkdirSync(join(root, '.claude', 'agents', 'thesmos'), { recursive: true });
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });

    const managedBody = ensureManagedMarker(
      '---\nid: argus-security-agent\nname: Argus\n---\n\nmanaged\n',
      'argus-security-agent'
    );
    writeFileSync(join(root, '.claude', 'agents', 'thesmos', 'argus-security-agent.md'), managedBody, 'utf8');
    let m = { ...EMPTY_MANIFEST, files: {} };
    m = upsertManagedRecord(
      m,
      managedClaudeAgentRel('argus-security-agent'),
      'argus-security-agent',
      managedBody
    );
    writeManagedManifestAtomic(root, m);

    writeFileSync(
      join(root, '.claude', 'agents', 'argus-security-agent.md'),
      '---\nid: argus-security-agent\nname: Local Argus\n---\n\noverride\n',
      'utf8'
    );

    const result = discoverAgents({ root, homeDir: home });
    const project = result.agents.find(
      (a) => a.invocationName === 'argus-security-agent' && a.origin === 'project'
    );
    expect(project?.status).toBe('active');
    const scoped = result.agents.find((a) => a.invocationName === 'pantheon:argus-security-agent');
    expect(scoped).toBeTruthy();
  });

  it('does not auto-adopt external agents into the registry', () => {
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'agents', 'my-blender-director.md'),
      '---\nid: my-blender-director\nname: Blender\n---\n\nx\n',
      'utf8'
    );
    discoverAgents({ root, homeDir: home });
    expect(existsSync(join(root, '.thesmos', 'registry.json'))).toBe(false);
  });
});
