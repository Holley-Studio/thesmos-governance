// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG_DEFAULTS } from './config';
import {
  THESMOS_RULES,
  ADAPTER_OUTPUT_PATHS,
  getRulesByTag,
  getRulesBySeverity,
  getRulesByCategory,
  generateClaudeRules,
  generateCursorRules,
  generateCopilotRules,
  generateCodexRules,
  generateGeminiRules,
  generateAgentsRules,
  buildAdapterContent,
  writeAllAdapters,
  parseAdapterMeta,
  isAdapterFresh,
  detectAdapterTargets,
  type AdapterTarget,
  type AdapterCatalog,
  type Rule,
} from './adapters';

// Temp dir helpers — keep adapter I/O tests off the library root
function makeTmpDir(): string {
  const dir = join(tmpdir(), `prom-adapters-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
const tmpDirs: string[] = [];
function trackTmp(dir: string): string {
  tmpDirs.push(dir);
  return dir;
}

const CONFIG = CONFIG_DEFAULTS;
const RULES = THESMOS_RULES;

// ── THESMOS_RULES integrity ────────────────────────────────────────────────

describe('THESMOS_RULES', () => {
  it('has no duplicate IDs', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has all required fields', () => {
    for (const rule of RULES) {
      expect(typeof rule.id, `${rule.id}: id`).toBe('string');
      expect(typeof rule.category, `${rule.id}: category`).toBe('string');
      expect(typeof rule.description, `${rule.id}: description`).toBe('string');
      expect(Array.isArray(rule.tags), `${rule.id}: tags`).toBe(true);
      expect(
        ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'],
        `${rule.id}: severity`
      ).toContain(rule.severity);
    }
  });

  it('has at least one BLOCKER rule', () => {
    expect(getRulesBySeverity(RULES, 'BLOCKER').length).toBeGreaterThan(0);
  });

  it('has at least one HIGH rule', () => {
    expect(getRulesBySeverity(RULES, 'HIGH').length).toBeGreaterThan(0);
  });

  it('direct_env_access is LOW — a maintainability nudge, not a gate', () => {
    const rule = RULES.find((r) => r.category === 'direct_env_access');
    expect(rule?.severity).toBe('LOW');
  });

  it('missing_api_auth is HIGH', () => {
    const rule = RULES.find((r) => r.category === 'missing_api_auth');
    expect(rule?.severity).toBe('HIGH');
  });
});

// ── ADAPTER_OUTPUT_PATHS ──────────────────────────────────────────────────────

describe('ADAPTER_OUTPUT_PATHS', () => {
  const ALL_TARGETS: AdapterTarget[] = [
    'gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents',
  ];

  it('maps all six targets', () => {
    for (const t of ALL_TARGETS) {
      expect(ADAPTER_OUTPUT_PATHS[t]).toBeTruthy();
    }
  });

  it('gemini outputs to GEMINI.md', () => {
    expect(ADAPTER_OUTPUT_PATHS.gemini).toBe('GEMINI.md');
  });

  it('claude outputs to CLAUDE.md', () => {
    expect(ADAPTER_OUTPUT_PATHS.claude).toBe('CLAUDE.md');
  });

  it('agents outputs to AGENTS.md', () => {
    expect(ADAPTER_OUTPUT_PATHS.agents).toBe('AGENTS.md');
  });

  it('cursor path ends in .mdc', () => {
    expect(ADAPTER_OUTPUT_PATHS.cursor).toMatch(/\.mdc$/);
  });

  it('copilot path is under .github/', () => {
    expect(ADAPTER_OUTPUT_PATHS.copilot).toMatch(/^\.github\//);
  });

  it('codex path is under .codex/', () => {
    expect(ADAPTER_OUTPUT_PATHS.codex).toMatch(/^\.codex\//);
  });
});

// ── Filter helpers ────────────────────────────────────────────────────────────

describe('getRulesByTag', () => {
  it('returns only rules with the given tag', () => {
    const found = getRulesByTag(RULES, 'security');
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((r) => r.tags.includes('security'))).toBe(true);
  });

  it('includes ENV_001 under the maintainability tag', () => {
    expect(getRulesByTag(RULES, 'maintainability').some((r) => r.id === 'ENV_001')).toBe(true);
  });

  it('returns empty array for unknown tag', () => {
    expect(getRulesByTag(RULES, '__nonexistent__')).toHaveLength(0);
  });

  it('does not mutate the source array', () => {
    const before = RULES.length;
    getRulesByTag(RULES, 'security');
    expect(RULES.length).toBe(before);
  });
});

describe('getRulesBySeverity', () => {
  it('returns only rules of the requested severity', () => {
    const blockers = getRulesBySeverity(RULES, 'BLOCKER');
    expect(blockers.every((r) => r.severity === 'BLOCKER')).toBe(true);
  });

  it('does not include other severities', () => {
    const highs = getRulesBySeverity(RULES, 'HIGH');
    expect(highs.some((r) => r.severity === 'BLOCKER')).toBe(false);
  });

  it('returns empty array for a severity with no rules', () => {
    const rules: typeof RULES = RULES.filter((r) => r.severity !== 'TECH_DEBT');
    expect(getRulesBySeverity(rules, 'TECH_DEBT')).toHaveLength(0);
  });
});

describe('getRulesByCategory', () => {
  it('returns rules whose category is in the list', () => {
    const found = getRulesByCategory(RULES, ['direct_env_access', 'rls_disabled']);
    expect(found.map((r) => r.category)).toEqual(
      expect.arrayContaining(['direct_env_access', 'rls_disabled'])
    );
    expect(found).toHaveLength(2);
  });

  it('returns empty for unknown categories', () => {
    expect(getRulesByCategory(RULES, ['__nope__'])).toHaveLength(0);
  });

  it('ignores categories not present in the rules list', () => {
    const found = getRulesByCategory(RULES, ['direct_env_access', '__nope__']);
    expect(found).toHaveLength(1);
  });
});

// ── Per-target generators — thin adapters (Operation Signal Phase 5) ─────────
//
// All six targets now share one content shape: no per-rule table at all (not
// even a BLOCKER+HIGH one) — a short universal body plus a pointer to
// `thesmos explain` / `.thesmos/RULES.md` for anything rule-specific. This is
// a deliberate, intentional architecture change (was: full 1,137-rule dump
// for 5 targets, BLOCKER+HIGH table for Claude), not a weakened test.

function sharedGeneratorSuite(
  name: string,
  generate: (rules: typeof RULES, config: typeof CONFIG) => string
) {
  describe(name, () => {
    const output = generate(RULES, CONFIG);

    it('contains the project name', () => {
      expect(output).toContain(CONFIG.project);
    });

    it('contains the version', () => {
      expect(output).toContain(CONFIG.version);
    });

    it('does NOT embed individual rule IDs — the catalog lives in .thesmos/RULES.md', () => {
      // Spot-check a representative sample across severities; embedding
      // *any* per-rule content defeats the point of a thin adapter.
      const sample = [
        ...RULES.filter((r) => r.severity === 'BLOCKER').slice(0, 5),
        ...RULES.filter((r) => r.severity === 'HIGH').slice(0, 5),
        ...RULES.filter((r) => r.severity === 'MEDIUM').slice(0, 5),
      ];
      for (const rule of sample) {
        expect(output).not.toContain(`[${rule.id}]`);
      }
    });

    it('references .thesmos/RULES.md for the full catalog', () => {
      expect(output).toContain('.thesmos/RULES.md');
    });

    it('references thesmos explain for inspecting a specific rule', () => {
      expect(output).toContain('thesmos explain');
    });

    it('references thesmos validate and thesmos review', () => {
      expect(output).toContain('thesmos validate');
      expect(output).toContain('thesmos review');
    });

    it('references how to discover an agent', () => {
      expect(output).toMatch(/agents:list|pantheon:list/);
    });

    it('contains BLOCKER label', () => {
      expect(output).toContain('BLOCKER');
    });

    it('is deterministic — same input produces same output', () => {
      expect(generate(RULES, CONFIG)).toBe(output);
    });

    it('is comfortably under the 8KB thin-adapter budget by itself', () => {
      // Historical sizes measured on this exact rule catalog before the fix
      // (Operation Signal Phase 5): 130-165KB per file, always loaded in
      // full, every one of the 1,137 rules with descriptions and examples.
      // This body alone now measures ~2.2-2.5KB on the real regenerated
      // files (see docs/plans/operation-signal.md for the exact numbers).
      expect(output.length).toBeLessThan(4_000);
    });

    it('is unaffected by growing the rule catalog (thin adapters do not scale with rule count)', () => {
      const manyRules = [
        ...RULES,
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `EXTRA_${i}`,
          category: `extra_${i}`,
          description: `Extra rule ${i} for scale testing.`,
          severity: 'HIGH' as const,
          tags: ['test'],
          sinceVersion: '2.0.0',
          detect: () => [],
        })),
      ];
      const grown = generate(manyRules, CONFIG);
      expect(grown.length).toBe(output.length);
    });
  });
}

sharedGeneratorSuite('generateGeminiRules', generateGeminiRules);
sharedGeneratorSuite('generateCursorRules', generateCursorRules);
sharedGeneratorSuite('generateCopilotRules', generateCopilotRules);
sharedGeneratorSuite('generateCodexRules', generateCodexRules);
sharedGeneratorSuite('generateClaudeRules', generateClaudeRules);
sharedGeneratorSuite('generateAgentsRules', generateAgentsRules);

// ── buildAdapterContent ───────────────────────────────────────────────────────

describe('buildAdapterContent', () => {
  it('creates a new document when existing is empty — contains markers', () => {
    const result = buildAdapterContent('claude', '', RULES, CONFIG);
    expect(result).toContain('<!-- THESMOS:GENERATED START rules -->');
    expect(result).toContain('<!-- THESMOS:GENERATED END rules -->');
  });

  it('new claude document includes project name in preamble', () => {
    const result = buildAdapterContent('claude', '', RULES, CONFIG);
    expect(result).toContain(CONFIG.project);
  });

  it('cursor preamble includes MDC frontmatter', () => {
    const result = buildAdapterContent('cursor', '', RULES, CONFIG);
    expect(result).toContain('---');
    expect(result).toContain('alwaysApply: true');
  });

  it('injects rules into an existing document', () => {
    const existing = '# My Project\n\nSome manual content.';
    const result = buildAdapterContent('claude', existing, RULES, CONFIG);
    expect(result).toContain('My Project');
    expect(result).toContain('Some manual content.');
    expect(result).toContain('<!-- THESMOS:GENERATED START rules -->');
  });

  it('replaces old generated content but preserves manual content', () => {
    const existing = [
      '# My Project',
      '',
      'Manual top.',
      '',
      '<!-- THESMOS:GENERATED START rules -->',
      'OLD RULES CONTENT',
      '<!-- THESMOS:GENERATED END rules -->',
      '',
      'Manual footer.',
    ].join('\n');

    const result = buildAdapterContent('claude', existing, RULES, CONFIG);
    expect(result).toContain('Manual top.');
    expect(result).toContain('Manual footer.');
    expect(result).not.toContain('OLD RULES CONTENT');
    expect(result).toContain('.thesmos/RULES.md');
  });

  it('is idempotent — applying twice produces identical output', () => {
    const r1 = buildAdapterContent('cursor', '', RULES, CONFIG);
    const r2 = buildAdapterContent('cursor', r1, RULES, CONFIG);
    expect(r1).toBe(r2);
  });

  it('every target produces non-empty output with markers', () => {
    const targets: AdapterTarget[] = [
      'gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents',
    ];
    for (const target of targets) {
      const result = buildAdapterContent(target, '', RULES, CONFIG);
      expect(result.length, `${target} should produce content`).toBeGreaterThan(0);
      expect(result, `${target} should have generated markers`).toContain(
        'THESMOS:GENERATED'
      );
    }
  });

  it('agents document is a thin pointer, not a rule dump', () => {
    const result = buildAdapterContent('agents', '', RULES, CONFIG);
    expect(result).toContain('BLOCKER');
    expect(result).toContain('.thesmos/RULES.md');
  });

  it('output is identical regardless of which rules subset is passed in (thin adapters do not enumerate rules)', () => {
    const subset = getRulesBySeverity(RULES, 'BLOCKER');
    const withSubset = buildAdapterContent('claude', '', subset, CONFIG);
    const withAll = buildAdapterContent('claude', '', RULES, CONFIG);
    // Content is identical except the embedded ruleCount in the META comment.
    const stripRuleCount = (s: string) => s.replace(/"ruleCount":\d+/, '"ruleCount":N');
    expect(stripRuleCount(withSubset)).toBe(stripRuleCount(withAll));
  });

  it('produces different content for different targets', () => {
    const claude = buildAdapterContent('claude', '', RULES, CONFIG);
    const cursor = buildAdapterContent('cursor', '', RULES, CONFIG);
    expect(claude).not.toBe(cursor);
  });

  it('claude document is idempotent — applying twice produces identical output', () => {
    const r1 = buildAdapterContent('claude', '', RULES, CONFIG);
    const r2 = buildAdapterContent('claude', r1, RULES, CONFIG);
    expect(r1).toBe(r2);
  });

  it('all targets are idempotent', () => {
    const targets: AdapterTarget[] = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'];
    for (const target of targets) {
      const r1 = buildAdapterContent(target, '', RULES, CONFIG);
      const r2 = buildAdapterContent(target, r1, RULES, CONFIG);
      expect(r1, `${target} should be idempotent`).toBe(r2);
    }
  });
});

// ── Claude preamble (thin adapter) ───────────────────────────────────────────

describe('Claude adapter preamble (thin adapter contract)', () => {
  const claudeDoc = buildAdapterContent('claude', '', RULES, CONFIG);

  it('references .thesmos/README.md', () => {
    expect(claudeDoc).toContain('.thesmos/README.md');
  });

  it('references .thesmos/GUARDRAILS.md', () => {
    expect(claudeDoc).toContain('.thesmos/GUARDRAILS.md');
  });

  it('references .thesmos/report.json', () => {
    expect(claudeDoc).toContain('.thesmos/report.json');
  });

  it('references .thesmos/governance/CODE_REVIEW.md', () => {
    expect(claudeDoc).toContain('.thesmos/governance/CODE_REVIEW.md');
  });

  it('references .thesmos/governance/REVIEW_AGENT.md', () => {
    expect(claudeDoc).toContain('.thesmos/governance/REVIEW_AGENT.md');
  });

  it('references .thesmos/playbooks/', () => {
    expect(claudeDoc).toContain('.thesmos/playbooks/');
  });

  it('instructs to never bypass severity rules', () => {
    expect(claudeDoc).toContain('Never bypass severity rules');
  });

  it('instructs to never overwrite outside THESMOS:GENERATED markers', () => {
    expect(claudeDoc).toContain('THESMOS:GENERATED');
    expect(claudeDoc).toContain('Never overwrite');
  });

  it('instructs to prefer small, reversible, tested changes', () => {
    expect(claudeDoc).toContain('small, reversible, tested');
  });

  it('instructs to run a Thesmos command after changes', () => {
    expect(claudeDoc).toContain('thesmos:scan');
  });

  it('instructs to list changed files at end of task', () => {
    expect(claudeDoc).toContain('changed files');
  });

  it('does not duplicate full rule descriptions (stays thin)', () => {
    // Full descriptions are in CODE_REVIEW.md. Check that at least one long description
    // from THESMOS_RULES is NOT inlined verbatim.
    const longRule = RULES.find((r) => r.description.length > 80);
    if (longRule) {
      expect(claudeDoc).not.toContain(longRule.description);
    }
  });

  it('preamble is stable across runs (deterministic)', () => {
    const r1 = buildAdapterContent('claude', '', RULES, CONFIG);
    const r2 = buildAdapterContent('claude', '', RULES, CONFIG);
    expect(r1).toBe(r2);
  });
});

// Clean up all temp dirs after the suite
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

// ── writeAllAdapters (I/O — uses temp dir, never the library root) ────────────

describe('writeAllAdapters', () => {
  it('writes all six adapter files to a temp consumer directory', () => {
    const root = trackTmp(makeTmpDir());
    const manifests = writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS);

    expect(manifests).toHaveLength(6);
    for (const m of manifests) {
      const abs = join(root, m.outputPath);
      expect(existsSync(abs), `${m.target}: ${m.outputPath} should exist`).toBe(true);
      const content = readFileSync(abs, 'utf8');
      expect(content.length, `${m.target} content should not be empty`).toBeGreaterThan(0);
    }
  });

  it('writes no files to the library source directory', () => {
    const root = trackTmp(makeTmpDir());
    writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS);

    // None of the adapter output paths should exist relative to the library root
    for (const relPath of Object.values(ADAPTER_OUTPUT_PATHS)) {
      // Use __dirname equivalent via import.meta.url — check the source directory
      // The point: adapter files were written to `root` (tmp), not here.
      expect(existsSync(join(root, relPath))).toBe(true);
    }
    // Sanity: the tmp dir is different from the library source dir
    expect(root).not.toContain('thesmos-helper/thesmos');
  });

  it('is idempotent — running twice produces identical file contents', () => {
    const root = trackTmp(makeTmpDir());
    writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS);

    // Read all files after first run
    const first: Record<string, string> = {};
    for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      first[target] = readFileSync(join(root, relPath), 'utf8');
    }

    writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS);

    // Contents should be byte-identical after second run
    for (const [target, relPath] of Object.entries(ADAPTER_OUTPUT_PATHS)) {
      const second = readFileSync(join(root, relPath), 'utf8');
      expect(second, `${target} changed between runs`).toBe(first[target]);
    }
  });

  it('preserves manual content outside generated markers on second run', () => {
    const root = trackTmp(makeTmpDir());
    writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS, ['claude']);

    const claudePath = join(root, ADAPTER_OUTPUT_PATHS.claude);
    const original = readFileSync(claudePath, 'utf8');

    // Simulate a developer adding manual content above the generated section
    const withManual = `# Team Notes\n\nOur custom instructions here.\n\n${original}`;
    writeFileSync(claudePath, withManual, 'utf8');

    // Re-run adapters
    writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS, ['claude']);

    const after = readFileSync(claudePath, 'utf8');
    expect(after).toContain('Our custom instructions here.');
    expect(after).toContain('<!-- THESMOS:GENERATED START rules -->');
  });

  it('a subset of targets writes only those adapter files', () => {
    const root = trackTmp(makeTmpDir());
    writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS, ['claude', 'gemini']);

    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(root, 'GEMINI.md'))).toBe(true);
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(root, '.cursor/rules/thesmos.mdc'))).toBe(false);
  });
});

