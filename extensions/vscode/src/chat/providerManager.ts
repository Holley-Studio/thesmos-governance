// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * ProviderManager — lets Pantheon Chat route at other LLM providers/CLIs.
 *
 * Four tiers of support:
 *   1. Anthropic (default) — the user's own Claude Code login; no config.
 *   2. OpenAI Codex — a genuinely separate CLI (`codex`), also driven by the
 *      user's own subscription login (`codex login`), no API key. Note: OpenAI
 *      has not published explicit terms for third-party wrapper apps using a
 *      ChatGPT-subscription-authenticated Codex CLI the way Anthropic has for
 *      Claude Code — we surface that honestly in the picker rather than
 *      implying equivalent certainty.
 *   3. Native Anthropic-compatible providers (GLM, Kimi, DeepSeek) — these
 *      ship official Anthropic-compatible endpoints built for Claude Code;
 *      linking an account is just an API key, still driven by the `claude` CLI.
 *   4. Custom proxy — anything else (GPT, Gemini, local models) via an
 *      Anthropic-compatible translating proxy the user runs or subscribes to
 *      (LiteLLM, claude-code-router, OpenRouter shims), also via `claude` CLI.
 *
 * API keys are stored ONLY in VS Code SecretStorage (OS keychain), never in
 * settings files. Keys are read at spawn time and placed in the child
 * process env — they are never written to disk or logged. Login-based
 * providers (Anthropic, Codex) never touch a key at all — the CLI's own
 * `login` command owns that OAuth flow entirely outside our process.
 */

import * as vscode from 'vscode';

export interface ProviderPreset {
  id: string;
  label: string;
  /** Which CLI binary drives this provider. Defaults to 'claude'. */
  cli?: 'claude' | 'codex';
  /** Anthropic-compatible endpoint; undefined = provider's own default. */
  baseUrl?: string;
  /** Model choices shown in the chat header for this provider. */
  models: Array<{ id: string; label: string }>;
  /** Whether an API key must be linked before use. */
  needsKey: boolean;
  detail: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    label: '⚡ Anthropic (Claude)',
    models: [
      { id: '', label: 'account default' },
      { id: 'fable', label: 'Fable' },
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' },
    ],
    needsKey: false,
    detail: 'Your existing Claude Code login — no setup.',
  },
  {
    id: 'codex',
    label: '🌀 Codex (OpenAI)',
    cli: 'codex',
    models: [{ id: '', label: 'account default' }],
    needsKey: false,
    detail:
      'Your ChatGPT/Codex subscription login via the official codex CLI. ' +
      'Note: OpenAI has not published explicit terms for third-party apps built on a subscription-authenticated Codex CLI — you are running the official binary yourself, but link with that in mind.',
  },
  {
    id: 'glm',
    label: '🇿 GLM (Zhipu AI)',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: [{ id: '', label: 'provider default' }, { id: 'glm-4.7', label: 'GLM-4.7' }],
    needsKey: true,
    detail: 'Official Anthropic-compatible endpoint. Link with your Zhipu API key.',
  },
  {
    id: 'kimi',
    label: '🌙 Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    models: [{ id: '', label: 'provider default' }, { id: 'kimi-k2', label: 'Kimi K2' }],
    needsKey: true,
    detail: 'Official Anthropic-compatible endpoint. Link with your Moonshot API key.',
  },
  {
    id: 'deepseek',
    label: '🐋 DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    models: [
      { id: '', label: 'provider default' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
    needsKey: true,
    detail: 'Official Anthropic-compatible endpoint. Link with your DeepSeek API key.',
  },
  {
    id: 'custom',
    label: '🔗 Custom proxy (GPT, Gemini, local…)',
    models: [{ id: '', label: 'proxy default' }],
    needsKey: true,
    detail:
      'Any Anthropic-compatible proxy (LiteLLM, claude-code-router, OpenRouter shim) — routes GPT, Gemini, or local models.',
  },
];

interface ActiveProviderState {
  id: string;
  /** Custom proxies store their user-entered URL here. */
  customBaseUrl?: string;
  /** Free-text model id for custom proxies. */
  customModels?: string[];
}

const STATE_KEY = 'thesmos.pantheonChat.provider';
const secretKey = (providerId: string): string => `thesmos.pantheon.provider.${providerId}.apiKey`;

