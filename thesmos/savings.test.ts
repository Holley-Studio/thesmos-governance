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

  it('derives tier savings from registry prices, not hardcoded ratios', () => {
    // After the Sonnet 5 introductory rate lapses: Opus 5 $5/$25 vs Sonnet 5
    // $3/$15 → ratio 5/3 → saving = (2/3) × cost.
    const after = new Date('2026-09-15T00:00:00Z');
    expect(estimateTierSaving('claude-sonnet-5', 0.05, after)).toBeCloseTo(0.05 * (2 / 3));
    // Opus 5 $5/$25 vs Haiku 4.5 $1/$5 → ratio 5 → saving = 4 × cost.
    expect(estimateTierSaving('claude-haiku-4-5', 0.01, after)).toBeCloseTo(0.04);
    // The baseline saves nothing against itself.
    expect(estimateTierSaving('claude-opus-5', 0.5, after)).toBeCloseTo(0);
  });

  it('tracks the dated Sonnet 5 introductory price window', () => {
    // A hardcoded ratio is wrong on one side of 2026-08-31 no matter which
    // value you pick. During the intro window Sonnet 5 is $2/$10, so the ratio
    // against Opus 5 is 2.5 and the saving is 1.5 × cost — not (2/3) × cost.
    const during = new Date('2026-08-03T00:00:00Z');
    expect(estimateTierSaving('claude-sonnet-5', 0.05, during)).toBeCloseTo(0.05 * 1.5);
  });

  it('reports Fable as a PREMIUM, never as equivalent to the baseline', () => {
    // The previous formula matched /opus|fable/ and returned undefined, hiding
    // the fact that Fable is 2x the Opus 5 baseline. A premium is a negative
    // saving, and callers must be able to see it.
    const at = new Date('2026-08-03T00:00:00Z');
    const fable = estimateTierSaving('claude-fable-5', 0.5, at);
    expect(fable).toBeDefined();
    expect(fable!).toBeLessThan(0);
    expect(fable!).toBeCloseTo(-0.25); // $0.50 on Fable would have been $0.25 on Opus 5
  });

  it('returns undefined only when the cost is genuinely unknowable', () => {
    const at = new Date('2026-08-03T00:00:00Z');
    expect(estimateTierSaving('glm-4.7', 0.5, at)).toBeUndefined();      // absent from registry
    expect(estimateTierSaving('claude-sonnet-5', 0, at)).toBeUndefined(); // no cost to compare
  });
});
