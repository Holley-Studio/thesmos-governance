// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isEssentialRule, partitionByTier, resolveTier } from './tiers';
import { THESMOS_RULES, ESSENTIAL_RULES, activeRulesForTier } from './rules/registry';
import { runReview } from './review';
import { CONFIG_DEFAULTS } from './config';
import type { ScanResult, ThesmosConfig } from './types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [], generatedAt: '2024-01-01T00:00:00.000Z', scanVersion: '2.0.0',
  pages: [], apiRoutes: [], componentCount: 0, sharedUiFiles: [], designSystemFiles: [],
  storeFiles: [], testFiles: [], largeFiles: [], riskyFiles: [], scriptFiles: [],
  envFiles: [], clientBoundaryRisks: [],
};

afterEach(() => vi.unstubAllEnvs());

describe('isEssentialRule — the free/paid boundary', () => {
  it('includes every BLOCKER and the full AI-code net (VIBE/AI/SLOP)', () => {
    expect(isEssentialRule({ id: 'SEC_001', severity: 'BLOCKER' })).toBe(true);
    expect(isEssentialRule({ id: 'VIBE_007', severity: 'HIGH' })).toBe(true);
    expect(isEssentialRule({ id: 'AI_006', severity: 'HIGH' })).toBe(true);
    expect(isEssentialRule({ id: 'SLOP_002', severity: 'HIGH' })).toBe(true);
  });

  it('excludes non-BLOCKER framework/quality rules (premium)', () => {
    expect(isEssentialRule({ id: 'TS_011', severity: 'HIGH' })).toBe(false);
    expect(isEssentialRule({ id: 'A11Y_001', severity: 'HIGH' })).toBe(false);
    expect(isEssentialRule({ id: 'DESIGN_001', severity: 'HIGH' })).toBe(false);
  });
});

describe('partitionByTier — the shipped split', () => {
  it('splits 1,137 rules into 288 free / 849 premium', () => {
    const { free, premium } = partitionByTier(THESMOS_RULES);
    expect(free.length + premium.length).toBe(THESMOS_RULES.length);
    expect(THESMOS_RULES.length).toBe(1137);
    expect(free.length).toBe(288);
    expect(premium.length).toBe(849);
    expect(ESSENTIAL_RULES.length).toBe(288);
  });
});

describe('activeRulesForTier', () => {
  it('returns the full engine for every tier — rules are never paywalled', () => {
    expect(activeRulesForTier({ tier: 'free' }).length).toBe(THESMOS_RULES.length);
    expect(activeRulesForTier({ tier: 'premium' }).length).toBe(THESMOS_RULES.length);
    expect(activeRulesForTier({}).length).toBe(THESMOS_RULES.length);
  });
});

describe('resolveTier — precedence', () => {
  it('THESMOS_TIER env wins over config', () => {
    vi.stubEnv('THESMOS_TIER', 'free');
    expect(resolveTier('premium', '/nope')).toBe('free');
    vi.stubEnv('THESMOS_TIER', 'premium');
    expect(resolveTier('free', '/nope')).toBe('premium');
  });

  it('falls back to explicit config.tier, then defaults to free', () => {
    vi.stubEnv('THESMOS_TIER', '');
    expect(resolveTier('premium', '/nonexistent-root')).toBe('premium');
    expect(resolveTier(undefined, '/nonexistent-root')).toBe('free');
  });
});

describe('runReview — full engine for every tier (rules are never paywalled)', () => {
  // apiKey="PLACEHOLDER" → VIBE_007 (hardcoded secret); debugger; → TS_011 (debugger statement).
  // Since 5.0.0 both rules fire on every tier.
  const input = (tier: 'free' | 'premium'): { scan: ScanResult; config: ThesmosConfig; changedFiles: { path: string; content: string }[] } => ({
    scan: EMPTY_SCAN,
    config: { ...CONFIG_DEFAULTS, tier } as ThesmosConfig,
    changedFiles: [{ path: 'src/x.ts', content: 'const apiKey = "PLACEHOLDER";\ndebugger;' }],
  });

  it('premium reports both the essential and the formerly-premium rule', () => {
    const cats = runReview(input('premium')).map((f) => f.category);
    expect(cats).toContain('vibe_hardcoded_secret');
    expect(cats).toContain('debugger_statement');
  });

  it('free ALSO reports both rules — the tier gate is gone', () => {
    const cats = runReview(input('free')).map((f) => f.category);
    expect(cats).toContain('vibe_hardcoded_secret');
    expect(cats).toContain('debugger_statement');
  });
});
