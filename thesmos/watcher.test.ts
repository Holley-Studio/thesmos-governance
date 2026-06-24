import { describe, it, expect } from 'vitest';
import {
  shouldWatchFile,
  fingerprintFinding,
  diffFindings,
  sortFindingsByWorst,
  formatWatchUpdate,
} from './watcher.ts';
import type { Finding } from './types.ts';

const makeF = (
  severity: Finding['severity'],
  file: string,
  message: string,
  category = 'test',
): Finding => ({ severity, file, message, category });

// ── shouldWatchFile ───────────────────────────────────────────────────────────

describe('shouldWatchFile', () => {
  const exts = new Set(['.ts', '.tsx', '.js']);

  it('returns true for watched extensions', () => {
    expect(shouldWatchFile('src/foo.ts', exts)).toBe(true);
    expect(shouldWatchFile('src/bar.tsx', exts)).toBe(true);
    expect(shouldWatchFile('app/page.js', exts)).toBe(true);
  });

  it('returns false for unwatched extensions', () => {
    expect(shouldWatchFile('README.md', exts)).toBe(false);
    expect(shouldWatchFile('.env', exts)).toBe(false);
    expect(shouldWatchFile('image.png', exts)).toBe(false);
  });

  it('returns false for files with no extension', () => {
    expect(shouldWatchFile('Makefile', exts)).toBe(false);
  });
});

// ── fingerprintFinding ────────────────────────────────────────────────────────

describe('fingerprintFinding', () => {
  it('produces stable fingerprints', () => {
    const f = makeF('HIGH', 'src/a.ts', 'something bad');
    expect(fingerprintFinding(f)).toBe('test|src/a.ts|something bad');
  });

  it('different files produce different fingerprints', () => {
    const a = makeF('HIGH', 'src/a.ts', 'msg');
    const b = makeF('HIGH', 'src/b.ts', 'msg');
    expect(fingerprintFinding(a)).not.toBe(fingerprintFinding(b));
  });

  it('different messages produce different fingerprints', () => {
    const a = makeF('HIGH', 'src/a.ts', 'msg1');
    const b = makeF('HIGH', 'src/a.ts', 'msg2');
    expect(fingerprintFinding(a)).not.toBe(fingerprintFinding(b));
  });
});

// ── diffFindings ──────────────────────────────────────────────────────────────

describe('diffFindings', () => {
  it('empty prev and empty next → no changes', () => {
    const diff = diffFindings([], []);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
    expect(diff.unchanged).toHaveLength(0);
  });

  it('new finding not in prev → appears in newFindings', () => {
    const f = makeF('HIGH', 'src/a.ts', 'new');
    const diff = diffFindings([], [f]);
    expect(diff.newFindings).toHaveLength(1);
    expect(diff.newFindings[0]).toBe(f);
    expect(diff.resolvedFindings).toHaveLength(0);
  });

  it('finding removed from next → appears in resolvedFindings', () => {
    const f = makeF('HIGH', 'src/a.ts', 'gone');
    const diff = diffFindings([f], []);
    expect(diff.resolvedFindings).toHaveLength(1);
    expect(diff.newFindings).toHaveLength(0);
  });

  it('same finding in both → appears in unchanged only', () => {
    const f = makeF('HIGH', 'src/a.ts', 'same');
    const diff = diffFindings([f], [f]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.newFindings).toHaveLength(0);
    expect(diff.resolvedFindings).toHaveLength(0);
  });

  it('handles mixed new, resolved, and unchanged', () => {
    const existing  = makeF('HIGH', 'src/a.ts', 'existing');
    const resolved  = makeF('MEDIUM', 'src/b.ts', 'resolved');
    const brandNew  = makeF('BLOCKER', 'src/c.ts', 'brand new');

    const diff = diffFindings([existing, resolved], [existing, brandNew]);
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.resolvedFindings).toHaveLength(1);
    expect(diff.newFindings).toHaveLength(1);
  });
});

// ── sortFindingsByWorst ───────────────────────────────────────────────────────

describe('sortFindingsByWorst', () => {
  it('sorts BLOCKER before HIGH before MEDIUM', () => {
    const findings = [
      makeF('MEDIUM', 'a.ts', 'm'),
      makeF('BLOCKER', 'b.ts', 'b'),
      makeF('HIGH', 'c.ts', 'h'),
    ];
    const sorted = sortFindingsByWorst(findings);
    expect(sorted[0].severity).toBe('BLOCKER');
    expect(sorted[1].severity).toBe('HIGH');
    expect(sorted[2].severity).toBe('MEDIUM');
  });

  it('does not mutate the original array', () => {
    const findings = [makeF('LOW', 'a.ts', 'm'), makeF('BLOCKER', 'b.ts', 'b')];
    const original = [...findings];
    sortFindingsByWorst(findings);
    expect(findings[0].severity).toBe(original[0].severity);
  });
});

// ── formatWatchUpdate ─────────────────────────────────────────────────────────

describe('formatWatchUpdate', () => {
  it('shows "No new findings" when diff is empty', () => {
    const diff = { newFindings: [], resolvedFindings: [], unchanged: [] };
    const out = formatWatchUpdate(diff, [], [], '12:00:00');
    expect(out).toContain('No new findings');
  });

  it('shows new finding count when findings are present', () => {
    const f = makeF('HIGH', 'src/a.ts', 'oops');
    const diff = { newFindings: [f], resolvedFindings: [], unchanged: [] };
    const out = formatWatchUpdate(diff, [f], ['src/a.ts'], '12:00:00');
    expect(out).toContain('1 new finding');
  });

  it('shows resolved count when findings are resolved', () => {
    const f = makeF('HIGH', 'src/a.ts', 'fixed');
    const diff = { newFindings: [], resolvedFindings: [f], unchanged: [] };
    const out = formatWatchUpdate(diff, [], ['src/a.ts'], '12:00:00');
    expect(out).toContain('1 resolved');
  });

  it('includes the timestamp', () => {
    const diff = { newFindings: [], resolvedFindings: [], unchanged: [] };
    const out = formatWatchUpdate(diff, [], [], '15:30:45');
    expect(out).toContain('15:30:45');
  });

  it('includes changed file names', () => {
    const diff = { newFindings: [], resolvedFindings: [], unchanged: [] };
    const out = formatWatchUpdate(diff, [], ['src/changed.ts'], '12:00:00');
    expect(out).toContain('src/changed.ts');
  });
});
