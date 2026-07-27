// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * BudgetPolicy — the single, pure decision function for the Budget Guardian.
 *
 * Replaces the old binary 'ok' | 'warn' | 'exceeded' state with a
 * billing-aware decision. The matrix (do not reimplement it in UI code):
 *
 *   | Billing mode | Under warning | Over warning | Over limit                          |
 *   |--------------|---------------|--------------|-------------------------------------|
 *   | Subscription | continue      | advisory     | continue with advisory              |
 *   | Metered      | continue      | warning      | block (fail-closed)                 |
 *   | Unknown      | continue      | advisory     | continue and request classification |
 *
 * The Subscription row applies only at VERIFIED confidence (workspace config,
 * explicit user selection, or provider auth metadata). An inferred
 * subscription — e.g. the codex-login heuristic — takes the Unknown row: an
 * inference must never trigger or disable monetary enforcement.
 *
 * Language rules enforced here so every consumer inherits them:
 *   - subscription copy says "API-equivalent usage estimate", never "spent"
 *     or "charged" — the number is the CLI's estimate, not a bill;
 *   - metered copy says "estimated metered usage" — we still have no verified
 *     billing data, only an estimate of real pay-per-token spend;
 *   - unknown copy says the billing mode is unverified and asks the user to
 *     classify it. Unknown never silently becomes subscription or metered.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BillingContext, BillingMode } from './billingContext.js';

/** Warn threshold fraction of a ceiling, when the config doesn't set one. */
export const DEFAULT_WARN_FRACTION = 0.8;

export interface TokenBudgetSettings {
  /** Metered session ceiling (tokenBudget.sessionMaxCostUSD). undefined = none. */
  limitUsd?: number;
  /** Explicit billing intent from config; 'auto' = detect. */
  billingMode: 'auto' | 'subscription' | 'metered';
  /** Fraction of the relevant threshold at which to warn (0 < f < 1). */
  warnAtFraction: number;
  /** Subscription advisory threshold (tokenBudget.subscriptionWarningEquivalentUSD). */
  subscriptionWarnUsd?: number;
}

export interface BudgetDecision {
  state: 'ok' | 'warn' | 'limit-reached';
  enforcement: 'none' | 'advisory' | 'block';
  billingMode: BillingMode;
  estimatedCostUsd: number;
  configuredLimitUsd?: number;
  message: string;
}

