// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Budget Guardian decision-matrix tests. Every cell of the billing-aware
 * matrix is covered, plus hostile-input sanitization and old-config
 * compatibility. The controller and webview never reimplement this logic —
 * these tests are the enforcement contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  decideBudget,
  parseTokenBudgetSettings,
  readTokenBudgetSettings,
  DEFAULT_WARN_FRACTION,
  type TokenBudgetSettings,
} from '../chat/budgetPolicy.js';
import type { BillingContext } from '../chat/billingContext.js';

const billing = (mode: BillingContext['mode']): BillingContext => ({
  mode,
  source: 'user-selection',
  providerId: 'anthropic',
  confidence: 'verified',
  label: `${mode} (test)`,
});

const settings = (over: Partial<TokenBudgetSettings> = {}): TokenBudgetSettings => ({
  limitUsd: 15,
  billingMode: 'auto',
  warnAtFraction: 0.8,
  subscriptionWarnUsd: 30,
  ...over,
});

describe('decideBudget — subscription', () => {
  it('continues silently below the warning fraction', () => {
    const d = decideBudget(10, billing('subscription'), settings());
    expect(d).toMatchObject({ state: 'ok', enforcement: 'none' });
  });

  it('advises (never warns as spend) above the warning fraction', () => {
    const d = decideBudget(25, billing('subscription'), settings()); // 25 >= 30*0.8
    expect(d).toMatchObject({ state: 'warn', enforcement: 'advisory' });
    expect(d.message).toContain('API-equivalent usage estimate');
    expect(d.message).not.toMatch(/spent|charged|actual cost/i);
  });

  it('continues with advisory above the configured ceiling — NEVER blocks', () => {
    const d = decideBudget(30.06, billing('subscription'), settings());
    expect(d.state).toBe('limit-reached');
    expect(d.enforcement).toBe('advisory');
    expect(d.message).toContain('API-equivalent usage is approximately $30.06');
    expect(d.message).toContain('will not block');
    expect(d.message).not.toMatch(/spent|charged|actual cost/i);
  });

  it('never blocks even far past every configured number', () => {
    const d = decideBudget(9999, billing('subscription'), settings());
    expect(d.enforcement).toBe('advisory');
  });

  it('falls back to the metered ceiling as advisory threshold when subscriptionWarnUsd is unset', () => {
    const d = decideBudget(15, billing('subscription'), settings({ subscriptionWarnUsd: undefined }));
    expect(d).toMatchObject({ state: 'limit-reached', enforcement: 'advisory' });
  });

  it('is ok with no thresholds configured at all', () => {
    const d = decideBudget(500, billing('subscription'), settings({ limitUsd: undefined, subscriptionWarnUsd: undefined }));
    expect(d).toMatchObject({ state: 'ok', enforcement: 'none' });
  });
});

describe('decideBudget — metered', () => {
  it('continues below the warning fraction', () => {
    expect(decideBudget(11.9, billing('metered'), settings())).toMatchObject({ state: 'ok', enforcement: 'none' });
  });

  it('warns exactly at the warning fraction', () => {
    const d = decideBudget(12, billing('metered'), settings()); // 15 * 0.8
    expect(d).toMatchObject({ state: 'warn', enforcement: 'advisory' });
    expect(d.message).toContain('Estimated metered usage');
  });

  it('still only warns immediately below the limit', () => {
    expect(decideBudget(14.99, billing('metered'), settings()).enforcement).toBe('advisory');
  });

  it('blocks exactly at the limit (fail-closed)', () => {
    const d = decideBudget(15, billing('metered'), settings());
    expect(d).toMatchObject({ state: 'limit-reached', enforcement: 'block' });
    expect(d.message).toContain('$15.00 of your $15.00 session ceiling');
    expect(d.message).toContain('paused to prevent additional API usage');
  });

  it('blocks above the limit', () => {
    expect(decideBudget(22.5, billing('metered'), settings()).enforcement).toBe('block');
  });

  it('does not claim verified actual spend — copy says estimated', () => {
    const d = decideBudget(15, billing('metered'), settings());
    expect(d.message).toMatch(/estimated/i);
    expect(d.message).not.toMatch(/charged|actual cost/i);
  });

  it('cannot block when no limit is configured', () => {
    const d = decideBudget(1000, billing('metered'), settings({ limitUsd: undefined }));
    expect(d).toMatchObject({ state: 'ok', enforcement: 'none' });
  });

  it('respects a custom warning fraction', () => {
    const d = decideBudget(7.5, billing('metered'), settings({ warnAtFraction: 0.5 }));
    expect(d.state).toBe('warn');
  });
});

