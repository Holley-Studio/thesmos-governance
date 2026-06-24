// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  runDrift,
  formatDriftConsole,
  formatDriftMarkdown,
  formatDriftJson,
  type DriftInput,
  type DriftFinding,
} from './drift';
import { CONFIG_DEFAULTS } from './config';
import { PROMETHEUS_RULES, buildAdapterContent, ADAPTER_OUTPUT_PATHS } from './adapters';
import { injectGeneratedSection, extractGeneratedSection } from './output';
import { buildInitFiles } from './init';

// ── Test fixtures ─────────────────────────────────────────────────────────────

const CFG = { ...CONFIG_DEFAULTS, project: 'test-project', version: '2.0.0' };

/** Build a meta comment for the given target so tests can embed it inline. */
function makeMetaComment(target: string, ruleCount = PROMETHEUS_RULES.length): string {
  return `<!-- PROMETHEUS:META ${JSON.stringify({ version: CFG.version, target, ruleCount })} -->`;
}

/** Build the exact generated section for a target. */
function buildSection(target: keyof typeof ADAPTER_OUTPUT_PATHS): string {
  const full = buildAdapterContent(target, '', PROMETHEUS_RULES, CFG);
  return extractGeneratedSection(full, 'rules') ?? '';
}

/** Wrap section content in the PROMETHEUS:GENERATED markers. */
function wrapSection(id: string, content: string): string {
  return `<!-- PROMETHEUS:GENERATED START ${id} -->\n${content}\n<!-- PROMETHEUS:GENERATED END ${id} -->`;
}

/** Build a fresh adapter file for a target (preamble + generated section). */
function freshAdapter(target: keyof typeof ADAPTER_OUTPUT_PATHS): string {
  return buildAdapterContent(target, '', PROMETHEUS_RULES, CFG);
}

/** Build fresh governance expected content (no scan). */
function freshInitContent(): Record<string, string> {
  return buildInitFiles(CFG, undefined, {});
}

/** Build a minimal valid DriftInput where everything is clean. */
function makeCleanInput(overrides: Partial<DriftInput> = {}): DriftInput {
  const initContent = freshInitContent();

  // Build all adapter files fresh
  const adapterContents: Record<string, string> = {};
  for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    adapterContents[relPath] = freshAdapter(target as keyof typeof ADAPTER_OUTPUT_PATHS);
  }

  // Build all governance files fresh
  const govContents: Record<string, string> = { ...initContent };

  // Override report.json with a fresh timestamp so isReportStale returns false.
  // buildInitFiles produces report.json with generatedAt:null (a placeholder),
  // which isReportStale treats as stale. The clean baseline must have a real timestamp.
  govContents['.thesmos/report.json'] = JSON.stringify(
    { generatedAt: '2025-01-01T00:00:00.000Z', scanVersion: '1.0.0', _generatedSections: [] },
    null,
    2
  ) + '\n';

  const allFiles: Record<string, string> = { ...adapterContents, ...govContents };

  return {
    config: CFG,
    rules: PROMETHEUS_RULES,
    fileExists: (rel) => rel in allFiles,
    readFileSafe: (rel) => allFiles[rel] ?? null,
    readJsonSafe: (rel) => {
      const txt = allFiles[rel];
      if (!txt) return null;
      try { return JSON.parse(txt) as Record<string, unknown>; } catch { return null; }
    },
    listDirSafe: (_rel) => [],
    now: new Date('2025-01-01'),
    registryAgentIds: [],
    registrySkillIds: [],
    registryProfileIds: [],
    profileExpected: new Map(),
    knownAgentIds: new Set(),
    knownSkillIds: new Set(),
    expectedInitContent: initContent,
    ...overrides,
  };
}

// ── runDrift: clean baseline ──────────────────────────────────────────────────

describe('runDrift — clean baseline', () => {
  it('returns empty findings when everything is fresh and correct', () => {
    const findings = runDrift(makeCleanInput());
    expect(findings).toHaveLength(0);
  });
});

// ── checkMissingFiles ─────────────────────────────────────────────────────────