/** A positive finite number, or undefined. Rejects 0, negatives, NaN, ±Infinity. */
function positiveOrUndefined(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Parse the tokenBudget section of a raw config object. Never throws, never
 * echoes raw config content into errors (a malformed config may contain
 * anything). Old configs that only set sessionMaxCostUSD keep working:
 * billingMode defaults to 'auto' (detect — NOT confirmed metered), and
 * warnAtFraction falls back to the CLI-side `alertAt` field, then 0.8.
 */
export function parseTokenBudgetSettings(raw: unknown): TokenBudgetSettings {
  const root = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const tb = (typeof root.tokenBudget === 'object' && root.tokenBudget !== null
    ? root.tokenBudget
    : {}) as Record<string, unknown>;

  const mode = tb.billingMode;
  const billingMode: TokenBudgetSettings['billingMode'] =
    mode === 'subscription' || mode === 'metered' ? mode : 'auto';

  const fractionRaw = Number(tb.warnAtFraction ?? tb.alertAt);
  const warnAtFraction =
    Number.isFinite(fractionRaw) && fractionRaw > 0 && fractionRaw < 1 ? fractionRaw : DEFAULT_WARN_FRACTION;

  return {
    limitUsd: positiveOrUndefined(tb.sessionMaxCostUSD),
    billingMode,
    warnAtFraction,
    subscriptionWarnUsd: positiveOrUndefined(tb.subscriptionWarningEquivalentUSD),
  };
}

/** Read tokenBudget settings from .thesmos/config.json. Safe defaults on any failure. */
export function readTokenBudgetSettings(workspaceRoot: string): TokenBudgetSettings {
  try {
    return parseTokenBudgetSettings(
      JSON.parse(readFileSync(join(workspaceRoot, '.thesmos', 'config.json'), 'utf-8')),
    );
  } catch {
    return parseTokenBudgetSettings(undefined);
  }
}

const usd = (v: number): string => `$${v.toFixed(2)}`;

/**
 * The pure, deterministic budget decision. Sanitizes hostile inputs
 * (NaN/Infinity/negative costs become 0; invalid limits mean "no limit") so a
 * corrupt config or event can never fail open into a bogus block — or a bogus
 * pass on a genuinely metered ceiling.
 */
export function decideBudget(
  estimatedCostUsd: number,
  billing: BillingContext,
  settings: TokenBudgetSettings,
): BudgetDecision {
  const cost = Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0 ? estimatedCostUsd : 0;
  const limit = positiveOrUndefined(settings.limitUsd);
  const fraction =
    Number.isFinite(settings.warnAtFraction) && settings.warnAtFraction > 0 && settings.warnAtFraction < 1
      ? settings.warnAtFraction
      : DEFAULT_WARN_FRACTION;

  const base = { billingMode: billing.mode, estimatedCostUsd: cost, configuredLimitUsd: limit };

  // The subscription exemption (never block, subscription-worded advisories)
  // requires VERIFIED confidence — workspace config, the user's explicit
  // selection, or provider auth metadata. An inferred subscription (e.g. the
  // codex-login heuristic) is a display label, not a billing fact: it falls
  // through to the unknown branch below, so an inference can never trigger or
  // disable monetary enforcement.
  if (billing.mode === 'subscription' && billing.confidence === 'verified') {
    // Advisory threshold: the dedicated subscription setting, falling back to
    // the session ceiling so a known-subscription user with an old config
    // still gets an advisory where they used to get (wrongly) blocked.
    const threshold = positiveOrUndefined(settings.subscriptionWarnUsd) ?? limit;
    if (threshold === undefined || cost < threshold * fraction) {
      return { ...base, state: 'ok', enforcement: 'none', message: '' };
    }
    if (cost < threshold) {
      return {
        ...base,
        state: 'warn',
        enforcement: 'advisory',
        message:
          `API-equivalent usage estimate is ~${usd(cost)} this session (advisory threshold ${usd(threshold)}). ` +
          `This is a subscription-backed connection, so Pantheon will not block based on this estimate. ` +
          `Provider usage or rate limits may still apply.`,
      };
    }
    return {
      ...base,
      state: 'limit-reached',
      enforcement: 'advisory',
      message:
        `API-equivalent usage is approximately ${usd(cost)} for this session. ` +
        `You are using a subscription-backed connection, so Pantheon will not block the session based on this estimate — ` +
        `this notice is advisory only. Subscription usage limits may still apply.`,
    };
  }

  if (billing.mode === 'metered') {
    if (limit === undefined || cost < limit * fraction) {
      return { ...base, state: 'ok', enforcement: 'none', message: '' };
    }
    if (cost < limit) {
      return {
        ...base,
        state: 'warn',
        enforcement: 'advisory',
        message:
          `Estimated metered usage is ~${usd(cost)} of your ${usd(limit)} session ceiling ` +
          `(${Math.round((cost / limit) * 100)}%).`,
      };
    }
    return {
      ...base,
      state: 'limit-reached',
      enforcement: 'block',
      message:
        `Estimated metered usage has reached approximately ${usd(cost)} of your ${usd(limit)} session ceiling. ` +
        `New prompts are paused to prevent additional API usage. ` +
        `Raise the ceiling or start a new session.`,
    };
  }

  // Unknown — including unverified (inferred) subscription — advisory only,
  // and ask the user to classify. Never block on an estimate whose billing
  // meaning we cannot verify.
  const unknownMessage =
    `Pantheon estimates approximately ${usd(cost)} in API-equivalent usage, but it cannot verify whether ` +
    `this connection is subscription-backed or metered. Select the billing mode (click the budget bar) ` +
    `to enable accurate budget protection.`;
  if (limit === undefined || cost < limit * fraction) {
    return { ...base, state: 'ok', enforcement: 'none', message: '' };
  }
  if (cost < limit) {
    return { ...base, state: 'warn', enforcement: 'advisory', message: unknownMessage };
  }
  return { ...base, state: 'limit-reached', enforcement: 'advisory', message: unknownMessage };
}
