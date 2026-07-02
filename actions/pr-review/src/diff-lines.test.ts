// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  parseChangedLines,
  resolveChangedLines,
  lineIsChanged,
  ALL_LINES,
} from './diff-lines.js';

// ── parseChangedLines ───────────────────────────────────────────────────────────

describe('parseChangedLines — single hunk', () => {
  it('returns the line numbers of added lines only', () => {
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' line1',
      '-line2',
      '+line2 modified',
      '+line3 new',
      ' line4',
    ].join('\n');

    expect(parseChangedLines(patch)).toEqual(new Set([2, 3]));
  });

  it('pure addition hunk — every added line is in the set', () => {
    const patch = [
      '@@ -1,1 +1,3 @@',
      ' line1',
      '+line2',
      '+line3',
    ].join('\n');

    expect(parseChangedLines(patch)).toEqual(new Set([2, 3]));
  });

  it('pure deletion hunk — nothing added, empty set', () => {
    const patch = [
      '@@ -1,3 +1,1 @@',
      ' line1',
      '-line2',
      '-line3',
    ].join('\n');

    expect(parseChangedLines(patch)).toEqual(new Set());
  });

  it('single-line hunk header without counts (b/d omitted means 1)', () => {
    const patch = ['@@ -1 +1 @@', '-old', '+new'].join('\n');
    expect(parseChangedLines(patch)).toEqual(new Set([1]));
  });

  it('added line at the very start of the file (new-side line 1)', () => {
    const patch = ['@@ -1,2 +1,3 @@', '+inserted at top', ' line1', ' line2'].join('\n');
    expect(parseChangedLines(patch)).toEqual(new Set([1]));
  });

  it('context-only hunk (no +/- lines) — empty set', () => {
    const patch = ['@@ -5,2 +5,2 @@', ' line5', ' line6'].join('\n');
    expect(parseChangedLines(patch)).toEqual(new Set());
  });
});

describe('parseChangedLines — multiple hunks', () => {
  it('resets the new-side counter per hunk', () => {
    const patch = [
      '@@ -1,2 +1,3 @@',
      ' line1',
      '+line1.5 inserted',
      ' line2',
      '@@ -50,2 +51,3 @@',
      ' line51',
      '+line51.5 inserted',
      ' line52',
    ].join('\n');

    expect(parseChangedLines(patch)).toEqual(new Set([2, 52]));
  });

  it('three hunks each contribute independently', () => {
    const patch = [
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
      '@@ -10,1 +11,2 @@',
      ' c',
      '+d',
      '@@ -20,1 +22,2 @@',
      ' e',
      '+f',
    ].join('\n');

    expect(parseChangedLines(patch)).toEqual(new Set([2, 12, 23]));
  });
});

describe('parseChangedLines — no trailing newline markers', () => {
  it('ignores "\\ No newline at end of file" and does not advance the counter', () => {
    const patch = [
      '@@ -1,1 +1,1 @@',
      '-old content',
      '\\ No newline at end of file',
      '+new content',
      '\\ No newline at end of file',
    ].join('\n');

    expect(parseChangedLines(patch)).toEqual(new Set([1]));
  });
});

describe('parseChangedLines — renamed files', () => {
  it('preamble lines (rename metadata) before the first hunk are ignored', () => {
    const patch = [
      'similarity index 92%',
      'rename from old-name.ts',
      'rename to new-name.ts',
      '@@ -10,2 +10,3 @@',
      ' context',
      '+added after rename',
      ' context2',
    ].join('\n');

    expect(parseChangedLines(patch)).toEqual(new Set([11]));
  });

  it('pure rename with zero hunks (no content change) returns an empty set', () => {
    const patch = ['similarity index 100%', 'rename from a.ts', 'rename to b.ts'].join('\n');
    expect(parseChangedLines(patch)).toEqual(new Set());
  });
});

describe('parseChangedLines — edge cases', () => {
  it('empty string returns an empty set', () => {
    expect(parseChangedLines('')).toEqual(new Set());
  });

  it('malformed patch with no hunk headers at all returns an empty set', () => {
    expect(parseChangedLines('not a real diff\njust text')).toEqual(new Set());
  });
});

// ── resolveChangedLines ──────────────────────────────────────────────────────────

describe('resolveChangedLines', () => {
  it('undefined patch (GitHub omitted it — large/binary file) resolves to ALL_LINES', () => {
    expect(resolveChangedLines(undefined)).toBe(ALL_LINES);
  });

  it('a real patch resolves to a parsed Set', () => {
    const patch = ['@@ -1,1 +1,2 @@', ' a', '+b'].join('\n');
    const result = resolveChangedLines(patch);
    expect(result).toEqual(new Set([2]));
  });

  it('empty string patch (present but empty) resolves to an empty Set, not ALL_LINES', () => {
    expect(resolveChangedLines('')).toEqual(new Set());
  });
});

// ── lineIsChanged ────────────────────────────────────────────────────────────────

describe('lineIsChanged', () => {
  it('ALL_LINES matches any line number', () => {
    expect(lineIsChanged(ALL_LINES, 1)).toBe(true);
    expect(lineIsChanged(ALL_LINES, 99999)).toBe(true);
  });

  it('a Set only matches lines it contains', () => {
    const set = new Set([2, 3]);
    expect(lineIsChanged(set, 2)).toBe(true);
    expect(lineIsChanged(set, 3)).toBe(true);
    expect(lineIsChanged(set, 4)).toBe(false);
  });

  it('an empty Set matches nothing', () => {
    expect(lineIsChanged(new Set(), 1)).toBe(false);
  });
});

// ── resolveChangedLines — null hardening (Argus, item 4) ─────────────────────

describe('resolveChangedLines — null/undefined fail CLOSED', () => {
  it('undefined patch → ALL_LINES', () => {
    expect(resolveChangedLines(undefined)).toBe(ALL_LINES);
  });

  it('null patch → ALL_LINES (must not fall through to empty-set fail-open)', () => {
    expect(resolveChangedLines(null)).toBe(ALL_LINES);
  });

  it('empty-string patch (pure rename) → empty set, nothing gates', () => {
    const result = resolveChangedLines('');
    expect(result).not.toBe(ALL_LINES);
    expect((result as Set<number>).size).toBe(0);
  });
});
