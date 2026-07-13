// @vitest-environment node
/**
 * agent-lifecycle tests — covers validation, ID derivation, registry mutation,
 * dry-run semantics, --force, --no-sync, directory batch behavior, and the
 * improved .claude/agents/ blocked-path suggestion in scope.ts.
 *
 * Adapter sync is stubbed via module mocking to avoid running writeAllAdapters
 * against disk and requiring a real Thesmos config.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── Pure helpers — import directly (no side effects) ─────────────────────────
import {
  toKebabCase,
  isValidAgentId,
  deriveAgentId,
  addAgentToRegistry,
  installAgent,
  isIgnoredAgentFile,
  AgentInstallError,
} from './agent-lifecycle.js';

// ── Scope test helper ─────────────────────────────────────────────────────────
import { checkScope, saveScopeConfig, SCOPE_DEFAULTS, type ScopeConfig } from './scope.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AGENT_WITH_ID_FM = `---
id: security-review
name: Security Review Agent
type: agent
version: 1.0.0
owner: local
tags:
  - security
enabled: true
---

# Security Review Agent

Perform a security review.
`;

const AGENT_WITH_NAME_FM_ONLY = `---
name: My Custom Agent
type: agent
version: 1.0.0
owner: local
tags:
  - custom
enabled: true
---

# My Custom Agent

Does custom things.
`;

const AGENT_NO_FM = `# Headless Agent

This agent has no frontmatter.
`;

const AGENT_EMPTY = '   \n  ';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `thesmos-lifecycle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeRegistry(root: string, data: unknown): void {
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(join(root, '.thesmos', 'registry.json'), JSON.stringify(data, null, 2), 'utf8');
}

function readRegistry(root: string): Record<string, unknown> {
  const p = join(root, '.thesmos', 'registry.json');
  return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
}

// ── toKebabCase ───────────────────────────────────────────────────────────────

describe('toKebabCase', () => {
  it('lowercases', () => expect(toKebabCase('MyAgent')).toBe('myagent'));
  it('replaces spaces with hyphens', () => expect(toKebabCase('My Agent')).toBe('my-agent'));
  it('strips special characters', () => expect(toKebabCase('My (Agent!) 2')).toBe('my-agent-2'));
  it('collapses repeated hyphens/spaces', () => expect(toKebabCase('my--agent')).toBe('my-agent'));
  it('trims edges', () => expect(toKebabCase('  agent  ')).toBe('agent'));
  it('handles already-kebab input unchanged', () => expect(toKebabCase('my-agent')).toBe('my-agent'));
});

// ── isValidAgentId ────────────────────────────────────────────────────────────

describe('isValidAgentId', () => {
  it('accepts lowercase kebab-case', () => expect(isValidAgentId('my-agent')).toBe(true));
  it('accepts single letter', () => expect(isValidAgentId('a')).toBe(true));
  it('accepts alphanumeric with hyphen', () => expect(isValidAgentId('agent-v2')).toBe(true));
  it('rejects uppercase', () => expect(isValidAgentId('MyAgent')).toBe(false));
  it('rejects trailing hyphen', () => expect(isValidAgentId('my-agent-')).toBe(false));
  it('rejects leading hyphen', () => expect(isValidAgentId('-my-agent')).toBe(false));
  it('rejects empty string', () => expect(isValidAgentId('')).toBe(false));
  it('rejects slashes (traversal)', () => expect(isValidAgentId('../etc/passwd')).toBe(false));
  it('rejects dots', () => expect(isValidAgentId('my.agent')).toBe(false));
});

// ── deriveAgentId ─────────────────────────────────────────────────────────────

describe('deriveAgentId', () => {
  it('uses frontmatter id when present', () => {
    expect(deriveAgentId(AGENT_WITH_ID_FM, 'source.md')).toBe('security-review');
  });

  it('falls back to frontmatter name when id is absent', () => {
    expect(deriveAgentId(AGENT_WITH_NAME_FM_ONLY, 'source.md')).toBe('my-custom-agent');
  });

  it('falls back to filename stem when frontmatter has neither id nor name', () => {
    expect(deriveAgentId(AGENT_NO_FM, 'my-headless-agent.md')).toBe('my-headless-agent');
  });

  it('normalizes filename stem to kebab-case', () => {
    // toKebabCase strips underscores (not in [a-z0-9\s-]), so 'My_Custom Agent' → 'mycustom-agent'
    expect(deriveAgentId(AGENT_NO_FM, 'My_Custom Agent.md')).toBe('mycustom-agent');
  });

  it('strips .md extension from filename', () => {
    expect(deriveAgentId(AGENT_NO_FM, 'agent-foo.md')).toBe('agent-foo');
  });
});

// ── isIgnoredAgentFile ────────────────────────────────────────────────────────

describe('isIgnoredAgentFile', () => {
  it('ignores README.md', () => expect(isIgnoredAgentFile('README.md')).toBe(true));
  it('ignores readme.md', () => expect(isIgnoredAgentFile('readme.md')).toBe(true));
  it('ignores CHANGELOG.md', () => expect(isIgnoredAgentFile('CHANGELOG.md')).toBe(true));
  it('does not ignore regular agent files', () => expect(isIgnoredAgentFile('my-agent.md')).toBe(false));
  it('does not ignore security-review.md', () => expect(isIgnoredAgentFile('security-review.md')).toBe(false));
});

// ── addAgentToRegistry ────────────────────────────────────────────────────────

describe('addAgentToRegistry', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /**/ } });

  it('creates registry.json and adds agent when file is absent', () => {
    const result = addAgentToRegistry(root, 'my-agent');
    expect(result).toBe('added');
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('my-agent');
  });

  it('returns already-present and does not duplicate', () => {
    writeRegistry(root, { rules: ['@thesmos/core'], agents: ['my-agent'] });
    const result = addAgentToRegistry(root, 'my-agent');
    expect(result).toBe('already-present');
    const reg = readRegistry(root);
    expect((reg['agents'] as string[]).filter((id) => id === 'my-agent')).toHaveLength(1);
  });

  it('preserves existing entries', () => {
    writeRegistry(root, { rules: ['@thesmos/core'], agents: ['existing-agent'] });
    addAgentToRegistry(root, 'new-agent');
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('existing-agent');
    expect(reg['agents']).toContain('new-agent');
  });

  it('preserves other registry keys (rules, skills)', () => {
    writeRegistry(root, { rules: ['@thesmos/security'], agents: [], skills: ['my-skill'] });
    addAgentToRegistry(root, 'new-agent');
    const reg = readRegistry(root);
    expect(reg['rules']).toEqual(['@thesmos/security']);
    expect(reg['skills']).toContain('my-skill');
  });

  it('handles malformed registry.json gracefully (starts fresh)', () => {
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'registry.json'), '{bad json}');
    expect(() => addAgentToRegistry(root, 'my-agent')).not.toThrow();
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('my-agent');
  });
});

