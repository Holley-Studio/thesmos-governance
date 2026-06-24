// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS } from './config';
import {
  PROMETHEUS_RULES,
  ADAPTER_OUTPUT_PATHS,
  buildAdapterContent,
  type Rule,
} from './adapters';
import {
  runCiCheck,
  formatCiCheckConsole,
  formatCiCheckMarkdown,
  formatCiCheckJson,
  CI_CHECK_GROUPS,
  type CiCheckInput,
} from './ci-check';
import type { ThesmosConfig } from './types';

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Pre-built fresh adapter content keyed by output path (not target name). */
const FRESH_BY_PATH: Record<string, string> = Object.fromEntries(
  Object.entries(ADAPTER_OUTPUT_PATHS).map(([target, relPath]) => [
    relPath,
    buildAdapterContent(target as keyof typeof ADAPTER_OUTPUT_PATHS, '', PROMETHEUS_RULES, CONFIG_DEFAULTS),
  ])
);

/** All CI files and adapters present, all adapters fresh, config valid. */
function makeFullInput(overrides: Partial<CiCheckInput> = {}): CiCheckInput {
  const allFiles = new Set<string>([
    '.thesmos/README.md',
    '.thesmos/config.json',
    '.thesmos/GUARDRAILS.md',
    '.thesmos/governance/CODE_REVIEW.md',
    '.thesmos/governance/REVIEW_AGENT.md',
    '.thesmos/report.json',
    '.github/workflows/thesmos-review.yml',
    ...Object.values(ADAPTER_OUTPUT_PATHS),
  ]);

  return {
    config: CONFIG_DEFAULTS,
    rules: PROMETHEUS_RULES,
    fileExists: (rel) => allFiles.has(rel),
    readFileSafe: (rel) => FRESH_BY_PATH[rel] ?? null,
    readJsonSafe: (rel) => {
      if (rel === '.thesmos/config.json') return { name: 'Test', version: '2.0.0' };
      return null;
    },
    ...overrides,
  };
}

/** Nothing exists, nothing is readable. */
function makeEmptyInput(configOverride?: Partial<ThesmosConfig>): CiCheckInput {
  return {
    config: { ...CONFIG_DEFAULTS, ...configOverride },
    rules: PROMETHEUS_RULES,
    fileExists: () => false,
    readFileSafe: () => null,
    readJsonSafe: () => null,
  };
}

// ── runCiCheck — all passing ──────────────────────────────────────────────────

describe('runCiCheck — all passing', () => {
  it('returns no failed checks when repo is fully configured and fresh', () => {
    const checks = runCiCheck(makeFullInput());
    expect(checks.filter((c) => !c.pass)).toHaveLength(0);
  });

  it('returns checks in all three groups', () => {
    const checks = runCiCheck(makeFullInput());
    const groups = new Set(checks.map((c) => c.group));
    expect(groups).toContain(CI_CHECK_GROUPS.CI_FILES);
    expect(groups).toContain(CI_CHECK_GROUPS.ADAPTERS);
    expect(groups).toContain(CI_CHECK_GROUPS.CONFIG);
  });

  it('includes a check for the GitHub workflow file', () => {
    const checks = runCiCheck(makeFullInput());
    const wf = checks.find((c) => c.name.includes('thesmos-review.yml'));
    expect(wf).toBeDefined();
    expect(wf!.pass).toBe(true);
  });

  it('includes freshness checks for all six adapters', () => {
    const checks = runCiCheck(makeFullInput());
    const freshChecks = checks.filter((c) => c.name.endsWith(':fresh'));
    expect(freshChecks).toHaveLength(Object.keys(ADAPTER_OUTPUT_PATHS).length);
    expect(freshChecks.every((c) => c.pass)).toBe(true);
  });

  it('includes marker checks for all six adapters', () => {
    const checks = runCiCheck(makeFullInput());
    const markerChecks = checks.filter((c) => c.name.endsWith(':markers'));
    expect(markerChecks).toHaveLength(Object.keys(ADAPTER_OUTPUT_PATHS).length);
    expect(markerChecks.every((c) => c.pass)).toBe(true);
  });

  it('config check passes when config.json is valid', () => {
    const checks = runCiCheck(makeFullInput());
    const cfg = checks.find((c) => c.name === 'config:valid');
    expect(cfg?.pass).toBe(true);
  });
});

// ── runCiCheck — missing CI files ────────────────────────────────────────────

