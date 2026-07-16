// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSavings,
  readSavingsEntries,
  monthSavingsUsd,
  estimateTierSaving,
  type SavingsEntry,
} from '../chat/savingsLedger.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'thesmos-ext-savings-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('extension savings ledger', () => {
  it('appends JSONL and reads it back', () => {
    const entry: SavingsEntry = {
      ts: '2026-07-09T12:00:00.000Z', type: 'model_tier',
      detail: 'turn on sonnet', estSavedUsd: 0.12, model: 'sonnet', costUsd: 0.03,
    };
    appendSavings(root, entry);
    appendSavings(root, { ...entry, estSavedUsd: 0.08 });
    const lines = readFileSync(join(root, '.thesmos', 'savings.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(readSavingsEntries(root)).toHaveLength(2);
  });

  it('skips malformed lines and returns [] with no ledger', () => {
    expect(readSavingsEntries(root)).toEqual([]);
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'savings.jsonl'),
      '{"ts":"2026-07-09T12:00:00.000Z","type":"budget_stop","detail":"x"}\nnot json\n');
    expect(readSavingsEntries(root)).toHaveLength(1);
  });

  it('sums only the given month', () => {
    const mk = (ts: string, usd: number): SavingsEntry =>
      ({ ts, type: 'model_tier', detail: 'd', estSavedUsd: usd });
    appendSavings(root, mk('2026-07-01T00:00:00Z', 1));
    appendSavings(root, mk('2026-07-20T00:00:00Z', 2));
    appendSavings(root, mk('2026-06-30T00:00:00Z', 99));
    expect(monthSavingsUsd(root, new Date('2026-07-09T00:00:00Z'))).toBe(3);
  });

  it('estimates tier savings vs flagship baseline using real price ratios', () => {
    expect(estimateTierSaving('claude-sonnet-4-6', 0.05)).toBeCloseTo(0.05 * (2 / 3));
    expect(estimateTierSaving('claude-haiku-4-5', 0.01)).toBeCloseTo(0.04);
    expect(estimateTierSaving('claude-opus-4-8', 0.5)).toBeUndefined();
    expect(estimateTierSaving('claude-fable-5', 0.5)).toBeUndefined();
    expect(estimateTierSaving('glm-4.7', 0.5)).toBeUndefined();
    expect(estimateTierSaving('claude-sonnet-4-6', 0)).toBeUndefined();
  });
});