// ── installAgent — validation ─────────────────────────────────────────────────

describe('installAgent — validation', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /**/ } });

  it('throws AgentInstallError on empty content', () => {
    expect(() => installAgent({
      content: AGENT_EMPTY, sourcePath: 'empty.md', dryRun: true, noSync: true, root
    })).toThrow(AgentInstallError);
  });

  it('throws AgentInstallError when ID cannot be derived', () => {
    // Filename that normalizes to empty after kebab stripping
    expect(() => installAgent({
      content: '---\n---\n\nno heading', sourcePath: '!!@@##.md', dryRun: true, noSync: true, root
    })).toThrow(AgentInstallError);
  });

  it('throws AgentInstallError on path traversal via targetId override', () => {
    // targetId bypasses frontmatter normalization — isValidAgentId must catch ../etc/passwd
    // (toKebabCase normalises frontmatter ids, so direct-traversal can only arrive via targetId)
    expect(() => installAgent({
      content: AGENT_NO_FM,
      sourcePath: 'test.md',
      targetId: '../etc/passwd',
      dryRun: true,
      noSync: true,
      root,
    })).toThrow(AgentInstallError);
  });

  it('throws AgentInstallError on duplicate without --force', () => {
    mkdirSync(join(root, '.thesmos', 'agents'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'agents', 'security-review.md'), 'existing', 'utf8');
    expect(() => installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'test.md', dryRun: false, noSync: true, root
    })).toThrow(AgentInstallError);
  });

  it('does not throw on duplicate with --force', () => {
    mkdirSync(join(root, '.thesmos', 'agents'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'agents', 'security-review.md'), 'existing', 'utf8');
    expect(() => installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'test.md', force: true, noSync: true, root
    })).not.toThrow();
  });
});

// ── installAgent — dry-run ────────────────────────────────────────────────────

