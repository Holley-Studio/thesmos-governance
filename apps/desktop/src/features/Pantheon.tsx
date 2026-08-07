// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pantheon — the council chamber.
 *
 * **The runtime catalog is the source of truth.** The agent list arrives over
 * IPC from `listRoutableAgents()`; the desktop keeps no roster of its own. An
 * earlier version of this file hardcoded eight gods, which would have drifted
 * the moment an agent was added or held back — the exact failure that once left
 * 25 shipped agents undiscoverable.
 *
 * Sigils are still local, because they are *presentation*: geometric marks
 * derived from a god's domain, not data. Gods without a drawn sigil fall back
 * to a neutral mark rather than being hidden — the catalog decides who exists,
 * never this file.
 *
 * Primary roles lead; the full routable population is available behind a
 * disclosure rather than dumped as a flat grid.
 */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { runtime, type PantheonAgentSummary } from '../ipc/runtime';

/** Gods shown first. Presentation ordering only — not an availability filter. */
const PRIMARY = [
  'Zeus',
  'Athena',
  'Argus',
  'Daedalus',
  'Mnemosyne',
  'Themis',
  'Hermes',
  'Hephaestus',
];

/* Geometry, not illustration: each mark derives from the god's function. */
const SIGILS: Record<string, JSX.Element> = {
  Zeus: <polyline points="26,6 14,26 24,26 18,42 34,20 24,20 30,6" fill="none" strokeWidth="1.5" />,
  Athena: (
    <>
      <path d="M24 6 L38 16 L38 34 L24 42 L10 34 L10 16 Z" fill="none" strokeWidth="1.5" />
      <path d="M24 14 L24 34 M17 24 L31 24" strokeWidth="1.5" />
    </>
  ),
  Argus: (
    <>
      <circle cx="24" cy="24" r="7" fill="none" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="2.5" strokeWidth="1.5" />
      <circle cx="24" cy="9" r="2" strokeWidth="1.5" />
      <circle cx="24" cy="39" r="2" strokeWidth="1.5" />
      <circle cx="9" cy="24" r="2" strokeWidth="1.5" />
      <circle cx="39" cy="24" r="2" strokeWidth="1.5" />
    </>
  ),
  Daedalus: (
    <path d="M8 8 H40 V40 H16 V16 H32 V32 H24 V24" fill="none" strokeWidth="1.5" strokeLinejoin="miter" />
  ),
  Mnemosyne: (
    <>
      <circle cx="24" cy="24" r="5" fill="none" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="11" fill="none" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="17" fill="none" strokeWidth="1.5" />
    </>
  ),
  Themis: (
    <>
      <path d="M24 8 V40 M12 16 H36" strokeWidth="1.5" />
      <path d="M12 16 L7 27 H17 Z M36 16 L31 27 H41 Z" fill="none" strokeWidth="1.5" />
    </>
  ),
  Hermes: (
    <>
      <path d="M10 34 L24 12 L38 34" fill="none" strokeWidth="1.5" />
      <path d="M14 24 H34" strokeWidth="1.5" />
    </>
  ),
  Hephaestus: (
    <>
      <path d="M10 30 H38 L34 38 H14 Z" fill="none" strokeWidth="1.5" />
      <path d="M24 30 V14 M17 14 H31" strokeWidth="1.5" />
    </>
  ),
};

/** Neutral mark for any god the catalog lists without a drawn sigil. */
const FALLBACK_SIGIL = (
  <>
    <circle cx="24" cy="24" r="15" fill="none" strokeWidth="1.5" />
    <path d="M24 12 V36" strokeWidth="1.5" />
  </>
);

function GodTile({ god, roles }: { god: string; roles: string[] }): JSX.Element {
  return (
    <li className="god" data-state="dormant">
      <svg className="sigil" viewBox="0 0 48 48" aria-hidden="true">
        {SIGILS[god] ?? FALLBACK_SIGIL}
      </svg>
      <span className="god-name">{god}</span>
      <span className="god-domain">{roles[0] ?? ''}</span>
      {roles.length > 1 && <span className="god-domain">+{roles.length - 1} more</span>}
      <span className="god-state">Dormant</span>
    </li>
  );
}

export function Pantheon(): JSX.Element {
  const [agents, setAgents] = useState<PantheonAgentSummary[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [filtered, setFiltered] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    runtime
      .pantheon()
      .then((res) => {
        setAgents(res.agents);
        setCount(res.routableCount);
        setFiltered(res.holdbackFilterApplied);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'catalog unavailable'));
  }, []);

  // Group by god: several agents can share one god (Ares has deal-strategy and
  // discovery, for example), and the chamber shows gods, not every specialist.
  const byGod = new Map<string, string[]>();
  for (const a of agents ?? []) {
    const list = byGod.get(a.god) ?? [];
    list.push(a.role);
    byGod.set(a.god, list);
  }

  const primary = PRIMARY.filter((g) => byGod.has(g));
  const rest = [...byGod.keys()].filter((g) => !primary.includes(g)).sort();

  return (
    <section className="section">
      <h2 className="inscription">The Pantheon</h2>

      {error && <p className="notice">{error}</p>}
      {!agents && !error && <p className="notice">Reading the catalog…</p>}

      {agents && !filtered && (
        <p className="notice">
          The holdback ledger could not be read, so this list may include an agent that should be
          unavailable. Treat it as unverified.
        </p>
      )}

      {agents && (
        <p className="notice">
          {/* Reported from the catalog, never hardcoded. */}
          {count} routable agents across {byGod.size} gods. All dormant — mission execution is not
          yet connected in this alpha.
        </p>
      )}

      {primary.length > 0 && (
        <>
          <h3 className="label" style={{ marginTop: 'var(--s-8)' }}>
            Primary roles
          </h3>
          <ul className="rotunda">
            {primary.map((god) => (
              <GodTile key={god} god={god} roles={byGod.get(god) ?? []} />
            ))}
          </ul>
        </>
      )}

      {rest.length > 0 && (
        <>
          <button
            type="button"
            className="theme-toggle"
            style={{ marginTop: 'var(--s-8)' }}
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'Hide specialists' : `Show ${rest.length} more specialists`}
          </button>
          {showAll && (
            <ul className="rotunda">
              {rest.map((god) => (
                <GodTile key={god} god={god} roles={byGod.get(god) ?? []} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