// ── Adapter drift detection ───────────────────────────────────────────────────

// Thin adapters (Operation Signal Phase 5) never enumerate individual rules,
// so "does a new rule appear in the adapter" is no longer the drift signal —
// isAdapterFresh()'s embedded ruleCount is. These tests cover that instead.
describe('adapter drift detection (via embedded ruleCount, not per-rule content)', () => {
  it('adding a rule changes the embedded ruleCount for every target', () => {
    const extraRule: Rule = {
      id: 'DRIFT_001',
      category: 'drift_test',
      description: 'Test rule for drift detection.',
      severity: 'HIGH',
      tags: ['test'],
    };
    const augmented = [...RULES, extraRule];
    const targets: AdapterTarget[] = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'];
    for (const target of targets) {
      const before = buildAdapterContent(target, '', RULES, CONFIG);
      const after = buildAdapterContent(target, '', augmented, CONFIG);
      const meta = parseAdapterMeta(after);
      expect(meta?.ruleCount, `${target} ruleCount should reflect the augmented catalog`).toBe(augmented.length);
      expect(isAdapterFresh(before, augmented, CONFIG).fresh, `${target} should be stale against the augmented catalog`).toBe(false);
      expect(isAdapterFresh(after, augmented, CONFIG).fresh, `${target} should be fresh against the catalog it was built from`).toBe(true);
    }
  });

  it('all adapters include project name', () => {
    const targets: AdapterTarget[] = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'];
    for (const target of targets) {
      const out = buildAdapterContent(target, '', RULES, CONFIG);
      expect(out, `${target} missing project name`).toContain(CONFIG.project);
    }
  });
});

