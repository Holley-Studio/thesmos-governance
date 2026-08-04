// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Lint coverage integrity.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * `brand:lint` once scanned ONE file and reported "No naming violations found."
 * Zero findings looked like a pass; it was a lint that had stopped working. A
 * lint's exit code is only meaningful alongside proof of what it actually read.
 *
 * Every lint therefore reports: configured roots, tracked-eligible files,
 * scanned files, excluded files with reasons, findings, and exit code — and
 * FAILS (exit 2) rather than passing when coverage cannot be trusted.
 *
 * ── Why git, not the filesystem ─────────────────────────────────────────────
 * The eligible set is derived from `git ls-files`, so it reflects what is
 * actually committed. A filesystem walk would silently include build output and
 * untracked scratch files, and would drift from what reviewers see in the diff.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CoverageExclusion {
  /** Exact path or path fragment. Broad globs are rejected. */
  path: string;
  reason: string;
}

export interface CoverageReport {
  lint: string;
  configuredRoots: string[];
  /** Tracked files under the configured roots matching the extension filter. */
  trackedEligible: number;
  scanned: number;
  excluded: number;
  exclusionReasons: { path: string; reason: string; matched: number }[];
  findings: number;
  /** Eligible files that were neither scanned nor matched by an exclusion. */
  unaccounted: string[];
  exitCode: 0 | 1 | 2;
  failureReason: string | null;
}

/**
 * Exclusion patterns that could mask an entire product surface.
 *
 * A `website/**` exclusion would hide every marketing page while the lint still
 * reported "clean" — the same class of failure this module exists to catch.
 */
const BROAD_EXCLUSION = /^(\*+|\.|\/)?$|^[^/]*\/\*\*$|^\*\*/;

export function validateExclusions(exclusions: readonly CoverageExclusion[], lint: string): void {
  const problems: string[] = [];
  for (const e of exclusions) {
    if (!e.reason?.trim()) problems.push(`exclusion "${e.path}" has no reason`);
    if (BROAD_EXCLUSION.test(e.path)) {
      problems.push(`exclusion "${e.path}" is a broad glob — exclusions must be exact and path-scoped`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`${lint}: invalid exclusions:\n  - ${problems.join('\n  - ')}`);
  }
}

/** Tracked files under `roots` whose extension matches, via `git ls-files`. */
export function trackedEligibleFiles(
  repoRoot: string,
  roots: readonly string[],
  extensions: readonly string[],
): string[] {
  let all: string[];
  try {
    all = execFileSync('git', ['ls-files', '-z'], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
  } catch (err) {
    throw new Error(`coverage: git ls-files failed in "${repoRoot}": ${(err as Error).message}`);
  }

  const inRoot = (p: string) =>
    roots.some((r) => (r.endsWith('/') ? p.startsWith(r) : p === r || p.startsWith(`${r}/`)));
  const extOk = (p: string) => extensions.some((e) => p.endsWith(e));

  return all.filter((p) => inRoot(p) && extOk(p)).sort();
}

export interface CoverageInput {
  lint: string;
  repoRoot: string;
  configuredRoots: readonly string[];
  extensions: readonly string[];
  exclusions: readonly CoverageExclusion[];
  /** Repo-relative paths the lint actually read. */
  scannedFiles: readonly string[];
  findings: number;
}

/**
 * Build the coverage report and decide the exit code.
 *
 * Exit 2 (coverage failure) beats exit 1 (findings): a lint that cannot prove
 * what it read has no standing to report findings either.
 */
export function buildCoverageReport(input: CoverageInput): CoverageReport {
  validateExclusions(input.exclusions, input.lint);

  const missingRoots = input.configuredRoots.filter((r) => !existsSync(join(input.repoRoot, r)));
  const eligible = trackedEligibleFiles(input.repoRoot, input.configuredRoots, input.extensions);
  const scanned = new Set(input.scannedFiles.map((p) => p.replace(/\\/g, '/')));

  const matchedBy = new Map<string, number>();
  const isExcluded = (p: string) => {
    for (const e of input.exclusions) {
      if (p.includes(e.path)) {
        matchedBy.set(e.path, (matchedBy.get(e.path) ?? 0) + 1);
        return true;
      }
    }
    return false;
  };

  const unaccounted: string[] = [];
  let excluded = 0;
  for (const p of eligible) {
    if (scanned.has(p)) continue;
    if (isExcluded(p)) { excluded++; continue; }
    unaccounted.push(p);
  }

  let exitCode: 0 | 1 | 2 = 0;
  let failureReason: string | null = null;

  if (missingRoots.length > 0) {
    exitCode = 2;
    failureReason = `configured root(s) missing: ${missingRoots.join(', ')}`;
  } else if (eligible.length === 0) {
    exitCode = 2;
    failureReason = 'eligible-file discovery returned empty — the lint would pass without reading anything';
  } else if (unaccounted.length > 0) {
    exitCode = 2;
    failureReason =
      `${unaccounted.length} eligible file(s) were neither scanned nor excluded ` +
      `(first: ${unaccounted.slice(0, 3).join(', ')})`;
  } else if (input.findings > 0) {
    exitCode = 1;
    failureReason = `${input.findings} finding(s)`;
  }

  return {
    lint: input.lint,
    configuredRoots: [...input.configuredRoots],
    trackedEligible: eligible.length,
    scanned: scanned.size,
    excluded,
    exclusionReasons: input.exclusions.map((e) => ({
      path: e.path,
      reason: e.reason,
      matched: matchedBy.get(e.path) ?? 0,
    })),
    findings: input.findings,
    unaccounted: unaccounted.slice(0, 20),
    exitCode,
    failureReason,
  };
}

export function formatCoverage(r: CoverageReport): string {
  const lines: string[] = [];
  lines.push(`  coverage — roots: ${r.configuredRoots.join(', ')}`);
  lines.push(`    tracked eligible : ${r.trackedEligible}`);
  lines.push(`    scanned          : ${r.scanned}`);
  lines.push(`    excluded         : ${r.excluded}`);
  for (const e of r.exclusionReasons.filter((x) => x.matched > 0)) {
    lines.push(`      - ${e.path} (${e.matched}) — ${e.reason}`);
  }
  if (r.unaccounted.length > 0) {
    lines.push(`    UNACCOUNTED      : ${r.unaccounted.length}`);
    for (const p of r.unaccounted) lines.push(`      ! ${p}`);
  }
  lines.push(`    findings         : ${r.findings}`);
  lines.push(`    exit             : ${r.exitCode}${r.failureReason ? ` (${r.failureReason})` : ''}`);
  return lines.join('\n');
}