describe('installAgent — dry-run', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /**/ } });

  it('returns structured result without writing any files', () => {
    const result = installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'security-review.md', dryRun: true, noSync: true, root
    });
    expect(result.agentId).toBe('security-review');
    expect(result.canonicalFile).toBe('.thesmos/agents/security-review.md');
    expect(result.registryResult).toBe('dry-run');
    expect(existsSync(join(root, '.thesmos', 'agents', 'security-review.md'))).toBe(false);
  });

  it('does not create or modify registry.json', () => {
    installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'test.md', dryRun: true, noSync: true, root
    });
    expect(existsSync(join(root, '.thesmos', 'registry.json'))).toBe(false);
  });

  it('validates even when file would be blocked by duplicate', () => {
    mkdirSync(join(root, '.thesmos', 'agents'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'agents', 'security-review.md'), 'existing');
    // dry-run still runs validation — duplicate without force should throw
    expect(() => installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'test.md', dryRun: true, noSync: true, root
    })).toThrow(AgentInstallError);
  });
});

// ── installAgent — real install ───────────────────────────────────────────────

describe('installAgent — real install', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /**/ } });

  it('writes canonical file to .thesmos/agents/', () => {
    installAgent({ content: AGENT_WITH_ID_FM, sourcePath: 'test.md', noSync: true, root });
    expect(existsSync(join(root, '.thesmos', 'agents', 'security-review.md'))).toBe(true);
  });

  it('content is preserved exactly', () => {
    installAgent({ content: AGENT_WITH_ID_FM, sourcePath: 'test.md', noSync: true, root });
    const written = readFileSync(join(root, '.thesmos', 'agents', 'security-review.md'), 'utf8');
    expect(written).toBe(AGENT_WITH_ID_FM);
  });

  it('adds agent to registry when fresh', () => {
    const result = installAgent({ content: AGENT_WITH_ID_FM, sourcePath: 'test.md', noSync: true, root });
    expect(result.registryResult).toBe('added');
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('security-review');
  });

  it('reports already-present when ID is already in registry', () => {
    writeRegistry(root, { rules: ['@thesmos/core'], agents: ['security-review'] });
    const result = installAgent({ content: AGENT_WITH_ID_FM, sourcePath: 'test.md', noSync: true, root });
    expect(result.registryResult).toBe('already-present');
  });

  it('adds agent only once when called twice (idempotent registry)', () => {
    installAgent({ content: AGENT_WITH_ID_FM, sourcePath: 'test.md', noSync: true, root });
    const result2 = installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'test.md', force: true, noSync: true, root
    });
    expect(result2.registryResult).toBe('already-present');
    const reg = readRegistry(root);
    const count = (reg['agents'] as string[]).filter((id) => id === 'security-review').length;
    expect(count).toBe(1);
  });

  it('derives ID from frontmatter name when id is absent', () => {
    const result = installAgent({
      content: AGENT_WITH_NAME_FM_ONLY, sourcePath: 'test.md', noSync: true, root
    });
    expect(result.agentId).toBe('my-custom-agent');
    expect(existsSync(join(root, '.thesmos', 'agents', 'my-custom-agent.md'))).toBe(true);
  });

  it('derives ID from filename when frontmatter has neither id nor name', () => {
    const result = installAgent({
      content: AGENT_NO_FM, sourcePath: '/tmp/my-headless-agent.md', noSync: true, root
    });
    expect(result.agentId).toBe('my-headless-agent');
  });

  it('overwrites existing file with --force and includes warning', () => {
    mkdirSync(join(root, '.thesmos', 'agents'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'agents', 'security-review.md'), 'old content');
    const result = installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'test.md', force: true, noSync: true, root
    });
    const written = readFileSync(join(root, '.thesmos', 'agents', 'security-review.md'), 'utf8');
    expect(written).toBe(AGENT_WITH_ID_FM);
    expect(result.warnings.some((w) => w.includes('Overwrote'))).toBe(true);
  });

  it('returns empty adapterPaths when noSync is true', () => {
    const result = installAgent({
      content: AGENT_WITH_ID_FM, sourcePath: 'test.md', noSync: true, root
    });
    expect(result.adapterPaths).toHaveLength(0);
  });
});

// ── installAgent — validation runs before mutation ────────────────────────────

