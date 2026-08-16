// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Assigns a reversibility class. Autonomy follows how cheaply an action
 * undoes, not how confident we are: a confident wrong merge is still wrong.
 * Unknown shapes resolve to one-way so ambiguity always asks.
 */
import type { PullRequest } from './types.ts';

export type Reversibility = 'reversible' | 'recoverable' | 'one-way';
export type SemverBump = 'patch' | 'minor' | 'major' | 'unknown';

const BUMP_RE = /from\s+v?(\d+)\.(\d+)\.(\d+)\S*\s+to\s+v?(\d+)\.(\d+)\.(\d+)/i;

/** Paths where a mistake is not cheaply undone. */
const ONE_WAY_PATHS = [
  /(^|\/)auth\//, /(^|\/)payments?\//, /(^|\/)billing\//,
  /migrations?\//, /\.github\/workflows\/[^/]*(release|publish|deploy|tag)/i, /(^|\/)secrets?\//,
];

const LOCKFILE_ONLY = /^(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const DOCS_ONLY = /\.(md|mdx|txt)$|^docs\//;

export function parseBump(title: string): SemverBump {
  const m = BUMP_RE.exec(title);
  if (!m) return 'unknown';
  const [fromMaj, fromMin, , toMaj, toMin] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (toMaj !== fromMaj) return 'major';
  // Pre-1.0, the minor slot is where breaking changes live: semver §4 says
  // anything may change in 0.x, and 0.3.0 → 0.4.0 routinely does. Reading it
  // as an ordinary "minor" would classify it recoverable and merge it
  // unattended — the most common shape in a young-library backlog.
  if (fromMaj === 0 && toMin !== fromMin) return 'major';
  if (toMin !== fromMin) return 'minor';
  return 'patch';
}

export function classify(pr: PullRequest): { class: Reversibility; reason: string } {
  for (const re of ONE_WAY_PATHS) {
    const hit = pr.files.find((f) => re.test(f));
    if (hit) return { class: 'one-way', reason: `touches sensitive path ${hit}` };
  }

  const bump = parseBump(pr.title);
  if (bump === 'major') {
    return { class: 'one-way', reason: 'major version bump — may contain breaking changes' };
  }
  if (bump === 'patch' && pr.files.length > 0 && pr.files.every((f) => LOCKFILE_ONLY.test(f))) {
    return { class: 'reversible', reason: 'patch bump, lockfile only' };
  }
  if (bump === 'minor') {
    return { class: 'recoverable', reason: 'minor version bump' };
  }
  if (pr.files.length > 0 && pr.files.every((f) => DOCS_ONLY.test(f))) {
    return { class: 'recoverable', reason: 'documentation only' };
  }

  return { class: 'one-way', reason: 'could not classify confidently — asking rather than guessing' };
}