describe('runCiCheck — missing files', () => {
  it('fails when .thesmos/README.md is missing', () => {
    const input = makeFullInput({
      fileExists: (rel) => rel !== '.thesmos/README.md',
    });
    const checks = runCiCheck(input);
    const check = checks.find((c) => c.name === '.thesmos/README.md');
    expect(check?.pass).toBe(false);
    expect(check?.fixHint).toContain('thesmos init');
  });

  it('fails when GitHub workflow is missing', () => {
    const input = makeFullInput({
      fileExists: (rel) => rel !== '.github/workflows/thesmos-review.yml',
    });
    const checks = runCiCheck(input);
    const wf = checks.find((c) => c.name.includes('thesmos-review.yml'));
    expect(wf?.pass).toBe(false);
    expect(wf?.fixHint).toContain('thesmos init');
  });

  it('uses config.github.workflow path when specified', () => {
    const config: ThesmosConfig = {
      ...CONFIG_DEFAULTS,
      github: { workflow: '.github/workflows/custom-thesmos.yml' },
    };
    const allFiles = new Set([
      ...Object.values(ADAPTER_OUTPUT_PATHS),
      '.thesmos/README.md',
      '.thesmos/config.json',
      '.thesmos/GUARDRAILS.md',
      '.thesmos/governance/CODE_REVIEW.md',
      '.thesmos/governance/REVIEW_AGENT.md',
      '.thesmos/report.json',
      '.github/workflows/custom-thesmos.yml',
    ]);
    const checks = runCiCheck(makeFullInput({ config, fileExists: (rel) => allFiles.has(rel) }));
    const wf = checks.find((c) => c.name.includes('custom-thesmos.yml'));
    expect(wf?.pass).toBe(true);
  });

  it('fails when an adapter file is missing', () => {
    const input = makeFullInput({
      fileExists: (rel) => rel !== ADAPTER_OUTPUT_PATHS.gemini,
    });
    const checks = runCiCheck(input);
    const existsCheck = checks.find((c) => c.name === 'adapter:gemini:exists');
    expect(existsCheck?.pass).toBe(false);
    expect(existsCheck?.fixHint).toContain('thesmos adapters');
  });

  it('does not emit freshness/marker checks for a missing adapter', () => {
    const input = makeFullInput({
      fileExists: (rel) => rel !== ADAPTER_OUTPUT_PATHS.claude,
    });
    const checks = runCiCheck(input);
    expect(checks.some((c) => c.name === 'adapter:claude:fresh')).toBe(false);
    expect(checks.some((c) => c.name === 'adapter:claude:markers')).toBe(false);
  });
});

// ── runCiCheck — stale adapters ───────────────────────────────────────────────

describe('runCiCheck — stale adapters', () => {
  it('fails freshness check when adapter has no metadata (old format)', () => {
    const staleContent = '# Old adapter\n\nSome content without meta comment.\n<!-- PROMETHEUS:GENERATED START rules -->\nrules\n<!-- PROMETHEUS:GENERATED END rules -->';
    const input = makeFullInput({
      readFileSafe: (rel) =>
        rel === ADAPTER_OUTPUT_PATHS.claude ? staleContent : (FRESH_BY_PATH[rel] ?? null),
    });
    const checks = runCiCheck(input);
    const freshCheck = checks.find((c) => c.name === 'adapter:claude:fresh');
    expect(freshCheck?.pass).toBe(false);
    expect(freshCheck?.message).toContain('no metadata');
  });

  it('fails freshness check when ruleCount is wrong', () => {
    // Build adapter with a subset of rules so ruleCount < PROMETHEUS_RULES.length
    const staleContent = buildAdapterContent('gemini', '', PROMETHEUS_RULES.slice(0, 5), CONFIG_DEFAULTS);
    const input = makeFullInput({
      readFileSafe: (rel) =>
        rel === ADAPTER_OUTPUT_PATHS.gemini ? staleContent : null,
    });
    const checks = runCiCheck(input);
    const freshCheck = checks.find((c) => c.name === 'adapter:gemini:fresh');
    expect(freshCheck?.pass).toBe(false);
    expect(freshCheck?.message).toContain('rule count mismatch');
  });

  it('fails freshness check when version is wrong', () => {
    const oldConfig: ThesmosConfig = { ...CONFIG_DEFAULTS, version: '1.0.0' };
    const staleContent = buildAdapterContent('cursor', '', PROMETHEUS_RULES, oldConfig);
    const input = makeFullInput({
      readFileSafe: (rel) =>
        rel === ADAPTER_OUTPUT_PATHS.cursor ? staleContent : (FRESH_BY_PATH[rel] ?? null),
    });
    const checks = runCiCheck(input);
    const freshCheck = checks.find((c) => c.name === 'adapter:cursor:fresh');
    expect(freshCheck?.pass).toBe(false);
    expect(freshCheck?.message).toContain('version mismatch');
  });

  it('fails marker check when PROMETHEUS:GENERATED markers are stripped', () => {
    const stripped = (FRESH_BY_PATH[ADAPTER_OUTPUT_PATHS.agents] ?? '').replace(/<!-- PROMETHEUS:GENERATED[^>]+-->/g, '');
    const input = makeFullInput({
      readFileSafe: (rel) =>
        rel === ADAPTER_OUTPUT_PATHS.agents ? stripped : (FRESH_BY_PATH[rel] ?? null),
    });
    const checks = runCiCheck(input);
    const markerCheck = checks.find((c) => c.name === 'adapter:agents:markers');
    expect(markerCheck?.pass).toBe(false);
    expect(markerCheck?.fixHint).toContain('thesmos adapters');
  });

  it('fresh adapter with one extra rule added to registry fails freshness', () => {
    // Simulate running ci-check after adding a new rule without refreshing adapters
    const extraRule: Rule = {
      id: 'EXTRA_001',
      category: 'extra_test',
      description: 'Extra rule for drift test.',
      severity: 'LOW',
      tags: ['test'],
    };
    const expandedRules = [...PROMETHEUS_RULES, extraRule];
    const input = makeFullInput({ rules: expandedRules });
    // Adapter files were built with PROMETHEUS_RULES (12 rules), but ci-check sees 13
    const freshChecks = runCiCheck(input).filter((c) => c.name.endsWith(':fresh'));
    expect(freshChecks.every((c) => !c.pass)).toBe(true);
    expect(freshChecks[0].message).toContain('rule count mismatch');
  });
});

