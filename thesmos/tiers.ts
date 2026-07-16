// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Rule tiering — legacy free/paid metadata, kept for back-compat.
 *
 * Since 5.0.0 the rule engine is 100% free: activeRulesForTier() in
 * rules/registry.ts returns every rule for every tier. The paid product is
 * the Pantheon agent pack ($24 one-time, content-gated: premium agents are
 * simply absent from the free npm distribution).
 *
 * ESSENTIAL_RULES / isEssentialRule / partitionByTier remain exported because
 * downstream tooling and the tier CLI report on the historical boundary, and
 * premiumPackPaths/hasPremiumPack still detect a purchased pack marker
 * (used to hide upsell messaging for buyers).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Severity } from './types.js';

export type RuleTier = 'free' | 'premium';

/** Minimal shape needed to tier a rule — id + severity. */
interface TierableRule {
  id: string;
  severity: Severity;
}

/**
 * True if a rule belongs to the free "Essentials" tier: every BLOCKER, plus the
 * complete AI-code net (VIBE_/AI_/SLOP_) at any severity. Predicate-based so the
 * boundary auto-maintains as rules are added — no hand-curated list to rot.
 */
export function isEssentialRule(rule: TierableRule): boolean {
  return rule.severity === 'BLOCKER' || /^(VIBE|AI|SLOP)_/.test(rule.id);
}

/** Split a rule set into { free, premium } by the essentials predicate. */
export function partitionByTier<T extends TierableRule>(rules: T[]): { free: T[]; premium: T[] } {
  const free: T[] = [];
  const premium: T[] = [];
  for (const r of rules) (isEssentialRule(r) ? free : premium).push(r);
  return { free, premium };
}

/** Candidate locations for the downloaded premium-pack marker. */
export function premiumPackPaths(root: string, homeDir: string = homedir()): string[] {
  return [
    join(root, '.thesmos', 'premium', 'pack.json'),
    join(homeDir, '.thesmos', 'premium', 'pack.json'),
  ];
}

/** True if a premium-pack marker is present on disk. */
export function hasPremiumPack(root: string, homeDir: string = homedir()): boolean {
  return premiumPackPaths(root, homeDir).some((p) => existsSync(p));
}

/**
 * Resolve the active tier. Precedence, highest first:
 *   1. THESMOS_TIER env ('free' | 'premium') — CI / test / vendor override
 *   2. explicit config.tier
 *   3. a premium-pack marker on disk (the $24 download drops this in)
 *   4. default: 'free'
 *
 * fs-touching — call this at the config-load layer, then stamp the result onto
 * config.tier so the pure review/govern engines can filter without fs access.
 *
 * `homeDir` is injectable for tests so a developer machine's ~/.thesmos/premium
 * marker cannot flip the default.
 */
export function resolveTier(
  configTier: RuleTier | undefined,
  root: string,
  homeDir: string = homedir()
): RuleTier {
  const env = process.env['THESMOS_TIER'];
  if (env === 'premium' || env === 'free') return env;
  if (configTier === 'premium' || configTier === 'free') return configTier;
  if (hasPremiumPack(root, homeDir)) return 'premium';
  return 'free';
}