describe('installAgent — all-or-nothing (validation before mutation)', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /**/ } });

  it('does not write canonical file when validation fails', () => {
    expect(() => installAgent({
      content: AGENT_EMPTY, sourcePath: 'empty.md', noSync: true, root
    })).toThrow(AgentInstallError);
    expect(existsSync(join(root, '.thesmos', 'agents'))).toBe(false);
  });

  it('does not mutate registry when validation fails', () => {
    writeRegistry(root, { rules: ['@thesmos/core'], agents: ['existing'] });
    expect(() => installAgent({
      content: AGENT_EMPTY, sourcePath: 'empty.md', noSync: true, root
    })).toThrow(AgentInstallError);
    const reg = readRegistry(root);
    expect(reg['agents']).toEqual(['existing']);
  });
});

// ── scope.ts improved suggestion for .claude/agents/ ─────────────────────────

describe('scope: improved suggestion for .claude/ authoring surfaces', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /**/ } });

  function writeScopeWith(blockedPaths: string[]): void {
    const cfg: ScopeConfig = {
      ...SCOPE_DEFAULTS,
      workspace: {
        ...SCOPE_DEFAULTS.workspace,
        allowedPaths: [],
        blockedPaths,
      },
    };
    saveScopeConfig(root, cfg);
  }

  it('returns agent-install suggestion when .claude/agents/ is blocked', () => {
    writeScopeWith(['.claude/']);
    const violation = checkScope({ toolName: 'Write', filePath: '.claude/agents/my-agent.md', root });
    expect(violation).not.toBeNull();
    expect(violation!.suggestion).toContain('thesmos agent:install');
    expect(violation!.suggestion).toContain('.thesmos/agents/');
  });

  it('returns agent-install suggestion when .claude/commands/ is blocked', () => {
    writeScopeWith(['.claude/']);
    const violation = checkScope({ toolName: 'Write', filePath: '.claude/commands/my-skill.md', root });
    expect(violation).not.toBeNull();
    expect(violation!.suggestion).toContain('thesmos agent:install');
  });

  it('returns agent-install suggestion when .claude/skills/ is blocked', () => {
    writeScopeWith(['.claude/']);
    const violation = checkScope({ toolName: 'Write', filePath: '.claude/skills/my-skill.md', root });
    expect(violation).not.toBeNull();
    expect(violation!.suggestion).toContain('thesmos agent:install');
  });

  it('returns generic suggestion for unrelated blocked paths', () => {
    writeScopeWith(['secrets/']);
    const violation = checkScope({ toolName: 'Write', filePath: 'secrets/key.pem', root });
    expect(violation).not.toBeNull();
    expect(violation!.suggestion).toContain('scope.json');
    expect(violation!.suggestion).not.toContain('thesmos agent:install');
  });

  it('preserves blocking behavior — violation type is still blocked_path', () => {
    writeScopeWith(['.claude/']);
    const violation = checkScope({ toolName: 'Write', filePath: '.claude/agents/x.md', root });
    expect(violation!.type).toBe('blocked_path');
  });

  it('existing scope enforcement tests continue to pass', () => {
    writeScopeWith(['node_modules/', '.env']);
    expect(checkScope({ toolName: 'Write', filePath: 'node_modules/pkg/index.js', root })).not.toBeNull();
    expect(checkScope({ toolName: 'Write', filePath: '.env', root })).not.toBeNull();
    expect(checkScope({ toolName: 'Write', filePath: 'src/index.ts', root })).toBeNull();
  });
});

// ── adapter sync is invoked once for a batch (integration-level check) ────────

describe('installAgent — adapter sync timing', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /**/ } });

  it('noSync:true installs two agents without calling syncAdapters, adapterPaths empty', () => {
    const agents = [AGENT_WITH_ID_FM, AGENT_WITH_NAME_FM_ONLY];
    const results = agents.map((content, i) =>
      installAgent({ content, sourcePath: `agent-${i}.md`, noSync: true, root })
    );
    // Both installed
    expect(existsSync(join(root, '.thesmos', 'agents', 'security-review.md'))).toBe(true);
    expect(existsSync(join(root, '.thesmos', 'agents', 'my-custom-agent.md'))).toBe(true);
    // No adapter paths (sync was skipped)
    for (const r of results) {
      expect(r.adapterPaths).toHaveLength(0);
    }
    // Registry has both
    const reg = readRegistry(root);
    expect(reg['agents']).toContain('security-review');
    expect(reg['agents']).toContain('my-custom-agent');
  });
});