// ── runCiCheck — config validation ────────────────────────────────────────────

describe('runCiCheck — config validation', () => {
  it('fails when config.json cannot be parsed', () => {
    const input = makeFullInput({ readJsonSafe: () => null });
    const check = runCiCheck(input).find((c) => c.name === 'config:valid');
    expect(check?.pass).toBe(false);
  });

  it('fails when config.json is missing required fields', () => {
    const input = makeFullInput({
      readJsonSafe: (rel) =>
        rel === '.thesmos/config.json' ? { project: 'only-project' } : null,
    });
    const check = runCiCheck(input).find((c) => c.name === 'config:valid');
    expect(check?.pass).toBe(false);
    expect(check?.message).toContain('missing required fields');
  });

  it('passes when config.json has name and version', () => {
    const input = makeFullInput({
      readJsonSafe: (rel) =>
        rel === '.thesmos/config.json'
          ? { name: 'MyProject', version: '2.0.0' }
          : null,
    });
    const check = runCiCheck(input).find((c) => c.name === 'config:valid');
    expect(check?.pass).toBe(true);
  });
});

// ── Formatters ────────────────────────────────────────────────────────────────

describe('formatCiCheckConsole', () => {
  it('includes project name in header', () => {
    const checks = runCiCheck(makeFullInput());
    const out = formatCiCheckConsole(checks, 'My Project');
    expect(out).toContain('My Project');
  });

  it('includes "CI Check" in header (not "Doctor")', () => {
    const checks = runCiCheck(makeFullInput());
    const out = formatCiCheckConsole(checks, 'Test');
    expect(out).toContain('CI Check');
    expect(out).not.toContain('Thesmos Doctor');
  });

  it('shows all passed when everything is fresh', () => {
    const checks = runCiCheck(makeFullInput());
    const out = formatCiCheckConsole(checks, 'Test');
    expect(out).toContain('all passed');
  });

  it('shows failed count when checks fail', () => {
    const checks = runCiCheck(makeEmptyInput());
    const out = formatCiCheckConsole(checks, 'Test');
    expect(out).toMatch(/\d+ failed/);
  });

  it('shows fix hints for failed checks', () => {
    const checks = runCiCheck(makeEmptyInput());
    const out = formatCiCheckConsole(checks, 'Test');
    expect(out).toContain('thesmos init');
  });
});

describe('formatCiCheckMarkdown', () => {
  it('includes project name', () => {
    const checks = runCiCheck(makeFullInput());
    const out = formatCiCheckMarkdown(checks, 'My Project');
    expect(out).toContain('My Project');
  });

  it('uses markdown table format', () => {
    const checks = runCiCheck(makeFullInput());
    const out = formatCiCheckMarkdown(checks, 'Test');
    expect(out).toContain('| Status |');
  });

  it('includes CI Check in heading (not Doctor)', () => {
    const checks = runCiCheck(makeFullInput());
    const out = formatCiCheckMarkdown(checks, 'Test');
    expect(out).toContain('CI Check');
    expect(out).not.toContain('Thesmos Doctor');
  });
});

describe('formatCiCheckJson', () => {
  it('returns valid JSON', () => {
    const checks = runCiCheck(makeFullInput());
    const out = formatCiCheckJson(checks);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('includes pass, total, passed, failed fields', () => {
    const checks = runCiCheck(makeFullInput());
    const parsed = JSON.parse(formatCiCheckJson(checks)) as Record<string, unknown>;
    expect(typeof parsed.pass).toBe('boolean');
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.passed).toBe('number');
    expect(typeof parsed.failed).toBe('number');
  });

  it('pass is true when all checks pass', () => {
    const checks = runCiCheck(makeFullInput());
    const parsed = JSON.parse(formatCiCheckJson(checks)) as Record<string, unknown>;
    expect(parsed.pass).toBe(true);
  });

  it('pass is false when any check fails', () => {
    const checks = runCiCheck(makeEmptyInput());
    const parsed = JSON.parse(formatCiCheckJson(checks)) as Record<string, unknown>;
    expect(parsed.pass).toBe(false);
  });
});
