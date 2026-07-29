// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * BudgetBarModel — pure view-model for the Pantheon budget bar.
 *
 * Shared by the webview bundle and unit tests, so the bar's wording is
 * testable without a DOM. Browser-safe: no node imports. Presentation only —
 * the enforcement matrix lives in budgetPolicy.ts, never here.
 *
 * Everything returned here is rendered via textContent (never innerHTML), so
 * provider labels and cost values cannot inject markup.
 */

import type { BillingMode } from './billingContext.js';

export interface BudgetBarInput {
  /** Cumulative session estimate (API-equivalent). */
  costUsd: number;
  billingMode: BillingMode;
  /** Human billing label from BillingContext, e.g. "Subscription (your selection)". */
  billingLabel: string;
  /** Metered session ceiling, if configured. */
  limitUsd?: number;
  /** Subscription advisory threshold, if configured. */
  subscriptionWarnUsd?: number;
}

export interface BudgetBarModel {
  /** Mode chip, e.g. "Subscription". */
  modeText: string;
  /** Cost text, e.g. "~$30.06 API equivalent · Advisory only". */
  costText: string;
  /** Ceiling suffix (metered only), e.g. "/ $15.00". */
  ceilingText: string;
  /** Fill percent for the bar, or null when no bar should render. */
  pct: number | null;
  tone: 'ok' | 'warn' | 'crit';
  pulsing: boolean;
  /** Tooltip. */
  title: string;
  /** Screen-reader label for the button. */
  ariaLabel: string;
}

const ACTION_HINT = 'Click or press Enter for billing and budget actions.';

function sanitize(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

export function buildBudgetBarModel(input: BudgetBarInput): BudgetBarModel {
  const cost = sanitize(input.costUsd);
  const limit = sanitize(input.limitUsd) || undefined;
  const costShort = `~$${cost.toFixed(2)}`;

  if (input.billingMode === 'metered') {
    if (limit !== undefined) {
      const pct = Math.min(100, (cost / limit) * 100);
      const text = `Metered API · ${costShort} / $${limit.toFixed(2)}`;
      return {
        modeText: 'Metered API',
        costText: costShort,
        ceilingText: `/ $${limit.toFixed(2)}`,
        pct,
        tone: pct >= 85 ? 'crit' : pct >= 60 ? 'warn' : 'ok',
        pulsing: pct >= 100,
        title:
          `${input.billingLabel} — estimated metered usage ${costShort} of the $${limit.toFixed(2)} session ceiling ` +
          `(${Math.round(pct)}%). New prompts pause at the ceiling. ${ACTION_HINT}`,
        ariaLabel: `Budget: ${text} (${Math.round(pct)} percent). ${ACTION_HINT}`,
      };
    }
    const text = `Metered API · ${costShort} estimated`;
    return {
      modeText: 'Metered API',
      costText: `${costShort} estimated`,
      ceilingText: '',
      pct: null,
      tone: 'ok',
      pulsing: false,
      title: `${input.billingLabel} — estimated metered usage ${costShort}; no session ceiling configured. ${ACTION_HINT}`,
      ariaLabel: `Budget: ${text}. ${ACTION_HINT}`,
    };
  }

  if (input.billingMode === 'subscription') {
    const text = `Subscription · ${costShort} API equivalent · Advisory only`;
    return {
      modeText: 'Subscription',
      costText: `${costShort} API equivalent · Advisory only`,
      ceilingText: '',
      pct: null,
      tone: 'ok',
      pulsing: false,
      title:
        `${input.billingLabel} — ${costShort} is an API-equivalent usage estimate, not a charge. ` +
        `Pantheon never blocks a subscription-backed session on this estimate; provider usage limits may still apply. ` +
        ACTION_HINT,
      ariaLabel: `Budget: ${text}. ${ACTION_HINT}`,
    };
  }

  const text = `Billing unknown · ${costShort} estimated`;
  return {
    modeText: 'Billing unknown',
    costText: `${costShort} estimated`,
    ceilingText: '',
    pct: null,
    tone: 'ok',
    pulsing: false,
    title:
      `${input.billingLabel} — Pantheon cannot verify whether this connection is subscription-backed or metered, ` +
      `so protection is advisory only. Set the billing mode to enable accurate protection. ${ACTION_HINT}`,
    ariaLabel: `Budget: ${text}. Billing mode unverified. ${ACTION_HINT}`,
  };
}