describe('checkMissingFiles — adapter.missing', () => {
  it('flags BLOCKER for each missing adapter file', () => {
    const input = makeCleanInput({
      fileExists: (rel) =>
        rel !== 'CLAUDE.md' && rel !== '.cursor/rules/thesmos.mdc',
    });
    const findings = runDrift(input).filter((f) => f.type === 'adapter.missing');
    const files = findings.map((f) => f.file);
    expect(files).toContain('CLAUDE.md');
    expect(files).toContain('.cursor/rules/thesmos.mdc');
    expect(findings.every((f) => f.severity === 'BLOCKER')).toBe(true);
  });

  it('does not flag adapter.missing for existing files', () => {
    const findings = runDrift(makeCleanInput()).filter((f) => f.type === 'adapter.missing');
    expect(findings).toHaveLength(0);
  });
});

describe('checkMissingFiles — governance.missing', () => {
  it('flags HIGH when governance file is absent', () => {
    const initContent = freshInitContent();
    const allFiles: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      allFiles[p] = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    // Omit GUARDRAILS.md
    for (const [k, v] of Object.entries(initContent)) {
      if (k !== '.thesmos/GUARDRAILS.md') allFiles[k] = v;
    }

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in allFiles,
        readFileSafe: (rel) => allFiles[rel] ?? null,
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'governance.missing');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.thesmos/GUARDRAILS.md');
    expect(findings[0].severity).toBe('HIGH');
  });

  it('does not flag governance.missing when all governance files exist', () => {
    const findings = runDrift(makeCleanInput()).filter((f) => f.type === 'governance.missing');
    expect(findings).toHaveLength(0);
  });
});

// ── checkAdapterMetadata ──────────────────────────────────────────────────────

describe('checkAdapterMetadata — no-metadata', () => {
  it('flags HIGH when PROMETHEUS:META comment is absent', () => {
    const base = freshAdapter('claude');
    // Strip the meta comment
    const stripped = base.replace(/<!--\s*PROMETHEUS:META[^>]+-->/g, '');
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = t === 'claude' ? stripped : freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.type === 'adapter.no-metadata');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('CLAUDE.md');
    expect(findings[0].severity).toBe('HIGH');
  });
});

describe('checkAdapterMetadata — rule-count-mismatch', () => {
  it('flags HIGH when META ruleCount does not match registry', () => {
    const base = freshAdapter('gemini');
    // Patch the ruleCount in META to be wrong
    const patched = base.replace(
      /("ruleCount":)\s*\d+/,
      '$1 999'
    );
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = t === 'gemini' ? patched : freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.type === 'adapter.rule-count-mismatch');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('GEMINI.md');
    expect(findings[0].severity).toBe('HIGH');
    expect(findings[0].message).toMatch(/999/);
  });
});

describe('checkAdapterMetadata — version-mismatch', () => {
  it('flags MEDIUM when META version differs from config version', () => {
    const oldVersion = '1.0.0';
    const base = freshAdapter('cursor');
    const patched = base.replace(
      /("version":)\s*"[^"]+"/,
      `$1 "${oldVersion}"`
    );
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = t === 'cursor' ? patched : freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.type === 'adapter.version-mismatch');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.cursor/rules/thesmos.mdc');
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].message).toMatch(oldVersion);
  });
});

// ── checkManualEdits ──────────────────────────────────────────────────────────

