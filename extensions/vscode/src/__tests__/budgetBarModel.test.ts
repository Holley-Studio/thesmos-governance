// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Budget-bar view-model tests. The webview renders exactly what this model
 * returns, via textContent only — so these tests are the webview's label,
 * tooltip, accessibility, and injection-safety contract.
 */
import { describe, it, expect } from 'vitest';
import { buildBudgetBarModel } from '../chat/budgetBarModel.js';

describe('buildBudgetBarModel — mode labels', () => {
  it('subscription: API-equivalent, advisory-only, no fill bar', () => {
    const m = buildBudgetBarModel({
      costUsd: 30.06,
      billingMode: 'subscription',
      billingLabel: 'Subscription (your selection)',
      limitUsd: 15,
      subscriptionWarnUsd: 30,
    });
    expect(m.modeText).toBe('Subscription');
    expect(m.costText).toBe('~$30.06 API equivalent · Advisory only');
    expect(m.pct).toBeNull();
    expect(m.pulsing).toBe(false);
    expect(m.title).toContain('not a charge');
    expect(m.title).not.toMatch(/spent|charged/i);
  });

  it('metered with a ceiling: cost / limit with a fill bar', () => {
    const m = buildBudgetBarModel({
      costUsd: 12.4,
      billingMode: 'metered',
      billingLabel: 'Metered API (linked API key)',
      limitUsd: 15,
    });
    expect(m.modeText).toBe('Metered API');
    expect(m.costText).toBe('~$12.40');
    expect(m.ceilingText).toBe('/ $15.00');
    expect(m.pct).toBeCloseTo(82.67, 1);
    expect(m.tone).toBe('warn');
  });

  it('metered at/over the ceiling: crit tone, pulsing, pct capped at 100', () => {
    const m = buildBudgetBarModel({ costUsd: 16, billingMode: 'metered', billingLabel: 'Metered API', limitUsd: 15 });
    expect(m.pct).toBe(100);
    expect(m.tone).toBe('crit');
    expect(m.pulsing).toBe(true);
  });

  it('metered without a ceiling: estimate only, no bar', () => {
    const m = buildBudgetBarModel({ costUsd: 3, billingMode: 'metered', billingLabel: 'Metered API' });
    expect(m.costText).toBe('~$3.00 estimated');
    expect(m.pct).toBeNull();
  });

  it('unknown: estimated label plus a classification hint', () => {
    const m = buildBudgetBarModel({ costUsd: 8.21, billingMode: 'unknown', billingLabel: 'Billing unknown' });
    expect(m.modeText).toBe('Billing unknown');
    expect(m.costText).toBe('~$8.21 estimated');
    expect(m.pct).toBeNull();
    expect(m.title).toContain('cannot verify');
    expect(m.ariaLabel).toContain('unverified');
  });
});

describe('buildBudgetBarModel — accessibility and actions', () => {
  it.each(['subscription', 'metered', 'unknown'] as const)('%s carries an aria label and action hint', (mode) => {
    const m = buildBudgetBarModel({ costUsd: 1, billingMode: mode, billingLabel: 'x', limitUsd: 10 });
    expect(m.ariaLabel.length).toBeGreaterThan(10);
    expect(m.title).toContain('press Enter');
  });
});

describe('buildBudgetBarModel — hostile inputs', () => {
  it.each([NaN, Infinity, -Infinity, -5])('sanitizes %p cost to $0.00', (cost) => {
    const m = buildBudgetBarModel({ costUsd: cost, billingMode: 'unknown', billingLabel: 'x' });
    expect(m.costText).toContain('$0.00');
  });

  it('treats a NaN/negative limit as no ceiling', () => {
    const m = buildBudgetBarModel({ costUsd: 5, billingMode: 'metered', billingLabel: 'x', limitUsd: NaN });
    expect(m.pct).toBeNull();
  });

  it('passes a malicious provider label through as inert text (rendered via textContent)', () => {
    const evil = '<img src=x onerror=alert(1)>"; window.x=1; "';
    const m = buildBudgetBarModel({ costUsd: 5, billingMode: 'subscription', billingLabel: evil });
    // The model must not transform, interpret, or wrap the label in markup —
    // it flows into title/aria as plain text and the webview uses textContent
    // and setAttribute exclusively, so no HTML/JS context ever evaluates it.
    expect(m.title).toContain(evil);
    expect(m.modeText).toBe('Subscription');
    expect(m.costText).not.toContain('<');
  });
});
