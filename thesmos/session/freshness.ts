// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pure freshness assessment.
 *
 * No I/O, no clock access — `nowMs` is an input. That makes the entire
 * staleness matrix testable as a table, with no fixture repositories to build.
 *
 * The rule this module exists to enforce: **unknown is not zero.** A `null`
 * behind-count produces a signal that says so, never a reassuring "0 behind"
 * derived from a week-old ref.
 */

import type {
  FreshnessInputs,
  FreshnessReport,
  FreshnessSignal,
  StalenessThresholds,
} from './types.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;

function days(ms: number): number {
  return Math.floor(ms / DAY);
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function assessFreshness(
  inputs: FreshnessInputs,
  thresholds: StalenessThresholds,
): FreshnessReport {
  const { nowMs, repo, artifacts } = inputs;
  const signals: FreshnessSignal[] = [];

  const fetchAgeMs = repo.lastFetchMs === null ? null : nowMs - repo.lastFetchMs;
  const refsUncertain =
    repo.isGitRepo &&
    (fetchAgeMs === null || fetchAgeMs > thresholds.fetchHours * HOUR);

  if (repo.isGitRepo) {
    if (repo.behind === null) {
      if (repo.upstream === null) {
        signals.push({
          id: 'behind',
          severity: 'notice',
          text: 'No upstream is configured for this branch — remote state is unknown.',
        });
      } else {
        signals.push({
          id: 'behind',
          severity: 'notice',
          text: `Commits behind ${repo.upstream} could not be determined — try fetching to update remote refs.`,
          remedy: 'git fetch --all --prune',
        });
      }
    } else if (repo.behind > 0) {
      signals.push({
        id: 'behind',
        severity: 'warn',
        text: `Local branch is ${repo.behind} ${plural(repo.behind, 'commit', 'commits')} behind ${repo.upstream ?? 'upstream'}.`,
        remedy: 'git pull --ff-only',
      });
    }

    if (repo.ahead !== null && repo.ahead > 0) {
      signals.push({
        id: 'ahead',
        severity: 'notice',
        text: `Local branch is ${repo.ahead} ${plural(repo.ahead, 'commit', 'commits')} ahead of ${repo.upstream ?? 'upstream'} (unpushed).`,
      });
    }

    if (repo.dirtyCount !== null && repo.dirtyCount > 0) {
      signals.push({
        id: 'dirty',
        severity: 'notice',
        text: `${repo.dirtyCount} uncommitted ${plural(repo.dirtyCount, 'file', 'files')} in the working tree.`,
      });
    }

    if (refsUncertain) {
      const age = fetchAgeMs === null ? 'never' : `${days(fetchAgeMs)}d ago`;
      signals.push({
        id: 'fetch',
        severity: 'warn',
        text: `Remote refs last fetched ${age} — behind/ahead counts above may be stale. Fetch before relying on branch state.`,
        remedy: 'git fetch --all --prune',
      });
    }
  }

  const artifactAge = (mtime: number | null): number | null =>
    mtime === null ? null : nowMs - mtime;

  const reportAge = artifactAge(artifacts.reportMtimeMs);
  if (reportAge === null) {
    signals.push({
      id: 'report',
      severity: 'warn',
      text: 'No .thesmos/report.json — the repository has never been scanned.',
      remedy: 'npm run thesmos:scan',
    });
  } else if (reportAge > thresholds.reportDays * DAY) {
    signals.push({
      id: 'report',
      severity: 'warn',
      text: `.thesmos/report.json is ${days(reportAge)} days stale (limit ${thresholds.reportDays}).`,
      remedy: 'npm run thesmos:scan',
    });
  }

  const baselineAge = artifactAge(artifacts.baselineMtimeMs);
  if (baselineAge !== null && baselineAge > thresholds.baselineDays * DAY) {
    signals.push({
      id: 'baseline',
      severity: 'notice',
      text: `.thesmos/baseline.json is ${days(baselineAge)} days stale (limit ${thresholds.baselineDays}) — drifted baselines resurface accepted findings.`,
      remedy: 'npm run thesmos:baseline:update',
    });
  }

  const contextAge = artifactAge(artifacts.contextMtimeMs);
  if (contextAge === null || contextAge > thresholds.reportDays * DAY) {
    signals.push({
      id: 'context',
      severity: 'notice',
      text:
        contextAge === null
          ? 'No .thesmos/context.md — this session starts without a project capsule.'
          : `.thesmos/context.md is ${days(contextAge)} days stale.`,
      remedy: 'npm run thesmos:context:snapshot',
    });
  }

  const { guardDistMtimeMs, guardSourceMtimeMs } = artifacts;
  if (guardDistMtimeMs === null) {
    signals.push({
      id: 'guardDist',
      severity: 'warn',
      text: 'The governance guard binary is not built — hooks cannot enforce anything.',
      remedy: 'npm run build --workspace=thesmos',
    });
  } else if (guardSourceMtimeMs !== null && guardSourceMtimeMs > guardDistMtimeMs) {
    signals.push({
      id: 'guardDist',
      severity: 'warn',
      text: `The governance guard binary is older than its sources (built ${days(nowMs - guardDistMtimeMs)}d ago) — hooks are running stale rules.`,
      remedy: 'npm run build --workspace=thesmos',
    });
  }

  return { signals, refsUncertain };
}