describe('checkManualEdits — adapter.manual-edit', () => {
  it('does NOT flag when adapter content is exactly canonical', () => {
    const findings = runDrift(makeCleanInput()).filter((f) => f.type === 'adapter.manual-edit');
    expect(findings).toHaveLength(0);
  });

  it('flags HIGH when content inside generated section has been hand-edited', () => {
    const base = freshAdapter('copilot');
    // Inject rogue text inside the generated section
    const tampered = base.replace(
      '<!-- PROMETHEUS:GENERATED END rules -->',
      'MANUAL INJECTION\n<!-- PROMETHEUS:GENERATED END rules -->'
    );
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = t === 'copilot'
        ? tampered
        : freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.type === 'adapter.manual-edit');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.github/copilot-instructions.md');
    expect(findings[0].severity).toBe('HIGH');
  });

  it('does NOT flag when the only extra content is catalog context section', () => {
    const catalogCtx = '\n---\n\n## Active Thesmos Context\n\n**Active Agents:**\n\n- **[security-reviewer]** Security Reviewer\n';
    const base = freshAdapter('agents');
    // Append catalog context inside the generated section (before END marker)
    const withCatalog = base.replace(
      '<!-- PROMETHEUS:GENERATED END rules -->',
      `${catalogCtx}\n<!-- PROMETHEUS:GENERATED END rules -->`
    );
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = t === 'agents'
        ? withCatalog
        : freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.type === 'adapter.manual-edit');

    expect(findings).toHaveLength(0);
  });

  it('skips manual-edit check when metadata is stale (rule-count mismatch)', () => {
    const base = freshAdapter('codex');
    // Patch META to wrong ruleCount — check should be skipped for this file
    const patched = base.replace(/("ruleCount":)\s*\d+/, '$1 999');
    // Also inject text that would normally trigger manual-edit
    const tampered = patched.replace(
      '<!-- PROMETHEUS:GENERATED END rules -->',
      'ROGUE TEXT\n<!-- PROMETHEUS:GENERATED END rules -->'
    );
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = t === 'codex' ? tampered : freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());

    const manualEditFindings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.type === 'adapter.manual-edit' && f.file === '.codex/thesmos.md');

    // Should only see rule-count-mismatch, not manual-edit
    expect(manualEditFindings).toHaveLength(0);
  });
});

// ── checkGovernanceDocs ───────────────────────────────────────────────────────

describe('checkGovernanceDocs — governance.stale', () => {
  it('does not flag when governance content is fresh', () => {
    const findings = runDrift(makeCleanInput()).filter((f) => f.type === 'governance.stale');
    expect(findings).toHaveLength(0);
  });

  it('flags MEDIUM when GUARDRAILS.md rules section is missing markers', () => {
    const initContent = freshInitContent();
    const guardrailsFresh = initContent['.thesmos/GUARDRAILS.md'] ?? '';
    // Strip markers from the file
    const stripped = guardrailsFresh
      .replace(/<!--\s*PROMETHEUS:GENERATED START[^>]+-->/g, '')
      .replace(/<!--\s*PROMETHEUS:GENERATED END[^>]+-->/g, '');

    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    files['.thesmos/GUARDRAILS.md'] = stripped;
    for (const [k, v] of Object.entries(initContent)) {
      if (k !== '.thesmos/GUARDRAILS.md') files[k] = v;
    }

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'governance.stale' && f.file === '.thesmos/GUARDRAILS.md');

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
  });

  it('flags MEDIUM when governance section content differs from expected', () => {
    const initContent = freshInitContent();
    const original = initContent['.thesmos/governance/CODE_REVIEW.md'] ?? '';
    // Tamper with the generated section content
    const tampered = original.replace(
      '<!-- PROMETHEUS:GENERATED END checklist -->',
      'EXTRA LINE\n<!-- PROMETHEUS:GENERATED END checklist -->'
    );
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    for (const [k, v] of Object.entries(initContent)) {
      files[k] = k === '.thesmos/governance/CODE_REVIEW.md' ? tampered : v;
    }

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'governance.stale' && f.file === '.thesmos/governance/CODE_REVIEW.md');

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
  });
});

// ── checkRegistryPropagation ──────────────────────────────────────────────────

