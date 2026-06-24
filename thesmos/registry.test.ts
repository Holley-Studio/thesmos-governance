// @vitest-environment node
/**
 * Registry tests — covers all pure functions (validation, merge, loading, resolution)
 * plus an integration test using a temp directory.
 *
 * All fs-dependent functions accept injectable readFileSafe to avoid disk access.
 */
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  REGISTRY_DEFAULTS,
  REGISTRY_PATH,
  validateRegistryConfig,
  mergeRegistryConfig,
  loadRegistryConfig,
  resolveRegistry,
  loadAndResolveRegistry,
  type ThesmosRegistryConfig,
} from './registry';

// ── validateRegistryConfig ────────────────────────────────────────────────────

describe('validateRegistryConfig', () => {
  it('accepts an empty object', () => {
    const { valid, errors } = validateRegistryConfig({});
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('accepts a fully populated config', () => {
    const { valid } = validateRegistryConfig({
      rules: ['@thesmos/core', '@thesmos/web'],
      agents: ['security-reviewer'],
      skills: ['web-review'],
      profiles: ['web-builder'],
    });
    expect(valid).toBe(true);
  });

  it('accepts a config with only some keys', () => {
    expect(validateRegistryConfig({ rules: ['@thesmos/core'] }).valid).toBe(true);
    expect(validateRegistryConfig({ agents: [] }).valid).toBe(true);
  });

  it('rejects null', () => {
    expect(validateRegistryConfig(null).valid).toBe(false);
  });

  it('rejects an array', () => {
    expect(validateRegistryConfig([]).valid).toBe(false);
  });

  it('rejects a string', () => {
    expect(validateRegistryConfig('not-an-object').valid).toBe(false);
  });

  it('rejects non-array rules', () => {
    const { valid, errors } = validateRegistryConfig({ rules: '@thesmos/core' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"rules"'))).toBe(true);
  });

  it('rejects non-string entries inside arrays', () => {
    const { valid, errors } = validateRegistryConfig({ agents: [42, true] });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"agents[0]"'))).toBe(true);
  });

  it('returns multiple errors when multiple fields are invalid', () => {
    const { errors } = validateRegistryConfig({ rules: 'string', agents: 123 });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── mergeRegistryConfig ───────────────────────────────────────────────────────

describe('mergeRegistryConfig', () => {
  it('returns defaults when override is empty', () => {
    const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, {});
    expect(merged).toEqual(REGISTRY_DEFAULTS);
  });

  it('override.rules replaces default rules', () => {
    const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, {
      rules: ['@thesmos/core', '@thesmos/web'],
    });
    expect(merged.rules).toEqual(['@thesmos/core', '@thesmos/web']);
  });

  it('override.agents replaces default agents (empty → populated)', () => {
    const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, {
      agents: ['security-reviewer'],
    });
    expect(merged.agents).toEqual(['security-reviewer']);
  });

  it('absent field falls back to base value', () => {
    const merged = mergeRegistryConfig(
      { ...REGISTRY_DEFAULTS, profiles: ['web-builder'] },
      { rules: ['@thesmos/security'] }
    );
    expect(merged.profiles).toEqual(['web-builder']); // kept from base
    expect(merged.rules).toEqual(['@thesmos/security']); // overridden
  });

  it('full override replaces all fields', () => {
    const override: Required<ThesmosRegistryConfig> = {
      rules: ['@my-org/custom'],
      agents: ['my-agent'],
      skills: ['my-skill'],
      profiles: ['my-profile'],
    };
    const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, override);
    expect(merged).toEqual(override);
  });

  it('does not mutate the base object', () => {
    const base = { ...REGISTRY_DEFAULTS };
    mergeRegistryConfig(base, { agents: ['new-agent'] });
    expect(base.agents).toEqual(REGISTRY_DEFAULTS.agents);
  });
});

// ── loadRegistryConfig ────────────────────────────────────────────────────────

describe('loadRegistryConfig', () => {
  const ROOT = '/fake/root';

  function makeReader(files: Record<string, string>) {
    return (absPath: string): string | null => files[absPath] ?? null;
  }

  it('returns empty config when file is missing', () => {
    const cfg = loadRegistryConfig(ROOT, makeReader({}));
    expect(cfg).toEqual({});
  });

  it('parses a valid registry.json', () => {
    const content = JSON.stringify({
      rules: ['@thesmos/core'],
      agents: ['security-reviewer'],
    });
    const cfg = loadRegistryConfig(
      ROOT,
      makeReader({ [`${ROOT}/${REGISTRY_PATH}`]: content })
    );
    expect(cfg.rules).toEqual(['@thesmos/core']);
    expect(cfg.agents).toEqual(['security-reviewer']);
  });

  it('returns empty config on malformed JSON', () => {
    const cfg = loadRegistryConfig(
      ROOT,
      makeReader({ [`${ROOT}/${REGISTRY_PATH}`]: '{not json' })
    );
    expect(cfg).toEqual({});
  });

  it('returns empty config when validation fails', () => {
    const content = JSON.stringify({ rules: 'not-an-array' });
    const cfg = loadRegistryConfig(
      ROOT,
      makeReader({ [`${ROOT}/${REGISTRY_PATH}`]: content })
    );
    expect(cfg).toEqual({});
  });

  it('preserves extra unknown keys (forward-compatible)', () => {
    const content = JSON.stringify({
      rules: ['@thesmos/core'],
      futureKey: 'value',
    });
    const cfg = loadRegistryConfig(
      ROOT,
      makeReader({ [`${ROOT}/${REGISTRY_PATH}`]: content })
    );
    expect(cfg.rules).toEqual(['@thesmos/core']);
  });
});

// ── resolveRegistry ───────────────────────────────────────────────────────────

describe('resolveRegistry', () => {
  const ROOT = '/fake/root';

  const AGENT_CONTENT = '# Security Reviewer\n\n## Purpose\n\nReview for security issues.';
  const SKILL_CONTENT = '# Web Review Skill\n\n## Use when\n\nReviewing web apps.';

  function makeReader(files: Record<string, string>) {
    return (absPath: string): string | null => files[absPath] ?? null;
  }

  it('returns empty agents and skills when config has none', () => {
    const resolved = resolveRegistry(ROOT, REGISTRY_DEFAULTS, makeReader({}));
    expect(resolved.agents).toHaveLength(0);
    expect(resolved.skills).toHaveLength(0);
    expect(resolved.rulePacks).toEqual(['@thesmos/core']);
  });

  it('loads an agent file when id is in config.agents', () => {
    const config = { ...REGISTRY_DEFAULTS, agents: ['security-reviewer'] };
    const resolved = resolveRegistry(
      ROOT,
      config,
      makeReader({
        [`${ROOT}/.thesmos/agents/security-reviewer.md`]: AGENT_CONTENT,
      })
    );
    expect(resolved.agents).toHaveLength(1);
    expect(resolved.agents[0].id).toBe('security-reviewer');
    expect(resolved.agents[0].name).toBe('Security Reviewer');
    expect(resolved.agents[0].content).toBe(AGENT_CONTENT);
    expect(resolved.agents[0].path).toBe('.thesmos/agents/security-reviewer.md');
  });

  it('loads a skill file when id is in config.skills', () => {
    const config = { ...REGISTRY_DEFAULTS, skills: ['web-review'] };
    const resolved = resolveRegistry(
      ROOT,
      config,
      makeReader({
        [`${ROOT}/.thesmos/skills/web-review.md`]: SKILL_CONTENT,
      })
    );
    expect(resolved.skills).toHaveLength(1);
    expect(resolved.skills[0].id).toBe('web-review');
    expect(resolved.skills[0].name).toBe('Web Review Skill');
  });

  it('silently skips agents whose files are missing', () => {
    const config = { ...REGISTRY_DEFAULTS, agents: ['missing-agent', 'security-reviewer'] };
    const resolved = resolveRegistry(
      ROOT,
      config,
      makeReader({
        [`${ROOT}/.thesmos/agents/security-reviewer.md`]: AGENT_CONTENT,
      })
    );
    expect(resolved.agents).toHaveLength(1);
    expect(resolved.agents[0].id).toBe('security-reviewer');
  });

  it('silently skips skills whose files are missing', () => {
    const config = { ...REGISTRY_DEFAULTS, skills: ['ghost-skill'] };
    const resolved = resolveRegistry(ROOT, config, makeReader({}));
    expect(resolved.skills).toHaveLength(0);
  });

  it('passes through rulePacks and profiles unchanged', () => {
    const config = {
      rules: ['@thesmos/core', '@thesmos/web'],
      agents: [],
      skills: [],
      profiles: ['web-builder'],
    };
    const resolved = resolveRegistry(ROOT, config, makeReader({}));
    expect(resolved.rulePacks).toEqual(['@thesmos/core', '@thesmos/web']);
    expect(resolved.profiles).toEqual(['web-builder']);
  });

  it('falls back to "Unknown" name when agent has no heading', () => {
    const config = { ...REGISTRY_DEFAULTS, agents: ['headless-agent'] };
    const resolved = resolveRegistry(
      ROOT,
      config,
      makeReader({
        [`${ROOT}/.thesmos/agents/headless-agent.md`]: 'No heading here, just prose.',
      })
    );
    expect(resolved.agents[0].name).toBe('Unknown');
  });

  it('loads multiple agents in config order', () => {
    const config = {
      ...REGISTRY_DEFAULTS,
      agents: ['first-agent', 'second-agent'],
    };
    const resolved = resolveRegistry(
      ROOT,
      config,
      makeReader({
        [`${ROOT}/.thesmos/agents/first-agent.md`]: '# First Agent',
        [`${ROOT}/.thesmos/agents/second-agent.md`]: '# Second Agent',
      })
    );
    expect(resolved.agents.map((a) => a.id)).toEqual(['first-agent', 'second-agent']);
  });
});

// ── REGISTRY_DEFAULTS ─────────────────────────────────────────────────────────

describe('REGISTRY_DEFAULTS', () => {
  it('includes @thesmos/core as the default rule pack', () => {
    expect(REGISTRY_DEFAULTS.rules).toContain('@thesmos/core');
  });

  it('has no default agents, skills, or profiles', () => {
    expect(REGISTRY_DEFAULTS.agents).toHaveLength(0);
    expect(REGISTRY_DEFAULTS.skills).toHaveLength(0);
    expect(REGISTRY_DEFAULTS.profiles).toHaveLength(0);
  });
});

// ── Integration: loadAndResolveRegistry with temp dir ────────────────────────

describe('loadAndResolveRegistry (integration)', () => {
  function withTempDir(fn: (root: string) => void): void {
    const root = join(tmpdir(), `thesmos-registry-test-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    try {
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('returns defaults when .thesmos/registry.json is absent', () => {
    withTempDir((root) => {
      const resolved = loadAndResolveRegistry(root);
      expect(resolved.rulePacks).toEqual(REGISTRY_DEFAULTS.rules);
      expect(resolved.agents).toHaveLength(0);
    });
  });

  it('loads registry.json and resolves agents from disk', () => {
    withTempDir((root) => {
      const thesmosDir = join(root, '.thesmos');
      const agentsDir = join(thesmosDir, 'agents');
      mkdirSync(agentsDir, { recursive: true });

      writeFileSync(
        join(thesmosDir, 'registry.json'),
        JSON.stringify({ rules: ['@thesmos/core'], agents: ['security-reviewer'] })
      );
      writeFileSync(
        join(agentsDir, 'security-reviewer.md'),
        '# Security Reviewer\n\nReviews for security issues.'
      );

      const resolved = loadAndResolveRegistry(root);
      expect(resolved.rulePacks).toEqual(['@thesmos/core']);
      expect(resolved.agents).toHaveLength(1);
      expect(resolved.agents[0].id).toBe('security-reviewer');
      expect(resolved.agents[0].name).toBe('Security Reviewer');
    });
  });

  it('resolves skills from disk', () => {
    withTempDir((root) => {
      const skillsDir = join(root, '.thesmos', 'skills');
      mkdirSync(skillsDir, { recursive: true });

      writeFileSync(
        join(root, '.thesmos', 'registry.json'),
        JSON.stringify({ skills: ['web-review'] })
      );
      writeFileSync(join(skillsDir, 'web-review.md'), '# Web Review Skill\n\nDetailed steps.');

      mkdirSync(join(root, '.thesmos'), { recursive: true });

      const resolved = loadAndResolveRegistry(root);
      expect(resolved.skills).toHaveLength(1);
      expect(resolved.skills[0].name).toBe('Web Review Skill');
    });
  });

  it('does not fail when registry.json is malformed JSON', () => {
    withTempDir((root) => {
      mkdirSync(join(root, '.thesmos'), { recursive: true });
      writeFileSync(join(root, '.thesmos', 'registry.json'), '{bad json');

      const resolved = loadAndResolveRegistry(root);
      expect(resolved.rulePacks).toEqual(REGISTRY_DEFAULTS.rules); // falls back
    });
  });
});
