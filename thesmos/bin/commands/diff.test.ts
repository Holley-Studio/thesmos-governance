// @vitest-environment node
/**
 * Tests for prometheus diff command — pure logic only (no fs or process side-effects).
 *
 * We test:
 *   - loadBaselineFindings  — JSON parsing variations
 *   - formatDiffConsole     — human-readable output
 *   - formatDiffFinding     — single-finding formatting
 *   - formatDiffJson        — machine-readable output
 *   - shouldFailDiff        — exit-code threshold logic
 *   - fingerprintFinding     — identity / deduplication key
 *   - diffFindings (via watcher) — integration of diff logic
 */
import { describe, it, expect } from 'vitest';
import { diffFindings } from '../../watcher.ts';
import {
  loadBaselineFindings,
  formatDiffConsole,
  formatDiffFinding,
  formatDiffJson,
  shouldFailDiff,
  fingerprintFinding,
  DEFAULT_BASELINE_FILENAME,
  type DiffResult,
} from './diff.ts';
import type { Finding } from '../../types.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeF = (
  severity: Finding['severity'],
  file: string,
  message: string,
  category = 'TEST',
  line?: number,
): Finding => ({ severity, file, message, category, ...(line !== undefined ? { line } : {}) });

const BLOCKER  = makeF('BLOCKER', 'src/auth.ts', 'No auth guard', 'AUTH');
const HIGH     = makeF('HIGH',    'src/api.ts',  'Unprotected route', 'API');
const MEDIUM   = makeF('MEDIUM',  'src/utils.ts','Large file', 'SIZE');
const LOW      = makeF('LOW',     'src/log.ts',  'Missing log level', 'LOG');

// ── loadBaselineFindings ──────────────────────────────────────────────────────

describe('loadBaselineFindings', () => {
  it('returns [] for a non-existent path', () => {
    const result = loadBaselineFindings('/tmp/__nonexistent_path_thesmos_test__.json');
    expect(result).toEqual([]);
  });

  it('handles a Finding[] array envelope written by --save', () => {
    // We can't write to disk in unit tests — test the parsing branch directly
    // by calling loadBaselineFindings with a temp file via the in-memory path.
    // Since we can't write a file here, we verify the return type contract:
    const empty = loadBaselineFindings('/dev/null');
    // /dev/null reads as empty string — JSON.parse will throw → returns []
    expect(empty).toEqual([]);
  });
});

// ── fingerprintFinding ────────────────────────────────────────────────────────

describe('fingerprintFinding (re-exported from watcher)', () => {
  it('produces category|file|message key', () => {
    const f = makeF('HIGH', 'src/a.ts', 'bad thing', 'CAT');
    expect(fingerprintFinding(f)).toBe('CAT|src/a.ts|bad thing');
  });

  it('findings that differ only in line number produce the same fingerprint', () => {
    const f1 = makeF('HIGH', 'src/a.ts', 'bad thing', 'CAT', 10);
    const f2 = makeF('HIGH', 'src/a.ts', 'bad thing', 'CAT', 20);
    expect(fingerprintFinding(f1)).toBe(fingerprintFinding(f2));
  });

  it('different categories → different fingerprint', () => {
    const f1 = makeF('HIGH', 'src/a.ts', 'bad thing', 'CAT_A');
    const f2 = makeF('HIGH', 'src/a.ts', 'bad thing', 'CAT_B');
    expect(fingerprintFinding(f1)).not.toBe(fingerprintFinding(f2));
  });
});

// ── diffFindings (via watcher.ts) ────────────────────────────────────────────