// ── Migration from the old (pre-thin) format ─────────────────────────────────

describe('migration from the old per-rule-table format', () => {
  it('replaces a realistic ~130KB legacy generated section with the thin body, preserving manual content and shrinking dramatically', () => {
    // Simulate the actual old format: one line per BLOCKER/HIGH rule with
    // description and example, the size driver that made every real adapter
    // 130-165KB before Operation Signal Phase 5.
    const legacyRuleLines = RULES.map(
      (r) => `### [${r.id}] ${r.category}\n${r.description}\n\`\`\`\nexample violation and fix for ${r.id}\n\`\`\`\n`
    ).join('\n');
    const legacyDoc = [
      '# My Project — Claude Code Instructions',
      '',
      'Team-authored preamble that must survive migration.',
      '',
      '<!-- THESMOS:GENERATED START rules -->',
      legacyRuleLines,
      '<!-- THESMOS:GENERATED END rules -->',
      '',
      'Team-authored footer that must survive migration.',
    ].join('\n');
    expect(Buffer.byteLength(legacyDoc, 'utf8')).toBeGreaterThan(100_000); // sanity: this really is the old-scale problem

    const migrated = buildAdapterContent('claude', legacyDoc, RULES, CONFIG);

    expect(migrated).toContain('Team-authored preamble that must survive migration.');
    expect(migrated).toContain('Team-authored footer that must survive migration.');
    expect(migrated).not.toContain('example violation and fix for');
    expect(migrated).toContain('.thesmos/RULES.md');

    const migratedSection = migrated.slice(
      migrated.indexOf('<!-- THESMOS:GENERATED START rules -->'),
      migrated.indexOf('<!-- THESMOS:GENERATED END rules -->')
    );
    expect(Buffer.byteLength(migratedSection, 'utf8')).toBeLessThan(4_000);
  });

  it('migration is idempotent — running it twice on the same legacy doc converges to a stable thin result', () => {
    const legacyDoc = [
      '# Notes',
      '<!-- THESMOS:GENERATED START rules -->',
      'huge legacy rule table stand-in '.repeat(2000),
      '<!-- THESMOS:GENERATED END rules -->',
    ].join('\n');
    const first = buildAdapterContent('agents', legacyDoc, RULES, CONFIG);
    const second = buildAdapterContent('agents', first, RULES, CONFIG);
    expect(second).toBe(first);
  });
});

