// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Desktop — application shell.
 *
 * Structure over decoration: a fixed left colonnade for navigation, a plinth
 * header carrying project and runtime state, and one content plane. No nested
 * cards; sections are separated by rule lines and inscribed labels, the way a
 * building separates spaces.
 *
 * Every surface below shows real runtime data or says plainly that it has none.
 * Nothing here renders invented content to look finished.
 */

import { useCallback, useEffect, useState} from 'react';
import type { JSX } from 'react';
import { chooseProjectFolder, runtime, type RuntimeHealth } from '../ipc/runtime';
import { Home } from '../features/Home';
import { Providers } from '../features/Providers';
import { Archive } from '../features/Archive';
import { Pantheon } from '../features/Pantheon';

type Surface = 'home' | 'missions' | 'pantheon' | 'archive' | 'providers' | 'settings';

const NAV: Array<{ id: Surface; label: string; ready: boolean }> = [
  { id: 'home', label: 'Home', ready: true },
  { id: 'missions', label: 'Missions', ready: false },
  { id: 'pantheon', label: 'Pantheon', ready: true },
  { id: 'archive', label: 'Mnemosyne', ready: true },
  { id: 'providers', label: 'Providers', ready: true },
  { id: 'settings', label: 'Settings', ready: true },
];

type Theme = 'olympus' | 'nocturne';

export function App(): JSX.Element {
  const [surface, setSurface] = useState<Surface>('home');
  const [health, setHealth] = useState<RuntimeHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('thesmos.theme') as Theme) ?? 'olympus',
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('thesmos.theme', theme);
  }, [theme]);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await runtime.health());
      setHealthError(null);
    } catch (err) {
      // A runtime that will not answer is shown, not hidden behind a spinner.
      setHealth(null);
      setHealthError(err instanceof Error ? err.message : 'runtime unreachable');
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const timer = setInterval(() => void refreshHealth(), 10_000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  const openProject = useCallback(async () => {
    const root = await chooseProjectFolder();
    if (!root) return;
    await runtime.openProject(root);
    await refreshHealth();
  }, [refreshHealth]);

  const projectName = health?.projectRoot?.split(/[\\/]/).filter(Boolean).pop();

  return (
    <div className="shell">
      <nav className="colonnade" aria-label="Primary">
        <div className="wordmark">
          <span className="wordmark-text">THESMOS</span>
          <span className="wordmark-sub">Governed Agent OS</span>
        </div>

        <ul className="nav-list">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="nav-item"
                aria-current={surface === item.id ? 'page' : undefined}
                aria-disabled={!item.ready}
                onClick={() => item.ready && setSurface(item.id)}
              >
                <span>{item.label}</span>
                {/* Honest labelling — an unbuilt surface says so rather than
                    opening an empty screen. */}
                {!item.ready && <span className="nav-soon">soon</span>}
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="theme-toggle"
          onClick={() => setTheme(theme === 'olympus' ? 'nocturne' : 'olympus')}
        >
          {theme === 'olympus' ? 'Nocturne' : 'Olympus'}
        </button>
      </nav>

      <div className="main">
        <header className="plinth">
          <div className="plinth-project">
            <span className="label">Project</span>
            <button type="button" className="project-button" onClick={() => void openProject()}>
              {projectName ?? 'Choose a project…'}
            </button>
          </div>

          <div className="plinth-runtime">
            <span className="label">Runtime</span>
            <span
              className="runtime-state"
              data-state={healthError ? 'blocked' : health ? 'active' : 'dormant'}
            >
              {/* State is never colour-only: the word is the primary signal. */}
              {healthError ? 'Unreachable' : health ? `Ready · v${health.version}` : 'Starting…'}
            </span>
          </div>
        </header>

        <main className="plane">
          {surface === 'home' && <Home health={health} onOpenProject={() => void openProject()} />}
          {surface === 'pantheon' && <Pantheon />}
          {surface === 'archive' && <Archive hasProject={Boolean(health?.projectRoot)} />}
          {surface === 'providers' && <Providers />}
          {surface === 'settings' && (
            <section className="section">
              <h2 className="inscription">Settings</h2>
              <dl className="facts">
                <dt>Theme</dt>
                <dd>{theme === 'olympus' ? 'Olympus (light)' : 'Nocturne (dark)'}</dd>
                <dt>Runtime version</dt>
                <dd>{health?.version ?? '—'}</dd>
                <dt>Runtime pid</dt>
                <dd>{health?.pid ?? '—'}</dd>
                <dt>Project root</dt>
                <dd className="mono">{health?.projectRoot ?? 'none granted'}</dd>
                <dt>Memory store</dt>
                <dd>
                  {health?.memory.available
                    ? `${health.memory.records ?? 0} records`
                    : (health?.memory.detail ?? 'unavailable')}
                </dd>
              </dl>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