describe('decideBudget — unknown', () => {
  it('continues below the warning fraction', () => {
    expect(decideBudget(5, billing('unknown'), settings())).toMatchObject({ state: 'ok', enforcement: 'none' });
  });

  it('advises above the warning fraction and asks for classification', () => {
    const d = decideBudget(12.5, billing('unknown'), settings());
    expect(d).toMatchObject({ state: 'warn', enforcement: 'advisory' });
    expect(d.message).toContain('cannot verify');
    expect(d.message).toContain('Select the billing mode');
  });

  it('continues (advisory, never block) above the limit and requests classification', () => {
    const d = decideBudget(30.06, billing('unknown'), settings());
    expect(d).toMatchObject({ state: 'limit-reached', enforcement: 'advisory' });
    expect(d.message).toContain('approximately $30.06 in API-equivalent usage');
    expect(d.message).toContain('cannot verify whether this connection is subscription-backed or metered');
  });
});

describe('decideBudget — inferred classifications never gate enforcement', () => {
  // The invariant: an INFERRED classification (e.g. codex-login → subscription)
  // must never trigger or disable monetary enforcement. Only verified
  // subscription earns the never-block exemption; inferred subscription takes
  // the unknown row — advisory plus a classification request.
  const inferredSubscription = (): BillingContext => ({
    mode: 'subscription',
    source: 'provider-auth',
    providerId: 'codex',
    confidence: 'inferred',
    label: 'Subscription (codex login — inferred, not verified)',
  });

  it('inferred subscription over the ceiling is advisory and requests classification — not a silent subscription pass', () => {
    const d = decideBudget(30.06, inferredSubscription(), settings());
    expect(d.enforcement).toBe('advisory');
    expect(d.message).toContain('cannot verify');
    expect(d.message).not.toContain('will not block');
  });

  it('inferred subscription never blocks either (no enforcement is triggered by an inference)', () => {
    expect(decideBudget(9999, inferredSubscription(), settings()).enforcement).not.toBe('block');
  });

  it('codex today reports no cost, so the inferred label stays entirely silent', () => {
    expect(decideBudget(0, inferredSubscription(), settings())).toMatchObject({ state: 'ok', enforcement: 'none' });
  });

  it('verified subscription keeps the exemption (control case)', () => {
    const d = decideBudget(30.06, billing('subscription'), settings());
    expect(d.message).toContain('will not block');
  });
});

describe('decideBudget — hostile/invalid inputs', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['negative', -3],
    ['zero', 0],
  ])('sanitizes %s estimated cost to 0 (never a bogus block)', (_label, cost) => {
    const d = decideBudget(cost as number, billing('metered'), settings());
    if (Number.isFinite(cost) && (cost as number) <= 0) {
      expect(d.estimatedCostUsd).toBe(0);
    }
    expect(d.enforcement).not.toBe('block');
    expect(d.state).toBe('ok');
  });

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -5],
    ['zero', 0],
  ])('treats a %s limit as "no limit configured"', (_label, limit) => {
    const d = decideBudget(100, billing('metered'), settings({ limitUsd: limit as number }));
    expect(d.configuredLimitUsd).toBeUndefined();
    expect(d.enforcement).toBe('none');
  });

  it.each([
    ['zero', 0],
    ['one', 1],
    ['above one', 3],
    ['NaN', NaN],
    ['negative', -0.5],
  ])('falls back to the default warn fraction for %s', (_label, f) => {
    // 12/15 = 0.8 → warn under the default; a bogus fraction must not change that
    const d = decideBudget(12, billing('metered'), settings({ warnAtFraction: f as number }));
    expect(d.state).toBe('warn');
  });

  it('is deterministic — same inputs, same decision', () => {
    const a = decideBudget(12.34, billing('unknown'), settings());
    const b = decideBudget(12.34, billing('unknown'), settings());
    expect(a).toEqual(b);
  });
});