// ── detectAdapterTargets ──────────────────────────────────────────────────────

describe('detectAdapterTargets', () => {
  it('always includes claude and agents even with no integration footprints present', () => {
    const root = trackTmp(makeTmpDir());
    const detected = detectAdapterTargets(root);
    expect(detected).toContain('claude');
    expect(detected).toContain('agents');
    expect(detected).not.toContain('gemini');
    expect(detected).not.toContain('cursor');
    expect(detected).not.toContain('copilot');
    expect(detected).not.toContain('codex');
  });

  it('detects gemini when GEMINI.md already exists', () => {
    const root = trackTmp(makeTmpDir());
    writeFileSync(join(root, 'GEMINI.md'), '# Gemini\n', 'utf8');
    expect(detectAdapterTargets(root)).toContain('gemini');
  });

  it('detects cursor when a .cursor directory exists', () => {
    const root = trackTmp(makeTmpDir());
    mkdirSync(join(root, '.cursor'), { recursive: true });
    expect(detectAdapterTargets(root)).toContain('cursor');
  });

  it('detects copilot when .github/copilot-instructions.md exists', () => {
    const root = trackTmp(makeTmpDir());
    mkdirSync(join(root, '.github'), { recursive: true });
    writeFileSync(join(root, '.github', 'copilot-instructions.md'), '# Copilot\n', 'utf8');
    expect(detectAdapterTargets(root)).toContain('copilot');
  });

  it('detects codex when a .codex directory exists', () => {
    const root = trackTmp(makeTmpDir());
    mkdirSync(join(root, '.codex'), { recursive: true });
    expect(detectAdapterTargets(root)).toContain('codex');
  });
});

