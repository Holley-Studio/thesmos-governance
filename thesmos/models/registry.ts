// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Model Registry — the single provider-neutral source of truth for every model
 * Thesmos, Pantheon Chat, Council execution, and the exporters may resolve.
 *
 * Before this module existed the same facts were restated in at least six
 * places: `advise.ts` constants, the `token-budget.ts` price table, the
 * `savings.ts` ratio comment, agent frontmatter, the generated
 * `pantheon-models.ts` maps, and the VS Code picker. They disagreed — the price
 * table billed Opus at $15/$75 while the savings comment (correctly) used
 * $5/$25. A registry is the fix: consumers ask, they do not restate.
 *
 * ── Honesty contract ────────────────────────────────────────────────────────
 * Every field here is either VERIFIED against an official source on the
 * recorded `verifiedAt` date, or explicitly `null`. There is no third state.
 * `null` means "not verified", and consumers must render it as unknown — never
 * substitute a neighbouring model's value, never interpolate, never guess.
 * A wrong number that looks confident is worse than an honest gap.
 *
 * Adding or changing an entry means updating `verifiedAt` and `sourceUrl` in
 * the same edit. `npm test --workspace=thesmos` enforces that mechanically.
 */

// ── Logical profiles ─────────────────────────────────────────────────────────

/**
 * What the work NEEDS, stated independently of who sells the model.
 *
 * Consumers request a profile, never a raw model id. This is what lets the
 * OpenAI and Anthropic paths share one routing policy, and what lets a model
 * generation turn over without touching a single call site.
 */
export type LogicalProfile =
  | 'fast-mechanical'
  | 'balanced-agentic'
  | 'deep-reasoning'
  | 'frontier-long-horizon';

export const LOGICAL_PROFILES: readonly LogicalProfile[] = [
  'fast-mechanical',
  'balanced-agentic',
  'deep-reasoning',
  'frontier-long-horizon',
] as const;

/** Ordered cheapest → most capable. Used for escalation and fallback walks. */
export const PROFILE_ORDER: readonly LogicalProfile[] = LOGICAL_PROFILES;

export function profileRank(profile: LogicalProfile): number {
  return PROFILE_ORDER.indexOf(profile);
}

export type Provider = 'anthropic' | 'openai';

export type CapabilityTier = 'light' | 'standard' | 'high' | 'frontier';

export type LatencyClass = 'fastest' | 'fast' | 'moderate' | 'slow';

/** Relative spend, not a price. The price lives in `pricing`. */
export type CostClass = 'lowest' | 'low' | 'medium' | 'high' | 'highest';

export type LifecycleState = 'active' | 'deprecated' | 'retired' | 'invalid';

// ── Pricing ──────────────────────────────────────────────────────────────────

/**
 * A price that was true over a date range. Ranges exist because they are real:
 * Claude Sonnet 5 carries an introductory rate that lapses 2026-08-31, and a
 * single scalar would silently become wrong on 2026-09-01.
 */
export interface PricePoint {
  inputPer1M: number;
  outputPer1M: number;
  /** Inclusive ISO date (YYYY-MM-DD). */
  effectiveFrom: string;
  /** Inclusive ISO date, or null for "still in effect". */
  effectiveTo: string | null;
  note?: string;
}

export interface Pricing {
  currency: 'USD';
  /** Ordered oldest → newest. Overlaps are a registry bug; tests reject them. */
  points: readonly PricePoint[];
}

/**
 * Resolve the price in effect on `on`. Returns null when the model has no
 * verified pricing, or when the date falls outside every recorded window.
 *
 * Callers MUST handle null by reporting unknown cost. Falling back to another
 * model's price is exactly the bug this registry exists to kill.
 */
export function priceOn(pricing: Pricing | null, on: Date): PricePoint | null {
  if (!pricing) return null;
  const day = on.toISOString().slice(0, 10);
  for (let i = pricing.points.length - 1; i >= 0; i--) {
    const p = pricing.points[i]!;
    if (day >= p.effectiveFrom && (p.effectiveTo === null || day <= p.effectiveTo)) return p;
  }
  return null;
}

