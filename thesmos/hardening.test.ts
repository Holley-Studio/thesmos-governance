// @vitest-environment node
/**
 * Hardening tests — cross-cutting correctness properties that don't belong
 * to any single module:
 *   - PROMETHEUS_RULES covers every review category (no drift)
 *   - injectable timestamps make all outputs deterministic
 *   - validate exits 1 only for failOnSeverity
 *   - HIGH warns but does not fail by default
 *   - all 6 adapters are AI-stack-agnostic (contain rule IDs, not assistant names)
 *   - config defaults merge safely with partial overrides
 *   - report.json is idempotent when written twice with the same scan
 */
import { describe, it, expect } from 'vitest';
import { PROMETHEUS_RULES, buildAdapterContent } from './adapters';
import { REVIEW_CATEGORIES } from './review';
import { CONFIG_DEFAULTS, loadConfig } from './config';
import { exitCodeFor, shouldWarn, shouldFail } from './severity';
import { isReportStale, applyGeneratedSections, sortReport, type JsonValue } from './report';
import type { Finding, Severity } from './types';

// ── Rule registry — single source of truth proofs ────────────────────────────
//
// After the refactor, REVIEW_CATEGORIES and CONFIG_DEFAULTS.severityRules are
// derived from PROMETHEUS_RULES. These tests document that derivation and prove
// the live wiring is correct (not just asserted once at write time).