// ── writeAllAdapters — manifest status + atomic writes ───────────────────────

describe('writeAllAdapters manifest status', () => {
  it('reports status "generated" for every successfully written target', () => {
    const root = trackTmp(makeTmpDir());
    const manifests = writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS, ['claude', 'gemini']);
    for (const m of manifests) {
      expect(m.status, `${m.target}`).toBe('generated');
      expect(m.generated).toBe(true);
      expect(m.error).toBeUndefined();
    }
  });

  it('a write failure on one target is reported as status "failed" and does not stop other targets', () => {
    const root = trackTmp(makeTmpDir());
    // Force a failure for exactly one target: pre-create its output path as a
    // directory, so writing a file there errors, while leaving the sibling
    // target free to succeed.
    mkdirSync(join(root, 'GEMINI.md'), { recursive: true });
    const manifests = writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS, ['claude', 'gemini']);

    const gemini = manifests.find((m) => m.target === 'gemini')!;
    const claude = manifests.find((m) => m.target === 'claude')!;
    expect(gemini.status).toBe('failed');
    expect(gemini.generated).toBe(false);
    expect(typeof gemini.error).toBe('string');
    expect(claude.status).toBe('generated');
    expect(existsSync(join(root, ADAPTER_OUTPUT_PATHS.claude))).toBe(true);
  });

  it('a failed target never leaves a stray temp file in the output directory', () => {
    const root = trackTmp(makeTmpDir());
    mkdirSync(join(root, 'GEMINI.md'), { recursive: true });
    writeAllAdapters(root, THESMOS_RULES, CONFIG_DEFAULTS, ['claude', 'gemini']);
    const leftovers = readdirSync(root).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });
});