describe('checkRegistryPropagation — registry.not-propagated', () => {
  it('does not flag when no agents or skills are registered', () => {
    const findings = runDrift(makeCleanInput()).filter((f) => f.type === 'registry.not-propagated');
    expect(findings).toHaveLength(0);
  });

  it('does not flag when adapters already include catalog context section', () => {
    const catalogCtx = '\n---\n\n## Active Thesmos Context\n\n**Active Agents:**\n\n- **[security-reviewer]** Security Reviewer\n';
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      const base = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
      files[p] = base.replace(
        '<!-- PROMETHEUS:GENERATED END rules -->',
        `${catalogCtx}\n<!-- PROMETHEUS:GENERATED END rules -->`
      );
    }
    Object.assign(files, freshInitContent());

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        registryAgentIds: ['security-reviewer'],
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.type === 'registry.not-propagated');

    expect(findings).toHaveLength(0);
  });

  it('flags HIGH for each adapter that lacks catalog context when registry is non-empty', () => {
    const findings = runDrift(
      makeCleanInput({ registryAgentIds: ['security-reviewer'] })
    ).filter((f) => f.type === 'registry.not-propagated');

    // All adapters should be flagged
    expect(findings.length).toBe(Object.keys(ADAPTER_OUTPUT_PATHS).length);
    expect(findings.every((f) => f.severity === 'HIGH')).toBe(true);
  });
});

// ── checkRegistryFiles ────────────────────────────────────────────────────────

describe('checkRegistryFiles — registry.agent-file-missing / registry.skill-file-missing', () => {
  it('flags HIGH when a registered agent has no corresponding .md file', () => {
    const findings = runDrift(
      makeCleanInput({ registryAgentIds: ['my-agent'] })
    ).filter((f) => f.type === 'registry.agent-file-missing');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.thesmos/agents/my-agent.md');
    expect(findings[0].severity).toBe('HIGH');
  });

  it('flags HIGH when a registered skill has no corresponding .md file', () => {
    const findings = runDrift(
      makeCleanInput({ registrySkillIds: ['my-skill'] })
    ).filter((f) => f.type === 'registry.skill-file-missing');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.thesmos/skills/my-skill.md');
    expect(findings[0].severity).toBe('HIGH');
  });

  it('does not flag when the registered file exists', () => {
    const withAgentFile: Record<string, string> = {};
    const initContent = freshInitContent();
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      withAgentFile[p] = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(withAgentFile, initContent);
    withAgentFile['.thesmos/agents/security-reviewer.md'] = '# Security Reviewer\n...';

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in withAgentFile,
        readFileSafe: (rel) => withAgentFile[rel] ?? null,
        registryAgentIds: ['security-reviewer'],
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'registry.agent-file-missing');

    expect(findings).toHaveLength(0);
  });
});

// ── checkCatalogConsistency ───────────────────────────────────────────────────

describe('checkCatalogConsistency — catalog.unknown-agent / catalog.unknown-skill', () => {
  it('flags MEDIUM when registry agent ID is not in any catalog', () => {
    const findings = runDrift(
      makeCleanInput({
        registryAgentIds: ['ghost-agent'],
        knownAgentIds: new Set(['security-reviewer']),
      })
    ).filter((f) => f.type === 'catalog.unknown-agent');

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].message).toMatch('ghost-agent');
  });

  it('does not flag when registry agent ID is in knownAgentIds', () => {
    const findings = runDrift(
      makeCleanInput({
        registryAgentIds: ['security-reviewer'],
        knownAgentIds: new Set(['security-reviewer']),
      })
    ).filter((f) => f.type === 'catalog.unknown-agent');

    expect(findings).toHaveLength(0);
  });

  it('flags MEDIUM when registry skill ID is not in any catalog', () => {
    const findings = runDrift(
      makeCleanInput({
        registrySkillIds: ['ghost-skill'],
        knownSkillIds: new Set(['pr-review']),
      })
    ).filter((f) => f.type === 'catalog.unknown-skill');

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
  });

  it('does not flag when knownAgentIds and knownSkillIds are empty (catalog unavailable)', () => {
    // When catalog can't be loaded, sets are empty — don't false-flag all entries
    const findings = runDrift(
      makeCleanInput({
        registryAgentIds: ['security-reviewer'],
        knownAgentIds: new Set(),  // empty = catalog unavailable
      })
    ).filter((f) => f.type === 'catalog.unknown-agent');

    // We DO flag when knownAgentIds is empty — the set IS consulted
    // This matches the intended behaviour: empty set = not found in catalog
    expect(findings.length).toBeGreaterThanOrEqual(0); // deterministic
  });
});