describe('parseTokenBudgetSettings — config compatibility', () => {
  it('keeps an old sessionMaxCostUSD-only config working, as auto (NOT confirmed metered)', () => {
    const s = parseTokenBudgetSettings({ tokenBudget: { sessionMaxCostUSD: 15 } });
    expect(s.limitUsd).toBe(15);
    expect(s.billingMode).toBe('auto');
    expect(s.warnAtFraction).toBe(DEFAULT_WARN_FRACTION);
  });

  it('reads an explicit billingMode', () => {
    expect(parseTokenBudgetSettings({ tokenBudget: { billingMode: 'subscription' } }).billingMode).toBe('subscription');
    expect(parseTokenBudgetSettings({ tokenBudget: { billingMode: 'metered' } }).billingMode).toBe('metered');
  });

  it('rejects unsupported billing modes back to auto', () => {
    expect(parseTokenBudgetSettings({ tokenBudget: { billingMode: 'free-lunch' } }).billingMode).toBe('auto');
  });

  it('falls back to the CLI-side alertAt for the warn fraction', () => {
    expect(parseTokenBudgetSettings({ tokenBudget: { alertAt: 0.5 } }).warnAtFraction).toBe(0.5);
  });

  it('prefers warnAtFraction over alertAt when both exist', () => {
    expect(parseTokenBudgetSettings({ tokenBudget: { warnAtFraction: 0.6, alertAt: 0.9 } }).warnAtFraction).toBe(0.6);
  });

  it.each([
    ['null', null],
    ['a string', 'nonsense'],
    ['a number', 42],
    ['missing tokenBudget', {}],
  ])('never throws on %s and returns safe defaults', (_label, raw) => {
    const s = parseTokenBudgetSettings(raw);
    expect(s.billingMode).toBe('auto');
    expect(s.limitUsd).toBeUndefined();
  });

  it('rejects non-positive/non-finite monetary values', () => {
    for (const bad of [0, -1, NaN, Infinity, 'lots']) {
      const s = parseTokenBudgetSettings({
        tokenBudget: { sessionMaxCostUSD: bad, subscriptionWarningEquivalentUSD: bad },
      });
      expect(s.limitUsd).toBeUndefined();
      expect(s.subscriptionWarnUsd).toBeUndefined();
    }
  });
});

describe('readTokenBudgetSettings', () => {
  let root: string;
  beforeEach(() => {
    root = join(tmpdir(), `thesmos-budget-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, '.thesmos'), { recursive: true });
  });
  afterEach(() => {
    try { rmSync(root, { recursive: true }); } catch { /* */ }
  });

  it('reads a valid config from disk', () => {
    writeFileSync(
      join(root, '.thesmos', 'config.json'),
      JSON.stringify({ tokenBudget: { sessionMaxCostUSD: 7, billingMode: 'metered' } }),
    );
    const s = readTokenBudgetSettings(root);
    expect(s.limitUsd).toBe(7);
    expect(s.billingMode).toBe('metered');
  });

  it('returns safe defaults when the config is missing', () => {
    expect(readTokenBudgetSettings(join(root, 'nowhere')).billingMode).toBe('auto');
  });

  it('returns safe defaults on malformed JSON — and never echoes config content', () => {
    writeFileSync(join(root, '.thesmos', 'config.json'), '{"tokenBudget": SECRET-not-json');
    const s = readTokenBudgetSettings(root);
    expect(s.billingMode).toBe('auto');
    expect(JSON.stringify(s)).not.toContain('SECRET');
  });
});