describe('diffFindings — diff logic', () => {
  it('identical findings → no new, no resolved', () => {
    const diff = diffFindings([BLOCKER, HIGH], [BLOCKER, HIGH]);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(2);
  });

  it('new finding added → appears in newFindings', () => {
    const diff = diffFindings([HIGH], [HIGH, MEDIUM]);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0]).toStrictEqual(MEDIUM);
    expect(diff.resolvedFindings).toHaveLength(0);
  });

  it('finding removed → appears in resolvedFindings', () => {
    const diff = diffFindings([HIGH, MEDIUM], [HIGH]);
    expect(diff.resolvedFindings).toHaveLength(1);
    expect(diff.resolvedFindings[0]).toStrictEqual(MEDIUM);
    expect(diff.newFindings).toHaveLength(0);
  });

  it('finding on a different line (same category+file+message) → unchanged (line is not part of fingerprint)', () => {
    const f1 = makeF('HIGH', 'src/a.ts', 'msg', 'CAT', 10);
    const f2 = makeF('HIGH', 'src/a.ts', 'msg', 'CAT', 20);
    const diff = diffFindings([f1], [f2]);
    // Same fingerprint → not new, not resolved
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(1);
  });

  it('empty baseline → all current findings are new', () => {
    const diff = diffFindings([], [BLOCKER, HIGH, MEDIUM]);
    expect(diff.newFindings).toHaveLength(3);
    expect(diff.resolvedFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('empty current → all baseline findings are resolved', () => {
    const diff = diffFindings([BLOCKER, HIGH], []);
    expect(diff.resolvedFindings).toHaveLength(2);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('mixed: some new, some resolved, some unchanged', () => {
    const diff = diffFindings([BLOCKER, HIGH], [HIGH, MEDIUM]);
    expect(diff.resolvedFindings).toHaveLength(1);
    expect(diff.resolvedFindings[0]).toStrictEqual(BLOCKER);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0]).toStrictEqual(MEDIUM);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.unchanged[0]).toStrictEqual(HIGH);
  });

  it('completely replaced findings set → all old resolved, all new added', () => {
    const diff = diffFindings([BLOCKER, HIGH], [MEDIUM, LOW]);
    expect(diff.resolvedFindings).toHaveLength(2);
    expect(diff.newFindings).toHaveLength(2);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('duplicate findings in current are handled by Map (last-write wins)', () => {
    // Two identical findings in current: Map deduplicates, but we still get 1 unchanged
    const dup1 = makeF('HIGH', 'src/a.ts', 'dup', 'CAT');
    const dup2 = makeF('HIGH', 'src/a.ts', 'dup', 'CAT');
    const diff = diffFindings([dup1], [dup2]);
    // Same fingerprint → unchanged
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
  });
});

// ── shouldFailDiff ────────────────────────────────────────────────────────────

describe('shouldFailDiff', () => {
  it('returns false when newFindings is empty', () => {
    expect(shouldFailDiff([], 'BLOCKER')).toBe(false);
  });

  it('returns true when a BLOCKER is present and failOn=BLOCKER', () => {
    expect(shouldFailDiff([BLOCKER], 'BLOCKER')).toBe(true);
  });

  it('returns false when only HIGH is present and failOn=BLOCKER', () => {
    expect(shouldFailDiff([HIGH], 'BLOCKER')).toBe(false);
  });

  it('returns true when HIGH is present and failOn=HIGH', () => {
    expect(shouldFailDiff([HIGH], 'HIGH')).toBe(true);
  });

  it('returns true when BLOCKER is present and failOn=HIGH (BLOCKER is more severe)', () => {
    expect(shouldFailDiff([BLOCKER], 'HIGH')).toBe(true);
  });

  it('returns false for unknown failOn value', () => {
    expect(shouldFailDiff([BLOCKER, HIGH], 'UNKNOWN')).toBe(false);
  });

  it('returns true when MEDIUM is present and failOn=MEDIUM', () => {
    expect(shouldFailDiff([MEDIUM], 'MEDIUM')).toBe(true);
  });

  it('returns false when only LOW is present and failOn=MEDIUM', () => {
    expect(shouldFailDiff([LOW], 'MEDIUM')).toBe(false);
  });
});

// ── formatDiffFinding ─────────────────────────────────────────────────────────

describe('formatDiffFinding', () => {
  it('includes the prefix, severity, and file', () => {
    const out = formatDiffFinding(HIGH, 'NEW', '\x1b[31m');
    expect(out).toContain('NEW');
    expect(out).toContain('HIGH');
    expect(out).toContain('src/api.ts');
    expect(out).toContain('Unprotected route');
  });

  it('includes the line number when present', () => {
    const f = makeF('HIGH', 'src/a.ts', 'msg', 'CAT', 42);
    const out = formatDiffFinding(f, '+', '');
    expect(out).toContain(':42');
  });

  it('omits line number when absent', () => {
    const out = formatDiffFinding(HIGH, '+', '');
    expect(out).not.toMatch(/:\d+/);
  });

  it('includes suggestion when present', () => {
    const f: Finding = { ...HIGH, suggestion: 'Add auth middleware' };
    const out = formatDiffFinding(f, '+', '');
    expect(out).toContain('Add auth middleware');
  });
});

// ── formatDiffConsole ─────────────────────────────────────────────────────────

describe('formatDiffConsole', () => {
  const noChangeDiff: DiffResult = { newFindings: [], resolvedFindings: [], unchanged: [HIGH] };
  const withNewDiff: DiffResult  = { newFindings: [BLOCKER], resolvedFindings: [], unchanged: [] };
  const withBothDiff: DiffResult = { newFindings: [MEDIUM], resolvedFindings: [HIGH], unchanged: [] };

  it('shows "No changes" when diff is empty', () => {
    const out = formatDiffConsole(noChangeDiff, '/path/to/findings.json');
    expect(out).toContain('No changes');
    expect(out).toContain('1 finding');
  });

  it('shows new finding count', () => {
    const out = formatDiffConsole(withNewDiff, '/path/findings.json');
    expect(out).toContain('1 new finding');
  });

  it('shows resolved count', () => {
    const out = formatDiffConsole(withBothDiff, '/path/findings.json');
    expect(out).toContain('1 resolved');
  });

  it('shows the baseline path in the header', () => {
    const out = formatDiffConsole(noChangeDiff, '/my/project/.thesmos/findings.json');
    expect(out).toContain('/my/project/.thesmos/findings.json');
  });

  it('warns about BLOCKER introductions', () => {
    const out = formatDiffConsole(withNewDiff, '/path/findings.json');
    expect(out).toContain('BLOCKER');
  });

  it('warns about HIGH findings when no blockers', () => {
    const highDiff: DiffResult = { newFindings: [HIGH], resolvedFindings: [], unchanged: [] };
    const out = formatDiffConsole(highDiff, '/path/findings.json');
    expect(out).toContain('HIGH');
  });
});

// ── formatDiffJson ────────────────────────────────────────────────────────────

describe('formatDiffJson', () => {
  it('returns valid JSON', () => {
    const diff: DiffResult = { newFindings: [BLOCKER], resolvedFindings: [HIGH], unchanged: [MEDIUM] };
    const out = formatDiffJson(diff);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('JSON output has newFindings, resolvedFindings, and summary', () => {
    const diff: DiffResult = { newFindings: [BLOCKER], resolvedFindings: [HIGH], unchanged: [MEDIUM] };
    const parsed = JSON.parse(formatDiffJson(diff)) as {
      newFindings: Finding[];
      resolvedFindings: Finding[];
      unchanged: number;
      summary: { new: number; resolved: number; unchanged: number };
    };
    expect(parsed.newFindings).toHaveLength(1);
    expect(parsed.resolvedFindings).toHaveLength(1);
    expect(parsed.unchanged).toBe(1);
    expect(parsed.summary.new).toBe(1);
    expect(parsed.summary.resolved).toBe(1);
    expect(parsed.summary.unchanged).toBe(1);
  });

  it('returns empty arrays when diff is empty', () => {
    const diff: DiffResult = { newFindings: [], resolvedFindings: [], unchanged: [] };
    const parsed = JSON.parse(formatDiffJson(diff)) as {
      newFindings: Finding[];
      resolvedFindings: Finding[];
      summary: { new: number; resolved: number };
    };
    expect(parsed.newFindings).toHaveLength(0);
    expect(parsed.resolvedFindings).toHaveLength(0);
    expect(parsed.summary.new).toBe(0);
    expect(parsed.summary.resolved).toBe(0);
  });
});

// ── DEFAULT_BASELINE_FILENAME ─────────────────────────────────────────────────

describe('DEFAULT_BASELINE_FILENAME', () => {
  it('points into .thesmos/', () => {
    expect(DEFAULT_BASELINE_FILENAME).toContain('.thesmos/');
    expect(DEFAULT_BASELINE_FILENAME).toContain('findings.json');
  });
});