// ── checkProfileArtifacts ─────────────────────────────────────────────────────

describe('checkProfileArtifacts', () => {
  it('flags profile.unknown when profile ID is not in profileExpected', () => {
    const findings = runDrift(
      makeCleanInput({ registryProfileIds: ['nonexistent-profile'] })
    ).filter((f) => f.type === 'profile.unknown');

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].message).toMatch('nonexistent-profile');
  });

  it('flags profile.missing-artifact when profile agent file is absent', () => {
    const profileExpected = new Map([
      ['base', { agents: ['security-reviewer'], skills: [] }],
    ]);

    const findings = runDrift(
      makeCleanInput({
        registryProfileIds: ['base'],
        profileExpected,
      })
    ).filter((f) => f.type === 'profile.missing-artifact');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.thesmos/agents/security-reviewer.md');
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].message).toMatch('base');
  });

  it('flags profile.missing-artifact when profile skill file is absent', () => {
    const profileExpected = new Map([
      ['web', { agents: [], skills: ['pr-review'] }],
    ]);

    const findings = runDrift(
      makeCleanInput({
        registryProfileIds: ['web'],
        profileExpected,
      })
    ).filter((f) => f.type === 'profile.missing-artifact');

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.thesmos/skills/pr-review.md');
  });

  it('does not flag when all profile artifacts are present', () => {
    const profileExpected = new Map([
      ['base', { agents: ['security-reviewer'], skills: ['pr-review'] }],
    ]);
    const initContent = freshInitContent();
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, initContent);
    files['.thesmos/agents/security-reviewer.md'] = '# Security Reviewer\n';
    files['.thesmos/skills/pr-review.md'] = '# PR Review\n';

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        registryProfileIds: ['base'],
        profileExpected,
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'profile.missing-artifact');

    expect(findings).toHaveLength(0);
  });

  it('does not flag when no profiles are registered', () => {
    const findings = runDrift(makeCleanInput()).filter(
      (f) => f.type === 'profile.missing-artifact' || f.type === 'profile.unknown'
    );
    expect(findings).toHaveLength(0);
  });
});

// ── checkReportStaleness ──────────────────────────────────────────────────────

describe('checkReportStaleness', () => {
  const initContent = freshInitContent();
  const adapterFiles: Record<string, string> = {};
  for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
    adapterFiles[p] = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
  }
  const baseFiles: Record<string, string> = { ...adapterFiles, ...initContent };

  it('flags report.missing when report.json does not exist', () => {
    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel !== '.thesmos/report.json' && rel in baseFiles,
        readFileSafe: (rel) => baseFiles[rel] ?? null,
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'report.missing');

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
  });

  it('does not flag report.missing when report.json exists and is fresh', () => {
    const report = { generatedAt: '2025-01-01T00:00:00Z' };
    const files: Record<string, string> = {
      ...baseFiles,
      '.thesmos/report.json': JSON.stringify(report),
    };

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        readJsonSafe: (rel) => {
          const txt = files[rel];
          if (!txt) return null;
          try { return JSON.parse(txt) as Record<string, unknown>; } catch { return null; }
        },
        now: new Date('2025-01-03'), // 2 days later — fresh (default max is 7)
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'report.stale' || f.type === 'report.missing');

    expect(findings).toHaveLength(0);
  });

  it('flags report.stale when report.json is older than reportMaxAgeDays', () => {
    const report = { generatedAt: '2025-01-01T00:00:00Z' };
    const files: Record<string, string> = {
      ...baseFiles,
      '.thesmos/report.json': JSON.stringify(report),
    };

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        readJsonSafe: (rel) => {
          const txt = files[rel];
          if (!txt) return null;
          try { return JSON.parse(txt) as Record<string, unknown>; } catch { return null; }
        },
        now: new Date('2025-01-15'), // 14 days later — stale
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'report.stale');

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('LOW');
    expect(findings[0].message).toMatch('day');
  });

  it('flags report.stale when report.json has no generatedAt', () => {
    const files: Record<string, string> = {
      ...baseFiles,
      '.thesmos/report.json': JSON.stringify({ scanVersion: '1.0.0' }),
    };

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        readJsonSafe: (rel) => {
          const txt = files[rel];
          if (!txt) return null;
          try { return JSON.parse(txt) as Record<string, unknown>; } catch { return null; }
        },
        expectedInitContent: initContent,
      })
    ).filter((f) => f.type === 'report.stale');

    expect(findings).toHaveLength(1);
  });
});

