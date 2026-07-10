// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSavingsEntry,
  readSavingsEntries,
  summarizeSavings,
  estimateTierSaving,
  type SavingsEntry,
} from './savings.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'thesmos-savings-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('savings ledger', () => {
  it('appends JSONL and reads it back', () => {
    const entry: SavingsEntry = {
      ts: '2026-07-09T12:00:00.000Z', type: 'model_tier',
      detail: 'turn on sonnet', estSavedUsd: 0.12, model: 'sonnet', costUsd: 0.03,
    };
    appendSavingsEntry(root, entry);
    appendSavingsEntry(root, { ...entry, estSavedUsd: 0.08 });
    const lines = readFileSync(join(root, '.thesmos', 'savings.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(readSavingsEntries(root)).toHaveLength(2);
  });

  it('skips malformed lines when reading', () => {
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'savings.jsonl'),
      '{"ts":"2026-07-09T12:00:00.000Z","type":"budget_stop","detail":"x"}\nnot json\n');
    expect(readSavingsEntries(root)).toHaveLength(1);
  });

  it('returns [] when no ledger exists', () => {
    expect(readSavingsEntries(root)).toEqual([]);
  });

  it('summarizes only the given month', () => {
    const mk = (ts: string, usd: number): SavingsEntry =>
      ({ ts, type: 'model_tier', detail: 'd', estSavedUsd: usd });
    const entries = [mk('2026-07-01T00:00:00Z', 1), mk('2026-07-20T00:00:00Z', 2), mk('2026-06-30T00:00:00Z', 99)];
    const s = summarizeSavings(entries, new Date('2026-07-09T00:00:00Z'));
    expect(s.monthEstUsd).toBe(3);
    expect(s.monthEvents).toBe(2);
    expect(s.byType['model_tier']).toBe(2);
  });

  it('estimates tier savings vs flagship baseline', () => {
    expect(estimateTierSaving('claude-sonnet-4-6', 0.05)).toBeCloseTo(0.2);
    expect(estimateTierSaving('claude-haiku-4-5', 0.01)).toBeCloseTo(0.24);
    expect(estimateTierSaving('claude-opus-4-8', 0.5)).toBeUndefined();
    expect(estimateTierSaving('claude-fable-5', 0.5)).toBeUndefined();
    expect(estimateTierSaving('glm-4.7', 0.5)).toBeUndefined();
    expect(estimateTierSaving('claude-sonnet-4-6', 0)).toBeUndefined();
  });
});
