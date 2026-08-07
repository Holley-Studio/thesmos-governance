// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pantheon — the council chamber.
 *
 * Primary roles only, laid out as a rotunda rather than a flat grid of every
 * agent in the catalog — the product deliberately moved away from that.
 * Specialists surface contextually once missions run.
 *
 * Sigils are geometric SVG built from each god's domain, not clip-art
 * mythology. Rendered as plain SVG, so navigation never depends on WebGL.
 */

import type { JSX } from 'react';

interface God {
  name: string;
  domain: string;
  sigil: JSX.Element;
}

/* Geometry, not illustration: each mark is derived from the god's function. */
const GODS: God[] = [
  {
    name: 'Zeus',
    domain: 'Authority · Orchestration',
    sigil: (
      <polyline points="26,6 14,26 24,26 18,42 34,20 24,20 30,6" fill="none" strokeWidth="1.5" />
    ),
  },
  {
    name: 'Athena',
    domain: 'Architecture · Strategy',
    sigil: (
      <>
        <path d="M24 6 L38 16 L38 34 L24 42 L10 34 L10 16 Z" fill="none" strokeWidth="1.5" />
        <path d="M24 14 L24 34 M17 24 L31 24" strokeWidth="1.5" />
      </>
    ),
  },
  {
    name: 'Argus',
    domain: 'Security · Observation',
    sigil: (
      <>
        <circle cx="24" cy="24" r="7" fill="none" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="2.5" strokeWidth="1.5" />
        <circle cx="24" cy="9" r="2" strokeWidth="1.5" />
        <circle cx="24" cy="39" r="2" strokeWidth="1.5" />
        <circle cx="9" cy="24" r="2" strokeWidth="1.5" />
        <circle cx="39" cy="24" r="2" strokeWidth="1.5" />
      </>
    ),
  },
  {
    name: 'Daedalus',
    domain: 'Design · Implementation',
    sigil: (
      <path
        d="M8 8 H40 V40 H16 V16 H32 V32 H24 V24"
        fill="none"
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
    ),
  },
  {
    name: 'Mnemosyne',
    domain: 'Memory · Archive',
    sigil: (
      <>
        <circle cx="24" cy="24" r="5" fill="none" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="11" fill="none" strokeWidth="1.5" />
        <circle cx="24" cy="24" r="17" fill="none" strokeWidth="1.5" />
      </>
    ),
  },
  {
    name: 'Themis',
    domain: 'Governance · Law',
    sigil: (
      <>
        <path d="M24 8 V40 M12 16 H36" strokeWidth="1.5" />
        <path d="M12 16 L7 27 H17 Z M36 16 L31 27 H41 Z" fill="none" strokeWidth="1.5" />
      </>
    ),
  },
  {
    name: 'Hermes',
    domain: 'Routing · Communication',
    sigil: (
      <>
        <path d="M10 34 L24 12 L38 34" fill="none" strokeWidth="1.5" />
        <path d="M14 24 H34" strokeWidth="1.5" />
      </>
    ),
  },
  {
    name: 'Hephaestus',
    domain: 'Build · Infrastructure',
    sigil: (
      <>
        <path d="M10 30 H38 L34 38 H14 Z" fill="none" strokeWidth="1.5" />
        <path d="M24 30 V14 M17 14 H31" strokeWidth="1.5" />
      </>
    ),
  },
];

export function Pantheon(): JSX.Element {
  return (
    <section className="section">
      <h2 className="inscription">The Pantheon</h2>
      <p className="notice">
        Primary roles. Specialists are summoned contextually when a mission requires them. All
        agents are dormant — mission execution is not yet connected in this alpha.
      </p>

      <ul className="rotunda">
        {GODS.map((god) => (
          <li key={god.name} className="god" data-state="dormant">
            <svg className="sigil" viewBox="0 0 48 48" aria-hidden="true">
              {god.sigil}
            </svg>
            <span className="god-name">{god.name}</span>
            <span className="god-domain">{god.domain}</span>
            <span className="god-state">Dormant</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