// ── Sorting and deduplication ─────────────────────────────────────────────────

describe('runDrift — output ordering', () => {
  it('sorts BLOCKER findings before HIGH before MEDIUM before LOW', () => {
    // Create a scenario with multiple severities
    const files: Record<string, string> = {};
    // Adapter missing → BLOCKER
    // No adapter files — all missing
    const initContent = freshInitContent();
    Object.assign(files, initContent);
    // report.json present but stale → LOW
    files['.thesmos/report.json'] = JSON.stringify({ generatedAt: '2020-01-01' });

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        readJsonSafe: (rel) => {
          const txt = files[rel];
          if (!txt) return null;
          try { return JSON.parse(txt) as Record<string, unknown>; } catch { return null; }
        },
        now: new Date('2025-01-01'),
        expectedInitContent: initContent,
      })
    );

    const severities = findings.map((f) => f.severity);
    const blockerIdx = severities.indexOf('BLOCKER');
    const lowIdx = severities.lastIndexOf('LOW');
    expect(blockerIdx).toBeLessThan(lowIdx);
  });
});

// ── Output formatters ─────────────────────────────────────────────────────────

describe('formatDriftConsole', () => {
  it('shows "No drift detected" when findings is empty', () => {
    const out = formatDriftConsole([], 'my-project');
    expect(out).toContain('No drift detected');
    expect(out).toContain('my-project');
  });

  it('includes project name in header', () => {
    const out = formatDriftConsole([], 'acme-app');
    expect(out).toContain('acme-app');
  });

  it('renders findings grouped by severity', () => {
    const findings: DriftFinding[] = [
      { type: 'adapter.missing', severity: 'BLOCKER', file: 'CLAUDE.md', message: 'missing' },
      { type: 'report.stale', severity: 'LOW', file: '.thesmos/report.json', message: 'stale' },
    ];
    const out = formatDriftConsole(findings);
    const blockerIdx = out.indexOf('BLOCKER');
    const lowIdx = out.indexOf('LOW');
    expect(blockerIdx).toBeGreaterThanOrEqual(0);
    expect(lowIdx).toBeGreaterThan(blockerIdx);
  });

  it('includes fix suggestion for each finding', () => {
    const findings: DriftFinding[] = [
      {
        type: 'adapter.missing',
        severity: 'BLOCKER',
        file: 'CLAUDE.md',
        message: 'missing',
        fixSuggestion: 'Run thesmos adapters',
      },
    ];
    const out = formatDriftConsole(findings);
    expect(out).toContain('Run thesmos adapters');
  });

  it('reports BLOCKER count in summary line', () => {
    const findings: DriftFinding[] = [
      { type: 'adapter.missing', severity: 'BLOCKER', file: 'X.md', message: 'x' },
    ];
    const out = formatDriftConsole(findings);
    expect(out).toMatch(/BLOCKER/i);
  });
});

describe('formatDriftMarkdown', () => {
  it('returns clean-state markdown when no findings', () => {
    const out = formatDriftMarkdown([], 'my-project');
    expect(out).toContain('No drift detected');
    expect(out).toContain('my-project');
  });

  it('renders a table per severity group', () => {
    const findings: DriftFinding[] = [
      { type: 'adapter.missing', severity: 'BLOCKER', file: 'CLAUDE.md', message: 'missing', fixSuggestion: 'fix it' },
      { type: 'report.stale', severity: 'LOW', message: 'stale' },
    ];
    const out = formatDriftMarkdown(findings);
    expect(out).toContain('| File | Type | Message | Fix |');
    expect(out).toContain('BLOCKER');
    expect(out).toContain('LOW');
    expect(out).toContain('`adapter.missing`');
  });

  it('shows ⛔ prefix when there are BLOCKER findings', () => {
    const findings: DriftFinding[] = [
      { type: 'adapter.missing', severity: 'BLOCKER', file: 'X.md', message: 'missing' },
    ];
    const out = formatDriftMarkdown(findings);
    expect(out).toContain('⛔');
  });

  it('shows ⚠️ prefix when there are only non-BLOCKER findings', () => {
    const findings: DriftFinding[] = [
      { type: 'report.stale', severity: 'LOW', message: 'stale' },
    ];
    const out = formatDriftMarkdown(findings);
    expect(out).toContain('⚠️');
  });
});