// ── Availability ─────────────────────────────────────────────────────────────

export interface AvailabilityRequirement {
  /** Human-readable precondition that must hold for the model to be callable. */
  requirement: string;
  /** How a caller can check it, when a mechanical check exists. */
  check: string | null;
}

// ── Registry entry ───────────────────────────────────────────────────────────

export interface ModelEntry {
  /** Logical profile this entry serves for its provider. */
  profile: LogicalProfile;
  provider: Provider;
  /** Canonical model id sent on the wire. */
  id: string;
  /** Accepted aliases that resolve to `id`. Audits treat these as known. */
  aliases: readonly string[];
  displayName: string;
  /** Marketing generation, e.g. "5" or "4.5". Distinct from capability tier. */
  generation: string;
  capabilityTier: CapabilityTier;
  /**
   * Effort / reasoning levels this model actually accepts. An empty array means
   * the model rejects the effort parameter — not that effort is unknown.
   */
  effortControls: readonly string[];
  /** Effort this profile uses when the caller does not specify one. */
  defaultEffort: string | null;
  latencyClass: LatencyClass;
  costClass: CostClass;
  /** Verified context window in tokens, or null when unverified. */
  contextTokens: number | null;
  /** Verified max output tokens, or null when unverified. */
  maxOutputTokens: number | null;
  availability: readonly AvailabilityRequirement[];
  /**
   * Minimum CLI version that can expose this model, when a version has been
   * VERIFIED. null means no verified minimum is on record — consumers must say
   * "unverified", never invent a version number to compare against.
   */
  minCliVersion: string | null;
  /** Profile to fall back to when this one is unavailable. */
  fallbackProfile: LogicalProfile | null;
  pricing: Pricing | null;
  sourceUrl: string;
  /** ISO date this entry's facts were last checked against `sourceUrl`. */
  verifiedAt: string;
  state: LifecycleState;
  /** Why this entry is shaped the way it is. Shown in audit output. */
  notes?: string;
}

// ── Verified sources ─────────────────────────────────────────────────────────

const ANTHROPIC_MODELS_DOC = 'https://platform.claude.com/docs/en/about-claude/models/overview';
const ANTHROPIC_CHOOSING_DOC =
  'https://platform.claude.com/docs/en/about-claude/models/choosing-a-model';
const OPENAI_LATEST_DOC = 'https://developers.openai.com/api/docs/guides/latest-model';

/** Date the Anthropic and OpenAI facts below were last verified. */
export const VERIFIED_AT = '2026-08-03';

// ── Active registry ──────────────────────────────────────────────────────────

/**
 * The active model set, one entry per (provider, profile).
 *
 * Note that OpenAI's frontier profile resolves to the SAME id as its
 * deep-reasoning profile (`gpt-5.6-sol`) with a higher reasoning level. That is
 * deliberate and load-bearing: OpenAI ships `pro` as a reasoning MODE, not as a
 * model. Inventing a `gpt-5.6-pro` slug — as `advise.ts` did with
 * `gpt-5.5-pro` — produces a model id that 404s.
 */
