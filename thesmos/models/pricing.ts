// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Model pricing and savings — derived from the registry, never restated.
 *
 * ── Three bugs this module exists to kill ───────────────────────────────────
 *
 * 1. FABRICATED COST. `token-budget.ts` fell back to a Sonnet 4.6 price for any
 *    model id it did not recognise, so an unknown model produced a confident,
 *    wrong dollar figure. Here, unknown is a first-class result: callers get
 *    `{ known: false, reason }` and must render "unknown". There is no default
 *    price and no nearest-neighbour guess.
 *
 * 2. STALE PRICE. The same table billed Opus at $15/$75 and Haiku at
 *    $0.25/$1.25 — 3× over and 4× under the verified rates. Prices now come
 *    from dated registry windows, so the Sonnet 5 introductory rate lapsing on
 *    2026-08-31 changes the answer on its own instead of silently going wrong.
 *
 * 3. FABLE COUNTED AS BASELINE. `estimateTierSaving` matched /opus|fable/ and
 *    returned undefined, treating the most expensive model in the catalog as
 *    equivalent to the baseline. Fable is 2× Opus 5 — running on it is a
 *    PREMIUM, and this module reports that as a negative saving rather than
 *    hiding it behind "no claim".
 */

import {
  type LogicalProfile,
  type PricePoint,
  type Provider,
  lookupModelId,
  priceOn,
  resolveProfile,
} from './registry.js';

// ── Results ──────────────────────────────────────────────────────────────────

export interface KnownCost {
  known: true;
  costUsd: number;
  /** The price window used, so a receipt can show which rate applied. */
  price: PricePoint;
  modelId: string;
}

export interface UnknownCost {
  known: false;
  /** Why the cost could not be determined. Render this; do not substitute. */
  reason: string;
  modelId: string;
}

export type CostResult = KnownCost | UnknownCost;

/**
 * Cost of a turn, or an explicit unknown.
 *
 * `at` is required rather than defaulting to now: pricing is date-dependent, so
 * a caller must state which day it is asking about. Passing the wrong date is a
 * visible bug; defaulting to `new Date()` inside a pure function is an
 * invisible one.
 */
export function costFor(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  at: Date,
): CostResult {
  const entry = lookupModelId(modelId);
  if (!entry) {
    return {
      known: false,
      modelId,
      reason: `Model "${modelId}" is not in the registry — cost unknown.`,
    };
  }
  if (!entry.pricing) {
    return {
      known: false,
      modelId,
      reason: `No verified pricing recorded for "${modelId}" — cost unknown.`,
    };
  }
  const price = priceOn(entry.pricing, at);
  if (!price) {
    return {
      known: false,
      modelId,
      reason: `No price window covers ${at.toISOString().slice(0, 10)} for "${modelId}" — cost unknown.`,
    };
  }
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) {
    return { known: false, modelId, reason: `Token counts are not finite — cost unknown.` };
  }
  const costUsd = (inputTokens * price.inputPer1M + outputTokens * price.outputPer1M) / 1_000_000;
  return { known: true, costUsd, price, modelId };
}

// ── Savings ──────────────────────────────────────────────────────────────────

/**
 * The tier the savings claim is measured against.
 *
 * Deep reasoning (Opus 5), not frontier: the honest counterfactual for routine
 * work is "the capable model you'd otherwise reach for", not "the most
 * expensive model in the catalog". Measuring against frontier would inflate
 * every figure by 2×.
 */
export const SAVINGS_BASELINE_PROFILE: LogicalProfile = 'deep-reasoning';

export interface KnownSaving {
  known: true;
  /**
   * Positive = cheaper than baseline (a saving).
   * Negative = MORE expensive than baseline (a premium, e.g. Fable).
   */
  estSavedUsd: number;
  baselineModelId: string;
  /** True when input and output ratios agree, making the figure exact. */
  exact: boolean;
}

export interface UnknownSaving {
  known: false;
  reason: string;
}

export type SavingResult = KnownSaving | UnknownSaving;

/**
 * Exact saving from real token counts: price the same turn on the baseline
 * model and subtract. No ratio algebra, no blend assumption.
 */
export function savingVsBaseline(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  at: Date,
  provider: Provider = 'anthropic',
): SavingResult {
  const baseline = resolveProfile(SAVINGS_BASELINE_PROFILE, provider);
  if (!baseline) {
    return { known: false, reason: `No ${provider} baseline model for savings comparison.` };
  }
  const actual = costFor(modelId, inputTokens, outputTokens, at);
  if (!actual.known) return { known: false, reason: actual.reason };
  const asBaseline = costFor(baseline.id, inputTokens, outputTokens, at);
  if (!asBaseline.known) return { known: false, reason: asBaseline.reason };

  return {
    known: true,
    estSavedUsd: asBaseline.costUsd - actual.costUsd,
    baselineModelId: baseline.id,
    exact: true,
  };
}

/**
 * Saving estimated from a turn's dollar cost when token counts are not
 * retained.
 *
 * Derives the ratio from the registry rather than a hardcoded constant. That
 * matters right now: the old hardcoded (2/3) is only correct AFTER the Sonnet 5
 * introductory rate lapses on 2026-08-31. Before then the real ratio is 2.5×,
 * so the constant understated savings — the registry gets this right on both
 * sides of the date with no code change.
 */
export function estimateTierSavingFromCost(
  modelId: string,
  turnCostUsd: number,
  at: Date,
  provider: Provider = 'anthropic',
): SavingResult {
  if (!Number.isFinite(turnCostUsd) || turnCostUsd <= 0) {
    return { known: false, reason: 'Turn cost is not a positive finite number.' };
  }
  const entry = lookupModelId(modelId);
  if (!entry) return { known: false, reason: `Model "${modelId}" is not in the registry.` };

  const baseline = resolveProfile(SAVINGS_BASELINE_PROFILE, provider);
  if (!baseline) return { known: false, reason: `No ${provider} baseline model.` };

  const actualPrice = entry.pricing ? priceOn(entry.pricing, at) : null;
  const basePrice = baseline.pricing ? priceOn(baseline.pricing, at) : null;
  if (!actualPrice) return { known: false, reason: `No verified price for "${modelId}".` };
  if (!basePrice) return { known: false, reason: `No verified price for baseline "${baseline.id}".` };
  if (actualPrice.inputPer1M <= 0 || actualPrice.outputPer1M <= 0) {
    return { known: false, reason: `Non-positive price recorded for "${modelId}".` };
  }

  const inputRatio = basePrice.inputPer1M / actualPrice.inputPer1M;
  const outputRatio = basePrice.outputPer1M / actualPrice.outputPer1M;
  const exact = Math.abs(inputRatio - outputRatio) < 1e-9;
  // When the two ratios agree the blend is exact for ANY token mix. When they
  // diverge we use the midpoint and flag it, rather than pretending precision.
  const ratio = exact ? inputRatio : (inputRatio + outputRatio) / 2;

  return {
    known: true,
    estSavedUsd: turnCostUsd * (ratio - 1),
    baselineModelId: baseline.id,
    exact,
  };
}

/**
 * Render a saving for display, honouring the honesty contract: estimates carry
 * "~", premiums read as premiums, and unknowns say so.
 */
export function formatSaving(result: SavingResult): string {
  if (!result.known) return 'unknown';
  const v = result.estSavedUsd;
  if (Math.abs(v) < 0.005) return '~$0.00';
  if (v < 0) return `+~$${Math.abs(v).toFixed(2)} premium vs ${result.baselineModelId}`;
  return `~$${v.toFixed(2)} saved vs ${result.baselineModelId}`;
}