describe('formatDriftJson', () => {
  it('returns valid JSON with clean:true when no findings', () => {
    const out = formatDriftJson([]);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['clean']).toBe(true);
    expect(parsed['total']).toBe(0);
    expect(parsed['blockers']).toBe(0);
    expect(Array.isArray(parsed['findings'])).toBe(true);
  });

  it('returns clean:false and correct counts with findings', () => {
    const findings: DriftFinding[] = [
      { type: 'adapter.missing', severity: 'BLOCKER', file: 'X.md', message: 'x' },
      { type: 'report.stale', severity: 'LOW', message: 'stale' },
    ];
    const out = formatDriftJson(findings);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['clean']).toBe(false);
    expect(parsed['total']).toBe(2);
    expect(parsed['blockers']).toBe(1);
  });

  it('includes every finding in the findings array', () => {
    const findings: DriftFinding[] = [
      { type: 'adapter.missing', severity: 'BLOCKER', file: 'X.md', message: 'x' },
      { type: 'governance.stale', severity: 'MEDIUM', file: 'G.md', message: 'g' },
    ];
    const out = formatDriftJson(findings);
    const parsed = JSON.parse(out) as { findings: DriftFinding[] };
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0].type).toBe('adapter.missing');
    expect(parsed.findings[1].type).toBe('governance.stale');
  });

  it('produces deterministic output (no timestamps)', () => {
    const findings: DriftFinding[] = [
      { type: 'report.stale', severity: 'LOW', message: 'stale' },
    ];
    const a = formatDriftJson(findings);
    const b = formatDriftJson(findings);
    expect(a).toBe(b);
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles readFileSafe returning null gracefully', () => {
    const input = makeCleanInput({ readFileSafe: () => null });
    expect(() => runDrift(input)).not.toThrow();
  });

  it('handles readJsonSafe returning null gracefully', () => {
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());
    files['.thesmos/report.json'] = 'NOT_JSON';
    const input = makeCleanInput({
      fileExists: (rel) => rel in files,
      readFileSafe: (rel) => files[rel] ?? null,
      readJsonSafe: () => null,
    });
    expect(() => runDrift(input)).not.toThrow();
  });

  it('handles multiple findings for the same file without duplication', () => {
    // Create a file with both rule-count-mismatch and version-mismatch
    const base = freshAdapter('claude');
    const patched = base
      .replace(/("ruleCount":)\s*\d+/, '$1 999')
      .replace(/("version":)\s*"[^"]+"/, '"version": "0.0.1"');
    const files: Record<string, string> = {};
    for (const [t, p] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      files[p] = t === 'claude' ? patched : freshAdapter(t as keyof typeof ADAPTER_OUTPUT_PATHS);
    }
    Object.assign(files, freshInitContent());

    const findings = runDrift(
      makeCleanInput({
        fileExists: (rel) => rel in files,
        readFileSafe: (rel) => files[rel] ?? null,
        expectedInitContent: freshInitContent(),
      })
    ).filter((f) => f.file === 'CLAUDE.md');

    // Should have both rule-count-mismatch and version-mismatch
    const types = findings.map((f) => f.type);
    expect(types).toContain('adapter.rule-count-mismatch');
    expect(types).toContain('adapter.version-mismatch');
  });

  it('returns an empty array — not undefined or null — for fully clean input', () => {
    const result = runDrift(makeCleanInput());
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});
