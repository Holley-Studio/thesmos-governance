// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEntry, readEntries, armedMerges } from './ledger.ts';

let root: string;
const AT = new Date('2026-08-16T12:00:00Z');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-ledger-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

describe('ledger', () => {
  it('appends and reads entries in order', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'intent' }, AT);
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'abc123' }, AT);

    const entries = readEntries(root);
    expect(entries.map((e) => e.phase)).toEqual(['intent', 'outcome']);
    expect(entries[1].mergeCommit).toBe('abc123');
    expect(entries[0].ts).toBe('2026-08-16T12:00:00.000Z');
  });

  it('returns an empty list when no ledger exists', () => {
    expect(readEntries(root)).toEqual([]);
  });

  it('skips a corrupt line instead of throwing', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'intent' }, AT);
    const p = join(root, '.thesmos', 'pr-ledger.jsonl');
    writeFileSync(p, readFileSync(p, 'utf8') + '{not json\n', 'utf8');
    appendEntry(root, { action: 'merge', pr: 2, phase: 'intent' }, AT);

    expect(readEntries(root).map((e) => e.pr)).toEqual([1, 2]);
  });

  it('reports merges that have not been reverted', () => {
    appendEntry(root, { action: 'merge', pr: 1, phase: 'outcome', ok: true, mergeCommit: 'a' }, AT);
    appendEntry(root, { action: 'merge', pr: 2, phase: 'outcome', ok: true, mergeCommit: 'b' }, AT);
    appendEntry(root, { action: 'revert', pr: 1, phase: 'outcome', ok: true }, AT);

    expect(armedMerges(readEntries(root)).map((e) => e.pr)).toEqual([2]);
  });
});