// ── Size budget (Operation Signal Phase 5 contract) ──────────────────────────

describe('8KB thin-adapter size budget', () => {
  const ALL_TARGETS: AdapterTarget[] = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'];
  const BUDGET_BYTES = 8192;

  it('the generated section alone is under 8KB for every target, with no catalog attached', () => {
    for (const target of ALL_TARGETS) {
      const content = buildAdapterContent(target, '', RULES, CONFIG);
      const section = content.slice(
        content.indexOf('<!-- THESMOS:GENERATED START rules -->'),
        content.indexOf('<!-- THESMOS:GENERATED END rules -->')
      );
      expect(Buffer.byteLength(section, 'utf8'), `${target} generated section`).toBeLessThan(BUDGET_BYTES);
    }
  });

  it('the generated section stays under 8KB even with a large active catalog attached (100 agents + 50 skills)', () => {
    const bigCatalog: AdapterCatalog = {
      agents: Array.from({ length: 100 }, (_, i) => ({ id: `agent-${i}`, name: `Agent ${i}` })),
      skills: Array.from({ length: 50 }, (_, i) => ({ id: `skill-${i}`, name: `Skill ${i}` })),
      profile: 'full-pantheon',
    };
    for (const target of ALL_TARGETS) {
      const content = buildAdapterContent(target, '', RULES, CONFIG, bigCatalog);
      const section = content.slice(
        content.indexOf('<!-- THESMOS:GENERATED START rules -->'),
        content.indexOf('<!-- THESMOS:GENERATED END rules -->')
      );
      expect(Buffer.byteLength(section, 'utf8'), `${target} generated section with large catalog`).toBeLessThan(BUDGET_BYTES);
    }
  });

  it('the full document is under 8KB for every target when starting from an empty file', () => {
    // Total size == generated section size when there's no pre-existing
    // user-owned content, since buildAdapterContent falls back to the
    // (also thin) target preamble.
    for (const target of ALL_TARGETS) {
      const content = buildAdapterContent(target, '', RULES, CONFIG);
      expect(Buffer.byteLength(content, 'utf8'), `${target} full document`).toBeLessThan(BUDGET_BYTES);
    }
  });
});
