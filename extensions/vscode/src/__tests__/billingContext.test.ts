// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Billing-classification tests. The resolver must never guess: only explicit
 * declarations, per-token provider keys, or the Claude CLI's own auth report
 * classify a session; everything ambiguous is 'unknown'.
 */
import { describe, it, expect } from 'vitest';
import { resolveBillingContext, type BillingSignals } from '../chat/billingContext.js';

const anthropic = (over: Partial<BillingSignals> = {}): BillingSignals => ({
  providerId: 'anthropic',
  hasLinkedKey: false,
  isCustomProxy: false,
  ...over,
});

describe('resolveBillingContext — resolution order', () => {
  it('workspace config wins over everything, including a stored selection and key auth', () => {
    const c = resolveBillingContext(
      anthropic({ configMode: 'subscription', storedSelection: 'metered', apiKeySource: 'user' }),
    );
    expect(c).toMatchObject({ mode: 'subscription', source: 'workspace-config', confidence: 'verified' });
  });

  it('explicit user selection wins over detection signals', () => {
    const c = resolveBillingContext(anthropic({ storedSelection: 'metered', apiKeySource: 'none' }));
    expect(c).toMatchObject({ mode: 'metered', source: 'user-selection', confidence: 'verified' });
  });

  it("configMode 'auto' does not count as an explicit declaration", () => {
    const c = resolveBillingContext(anthropic({ configMode: 'auto' }));
    expect(c.source).not.toBe('workspace-config');
  });
});

describe('resolveBillingContext — provider auth', () => {
  it('classifies a per-token provider key (GLM/Kimi/DeepSeek) as verified metered', () => {
    const c = resolveBillingContext({ providerId: 'deepseek', hasLinkedKey: true, isCustomProxy: false });
    expect(c).toMatchObject({ mode: 'metered', source: 'provider-auth', confidence: 'verified' });
  });

  it('a custom proxy is ALWAYS unknown unless explicitly classified — even with a key linked', () => {
    const c = resolveBillingContext({ providerId: 'custom', hasLinkedKey: true, isCustomProxy: true });
    expect(c).toMatchObject({ mode: 'unknown', confidence: 'unknown' });
  });

  it('a classified custom proxy honors the selection', () => {
    const c = resolveBillingContext({
      providerId: 'custom',
      hasLinkedKey: true,
      isCustomProxy: true,
      storedSelection: 'subscription',
    });
    expect(c).toMatchObject({ mode: 'subscription', source: 'user-selection' });
  });

  it('codex login is subscription-shaped but only inferred, never verified', () => {
    const c = resolveBillingContext({
      providerId: 'codex',
      providerCli: 'codex',
      hasLinkedKey: false,
      isCustomProxy: false,
    });
    expect(c).toMatchObject({ mode: 'subscription', source: 'provider-auth', confidence: 'inferred' });
    expect(c.label).toContain('inferred');
  });

  it('a verified metered signal outranks the codex inference — a linked key wins', () => {
    // The invariant: an inferred classification must never disable a genuine
    // spending guard for a provider that reports metered cost.
    const c = resolveBillingContext({
      providerId: 'codex',
      providerCli: 'codex',
      hasLinkedKey: true,
      isCustomProxy: false,
    });
    expect(c).toMatchObject({ mode: 'metered', source: 'provider-auth', confidence: 'verified' });
  });

  it('verified session metadata outranks the codex inference too', () => {
    const c = resolveBillingContext({
      providerId: 'codex',
      providerCli: 'codex',
      hasLinkedKey: false,
      isCustomProxy: false,
      apiKeySource: 'user',
    });
    expect(c).toMatchObject({ mode: 'metered', source: 'session-metadata', confidence: 'verified' });
  });
});

describe('resolveBillingContext — session metadata (Claude CLI apiKeySource)', () => {
  it.each(['user', 'project', 'org', 'temporary', 'ANTHROPIC_API_KEY', 'apiKeyHelper'])(
    'recognized key source %s → verified metered',
    (source) => {
      const c = resolveBillingContext(anthropic({ apiKeySource: source }));
      expect(c).toMatchObject({ mode: 'metered', source: 'session-metadata', confidence: 'verified' });
    },
  );

  it("'none' (OAuth login) is UNKNOWN — never assumed to be a subscription", () => {
    // An OAuth login can be a Pro/Max subscription OR a metered Console
    // account; the provider being 'anthropic' proves nothing either way.
    const c = resolveBillingContext(anthropic({ apiKeySource: 'none' }));
    expect(c.mode).toBe('unknown');
  });

  it('an unrecognized future apiKeySource value is unknown, not a guess', () => {
    const c = resolveBillingContext(anthropic({ apiKeySource: 'quantum-vault-v9' }));
    expect(c.mode).toBe('unknown');
  });
});

describe('resolveBillingContext — fallback and hygiene', () => {
  it('no signals at all → unknown/unknown', () => {
    const c = resolveBillingContext(anthropic());
    expect(c).toMatchObject({ mode: 'unknown', source: 'unknown', confidence: 'unknown' });
  });

  it('detection failure semantics: absence of an env-var-shaped signal never implies subscription', () => {
    const c = resolveBillingContext(anthropic({ apiKeySource: undefined }));
    expect(c.mode).not.toBe('subscription');
  });

  it('carries a human label and the provider id', () => {
    const c = resolveBillingContext(anthropic({ storedSelection: 'subscription' }));
    expect(c.providerId).toBe('anthropic');
    expect(c.label).toContain('Subscription');
  });

  it('never serializes secret material — the context only ever holds classification fields', () => {
    const c = resolveBillingContext({
      providerId: 'glm',
      hasLinkedKey: true, // boolean only — resolver never sees the key itself
      isCustomProxy: false,
    });
    expect(Object.keys(c).sort()).toEqual(['confidence', 'label', 'mode', 'providerId', 'source']);
    // The signals input only carries a boolean; no credential-shaped content
    // can appear in the serialized context.
    expect(JSON.stringify(c)).not.toMatch(/sk-|bearer|secret/i);
  });
});
