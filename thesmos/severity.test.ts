// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS, loadConfig } from './config';
import { THESMOS_RULES } from './rules/registry';
import type { Finding, Severity, SeverityRule } from './types';
import {
  classifySeverity,
  shouldFail,
  shouldWarn,
  exitCodeFor,
  sortFindings,
} from './severity';

const RULES = CONFIG_DEFAULTS.severityRules;
const CONFIG = CONFIG_DEFAULTS;

function makeFinding(severity: Finding['severity'], category = 'test'): Finding {
  return { severity, category, file: 'test.ts', message: 'test' };
}

describe('classifySeverity', () => {
  it('returns LOW for direct_env_access', () => {
    expect(classifySeverity('direct_env_access', RULES)).toBe('LOW');
  });

  it('returns HIGH for missing_api_auth', () => {
    expect(classifySeverity('missing_api_auth', RULES)).toBe('HIGH');
  });

  it('returns MEDIUM as default for unknown category', () => {
    expect(classifySeverity('totally_unknown_category', RULES)).toBe('MEDIUM');
  });

  it('returns LOW for console_log', () => {
    expect(classifySeverity('console_log', RULES)).toBe('LOW');
  });

  it('returns TECH_DEBT for large_file', () => {
    expect(classifySeverity('large_file', RULES)).toBe('TECH_DEBT');
  });
});

describe('shouldFail', () => {
  it('returns true when a BLOCKER finding exists', () => {
    expect(shouldFail([makeFinding('BLOCKER')], CONFIG)).toBe(true);
  });

  it('returns false when only HIGH findings exist (not in failOnSeverity)', () => {
    expect(shouldFail([makeFinding('HIGH')], CONFIG)).toBe(false);
  });

  it('returns false for empty findings', () => {
    expect(shouldFail([], CONFIG)).toBe(false);
  });

  it('returns true when config has HIGH in failOnSeverity', () => {
    const strictConfig = { ...CONFIG, failOnSeverity: ['BLOCKER', 'HIGH'] as Severity[] };
    expect(shouldFail([makeFinding('HIGH')], strictConfig)).toBe(true);
  });
});

describe('shouldWarn', () => {
  it('returns true when HIGH exists and no BLOCKER', () => {
    expect(shouldWarn([makeFinding('HIGH')], CONFIG)).toBe(true);
  });

  it('returns false when BLOCKER exists (fail takes precedence)', () => {
    expect(shouldWarn([makeFinding('BLOCKER'), makeFinding('HIGH')], CONFIG)).toBe(false);
  });

  it('returns false when only LOW findings', () => {
    expect(shouldWarn([makeFinding('LOW')], CONFIG)).toBe(false);
  });
});

describe('exitCodeFor', () => {
  it('returns 0 for empty findings', () => {
    expect(exitCodeFor([], CONFIG)).toBe(0);
  });

  it('returns 1 for BLOCKER findings', () => {
    expect(exitCodeFor([makeFinding('BLOCKER')], CONFIG)).toBe(1);
  });

  it('returns 0 for HIGH findings (warning only)', () => {
    expect(exitCodeFor([makeFinding('HIGH')], CONFIG)).toBe(0);
  });

  it('returns 0 for TECH_DEBT findings', () => {
    expect(exitCodeFor([makeFinding('TECH_DEBT')], CONFIG)).toBe(0);
  });
});

describe('sortFindings', () => {
  it('puts BLOCKER before HIGH before MEDIUM', () => {
    const findings = [
      makeFinding('MEDIUM'),
      makeFinding('BLOCKER'),
      makeFinding('HIGH'),
    ];
    const sorted = sortFindings(findings);
    expect(sorted.map((f) => f.severity)).toEqual(['BLOCKER', 'HIGH', 'MEDIUM']);
  });

  it('is stable when run twice on same input', () => {
    const findings = [makeFinding('LOW', 'b'), makeFinding('LOW', 'a')];
    const r1 = JSON.stringify(sortFindings(findings));
    const r2 = JSON.stringify(sortFindings(findings));
    expect(r1).toBe(r2);
  });
});

// ── BLOCKER severity regression ───────────────────────────────────────────────
// This suite is the regression anchor for the silent-downgrade gap found in the
// Momus challenger audit (2026-07-11): 198 BLOCKER-declared rules were resolving
// to MEDIUM because mergeConfig replaced severityRules instead of merging.
//
// These tests use loadConfig with a partial _preloaded config — exactly the
// pattern that triggered the original gap. If the merge fix is ever reverted,
// all ~200 it.each cases below will fail.

describe('BLOCKER severity regression — mergeConfig must not downgrade', () => {
  // A minimal user config that lists only a few overrides — the same pattern
  // that silenced 198 BLOCKER rules under the old replace behavior.
  const partialUserRules: SeverityRule[] = [
    { category: 'missing_ts_extension', severity: 'LOW'    },
    { category: 'floating_promise',     severity: 'MEDIUM' },
    { category: 'sync_fs_in_handler',   severity: 'MEDIUM' },
  ];

  // loadConfig with _preloaded skips filesystem reads and the first-run ack write.
  const merged = loadConfig('/fake/root', { severityRules: partialUserRules });
  const blockerRules = THESMOS_RULES.filter((r) => r.severity === 'BLOCKER');

  it('registry contains ≥200 BLOCKER-declared rules', () => {
    expect(blockerRules.length).toBeGreaterThanOrEqual(200);
  });

  it.each(blockerRules.map((r) => [r.id, r.category] as const))(
    '[%s] %s resolves to BLOCKER after merging with partial user config',
    (_id, category) => {
      expect(classifySeverity(category, merged.severityRules)).toBe('BLOCKER');
    },
  );

  it('user overrides in partial config still win — LOW stays LOW after merge', () => {
    expect(classifySeverity('missing_ts_extension', merged.severityRules)).toBe('LOW');
  });

  it('user overrides in partial config still win — MEDIUM stays MEDIUM after merge', () => {
    expect(classifySeverity('floating_promise', merged.severityRules)).toBe('MEDIUM');
  });
});
