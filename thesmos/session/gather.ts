// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Freshness input gathering — the I/O half.
 *
 * Every probe is independently failable: one that throws or exceeds its slice
 * contributes `null` and does not prevent the others from reporting. `null`
 * always means unknown.
 *
 * **This module never touches the network.** Behind/ahead counts are read from
 * cached remote-tracking refs (~45ms). A fetch is an unbounded network round
 * trip and has no place in a path that blocks session startup.
 */

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtifactInputs, FreshnessInputs, RepoInputs } from './types.js';

/** Default total wall-clock budget for all probes. */
export const DEFAULT_BUDGET_MS = 400;

/** Governance sources the guard binary is bundled from. */
const GUARD_SOURCES = [
  'thesmos/claude-govern.ts',
  'thesmos/shell-command.ts',
  'thesmos/scope.ts',
  'thesmos/bin/thesmos-guard.ts',
];

function git(root: string, args: string[], timeoutMs: number): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    }).trim();
  } catch {
    return null;
  }
}

function mtimeMs(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

function newestMtime(root: string, relPaths: string[]): number | null {
  let newest: number | null = null;
  for (const rel of relPaths) {
    const m = mtimeMs(join(root, rel));
    if (m !== null && (newest === null || m > newest)) newest = m;
  }
  return newest;
}

function parseCount(raw: string | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

function gatherRepo(root: string, sliceMs: number): RepoInputs {
  const empty: RepoInputs = {
    isGitRepo: false,
    branch: null,
    upstream: null,
    behind: null,
    ahead: null,
    dirtyCount: null,
    lastFetchMs: null,
  };

  const inside = git(root, ['rev-parse', '--is-inside-work-tree'], sliceMs);
  if (inside !== 'true') return empty;

  const branchRaw = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], sliceMs);
  const branch = branchRaw && branchRaw !== 'HEAD' ? branchRaw : null;

  const upstream = branch
    ? git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], sliceMs)
    : null;

  let behind: number | null = null;
  let ahead: number | null = null;
  if (upstream) {
    // "<behind>\t<ahead>" — one process instead of two.
    const counts = git(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], sliceMs);
    const [b, a] = (counts ?? '').split(/\s+/);
    behind = parseCount(b ?? null);
    ahead = parseCount(a ?? null);
  }

  const status = git(root, ['status', '--porcelain'], sliceMs);
  const dirtyCount =
    status === null ? null : status.length === 0 ? 0 : status.split('\n').length;

  const gitDir = git(root, ['rev-parse', '--git-dir'], sliceMs);
  const lastFetchMs =
    gitDir === null ? null : mtimeMs(join(root, gitDir, 'FETCH_HEAD'));

  return { isGitRepo: true, branch, upstream, behind, ahead, dirtyCount, lastFetchMs };
}

function gatherArtifacts(root: string): ArtifactInputs {
  return {
    reportMtimeMs: mtimeMs(join(root, '.thesmos', 'report.json')),
    baselineMtimeMs: mtimeMs(join(root, '.thesmos', 'baseline.json')),
    contextMtimeMs: mtimeMs(join(root, '.thesmos', 'context.md')),
    guardDistMtimeMs: mtimeMs(join(root, 'thesmos', 'dist', 'thesmos-guard.js')),
    guardSourceMtimeMs: newestMtime(root, GUARD_SOURCES),
  };
}

export function gatherFreshnessInputs(
  root: string,
  budgetMs: number = DEFAULT_BUDGET_MS,
): FreshnessInputs {
  // Six git probes share the budget; stat() calls are ~7ms total and unbudgeted.
  const sliceMs = Math.max(50, Math.floor(budgetMs / 6));
  let repo: RepoInputs;
  try {
    repo = gatherRepo(root, sliceMs);
  } catch {
    repo = {
      isGitRepo: false,
      branch: null,
      upstream: null,
      behind: null,
      ahead: null,
      dirtyCount: null,
      lastFetchMs: null,
    };
  }

  let artifacts: ArtifactInputs;
  try {
    artifacts = gatherArtifacts(root);
  } catch {
    artifacts = {
      reportMtimeMs: null,
      baselineMtimeMs: null,
      contextMtimeMs: null,
      guardDistMtimeMs: null,
      guardSourceMtimeMs: null,
    };
  }

  return { nowMs: Date.now(), repo, artifacts };
}
