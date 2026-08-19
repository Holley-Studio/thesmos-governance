// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Home — the summoning surface.
 *
 * The primary act is "state a mission", not "start a chat", so the composer
 * dominates rather than sitting in a sidebar. Submission is deliberately inert
 * in this alpha: the mission runtime is not yet wired through IPC, and a
 * composer that appeared to accept work it cannot execute would be a lie told
 * in the most prominent place in the product.
 */
import { useState} from 'react';
import type { JSX } from 'react';
import type { RuntimeHealth } from '../ipc/runtime';

export function Home({
  health,
  onOpenProject,
}: {
  health: RuntimeHealth | null;
  onOpenProject: () => void;
}): JSX.Element {
  const [intent, setIntent] = useState('');
  const hasProject = Boolean(health?.projectRoot);

  return (
    <section className="home">
      <div className="home-monument">
        <h1 className="hero">THESMOS</h1>
        <p className="hero-sub">What shall the gods accomplish?</p>
      </div>

      <div className="composer">
        <label className="sr-only" htmlFor="mission-intent">
          Mission intent
        </label>
        <textarea
          id="mission-intent"
          className="composer-input"
          rows={4}
          placeholder={
            hasProject
              ? 'Continue fixing the staging migration certification failure…'
              : 'Choose a project before stating a mission…'
          }
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          disabled={!hasProject}
        />
        <div className="composer-foot">
          <span className="composer-note">
            {hasProject
              ? 'Mission execution is not yet connected in this alpha.'
              : 'No project granted yet.'}
          </span>
          {hasProject ? (
            <button type="button" className="btn-authority" disabled title="Not yet connected">
              Summon Council
            </button>
          ) : (
            <button type="button" className="btn-authority" onClick={onOpenProject}>
              Choose Project
            </button>
          )}
        </div>
      </div>

      <div className="home-facts">
        <div className="fact">
          <span className="label">Runtime</span>
          <span className="fact-value">{health ? `Ready · v${health.version}` : 'Starting…'}</span>
        </div>
        <div className="fact">
          <span className="label">Memory</span>
          <span className="fact-value">
            {health?.memory.available
              ? `${health.memory.records ?? 0} records`
              : (health?.memory.detail ?? '—')}
          </span>
        </div>
        <div className="fact">
          <span className="label">Uptime</span>
          <span className="fact-value">
            {health ? `${Math.round(health.uptimeMs / 1000)}s` : '—'}
          </span>
        </div>
      </div>
    </section>
  );
}
