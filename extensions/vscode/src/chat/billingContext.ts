// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * BillingContext — explicit billing classification for Pantheon Chat sessions.
 *
 * The Budget Guardian must never treat an API-equivalent usage estimate as
 * actual billed spend. Whether a session is subscription-backed (Claude
 * Pro/Max/Team/Enterprise, ChatGPT/Codex login) or metered (Anthropic Console
 * key, GLM/Kimi/DeepSeek keys, proxies) changes what the estimate means — so
 * the classification is resolved here, once, and every consumer (policy,
 * controller, webview) receives a BillingContext instead of making ad hoc
 * provider assumptions.
 *
 * Resolution is deliberately conservative:
 *   - the provider being 'anthropic' proves nothing — the CLI login may be a
 *     subscription OAuth, a Console (metered) OAuth, or an API key;
 *   - the absence of one env var proves nothing either;
 *   - only the CLI's own auth report (`apiKeySource` in the stream-json init
 *     event), a linked per-token provider key, or an explicit user/workspace
 *     declaration is trusted;
 *   - anything ambiguous resolves to 'unknown', which the policy layer treats
 *     as advisory-only and asks the user to classify. Unknown never silently
 *     becomes subscription or metered.
 *
 * SECURITY: this module only ever sees a boolean `hasLinkedKey` — never key
 * material. A BillingContext is safe to log, persist, and post to the webview.
 */

export type BillingMode = 'subscription' | 'metered' | 'unknown';

export type BillingSource =
  | 'provider-auth'
  | 'workspace-config'
  | 'user-selection'
  | 'session-metadata'
  | 'unknown';

export type BillingConfidence = 'verified' | 'inferred' | 'unknown';

export interface BillingContext {
  mode: BillingMode;
  source: BillingSource;
  providerId: string;
  confidence: BillingConfidence;
  /** Short human label for the UI, e.g. "Subscription (your selection)". */
  label: string;
}

/**
 * Capability contract for provider integrations. Implementations may return a
 * verified subscription, a verified metered classification, or unknown — they
 * must never guess. Custom proxies default to unknown unless the user
 * explicitly classifies them.
 */
export interface ProviderBillingCapability {
  detectBillingContext(opts: {
    configMode?: 'auto' | 'subscription' | 'metered';
    apiKeySource?: string;
  }): Promise<BillingContext>;
}

/** Everything the pure resolver is allowed to know. No secrets, ever. */
export interface BillingSignals {
  providerId: string;
  /** Which CLI drives the provider ('claude' unless stated). */
  providerCli?: 'claude' | 'codex';
  /** Preset requires an API key AND one is linked. Boolean only — never the key. */
  hasLinkedKey: boolean;
  /** The user-configured Anthropic-compatible proxy preset. */
  isCustomProxy: boolean;
  /** tokenBudget.billingMode from .thesmos/config.json; 'auto'/absent = no explicit intent. */
  configMode?: 'auto' | 'subscription' | 'metered';
  /** Explicit in-product classification stored by Pantheon for this provider. */
  storedSelection?: 'subscription' | 'metered';
  /**
   * The Claude CLI's own auth report from the system/init stream-json event.
   * 'none' = OAuth login (subscription OR Console — ambiguous, so unknown);
   * a recognized key source = an API key is billing the session (metered).
   */
  apiKeySource?: string;
}

/**
 * apiKeySource values that mean "an API key authenticates this session".
 * The set is an allowlist on purpose: an unrecognized future value must fall
 * through to 'unknown', never be assumed metered or subscription.
 */
const API_KEY_SOURCES = new Set(['user', 'project', 'org', 'temporary', 'anthropic_api_key', 'apikeyhelper']);

const MODE_LABEL: Record<BillingMode, string> = {
  subscription: 'Subscription',
  metered: 'Metered API',
  unknown: 'Billing unknown',
};

function ctx(
  mode: BillingMode,
  source: BillingSource,
  providerId: string,
  confidence: BillingConfidence,
  detail: string,
): BillingContext {
  return { mode, source, providerId, confidence, label: `${MODE_LABEL[mode]} (${detail})` };
}

/**
 * Resolve the billing classification. Order (first match wins):
 *   1. explicit workspace config (tokenBudget.billingMode)
 *   2. explicit user selection stored by Pantheon
 *   3. verified provider authentication (per-token keys; custom proxy → unknown)
 *   4. session metadata (the Claude CLI's apiKeySource report)
 *   5. inference (codex login → subscription, 'inferred' — display-only;
 *      never grants the enforcement exemption verified subscription gets)
 *   6. unknown
 */
export function resolveBillingContext(signals: BillingSignals): BillingContext {
  const id = signals.providerId;

  // 1. Explicit workspace configuration — the strongest statement of intent.
  if (signals.configMode === 'subscription' || signals.configMode === 'metered') {
    return ctx(signals.configMode, 'workspace-config', id, 'verified', 'workspace config');
  }

  // 2. Explicit user selection stored by Pantheon (survives new sessions).
  if (signals.storedSelection === 'subscription' || signals.storedSelection === 'metered') {
    return ctx(signals.storedSelection, 'user-selection', id, 'verified', 'your selection');
  }

  // 3. Provider authentication.
  if (signals.isCustomProxy) {
    // A proxy may front a subscription, a metered account, or a local model —
    // unknowable from here. Never assume metered just because a key is linked.
    return ctx('unknown', 'provider-auth', id, 'unknown', 'custom proxy — classify to enable protection');
  }
  if (signals.hasLinkedKey) {
    // GLM/Kimi/DeepSeek presets: the linked key is a pay-per-token credential.
    // Checked before any inference — a verified metered signal must never be
    // outranked by an inferred classification.
    return ctx('metered', 'provider-auth', id, 'verified', 'linked API key');
  }

  // 4. Session metadata — the Claude CLI's own report of how it authenticated.
  if (typeof signals.apiKeySource === 'string' && signals.apiKeySource.length > 0) {
    const source = signals.apiKeySource.toLowerCase();
    if (API_KEY_SOURCES.has(source)) {
      return ctx('metered', 'session-metadata', id, 'verified', 'API key auth');
    }
    // 'none' = OAuth login — could be a subscription OR a metered Console
    // account. Unrecognized values are treated the same: unknown, not a guess.
    return ctx('unknown', 'session-metadata', id, 'unknown', 'unverified — classify to enable protection');
  }

  // 5. Inference — display-only. `codex login` OAuth is subscription-shaped
  //    (no API key ever touches the extension, and Codex reports no cost), but
  //    no metadata we can read proves it, so confidence stays 'inferred'.
  //    budgetPolicy only grants the subscription never-block exemption at
  //    'verified' confidence — an inferred label can never disable a real
  //    spending guard, it only decorates the UI.
  if (signals.providerCli === 'codex') {
    return ctx('subscription', 'provider-auth', id, 'inferred', 'codex login — inferred, not verified');
  }

  // 6. Nothing reliable yet (e.g. no turn has run, so no init metadata).
  return ctx('unknown', 'unknown', id, 'unknown', 'unverified — classify to enable protection');
}