export class ProviderManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

  get active(): ProviderPreset {
    const saved = this.context.globalState.get<ActiveProviderState>(STATE_KEY);
    const preset = PROVIDER_PRESETS.find((p) => p.id === saved?.id) ?? PROVIDER_PRESETS[0];
    if (preset.id === 'custom' && saved?.customBaseUrl) {
      return {
        ...preset,
        baseUrl: saved.customBaseUrl,
        models: [
          { id: '', label: 'proxy default' },
          ...(saved.customModels ?? []).map((m) => ({ id: m, label: m })),
        ],
      };
    }
    return preset;
  }

  /**
   * Env overrides for the CLI subprocess, or undefined for plain Anthropic.
   * Returns null when the provider needs a key that has not been linked.
   */
  async envForActive(): Promise<Record<string, string> | undefined | null> {
    const preset = this.active;
    if (!preset.baseUrl) return undefined;
    const key = await this.context.secrets.get(secretKey(preset.id));
    if (!key) return null;
    return { ANTHROPIC_BASE_URL: preset.baseUrl, ANTHROPIC_AUTH_TOKEN: key };
  }

  /** Interactive picker: choose provider, link key if needed. Returns true on change. */
  async pick(): Promise<boolean> {
    const picked = await vscode.window.showQuickPick(
      PROVIDER_PRESETS.map((p) => ({ label: p.label, description: p.detail, id: p.id })),
      { title: 'Pantheon Chat — LLM Provider', placeHolder: 'Which power source feeds the gods?' },
    );
    if (!picked) return false;
    const preset = PROVIDER_PRESETS.find((p) => p.id === picked.id)!;

    const state: ActiveProviderState = { id: preset.id };

    if (preset.id === 'custom') {
      const url = await vscode.window.showInputBox({
        title: 'Anthropic-compatible proxy URL',
        prompt: 'e.g. http://localhost:4000 (LiteLLM) — the proxy translates to GPT/Gemini/local models',
        value: this.context.globalState.get<ActiveProviderState>(STATE_KEY)?.customBaseUrl ?? '',
        validateInput: (v) => (/^https?:\/\/.+/.test(v) ? undefined : 'Enter an http(s):// URL'),
      });
      if (!url) return false;
      state.customBaseUrl = url;
      const models = await vscode.window.showInputBox({
        title: 'Model ids (optional)',
        prompt: 'Comma-separated model ids your proxy serves, e.g. gpt-5.2, gemini-3-pro',
        value: (this.context.globalState.get<ActiveProviderState>(STATE_KEY)?.customModels ?? []).join(', '),
      });
      state.customModels = (models ?? '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean);
    }

    if (preset.cli === 'codex') {
      // Subscription login owned entirely by `codex login`'s own OAuth flow —
      // we never see a token, so there is nothing for us to store or manage.
      const terminal = vscode.window.createTerminal('Codex Login');
      terminal.show();
      terminal.sendText('codex login');
      void vscode.window.showInformationMessage(
        'Complete the Codex login in the terminal, then send a message in Pantheon Chat.',
      );
    }

    if (preset.needsKey) {
      const existing = await this.context.secrets.get(secretKey(preset.id));
      const key = await vscode.window.showInputBox({
        title: `${preset.label} — API key`,
        prompt: existing
          ? 'A key is already linked — leave blank to keep it, or paste a new one.'
          : 'Stored in your OS keychain via VS Code SecretStorage; never written to settings files.',
        password: true,
        ignoreFocusOut: true,
      });
      if (key === undefined) return false; // cancelled
      if (key) await this.context.secrets.store(secretKey(preset.id), key);
      else if (!existing) return false; // no key linked and none provided
    }

    await this.context.globalState.update(STATE_KEY, state);
    return true;
  }

  /** Remove a linked key (used by the unlink command). */
  async unlink(): Promise<void> {
    const linked: Array<{ label: string; id: string }> = [];
    for (const p of PROVIDER_PRESETS) {
      if (p.needsKey && (await this.context.secrets.get(secretKey(p.id)))) {
        linked.push({ label: p.label, id: p.id });
      }
    }
    if (linked.length === 0) {
      void vscode.window.showInformationMessage('Pantheon Chat: no linked provider keys.');
      return;
    }
    const picked = await vscode.window.showQuickPick(linked, { title: 'Unlink provider API key' });
    if (!picked) return;
    await this.context.secrets.delete(secretKey(picked.id));
    void vscode.window.showInformationMessage(`Pantheon Chat: unlinked ${picked.label}.`);
  }
}
