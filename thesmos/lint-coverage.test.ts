// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Coverage-integrity proof suite.
 *
 * Recreates the exact failure this module exists to prevent: `brand:lint` once
 * scanned ONE file and reported "No naming violations found." Zero findings
 * looked like a pass; it was a lint that had stopped working.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  buildCoverageReport,
  trackedEligibleFiles,
  validateExclusions,
  type CoverageExclusion,
} from './lint-coverage.js';

const REPO_ROOT = join(import.meta.dirname, '..');

describe('coverage integrity', () => {
  it('discovers tracked eligible files from git, not the filesystem', () => {
    const files = trackedEligibleFiles(REPO_ROOT, ['thesmos/catalog/agents/'], ['.md']);
    expect(files.length).toBeGreaterThan(100);
    // Build output and untracked scratch must never appear.
    expect(files.some((f) => f.includes('/dist/'))).toBe(false);
    expect(files.every((f) => f.endsWith('.md'))).toBe(true);
  });

  // ── THE REGRESSION ────────────────────────────────────────────────────────
  it('FAILS (exit 2) when a lint scans one file out of many — the brand:lint false-green', () => {
    const eligible = trackedEligibleFiles(REPO_ROOT, ['thesmos/catalog/agents/'], ['.md']);
    const report = buildCoverageReport({
      lint: 'regression',
      repoRoot: REPO_ROOT,
      configuredRoots: ['thesmos/catalog/agents/'],
      extensions: ['.md'],
      exclusions: [],
      scannedFiles: eligible.slice(0, 1), // scanned ONE file
      findings: 0,                        // and found nothing
    });
    // Zero findings must NOT read as a pass.
    expect(report.findings).toBe(0);
    expect(report.exitCode).toBe(2);
    expect(report.failureReason).toMatch(/neither scanned nor excluded/);
  });

  it('passes only when every eligible file is scanned or explicitly excluded', () => {
    const eligible = trackedEligibleFiles(REPO_ROOT, ['thesmos/catalog/agents/'], ['.md']);
    const report = buildCoverageReport({
      lint: 'full',
      repoRoot: REPO_ROOT,
      configuredRoots: ['thesmos/catalog/agents/'],
      extensions: ['.md'],
      exclusions: [],
      scannedFiles: eligible,
      findings: 0,
    });
    expect(report.exitCode).toBe(0);
    expect(report.unaccounted).toEqual([]);
    expect(report.scanned).toBe(report.trackedEligible);
  });

  it('FAILS (exit 2) when a configured root disappears', () => {
    const report = buildCoverageReport({
      lint: 'missing-root',
      repoRoot: REPO_ROOT,
      configuredRoots: ['thesmos/catalog/agents/', 'does/not/exist/'],
      extensions: ['.md'],
      exclusions: [],
      scannedFiles: [],
      findings: 0,
    });
    expect(report.exitCode).toBe(2);
    expect(report.failureReason).toMatch(/root\(s\) missing/);
  });

  it('FAILS (exit 2) when eligible discovery returns empty', () => {
    const report = buildCoverageReport({
      lint: 'empty',
      repoRoot: REPO_ROOT,
      configuredRoots: ['thesmos/catalog/agents/'],
      extensions: ['.no-such-extension'],
      exclusions: [],
      scannedFiles: [],
      findings: 0,
    });
    expect(report.exitCode).toBe(2);
    expect(report.failureReason).toMatch(/empty/);
  });

  it('reports findings (exit 1) only when coverage is sound', () => {
    const eligible = trackedEligibleFiles(REPO_ROOT, ['thesmos/catalog/agents/'], ['.md']);
    const report = buildCoverageReport({
      lint: 'findings',
      repoRoot: REPO_ROOT,
      configuredRoots: ['thesmos/catalog/agents/'],
      extensions: ['.md'],
      exclusions: [],
      scannedFiles: eligible,
      findings: 3,
    });
    expect(report.exitCode).toBe(1);
  });

  it('coverage failure OUTRANKS findings — a lint that cannot prove what it read has no standing', () => {
    const eligible = trackedEligibleFiles(REPO_ROOT, ['thesmos/catalog/agents/'], ['.md']);
    const report = buildCoverageReport({
      lint: 'both',
      repoRoot: REPO_ROOT,
      configuredRoots: ['thesmos/catalog/agents/'],
      extensions: ['.md'],
      exclusions: [],
      scannedFiles: eligible.slice(0, 2),
      findings: 5,
    });
    expect(report.exitCode).toBe(2);
  });

  // ── Exclusion discipline ──────────────────────────────────────────────────
  const broad: CoverageExclusion[] = [
    { path: '**', reason: 'x' },
    { path: 'website/**', reason: 'x' },
    { path: '*', reason: 'x' },
  ];
  for (const e of broad) {
    it(`rejects the broad exclusion "${e.path}" that could mask a product surface`, () => {
      expect(() => validateExclusions([e], 'test')).toThrow(/broad glob/);
    });
  }

  it('rejects an exclusion with no reason', () => {
    expect(() => validateExclusions([{ path: 'CHANGELOG.md', reason: '' }], 'test')).toThrow(/no reason/);
  });

  it('accepts exact, path-scoped exclusions with reasons', () => {
    expect(() =>
      validateExclusions(
        [{ path: 'CHANGELOG.md', reason: 'historical record' }, { path: 'docs/audits/', reason: 'quotes findings' }],
        'test',
      ),
    ).not.toThrow();
  });

  it('records which exclusion matched how many files, so a stale exclusion is visible', () => {
    const eligible = trackedEligibleFiles(REPO_ROOT, ['thesmos/catalog/agents/'], ['.md']);
    const report = buildCoverageReport({
      lint: 'reasons',
      repoRoot: REPO_ROOT,
      configuredRoots: ['thesmos/catalog/agents/'],
      extensions: ['.md'],
      exclusions: [
        { path: 'reviewers/', reason: 'internal review tooling' },
        { path: 'never-matches-anything.md', reason: 'stale exclusion' },
      ],
      scannedFiles: eligible.filter((f) => !f.includes('reviewers/')),
      findings: 0,
    });
    expect(report.exitCode).toBe(0);
    const reviewers = report.exclusionReasons.find((e) => e.path === 'reviewers/');
    expect(reviewers?.matched).toBeGreaterThan(0);
    // A stale exclusion matching nothing is visible rather than silently kept.
    expect(report.exclusionReasons.find((e) => e.path === 'never-matches-anything.md')?.matched).toBe(0);
  });
});