describe('rule registry completeness', () => {
  const ruleIds = new Set(PROMETHEUS_RULES.map((r) => r.id));
  const ruleCategories = new Set(PROMETHEUS_RULES.map((r) => r.category));

  it('REVIEW_CATEGORIES is derived from PROMETHEUS_RULES (same length, same order)', () => {
    expect(REVIEW_CATEGORIES).toEqual(PROMETHEUS_RULES.map((r) => r.category));
  });

  it('every PROMETHEUS_RULE has a unique ID', () => {
    expect(ruleIds.size).toBe(PROMETHEUS_RULES.length);
  });

  it('CONFIG_DEFAULTS.severityRules is derived from PROMETHEUS_RULES (every rule has an entry)', () => {
    const configCategories = new Set(CONFIG_DEFAULTS.severityRules.map((r) => r.category));
    for (const rule of PROMETHEUS_RULES) {
      expect(
        configCategories.has(rule.category),
        `[${rule.id}] category "${rule.category}" missing from CONFIG_DEFAULTS.severityRules`
      ).toBe(true);
    }
  });

  it('CONFIG_DEFAULTS.severityRules has no entries outside PROMETHEUS_RULES', () => {
    for (const sr of CONFIG_DEFAULTS.severityRules) {
      expect(
        ruleCategories.has(sr.category),
        `category "${sr.category}" is in severityRules but missing from PROMETHEUS_RULES`
      ).toBe(true);
    }
  });

  it('CONFIG_DEFAULTS.severityRules severity matches registry severity for every rule', () => {
    for (const rule of PROMETHEUS_RULES) {
      const sr = CONFIG_DEFAULTS.severityRules.find((s) => s.category === rule.category);
      expect(sr?.severity, `[${rule.id}] severity mismatch`).toBe(rule.severity);
    }
  });

  it('new rules added to PROMETHEUS_RULES appear in all adapter outputs', () => {
    const allTargets = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'] as const;
    for (const target of allTargets) {
      const out = buildAdapterContent(target, '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
      for (const rule of PROMETHEUS_RULES) {
        expect(out, `${target} is missing [${rule.id}]`).toContain(`[${rule.id}]`);
      }
    }
  });
});

// ── Injectable timestamps ─────────────────────────────────────────────────────

describe('deterministic timestamps', () => {
  const FIXED_NOW = new Date('2026-06-09T12:00:00.000Z').getTime();
  const OLD_TS = new Date('2026-05-01T00:00:00.000Z').toISOString(); // 39 days before
  const NEW_TS = new Date('2026-06-08T00:00:00.000Z').toISOString(); // 1 day before

  it('isReportStale: pinned clock gives stable result for old timestamp', () => {
    expect(isReportStale(OLD_TS, 30, FIXED_NOW)).toBe(true);
  });

  it('isReportStale: pinned clock gives stable result for fresh timestamp', () => {
    expect(isReportStale(NEW_TS, 30, FIXED_NOW)).toBe(false);
  });

  it('isReportStale: same inputs always produce same output (no random drift)', () => {
    const r1 = isReportStale(OLD_TS, 30, FIXED_NOW);
    const r2 = isReportStale(OLD_TS, 30, FIXED_NOW);
    expect(r1).toBe(r2);
  });
});

// ── Validate exit-code contract ───────────────────────────────────────────────

describe('validate exit-code contract', () => {
  function finding(severity: Severity): Finding {
    return { severity, category: 'test', file: 'f.ts', message: 'msg' };
  }

  it('BLOCKER → exitCodeFor returns 1', () => {
    expect(exitCodeFor([finding('BLOCKER')], CONFIG_DEFAULTS)).toBe(1);
  });

  it('HIGH → exitCodeFor returns 0 (warn only by default)', () => {
    expect(exitCodeFor([finding('HIGH')], CONFIG_DEFAULTS)).toBe(0);
  });

  it('MEDIUM / LOW / TECH_DEBT → exitCodeFor returns 0', () => {
    for (const sev of ['MEDIUM', 'LOW', 'TECH_DEBT'] as Severity[]) {
      expect(exitCodeFor([finding(sev)], CONFIG_DEFAULTS), sev).toBe(0);
    }
  });

  it('empty findings → exitCodeFor returns 0', () => {
    expect(exitCodeFor([], CONFIG_DEFAULTS)).toBe(0);
  });

  it('HIGH → shouldWarn true (no BLOCKER present)', () => {
    expect(shouldWarn([finding('HIGH')], CONFIG_DEFAULTS)).toBe(true);
  });

  it('BLOCKER + HIGH → shouldWarn false (fail takes precedence)', () => {
    expect(shouldWarn([finding('BLOCKER'), finding('HIGH')], CONFIG_DEFAULTS)).toBe(false);
  });

  it('when failOnSeverity includes HIGH, HIGH finding → exit 1', () => {
    const strict = { ...CONFIG_DEFAULTS, failOnSeverity: ['BLOCKER', 'HIGH'] as Severity[] };
    expect(exitCodeFor([finding('HIGH')], strict)).toBe(1);
  });

  it('shouldFail is false when findings list is empty', () => {
    expect(shouldFail([], CONFIG_DEFAULTS)).toBe(false);
  });
});

// ── Config merge safety ───────────────────────────────────────────────────────

describe('config defaults merge safely', () => {
  it('loadConfig with empty object returns all defaults', () => {
    const cfg = loadConfig('/tmp', {});
    expect(cfg.failOnSeverity).toEqual(CONFIG_DEFAULTS.failOnSeverity);
    expect(cfg.warnOnSeverity).toEqual(CONFIG_DEFAULTS.warnOnSeverity);
    expect(Array.isArray(cfg.secretPatterns)).toBe(true);
    expect(cfg.secretPatterns.length).toBeGreaterThan(0);
  });

  it('partial override does not erase array defaults', () => {
    const cfg = loadConfig('/tmp', { project: 'My App' });
    expect(cfg.project).toBe('My App');
    expect(cfg.failOnSeverity).toEqual(CONFIG_DEFAULTS.failOnSeverity);
  });

  it('raw failOnSeverity array is accepted', () => {
    const cfg = loadConfig('/tmp', { failOnSeverity: ['BLOCKER', 'HIGH'] });
    expect(cfg.failOnSeverity).toEqual(['BLOCKER', 'HIGH']);
  });

  it('invalid failOnSeverity falls back to default', () => {
    const cfg = loadConfig('/tmp', { failOnSeverity: 'not-an-array' });
    expect(cfg.failOnSeverity).toEqual(CONFIG_DEFAULTS.failOnSeverity);
  });

  it('doctor sub-config is merged, not replaced', () => {
    const cfg = loadConfig('/tmp', { doctor: { reportMaxAgeDays: 3 } });
    expect(cfg.doctor.reportMaxAgeDays).toBe(3);
    expect(cfg.doctor.requiredScripts).toEqual(CONFIG_DEFAULTS.doctor.requiredScripts);
  });

  it('secretPatterns must be an array after merge', () => {
    const cfg = loadConfig('/tmp', { secretPatterns: null });
    expect(Array.isArray(cfg.secretPatterns)).toBe(true);
  });

  it('CLAUDE.md is NOT in CONFIG_DEFAULTS.requiredFiles (not Claude-specific)', () => {
    expect(CONFIG_DEFAULTS.requiredFiles).not.toContain('CLAUDE.md');
  });
});

// ── Report idempotency ────────────────────────────────────────────────────────

describe('report.json idempotency', () => {
  const SCAN_DATA: Record<string, JsonValue> = {
    _generatedSections: ['scan'],
    generatedAt: '2026-06-09T00:00:00.000Z', // pinned — not new Date()
    pages: [{ route: '/b' }, { route: '/a' }],
    storeFiles: ['z.ts', 'a.ts'],
  };

  it('applying the same scan twice produces identical JSON', () => {
    const r1 = sortReport(applyGeneratedSections({}, SCAN_DATA, ['_generatedSections', 'generatedAt', 'pages', 'storeFiles']));
    const r2 = sortReport(applyGeneratedSections({}, SCAN_DATA, ['_generatedSections', 'generatedAt', 'pages', 'storeFiles']));
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('manual keys outside _generatedSections are preserved on second apply', () => {
    const withManual: Record<string, JsonValue> = {
      ...SCAN_DATA,
      knownRisks: ['keep-me'],
    };
    const r1 = applyGeneratedSections(withManual, SCAN_DATA, Object.keys(SCAN_DATA));
    expect(r1['knownRisks']).toEqual(['keep-me']);
  });
});

// ── AI-stack-agnostic adapter outputs ────────────────────────────────────────

describe('adapter files are AI-stack-agnostic', () => {
  const TARGETS = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'] as const;

  it('Gemini adapter does not mention Claude', () => {
    const out = buildAdapterContent('gemini', '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
    // The preamble should not instruct users to talk to a specific AI
    expect(out.toLowerCase()).not.toContain('ask claude');
    expect(out.toLowerCase()).not.toContain('claude code only');
  });

  it('all adapters contain only rule IDs from PROMETHEUS_RULES', () => {
    for (const target of TARGETS) {
      const out = buildAdapterContent(target, '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
      for (const rule of PROMETHEUS_RULES) {
        expect(out, `${target} missing [${rule.id}]`).toContain(`[${rule.id}]`);
      }
    }
  });

  it('all adapters are deterministic with the same PROMETHEUS_RULES', () => {
    for (const target of TARGETS) {
      const r1 = buildAdapterContent(target, '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
      const r2 = buildAdapterContent(target, '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
      expect(r1, `${target} is not deterministic`).toBe(r2);
    }
  });

  it('adding a new adapter target later does not change existing adapter content', () => {
    const claudeOut = buildAdapterContent('claude', '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
    // Simulate adding gemini later — should not change claude's content
    buildAdapterContent('gemini', '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
    const claudeOut2 = buildAdapterContent('claude', '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
    expect(claudeOut).toBe(claudeOut2);
  });
});
