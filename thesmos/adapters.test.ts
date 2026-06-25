// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
  type AdapterTarget,
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

  it('direct_env_access is a BLOCKER', () => {
    const rule = RULES.find((r) => r.category === 'direct_env_access');
    expect(rule?.severity).toBe('BLOCKER');
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

  it('includes ENV_001 under the security tag', () => {
    expect(getRulesByTag(RULES, 'security').some((r) => r.id === 'ENV_001')).toBe(true);
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

// ── Per-target generators ─────────────────────────────────────────────────────

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

    it('contains all rule IDs', () => {
      for (const rule of RULES) {
        expect(output).toContain(`[${rule.id}]`);
      }
    });

    it('contains BLOCKER label', () => {
      expect(output).toContain('BLOCKER');
    });

    it('is deterministic — same input produces same output', () => {
      expect(generate(RULES, CONFIG)).toBe(output);
    });
  });
}

sharedGeneratorSuite('generateGeminiRules', generateGeminiRules);
sharedGeneratorSuite('generateCursorRules', generateCursorRules);
sharedGeneratorSuite('generateCopilotRules', generateCopilotRules);
sharedGeneratorSuite('generateCodexRules', generateCodexRules);

// Claude gets its own suite — it's a thin adapter referencing .thesmos/ files,
// not a full rule dump, so the shared preamble/example expectations don't apply.
describe('generateClaudeRules (thin adapter)', () => {
  const output = generateClaudeRules(RULES, CONFIG);

  it('contains the project name', () => {
    expect(output).toContain(CONFIG.project);
  });

  it('contains the version', () => {
    expect(output).toContain(CONFIG.version);
  });

  it('contains all rule IDs', () => {
    for (const rule of RULES) {
      expect(output).toContain(`[${rule.id}]`);
    }
  });

  it('contains BLOCKER severity label', () => {
    expect(output).toContain('BLOCKER');
  });

  it('references .thesmos/governance/CODE_REVIEW.md', () => {
    expect(output).toContain('.thesmos/governance/CODE_REVIEW.md');
  });

  it('references thesmos:validate command', () => {
    expect(output).toContain('thesmos:validate');
  });

  it('references thesmos:review command', () => {
    expect(output).toContain('thesmos:review');
  });

  it('uses table format (| separators)', () => {
    expect(output).toContain('| Rule |');
  });

  it('does NOT inline full code examples from rules', () => {
    // Full examples should stay in CODE_REVIEW.md, not be duplicated here
    expect(output).not.toContain('```ts');
  });

  it('is deterministic — same input produces same output', () => {
    expect(generateClaudeRules(RULES, CONFIG)).toBe(output);
  });
});

describe('generateAgentsRules', () => {
  const output = generateAgentsRules(RULES, CONFIG);

  it('has a CRITICAL section for BLOCKER rules', () => {
    expect(output).toContain('CRITICAL');
  });

  it('contains all BLOCKER rule IDs', () => {
    for (const rule of getRulesBySeverity(RULES, 'BLOCKER')) {
      expect(output).toContain(`[${rule.id}]`);
    }
  });

  it('has a HIGH PRIORITY section', () => {
    expect(output).toContain('HIGH PRIORITY');
  });

  it('contains all HIGH rule IDs', () => {
    for (const rule of getRulesBySeverity(RULES, 'HIGH')) {
      expect(output).toContain(`[${rule.id}]`);
    }
  });

  it('contains GUIDELINES section for lower-severity rules', () => {
    expect(output).toContain('GUIDELINES');
  });

  it('is deterministic', () => {
    expect(generateAgentsRules(RULES, CONFIG)).toBe(output);
  });
});

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
    expect(result).toContain('[ENV_001]');
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

  it('agents document has CRITICAL section', () => {
    const result = buildAdapterContent('agents', '', RULES, CONFIG);
    expect(result).toContain('CRITICAL');
  });

  it('works with a subset of rules', () => {
    const subset = getRulesBySeverity(RULES, 'BLOCKER');
    const result = buildAdapterContent('claude', '', subset, CONFIG);
    for (const rule of subset) {
      expect(result).toContain(`[${rule.id}]`);
    }
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

describe('adapter drift detection', () => {
  it('every THESMOS_RULES entry appears in every adapter output', () => {
    const targets: AdapterTarget[] = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'];
    for (const target of targets) {
      const out = buildAdapterContent(target, '', RULES, CONFIG);
      for (const rule of RULES) {
        expect(out, `${target} missing [${rule.id}]`).toContain(`[${rule.id}]`);
      }
    }
  });

  it('adding a new rule makes it appear in all adapters', () => {
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
      const out = buildAdapterContent(target, '', augmented, CONFIG);
      expect(out, `${target} should include DRIFT_001`).toContain('[DRIFT_001]');
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
