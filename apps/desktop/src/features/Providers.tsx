// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Providers — choose your intelligence.
 *
 * Billing class is shown verbatim from the runtime rather than simplified to
 * "free". Local inference costs the user's hardware; calling that free is the
 * exact dishonesty the provider contracts were designed to prevent.
 *
 * Only Ollama appears because only Ollama is implemented. The subscription and
 * API providers are named as unbuilt rather than shown as broken buttons.
 */
import { useEffect, useState} from 'react';
import type { JSX } from 'react';
import { runtime, type ProviderSummary } from '../ipc/runtime';

const BILLING_LABEL: Record<string, string> = {
  'local-compute': 'Local compute',
  'metered-api': 'API billing',
  subscription: 'Subscription',
};

export function Providers(): JSX.Element {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    runtime
      .providers()
      .then(setProviders)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'failed to list providers'));
  }, []);

  return (
    <section className="section">
      <h2 className="inscription">Choose your intelligence</h2>

      {error && <p className="notice">{error}</p>}
      {!providers && !error && <p className="notice">Discovering providers…</p>}

      {providers?.map((p) => (
        <article key={p.id} className="provider">
          <header className="provider-head">
            <div>
              <h3 className="provider-name">{p.label}</h3>
              <span className="provider-meta">
                {p.locality === 'local' ? 'Local compute' : `${p.locality} endpoint`} · {p.endpoint}
              </span>
            </div>
            <span className="runtime-state" data-state={p.available ? 'active' : 'dormant'}>
              {p.available ? `Running${p.latencyMs !== undefined ? ` · ${p.latencyMs}ms` : ''}` : 'Stopped'}
            </span>
          </header>

          {!p.available && p.detail && <p className="notice">{p.detail}</p>}

          {p.models.length > 0 && (
            <ul className="model-list">
              {p.models.map((m) => (
                <li key={m.id} className="model">
                  <span className="model-id">{m.id}</span>
                  <span className="model-meta">
                    {m.parameterSize ? `${m.parameterSize} · ` : ''}
                    {BILLING_LABEL[m.billingClass] ?? m.billingClass}
                    {m.privacyClass === 'local-only' ? ' · stays on this machine' : ' · leaves this machine'}
                    {m.contextWindow ? ` · ${(m.contextWindow / 1024).toFixed(0)}k context` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {p.available && p.models.length === 0 && (
            <p className="notice">No models installed. Pull one with `ollama pull &lt;model&gt;`.</p>
          )}
        </article>
      ))}

      <div className="unbuilt">
        <span className="label">Not yet connected</span>
        <p>
          Claude (subscription), Anthropic API, OpenAI Codex (subscription) and OpenAI API adapters
          are specified but not implemented in this alpha. They are listed here rather than shown as
          buttons that would not work.
        </p>
      </div>
    </section>
  );
}
