// @vitest-environment node
/**
 * Tests for `thesmos review` baseline awareness (Operation Themis Rising, Phase 2).
 *
 * Verifies:
 *   - By default, findings matching a .thesmos/baseline.json entry are suppressed
 *     from console AND --json output (mirrors `validate`'s behavior).
 *   - --no-baseline shows everything, including accepted debt.
 *   - --json output carries a `baselinedCount` field in both modes.
 *   - Console mode prints a "N baseline finding(s) suppressed" note on stderr.
 *
 * NOTE: a handful of engine rules (e.g. lic_copyleft_dependency, lic_proprietary_dependency
 * in rules/license.ts) read `process.cwd()` directly instead of the review `root` — running
 * these tests inside this monorepo means the real repo's package.json/lockfile can produce
 * additional findings alongside our fixture's `missing_api_auth` finding. Assertions below
 * key off the specific target finding rather than a hardcoded total count, so they stay
 * correct regardless of that pre-existing engine quirk (outside this task's scope).
 *
 * This file exercises the actual cmdReview() command (not just the review engine —
 * see thesmos/review.test.ts for engine-level tests, and
 * thesmos/bin/commands/review.test.ts for formatter tests using coreRunReview directly).
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CONFIG_DEFAULTS } from '../../config.ts';
import { createBaseline, saveBaseline } from '../../baseline.ts';
import type { ScanResult, Finding } from '../../types.ts';

vi.mock('../lib/context.ts', () => ({
  createContext: vi.fn(),
}));

import { createContext } from '../lib/context.ts';
import { cmdReview } from './review.ts';

const mockCreateContext = createContext as unknown as MockInstance;

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  scanVersion: '1',
  pages: [],
  // One unauthenticated POST route — deterministically fires AUTH_001
  // (missing_api_auth, HIGH) purely from scan data, no changed-file content needed.
  apiRoutes: [
    { path: '/api/orders', file: 'app/api/orders/route.ts', methods: ['POST'], auth: false, desc: '' },
  ],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

const tmpDirs: string[] = [];

function makeTmpRoot(): string {
  const dir = join(tmpdir(), `thesmos-review-baseline-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.thesmos'), { recursive: true });
  writeFileSync(join(dir, '.thesmos', 'report.json'), JSON.stringify(SCAN), 'utf8');
  tmpDirs.push(dir);
  mockCreateContext.mockReturnValue({ root: dir, config: { ...CONFIG_DEFAULTS, project: 'BaselineTest' } });
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

/** Capture process.stdout.write + console.log (used by the non-JSON console path). */
function captureStdout(): { text: () => string; restore: () => void } {
  let out = '';
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out += args.join(' ') + '\n';
  });
  return {
    text: () => out,
    restore: () => { stdoutSpy.mockRestore(); logSpy.mockRestore(); },
  };
}

function captureStderr(): { text: () => string; restore: () => void } {
  let out = '';
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
  return { text: () => out, restore: () => spy.mockRestore() };
}

interface JsonReviewOutput {
  total: number;
  findings: Finding[];
  baselinedCount: number;
}

async function runJson(root: string, extraArgs: string[] = []): Promise<JsonReviewOutput> {
  mockCreateContext.mockReturnValue({ root, config: { ...CONFIG_DEFAULTS, project: 'BaselineTest' } });
  const out = captureStdout();
  await cmdReview(['--json', ...extraArgs]);
  out.restore();
  return JSON.parse(out.text()) as JsonReviewOutput;
}

const hasAuthFinding = (findings: Finding[]): boolean =>
  findings.some((f) => f.category === 'missing_api_auth');

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('cmdReview — no baseline present', () => {
  it('--json shows the fixture finding with baselinedCount: 0', async () => {
    const root = makeTmpRoot();
    const parsed = await runJson(root);
    expect(hasAuthFinding(parsed.findings)).toBe(true);
    expect(parsed.total).toBe(parsed.findings.length);
    expect(parsed.baselinedCount).toBe(0);
  });
});

describe('cmdReview — baseline present and matching', () => {
  it('--json (default) suppresses every baselined finding, including our fixture, and reports baselinedCount', async () => {
    const root = makeTmpRoot();

    // First pass captures the real Finding objects to accept into the baseline.
    const first = await runJson(root);
    expect(hasAuthFinding(first.findings)).toBe(true);
    const acceptedCount = first.findings.length;

    const baseline = createBaseline(first.findings, new Date('2026-01-01T00:00:00.000Z'));
    saveBaseline(root, baseline);

    const second = await runJson(root);
    expect(hasAuthFinding(second.findings)).toBe(false);
    expect(second.total).toBe(0);
    expect(second.findings).toHaveLength(0);
    expect(second.baselinedCount).toBe(acceptedCount);
  });

  it('--no-baseline shows everything even when a baseline exists', async () => {
    const root = makeTmpRoot();
    const first = await runJson(root);
    const acceptedCount = first.findings.length;
    const baseline = createBaseline(first.findings, new Date('2026-01-01T00:00:00.000Z'));
    saveBaseline(root, baseline);

    const filtered = await runJson(root);
    expect(filtered.total).toBe(0);

    const unfiltered = await runJson(root, ['--no-baseline']);
    expect(hasAuthFinding(unfiltered.findings)).toBe(true);
    expect(unfiltered.total).toBe(acceptedCount);
    expect(unfiltered.baselinedCount).toBe(0);
  });

  it('console mode: shows "No findings" and prints a suppression note to stderr', async () => {
    const root = makeTmpRoot();
    const first = await runJson(root);
    const acceptedCount = first.findings.length;
    const baseline = createBaseline(first.findings, new Date('2026-01-01T00:00:00.000Z'));
    saveBaseline(root, baseline);

    const out = captureStdout();
    const err = captureStderr();
    await cmdReview([]);
    out.restore();
    err.restore();

    expect(out.text()).toContain('No findings');
    expect(err.text()).toContain(
      `${acceptedCount} baseline finding${acceptedCount === 1 ? '' : 's'} suppressed`,
    );
    expect(err.text()).toContain('thesmos baseline:report');
  });

  it('console mode with --no-baseline: shows the fixture finding, no suppression note', async () => {
    const root = makeTmpRoot();
    const first = await runJson(root);
    const baseline = createBaseline(first.findings, new Date('2026-01-01T00:00:00.000Z'));
    saveBaseline(root, baseline);

    const out = captureStdout();
    const err = captureStderr();
    await cmdReview(['--no-baseline']);
    out.restore();
    err.restore();

    expect(out.text()).toContain('missing_api_auth');
    expect(err.text()).not.toContain('baseline finding');
  });
});
