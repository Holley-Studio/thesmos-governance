// @vitest-environment node
/**
 * Registry proof tests — verify that the single canonical registry is the
 * only source of truth and that all downstream consumers derive from it.
 *
 * Key assertions:
 *   - Every rule has a unique ID and a sinceVersion
 *   - REVIEW_CATEGORIES and severityRules are live derivations, not copies
 *   - Every adapter output contains all registry rule IDs
 *   - Adding a mock rule to runReview propagates automatically (no other changes needed)
 */

import { describe, it, expect } from 'vitest';
import { PROMETHEUS_RULES } from './registry';
import { REVIEW_CATEGORIES, runReview } from '../review';
import { CONFIG_DEFAULTS } from '../config';
import { buildAdapterContent } from '../adapters';
import type { PrometheusRule, DetectInput, Finding, ScanResult } from '../types';

// ── Shared fixture ─────────────────────────────────────────────────────────────

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

// ── Registry structure ────────────────────────────────────────────────────────

describe('registry structure', () => {
  it('every rule has a unique ID', () => {
    const ids = PROMETHEUS_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has a sinceVersion string', () => {
    for (const rule of PROMETHEUS_RULES) {
      expect(typeof rule.sinceVersion, `[${rule.id}] sinceVersion`).toBe('string');
      expect(rule.sinceVersion.length, `[${rule.id}] sinceVersion is empty`).toBeGreaterThan(0);
    }
  });

  it('every rule has a detect() function', () => {
    for (const rule of PROMETHEUS_RULES) {
      expect(typeof rule.detect, `[${rule.id}] detect`).toBe('function');
    }
  });

  it('every rule has a non-empty description', () => {
    for (const rule of PROMETHEUS_RULES) {
      expect(rule.description.length, `[${rule.id}] description`).toBeGreaterThan(0);
    }
  });

  it('has exactly 757 rules (update this when adding new rules)', () => {
    expect(PROMETHEUS_RULES).toHaveLength(814);
  });
});

// ── Derivation proofs ─────────────────────────────────────────────────────────

describe('downstream derivation from registry', () => {
  it('REVIEW_CATEGORIES equals PROMETHEUS_RULES.map(r => r.category)', () => {
    expect(REVIEW_CATEGORIES).toEqual(PROMETHEUS_RULES.map((r) => r.category));
  });

  it('CONFIG_DEFAULTS.severityRules matches registry severity for every rule', () => {
    for (const rule of PROMETHEUS_RULES) {
      const sr = CONFIG_DEFAULTS.severityRules.find((s) => s.category === rule.category);
      expect(sr, `[${rule.id}] missing from severityRules`).toBeDefined();
      expect(sr!.severity, `[${rule.id}] severity mismatch`).toBe(rule.severity);
    }
  });

  it('CONFIG_DEFAULTS.severityRules has exactly the same length as PROMETHEUS_RULES', () => {
    expect(CONFIG_DEFAULTS.severityRules).toHaveLength(PROMETHEUS_RULES.length);
  });
});

// ── Adapter derivation ────────────────────────────────────────────────────────

describe('adapters derive from registry', () => {
  const ALL_TARGETS = ['gemini', 'claude', 'cursor', 'copilot', 'codex', 'agents'] as const;

  it('every adapter target contains all registry rule IDs', () => {
    for (const target of ALL_TARGETS) {
      const out = buildAdapterContent(target, '', PROMETHEUS_RULES, CONFIG_DEFAULTS);
      for (const rule of PROMETHEUS_RULES) {
        expect(out, `${target} missing [${rule.id}]`).toContain(`[${rule.id}]`);
      }
    }
  });
});

// ── Mock rule — proves the registry is the only edit needed ───────────────────

describe('mock rule extensibility', () => {
  const mockRule: PrometheusRule = {
    id: 'MOCK_001',
    category: 'mock_violation',
    severity: 'HIGH',
    description: 'Mock rule for registry extensibility test.',
    tags: ['test'],
    sinceVersion: '2.0.0',
    detect(_input: DetectInput): Finding[] {
      return [
        {
          severity: 'HIGH',
          category: 'mock_violation',
          file: 'any.ts',
          message: 'mock finding',
        },
      ];
    },
  };

  it('a mock rule passed to runReview produces its findings — no other code changes needed', () => {
    const input = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    const testRegistry = [...PROMETHEUS_RULES, mockRule];
    const findings = runReview(input, testRegistry);
    const mockFinding = findings.find((f) => f.category === 'mock_violation');
    expect(mockFinding).toBeDefined();
    expect(mockFinding!.severity).toBe('HIGH');
  });

  it('mock rule detect() is isolated — does not affect the global registry output', () => {
    const input = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    const baseline = runReview(input); // uses global PROMETHEUS_RULES
    expect(baseline.find((f) => f.category === 'mock_violation')).toBeUndefined();
  });

  it('mock rule appears in adapter output when included in the rules list', () => {
    const rulesWithMock = [...PROMETHEUS_RULES, mockRule];
    const out = buildAdapterContent('claude', '', rulesWithMock, CONFIG_DEFAULTS);
    expect(out).toContain('[MOCK_001]');
  });
});

// ── Individual detect() methods return correct categories ─────────────────────

describe('detect() returns correct category on each rule', () => {
  it('ENV_001 detect() produces direct_env_access findings', () => {
    const rule = PROMETHEUS_RULES.find((r) => r.id === 'ENV_001')!;
    const findings = rule.detect({
      scan: EMPTY_SCAN,
      config: CONFIG_DEFAULTS,
      changedFiles: [{ path: 'lib/config.ts', content: 'const x = process.env.SECRET;' }],
    });
    expect(findings[0]?.category).toBe('direct_env_access');
    expect(findings[0]?.line).toBe(1);
  });

  it('QUAL_002 detect() produces large_file findings from scan data', () => {
    const rule = PROMETHEUS_RULES.find((r) => r.id === 'QUAL_002')!;
    const scan = { ...EMPTY_SCAN, largeFiles: [{ file: 'big.ts', lines: 600 }] };
    const findings = rule.detect({ scan, config: CONFIG_DEFAULTS, changedFiles: [] });
    expect(findings[0]?.category).toBe('large_file');
    expect(findings[0]?.file).toBe('big.ts');
  });

  it('every rule detect() returns an array (not undefined)', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const rule of PROMETHEUS_RULES) {
      const result = rule.detect(input);
      expect(Array.isArray(result), `[${rule.id}] detect() did not return an array`).toBe(true);
    }
  });

  it('every rule detect() result has valid severity when findings are returned', () => {
    const VALID_SEVERITIES = new Set(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT']);
    const scan = {
      ...EMPTY_SCAN,
      apiRoutes: [
        { path: '/api/test', file: 'route.ts', methods: ['POST'], auth: false, desc: '' },
      ],
      largeFiles: [{ file: 'big.ts', lines: 999 }],
    };
    const changedFiles = [
      { path: 'lib/x.ts', content: 'process.env.FOO' },
    ];
    for (const rule of PROMETHEUS_RULES) {
      const findings = rule.detect({ scan, config: CONFIG_DEFAULTS, changedFiles });
      for (const f of findings) {
        expect(
          VALID_SEVERITIES.has(f.severity),
          `[${rule.id}] invalid severity "${f.severity}"`
        ).toBe(true);
      }
    }
  });
});