export const MODEL_REGISTRY: readonly ModelEntry[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  {
    profile: 'fast-mechanical',
    provider: 'anthropic',
    id: 'claude-haiku-4-5-20251001',
    aliases: ['claude-haiku-4-5'],
    displayName: 'Haiku 4.5',
    generation: '4.5',
    capabilityTier: 'light',
    // Verified: effort is rejected on Haiku 4.5. Empty means "rejects", not "unknown".
    effortControls: [],
    defaultEffort: null,
    latencyClass: 'fastest',
    costClass: 'lowest',
    contextTokens: 200_000,
    maxOutputTokens: 64_000,
    availability: [],
    minCliVersion: null,
    fallbackProfile: 'balanced-agentic',
    pricing: {
      currency: 'USD',
      points: [{ inputPer1M: 1.0, outputPer1M: 5.0, effectiveFrom: '2025-10-01', effectiveTo: null }],
    },
    sourceUrl: ANTHROPIC_MODELS_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes:
      'Bounded mechanical subtasks only. Must never make architectural, security, product, or release decisions.',
  },
  {
    profile: 'balanced-agentic',
    provider: 'anthropic',
    id: 'claude-sonnet-5',
    aliases: [],
    displayName: 'Sonnet 5',
    generation: '5',
    capabilityTier: 'standard',
    effortControls: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    latencyClass: 'fast',
    costClass: 'low',
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    availability: [],
    minCliVersion: null,
    fallbackProfile: null,
    pricing: {
      currency: 'USD',
      points: [
        {
          inputPer1M: 2.0,
          outputPer1M: 10.0,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-08-31',
          note: 'Introductory pricing. Lapses 2026-08-31.',
        },
        { inputPer1M: 3.0, outputPer1M: 15.0, effectiveFrom: '2026-09-01', effectiveTo: null },
      ],
    },
    sourceUrl: ANTHROPIC_MODELS_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes: 'The default for normal work. This is the floor, not a compromise.',
  },
  {
    profile: 'deep-reasoning',
    provider: 'anthropic',
    id: 'claude-opus-5',
    aliases: [],
    displayName: 'Opus 5',
    generation: '5',
    capabilityTier: 'high',
    effortControls: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    latencyClass: 'moderate',
    costClass: 'medium',
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    availability: [
      {
        requirement:
          'Elevated cybersecurity safeguards may decline a request (HTTP 200 with stop_reason "refusal").',
        check: 'Inspect stop_reason before reading content.',
      },
    ],
    minCliVersion: null,
    fallbackProfile: 'balanced-agentic',
    pricing: {
      currency: 'USD',
      points: [{ inputPer1M: 5.0, outputPer1M: 25.0, effectiveFrom: '2026-01-01', effectiveTo: null }],
    },
    sourceUrl: ANTHROPIC_MODELS_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes:
      'Cross-cutting architecture, root-cause debugging, security reasoning, release-system changes, orchestration and synthesis.',
  },
  {
    profile: 'frontier-long-horizon',
    provider: 'anthropic',
    id: 'claude-fable-5',
    aliases: [],
    displayName: 'Fable 5',
    generation: '5',
    capabilityTier: 'frontier',
    effortControls: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    latencyClass: 'slow',
    costClass: 'highest',
    contextTokens: 1_000_000,
    maxOutputTokens: 128_000,
    availability: [
      {
        requirement:
          'Requires 30-day data retention. Unavailable under zero data retention; such requests return 400.',
        check: 'Confirm the organization retention configuration before enabling.',
      },
      {
        requirement: 'Safety classifiers may decline a request (stop_reason "refusal").',
        check: 'Inspect stop_reason before reading content.',
      },
    ],
    minCliVersion: null,
    fallbackProfile: 'deep-reasoning',
    pricing: {
      currency: 'USD',
      points: [{ inputPer1M: 10.0, outputPer1M: 50.0, effectiveFrom: '2026-01-01', effectiveTo: null }],
    },
    sourceUrl: ANTHROPIC_CHOOSING_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes:
      'NEVER a static default for an agent. Requires recorded justification plus explicit human approval acknowledging the capability and cost tier.',
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  {
    profile: 'fast-mechanical',
    provider: 'openai',
    id: 'gpt-5.6-luna',
    aliases: [],
    displayName: 'GPT-5.6 Luna',
    generation: '5.6',
    capabilityTier: 'light',
    effortControls: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'low',
    latencyClass: 'fastest',
    costClass: 'lowest',
    // Not verified on the fetched source. Honest null beats an invented number.
    contextTokens: null,
    maxOutputTokens: null,
    availability: [],
    minCliVersion: null,
    fallbackProfile: 'balanced-agentic',
    pricing: null,
    sourceUrl: OPENAI_LATEST_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes: 'Efficient, high-volume workloads. Context/output limits and pricing unverified.',
  },
  {
    profile: 'balanced-agentic',
    provider: 'openai',
    id: 'gpt-5.6-terra',
    aliases: [],
    displayName: 'GPT-5.6 Terra',
    generation: '5.6',
    capabilityTier: 'standard',
    effortControls: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'medium',
    latencyClass: 'fast',
    costClass: 'low',
    contextTokens: null,
    maxOutputTokens: null,
    availability: [],
    minCliVersion: null,
    fallbackProfile: null,
    pricing: null,
    sourceUrl: OPENAI_LATEST_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes: 'Balances intelligence against cost. Context/output limits and pricing unverified.',
  },
  {
    profile: 'deep-reasoning',
    provider: 'openai',
    id: 'gpt-5.6-sol',
    aliases: ['gpt-5.6'],
    displayName: 'GPT-5.6 Sol',
    generation: '5.6',
    capabilityTier: 'high',
    effortControls: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'high',
    latencyClass: 'moderate',
    costClass: 'medium',
    contextTokens: null,
    maxOutputTokens: null,
    availability: [],
    minCliVersion: null,
    fallbackProfile: 'balanced-agentic',
    pricing: null,
    sourceUrl: OPENAI_LATEST_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes: 'Flagship capability. `gpt-5.6` is an alias for this id.',
  },
  {
    profile: 'frontier-long-horizon',
    provider: 'openai',
    id: 'gpt-5.6-sol',
    aliases: ['gpt-5.6'],
    displayName: 'GPT-5.6 Sol (max reasoning)',
    generation: '5.6',
    capabilityTier: 'frontier',
    effortControls: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
    defaultEffort: 'max',
    latencyClass: 'slow',
    costClass: 'high',
    contextTokens: null,
    maxOutputTokens: null,
    availability: [],
    minCliVersion: null,
    fallbackProfile: 'deep-reasoning',
    pricing: null,
    sourceUrl: OPENAI_LATEST_DOC,
    verifiedAt: VERIFIED_AT,
    state: 'active',
    notes:
      'Frontier work uses the flagship id at a HIGHER REASONING LEVEL. OpenAI ships "pro" as a reasoning mode, not a model — there is no gpt-5.6-pro slug.',
  },
];

// ── Legacy / known-bad ids ───────────────────────────────────────────────────

export interface LegacyModelEntry {
  id: string;
  provider: Provider;
  state: Exclude<LifecycleState, 'active'>;
  /** Profile a migration should move this id to. */
  replacementProfile: LogicalProfile | null;
  reason: string;
}

/**
 * Ids that must FAIL validation when found in active source.
 *
 * Historical documents, release notes, migration fixtures, and comparison tests
 * legitimately keep old ids — the audit scopes itself to active source and does
 * not rewrite history.
 */
export const LEGACY_MODELS: readonly LegacyModelEntry[] = [
  {
    id: 'claude-opus-4-8',
    provider: 'anthropic',
    state: 'deprecated',
    replacementProfile: 'deep-reasoning',
    reason: 'Superseded by Opus 5 at the same price point ($5/$25 per MTok).',
  },
  {
    id: 'claude-opus-4-7',
    provider: 'anthropic',
    state: 'deprecated',
    replacementProfile: 'deep-reasoning',
    reason: 'Superseded by Opus 5.',
  },
  {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    state: 'deprecated',
    replacementProfile: 'deep-reasoning',
    reason: 'Superseded by Opus 5.',
  },
  {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    state: 'deprecated',
    replacementProfile: 'balanced-agentic',
    reason: 'Superseded by Sonnet 5.',
  },
  {
    id: 'claude-sonnet-4-5',
    provider: 'anthropic',
    state: 'deprecated',
    replacementProfile: 'balanced-agentic',
    reason: 'Superseded by Sonnet 5.',
  },
  {
    id: 'gpt-5.5',
    provider: 'openai',
    state: 'deprecated',
    replacementProfile: 'balanced-agentic',
    reason: 'Superseded by the GPT-5.6 family.',
  },
  {
    id: 'gpt-5.5-instant',
    provider: 'openai',
    state: 'deprecated',
    replacementProfile: 'fast-mechanical',
    reason: 'Superseded by gpt-5.6-luna.',
  },
  {
    id: 'gpt-5.5-pro',
    provider: 'openai',
    state: 'invalid',
    replacementProfile: 'frontier-long-horizon',
    reason:
      'Never a real model slug. OpenAI ships "pro" as a reasoning MODE. Frontier work uses the flagship id at a higher reasoning level.',
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    state: 'deprecated',
    replacementProfile: 'balanced-agentic',
    reason: 'Superseded by the GPT-5.6 family.',
  },
];

// ── Lookup ───────────────────────────────────────────────────────────────────

export function entriesFor(provider: Provider): readonly ModelEntry[] {
  return MODEL_REGISTRY.filter((e) => e.provider === provider);
}

/** Resolve a (provider, profile) pair to its registry entry. */
export function resolveProfile(
  profile: LogicalProfile,
  provider: Provider = 'anthropic',
): ModelEntry | null {
  return MODEL_REGISTRY.find((e) => e.profile === profile && e.provider === provider) ?? null;
}

/**
 * Find the registry entry for a raw model id, matching canonical ids and
 * aliases. When an id serves several profiles (OpenAI's flagship serves both
 * deep-reasoning and frontier), the LOWEST-ranked profile wins so that merely
 * observing the id never implies frontier intent.
 */
export function lookupModelId(id: string): ModelEntry | null {
  const matches = MODEL_REGISTRY.filter((e) => e.id === id || e.aliases.includes(id));
  if (matches.length === 0) return null;
  return matches.reduce((best, e) => (profileRank(e.profile) < profileRank(best.profile) ? e : best));
}

export function lookupLegacyId(id: string): LegacyModelEntry | null {
  return LEGACY_MODELS.find((e) => e.id === id) ?? null;
}

/** True when `id` is an active, registry-known model id or alias. */
export function isActiveModelId(id: string): boolean {
  const entry = lookupModelId(id);
  return entry !== null && entry.state === 'active';
}

/** Every canonical id and alias that is currently active. */
export function activeModelIds(): string[] {
  const out = new Set<string>();
  for (const e of MODEL_REGISTRY) {
    if (e.state !== 'active') continue;
    out.add(e.id);
    for (const a of e.aliases) out.add(a);
  }
  return [...out].sort();
}

// ── Registry identity ────────────────────────────────────────────────────────

/**
 * Bumped by hand when the registry's SHAPE changes in a way consumers must
 * notice. The hash below covers CONTENT and moves on its own.
 */
export const REGISTRY_VERSION = '1.0.0';

/**
 * Stable content hash. Deterministic across runs and machines: field order is
 * fixed by an explicit projection rather than by object key order, so a
 * reordered literal does not change the hash but a changed value does.
 *
 * Uses FNV-1a rather than node:crypto so the registry stays importable from the
 * VS Code webview bundle, which has no node builtins.
 */
export function registryHash(): string {
  const projection = MODEL_REGISTRY.map((e) =>
    [
      e.provider,
      e.profile,
      e.id,
      e.aliases.join(','),
      e.generation,
      e.capabilityTier,
      e.effortControls.join(','),
      e.defaultEffort ?? '',
      e.contextTokens ?? '',
      e.maxOutputTokens ?? '',
      e.minCliVersion ?? '',
      e.fallbackProfile ?? '',
      e.state,
      e.verifiedAt,
      e.pricing ? e.pricing.points.map((p) => `${p.inputPer1M}/${p.outputPer1M}@${p.effectiveFrom}-${p.effectiveTo ?? ''}`).join(';') : '',
    ].join('|'),
  )
    .sort()
    .join('\n');

  let h = 0x811c9dc5;
  for (let i = 0; i < projection.length; i++) {
    h ^= projection.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
