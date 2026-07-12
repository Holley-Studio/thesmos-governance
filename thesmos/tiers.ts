// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Rule tiering — the free/paid boundary for the Thesmos engine.
 *
 * FREE ("Essentials"): every BLOCKER-severity rule plus the complete AI-code
 * safety net (VIBE_*, AI_*, SLOP_*) regardless of severity. This is the set that
 * stops disasters — the code that gets you breached, owned, or shipped broken by
 * an AI tool. ~288 rules.
 *
 * PREMIUM ($79, lifetime): the full 1,137-rule engine — every framework
 * (React/Next/Prisma/Django/Go/Rust/…), the compliance packs (GDPR/HIPAA/EU AI
 * Act/DORA), and the quality/perf/debt rules — plus all Pantheon agents for every
 * LLM.
 *
 * Distribution gating is honor-system by design (rule source is public on GitHub,
 * matching the FSL license): the premium tier is unlocked by a downloaded pack
 * marker or an explicit config/env flag — no license server, no runtime key.
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
export function premiumPackPaths(root: string): string[] {
  return [
    join(root, '.thesmos', 'premium', 'pack.json'),
    join(homedir(), '.thesmos', 'premium', 'pack.json'),
  ];
}

/** True if a premium-pack marker is present on disk. */
export function hasPremiumPack(root: string): boolean {
  return premiumPackPaths(root).some((p) => existsSync(p));
}

/**
 * Resolve the active tier. Precedence, highest first:
 *   1. THESMOS_TIER env ('free' | 'premium') — CI / test / vendor override
 *   2. explicit config.tier
 *   3. a premium-pack marker on disk (the $79 download drops this in)
 *   4. default: 'free'
 *
 * fs-touching — call this at the config-load layer, then stamp the result onto
 * config.tier so the pure review/govern engines can filter without fs access.
 */
export function resolveTier(configTier: RuleTier | undefined, root: string): RuleTier {
  const env = process.env['THESMOS_TIER'];
  if (env === 'premium' || env === 'free') return env;
  if (configTier === 'premium' || configTier === 'free') return configTier;
  if (hasPremiumPack(root)) return 'premium';
  return 'free';
}
