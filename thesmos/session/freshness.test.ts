// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { assessFreshness } from './freshness.js';
import type { FreshnessInputs, StalenessThresholds } from './types.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const THRESHOLDS: StalenessThresholds = {
  reportDays: 7,
  baselineDays: 30,
  fetchHours: 12,
};

function inputs(over: Partial<FreshnessInputs> = {}): FreshnessInputs {
  return {
    nowMs: NOW,
    repo: {
      isGitRepo: true,
      branch: 'main',
      upstream: 'origin/main',
      behind: 0,
      ahead: 0,
      dirtyCount: 0,
      lastFetchMs: NOW - HOUR,
    },
    artifacts: {
      reportMtimeMs: NOW - DAY,
      baselineMtimeMs: NOW - DAY,
      contextMtimeMs: NOW - DAY,
      guardDistMtimeMs: NOW - HOUR,
      guardSourceMtimeMs: NOW - 2 * HOUR,
    },
    ...over,
  };
}

function ids(report: ReturnType<typeof assessFreshness>): string[] {
  return report.signals.filter((s) => s.severity !== 'ok').map((s) => s.id);
}

describe('assessFreshness', () => {
  it('reports nothing actionable when everything is current', () => {
    expect(ids(assessFreshness(inputs(), THRESHOLDS))).toEqual([]);
  });

  it('flags a branch behind upstream', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, behind: 14 } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('behind');
    expect(r.signals.find((s) => s.id === 'behind')?.text).toContain('14');
  });

  it('treats an unknown behind-count as unknown, never as zero', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, behind: null, upstream: null } }),
      THRESHOLDS,
    );
    expect(r.signals.find((s) => s.id === 'behind')?.text ?? '').not.toMatch(/\b0\b/);
  });

  it('marks refs uncertain when the last fetch is older than the threshold', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, lastFetchMs: NOW - 72 * HOUR } }),
      THRESHOLDS,
    );
    expect(r.refsUncertain).toBe(true);
    expect(ids(r)).toContain('fetch');
  });

  it('does not mark refs uncertain on a recent fetch', () => {
    expect(assessFreshness(inputs(), THRESHOLDS).refsUncertain).toBe(false);
  });

  it('flags a stale report past reportDays', () => {
    const r = assessFreshness(
      inputs({ artifacts: { ...inputs().artifacts, reportMtimeMs: NOW - 39 * DAY } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('report');
    expect(r.signals.find((s) => s.id === 'report')?.remedy).toContain('scan');
  });

  it('flags a stale baseline past baselineDays', () => {
    const r = assessFreshness(
      inputs({ artifacts: { ...inputs().artifacts, baselineMtimeMs: NOW - 61 * DAY } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('baseline');
  });

  it('flags a guard binary older than its own sources', () => {
    const r = assessFreshness(
      inputs({
        artifacts: {
          ...inputs().artifacts,
          guardDistMtimeMs: NOW - 30 * DAY,
          guardSourceMtimeMs: NOW - HOUR,
        },
      }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('guardDist');
    expect(r.signals.find((s) => s.id === 'guardDist')?.remedy).toContain('build');
  });

  it('omits repo signals entirely outside a git repository', () => {
    const r = assessFreshness(
      inputs({
        repo: {
          isGitRepo: false,
          branch: null,
          upstream: null,
          behind: null,
          ahead: null,
          dirtyCount: null,
          lastFetchMs: null,
        },
      }),
      THRESHOLDS,
    );
    for (const id of ['behind', 'ahead', 'dirty', 'fetch']) {
      expect(r.signals.some((s) => s.id === id)).toBe(false);
    }
  });

  it('handles detached HEAD without inventing an upstream', () => {
    const r = assessFreshness(
      inputs({
        repo: { ...inputs().repo, branch: null, upstream: null, behind: null, ahead: null },
      }),
      THRESHOLDS,
    );
    expect(ids(r)).not.toContain('ahead');
  });

  it('flags uncommitted work', () => {
    const r = assessFreshness(
      inputs({ repo: { ...inputs().repo, dirtyCount: 5 } }),
      THRESHOLDS,
    );
    expect(ids(r)).toContain('dirty');
  });

  it('is pure — the same inputs always yield the same report', () => {
    const a = assessFreshness(inputs({ repo: { ...inputs().repo, behind: 3 } }), THRESHOLDS);
    const b = assessFreshness(inputs({ repo: { ...inputs().repo, behind: 3 } }), THRESHOLDS);
    expect(a).toEqual(b);
  });
});
