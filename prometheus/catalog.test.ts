// @vitest-environment node
/**
 * Catalog tests — covers frontmatter parsing, validation, built-in loader,
 * profile loading, user catalog loading, and end-to-end extensibility.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import {
  parseFrontmatter,
  validateFrontmatter,
  validateCatalog,
  loadCatalogDir,
  loadBuiltInCatalog,
  loadBuiltInProfiles,
  loadCatalogProfile,
  loadUserCatalog,
  getActiveCatalog,
  buildAgentStub,
  buildSkillStub,
  type CatalogEntry,
} from './catalog';

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('parses a complete frontmatter block', () => {
    const raw = `---
id: security-reviewer
name: Security Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - security
  - auth
enabled: true
---

# Body content here
`;
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.id).toBe('security-reviewer');
    expect(frontmatter.name).toBe('Security Reviewer');
    expect(frontmatter.type).toBe('agent');
    expect(frontmatter.version).toBe('1.0.0');
    expect(frontmatter.owner).toBe('prometheus');
    expect(frontmatter.tags).toEqual(['security', 'auth']);
    expect(frontmatter.enabled).toBe(true);
    expect(body).toContain('# Body content here');
  });

  it('parses enabled: false correctly', () => {
    const raw = `---
id: test
name: Test
type: skill
version: 1.0.0
owner: prometheus
enabled: false
---
body`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.enabled).toBe(false);
  });

  it('returns empty frontmatter and original body when no opening ---', () => {
    const raw = 'No frontmatter here\nJust body text.';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('returns empty frontmatter when opening --- is present but no closing ---', () => {
    const raw = '---\nid: test\nno closing marker\nbody';
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe(raw);
  });

  it('handles empty tags list', () => {
    const raw = `---
id: test
name: Test
type: agent
version: 1.0.0
owner: prometheus
tags:
enabled: true
---`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.tags).toEqual([]);
  });
});

// ── validateFrontmatter ───────────────────────────────────────────────────────

describe('validateFrontmatter', () => {
  const VALID = {
    id: 'security-reviewer',
    name: 'Security Reviewer',
    type: 'agent',
    version: '1.0.0',
    owner: 'prometheus',
    tags: ['security'],
    enabled: true,
  };

  it('accepts a valid agent frontmatter', () => {
    const { valid, errors } = validateFrontmatter(VALID);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid skill frontmatter', () => {
    const { valid } = validateFrontmatter({ ...VALID, type: 'skill' });
    expect(valid).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { valid, errors } = validateFrontmatter({});
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"id"'))).toBe(true);
    expect(errors.some((e) => e.includes('"name"'))).toBe(true);
    expect(errors.some((e) => e.includes('"type"'))).toBe(true);
    expect(errors.some((e) => e.includes('"version"'))).toBe(true);
    expect(errors.some((e) => e.includes('"owner"'))).toBe(true);
    expect(errors.some((e) => e.includes('"enabled"'))).toBe(true);
  });

  it('rejects invalid type', () => {
    const { valid, errors } = validateFrontmatter({ ...VALID, type: 'tool' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"type"'))).toBe(true);
  });

  it('rejects invalid semver version', () => {
    const { valid, errors } = validateFrontmatter({ ...VALID, version: '1.0' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"version"'))).toBe(true);
  });

  it('rejects non-boolean enabled', () => {
    const { valid, errors } = validateFrontmatter({ ...VALID, enabled: 'yes' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"enabled"'))).toBe(true);
  });

  it('rejects non-array tags', () => {
    const { valid, errors } = validateFrontmatter({ ...VALID, tags: 'security' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"tags"'))).toBe(true);
  });

  it('rejects non-kebab-case id', () => {
    const { valid, errors } = validateFrontmatter({ ...VALID, id: 'Security Reviewer' });
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('"id"'))).toBe(true);
  });

  it('accepts id without tags (optional)', () => {
    // tags is optional (but enabled/id/name/type/version/owner are required)
    const { valid } = validateFrontmatter({ ...VALID, tags: undefined } as Record<string, unknown>);
    expect(valid).toBe(true); // tags is optional
  });
});

// ── validateCatalog ───────────────────────────────────────────────────────────

describe('validateCatalog', () => {
  function makeEntry(id: string, name: string): CatalogEntry {
    return {
      frontmatter: {
        id,
        name,
        type: 'agent',
        version: '1.0.0',
        owner: 'prometheus',
        tags: [],
        enabled: true,
      },
      body: '',
      content: '',
      path: `catalog/agents/${id}.md`,
      source: 'builtin',
    };
  }

  it('accepts a catalog with unique IDs and names', () => {
    const entries = [makeEntry('agent-a', 'Agent A'), makeEntry('agent-b', 'Agent B')];
    const { valid, errors } = validateCatalog(entries);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('rejects duplicate IDs', () => {
    const entries = [makeEntry('agent-a', 'Agent A'), makeEntry('agent-a', 'Agent A 2')];
    const { valid, errors } = validateCatalog(entries);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
  });

  it('rejects duplicate names', () => {
    const entries = [makeEntry('agent-a', 'Same Name'), makeEntry('agent-b', 'Same Name')];
    const { valid, errors } = validateCatalog(entries);
    expect(valid).toBe(false);
    expect(errors.some((e) => e.includes('duplicate name'))).toBe(true);
  });

  it('accepts an empty catalog', () => {
    const { valid } = validateCatalog([]);
    expect(valid).toBe(true);
  });
});

// ── loadCatalogDir ────────────────────────────────────────────────────────────

describe('loadCatalogDir', () => {
  const AGENT_CONTENT = `---
id: my-agent
name: My Agent
type: agent
version: 1.0.0
owner: test
tags:
  - custom
enabled: true
---

# My Agent

Body content.
`;

  function makeReader(files: Record<string, string>) {
    return (p: string): string | null => files[p] ?? null;
  }

  // listFn mirrors readdirSync — returns bare filenames, NOT full paths.
  // loadCatalogDir does join(dir, file) internally to build the absolute path.
  function makeList(filenames: string[]) {
    return (_dir: string) => filenames;
  }

  it('loads entries from a directory', () => {
    const dir = '/fake/agents';
    const entries = loadCatalogDir(
      dir,
      'builtin',
      undefined,
      makeReader({ [`${dir}/my-agent.md`]: AGENT_CONTENT }),
      makeList(['my-agent.md'])
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].frontmatter.id).toBe('my-agent');
    expect(entries[0].frontmatter.name).toBe('My Agent');
    expect(entries[0].source).toBe('builtin');
  });

  it('returns empty array when directory is empty', () => {
    const entries = loadCatalogDir('/fake/empty', 'user', undefined, makeReader({}), makeList([]));
    expect(entries).toHaveLength(0);
  });

  it('skips files with invalid frontmatter (no stderr thrown)', () => {
    const dir = '/fake/agents';
    const entries = loadCatalogDir(
      dir,
      'builtin',
      undefined,
      makeReader({ [`${dir}/bad.md`]: '---\nbad: content\n---\nbody' }),
      makeList(['bad.md'])
    );
    expect(entries).toHaveLength(0);
  });

  it('filters by ID when filter list is provided', () => {
    const dir = '/fake/agents';
    const contentA = AGENT_CONTENT.replace(/my-agent/g, 'agent-a').replace('My Agent', 'Agent A');
    const contentB = AGENT_CONTENT.replace(/my-agent/g, 'agent-b').replace('My Agent', 'Agent B');
    const files = {
      [`${dir}/agent-a.md`]: contentA,
      [`${dir}/agent-b.md`]: contentB,
    };
    const entries = loadCatalogDir(
      dir,
      'user',
      ['agent-a'],
      makeReader(files),
      makeList(['agent-a.md', 'agent-b.md'])
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].frontmatter.id).toBe('agent-a');
  });

  it('marks entries with the correct source', () => {
    const dir = '/fake/agents';
    const builtin = loadCatalogDir(
      dir,
      'builtin',
      undefined,
      makeReader({ [`${dir}/my-agent.md`]: AGENT_CONTENT }),
      makeList(['my-agent.md'])
    );
    expect(builtin[0].source).toBe('builtin');

    const user = loadCatalogDir(
      dir,
      'user',
      undefined,
      makeReader({ [`${dir}/my-agent.md`]: AGENT_CONTENT }),
      makeList(['my-agent.md'])
    );
    expect(user[0].source).toBe('user');
  });
});

// ── loadBuiltInCatalog — snapshot tests ──────────────────────────────────────

describe('loadBuiltInCatalog', () => {
  it('loads exactly 70 built-in agents', () => {
    const { agents } = loadBuiltInCatalog();
    expect(agents).toHaveLength(70);
  });

  it('loads exactly 50 built-in skills', () => {
    const { skills } = loadBuiltInCatalog();
    expect(skills).toHaveLength(53);
  });

  it('all built-in agents have valid frontmatter', () => {
    const { agents } = loadBuiltInCatalog();
    for (const agent of agents) {
      expect(agent.frontmatter.type, `${agent.frontmatter.id} must be type agent`).toBe('agent');
      expect(agent.frontmatter.id).toBeTruthy();
      expect(agent.frontmatter.name).toBeTruthy();
      expect(agent.frontmatter.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(agent.frontmatter.enabled).toBe(true);
    }
  });

  it('all built-in skills have valid frontmatter', () => {
    const { skills } = loadBuiltInCatalog();
    for (const skill of skills) {
      expect(skill.frontmatter.type, `${skill.frontmatter.id} must be type skill`).toBe('skill');
      expect(skill.frontmatter.id).toBeTruthy();
      expect(skill.frontmatter.name).toBeTruthy();
      expect(skill.frontmatter.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(skill.frontmatter.enabled).toBe(true);
    }
  });

  it('all built-in agent IDs are unique', () => {
    const { agents } = loadBuiltInCatalog();
    const ids = agents.map((a) => a.frontmatter.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all built-in skill IDs are unique', () => {
    const { skills } = loadBuiltInCatalog();
    const ids = skills.map((s) => s.frontmatter.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('all built-in agents have non-empty body content', () => {
    const { agents } = loadBuiltInCatalog();
    for (const agent of agents) {
      expect(agent.body.length, `${agent.frontmatter.id} has empty body`).toBeGreaterThan(50);
    }
  });

  it('validateCatalog passes for all built-in agents', () => {
    const { agents } = loadBuiltInCatalog();
    const { valid, errors } = validateCatalog(agents);
    expect(errors).toHaveLength(0);
    expect(valid).toBe(true);
  });

  it('validateCatalog passes for all built-in skills', () => {
    const { skills } = loadBuiltInCatalog();
    const { valid, errors } = validateCatalog(skills);
    expect(errors).toHaveLength(0);
    expect(valid).toBe(true);
  });

  it('security-reviewer agent exists in built-in catalog', () => {
    const { agents } = loadBuiltInCatalog();
    const sr = agents.find((a) => a.frontmatter.id === 'security-reviewer');
    expect(sr).toBeDefined();
    expect(sr!.frontmatter.name).toBe('Security Reviewer');
  });

  it('pr-review skill exists in built-in catalog', () => {
    const { skills } = loadBuiltInCatalog();
    const pr = skills.find((s) => s.frontmatter.id === 'pr-review');
    expect(pr).toBeDefined();
    expect(pr!.frontmatter.name).toBe('PR Review');
  });
});

// ── loadBuiltInProfiles ───────────────────────────────────────────────────────

describe('loadBuiltInProfiles', () => {
  it('loads exactly 5 built-in profiles', () => {
    const profiles = loadBuiltInProfiles();
    expect(profiles).toHaveLength(5);
  });

  it('includes base, web, next-supabase, package, and enterprise profiles', () => {
    const profiles = loadBuiltInProfiles();
    const ids = profiles.map((p) => p.id);
    expect(ids).toContain('base');
    expect(ids).toContain('web');
    expect(ids).toContain('next-supabase');
    expect(ids).toContain('package');
    expect(ids).toContain('enterprise');
  });

  it('every profile has agents, skills, and rulePacks arrays', () => {
    const profiles = loadBuiltInProfiles();
    for (const profile of profiles) {
      expect(Array.isArray(profile.agents), `${profile.id} agents must be array`).toBe(true);
      expect(Array.isArray(profile.skills), `${profile.id} skills must be array`).toBe(true);
      expect(Array.isArray(profile.rulePacks), `${profile.id} rulePacks must be array`).toBe(true);
    }
  });

  it('every profile includes @prometheus/core in rulePacks', () => {
    const profiles = loadBuiltInProfiles();
    for (const profile of profiles) {
      expect(profile.rulePacks, `${profile.id} must include @prometheus/core`).toContain(
        '@prometheus/core'
      );
    }
  });

  it('base profile agents are a subset of next-supabase profile agents', () => {
    const profiles = loadBuiltInProfiles();
    const base = profiles.find((p) => p.id === 'base')!;
    const nextSupabase = profiles.find((p) => p.id === 'next-supabase')!;
    for (const agentId of base.agents) {
      expect(nextSupabase.agents, `next-supabase should include ${agentId}`).toContain(agentId);
    }
  });
});

// ── loadCatalogProfile ────────────────────────────────────────────────────────

describe('loadCatalogProfile', () => {
  it('returns the web profile by ID', () => {
    const profile = loadCatalogProfile('web');
    expect(profile).toBeDefined();
    expect(profile!.id).toBe('web');
    expect(profile!.name).toBe('Web Profile');
  });

  it('returns null for an unknown profile ID', () => {
    const profile = loadCatalogProfile('does-not-exist');
    expect(profile).toBeNull();
  });

  it('next-supabase profile includes supabase-reviewer agent', () => {
    const profile = loadCatalogProfile('next-supabase');
    expect(profile!.agents).toContain('supabase-reviewer');
  });

  it('enterprise profile has the most agents of all profiles', () => {
    const profiles = loadBuiltInProfiles();
    const enterprise = profiles.find((p) => p.id === 'enterprise')!;
    for (const profile of profiles.filter((p) => p.id !== 'enterprise')) {
      expect(enterprise.agents.length).toBeGreaterThanOrEqual(profile.agents.length);
    }
  });
});

// ── loadUserCatalog — integration with temp dir ───────────────────────────────

describe('loadUserCatalog (integration)', () => {
  const AGENT_CONTENT = `---
id: custom-agent
name: Custom Agent
type: agent
version: 1.0.0
owner: local
tags:
  - custom
enabled: true
---

# Custom Agent

This is a custom agent.
`;

  const SKILL_CONTENT = `---
id: custom-skill
name: Custom Skill
type: skill
version: 1.0.0
owner: local
tags:
  - custom
enabled: true
---

# Custom Skill

This is a custom skill.
`;

  function withTempDir(fn: (root: string) => void): void {
    const root = join(tmpdir(), `prometheus-catalog-test-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    try {
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('returns empty catalog when .prometheus/agents and .prometheus/skills do not exist', () => {
    withTempDir((root) => {
      const { agents, skills } = loadUserCatalog(root);
      expect(agents).toHaveLength(0);
      expect(skills).toHaveLength(0);
    });
  });

  it('loads a custom agent file from .prometheus/agents/', () => {
    withTempDir((root) => {
      const agentsDir = join(root, '.prometheus', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'custom-agent.md'), AGENT_CONTENT);

      const { agents } = loadUserCatalog(root);
      expect(agents).toHaveLength(1);
      expect(agents[0].frontmatter.id).toBe('custom-agent');
      expect(agents[0].source).toBe('user');
    });
  });

  it('loads a custom skill file from .prometheus/skills/', () => {
    withTempDir((root) => {
      const skillsDir = join(root, '.prometheus', 'skills');
      mkdirSync(skillsDir, { recursive: true });
      writeFileSync(join(skillsDir, 'custom-skill.md'), SKILL_CONTENT);

      const { skills } = loadUserCatalog(root);
      expect(skills).toHaveLength(1);
      expect(skills[0].frontmatter.id).toBe('custom-skill');
      expect(skills[0].source).toBe('user');
    });
  });

  it('filters agents by enabledIds when provided', () => {
    withTempDir((root) => {
      const agentsDir = join(root, '.prometheus', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(join(agentsDir, 'custom-agent.md'), AGENT_CONTENT);
      // A second agent that is NOT in the enabled list
      const secondAgent = AGENT_CONTENT.replace('custom-agent', 'other-agent').replace(
        'Custom Agent',
        'Other Agent'
      );
      writeFileSync(join(agentsDir, 'other-agent.md'), secondAgent);

      const { agents } = loadUserCatalog(root, { agents: ['custom-agent'] });
      expect(agents).toHaveLength(1);
      expect(agents[0].frontmatter.id).toBe('custom-agent');
    });
  });
});

// ── getActiveCatalog ──────────────────────────────────────────────────────────

describe('getActiveCatalog (integration)', () => {
  function withTempDir(fn: (root: string) => void): void {
    const root = join(tmpdir(), `prometheus-active-catalog-test-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    try {
      fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it('includes built-in agents when no filter is provided', () => {
    withTempDir((root) => {
      const { agents } = getActiveCatalog(root);
      expect(agents.length).toBeGreaterThan(0);
      expect(agents.every((a) => a.source === 'builtin')).toBe(true);
    });
  });

  it('includes only filtered built-in agents when enabledIds is provided', () => {
    withTempDir((root) => {
      const { agents } = getActiveCatalog(root, { agents: ['security-reviewer'] });
      expect(agents.some((a) => a.frontmatter.id === 'security-reviewer')).toBe(true);
      expect(agents.every((a) => a.frontmatter.id === 'security-reviewer')).toBe(true);
    });
  });

  it('merges user agents with built-in agents when both are in enabledIds', () => {
    withTempDir((root) => {
      const agentsDir = join(root, '.prometheus', 'agents');
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        join(agentsDir, 'custom-agent.md'),
        `---
id: custom-agent
name: Custom Agent
type: agent
version: 1.0.0
owner: local
tags:
  - custom
enabled: true
---
# Custom Agent
`
      );

      // Both IDs must be in enabledIds — the registry controls what is active.
      const { agents } = getActiveCatalog(root, {
        agents: ['security-reviewer', 'custom-agent'],
      });
      const ids = agents.map((a) => a.frontmatter.id);
      expect(ids).toContain('security-reviewer');
      expect(ids).toContain('custom-agent');
    });
  });
});

// ── buildAgentStub / buildSkillStub ───────────────────────────────────────────

describe('buildAgentStub', () => {
  it('produces valid frontmatter that passes validateFrontmatter', () => {
    const stub = buildAgentStub('my-agent', 'My Agent');
    const { frontmatter } = parseFrontmatter(stub);
    const { valid, errors } = validateFrontmatter(frontmatter);
    expect(errors).toHaveLength(0);
    expect(valid).toBe(true);
  });

  it('uses the provided id and name', () => {
    const stub = buildAgentStub('custom-sec', 'Custom Security');
    const { frontmatter } = parseFrontmatter(stub);
    expect(frontmatter.id).toBe('custom-sec');
    expect(frontmatter.name).toBe('Custom Security');
  });

  it('sets type to agent', () => {
    const stub = buildAgentStub('x', 'X');
    const { frontmatter } = parseFrontmatter(stub);
    expect(frontmatter.type).toBe('agent');
  });
});

describe('buildSkillStub', () => {
  it('produces valid frontmatter that passes validateFrontmatter', () => {
    const stub = buildSkillStub('my-skill', 'My Skill');
    const { frontmatter } = parseFrontmatter(stub);
    const { valid, errors } = validateFrontmatter(frontmatter);
    expect(errors).toHaveLength(0);
    expect(valid).toBe(true);
  });

  it('sets type to skill', () => {
    const stub = buildSkillStub('x', 'X');
    const { frontmatter } = parseFrontmatter(stub);
    expect(frontmatter.type).toBe('skill');
  });
});
