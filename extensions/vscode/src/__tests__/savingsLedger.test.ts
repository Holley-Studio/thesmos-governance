// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSavings,
  readSavingsEntries,
  monthSavingsUsd,
  estimateTierSaving,
  privateLedgerPath,
  legacyLedgerPath,
  migrateLegacyLedger,
  type SavingsEntry,
} from '../chat/savingsLedger.js';

let storageDir: string;
let workspaceDir: string;
beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'thesmos-ext-storage-'));
  workspaceDir = mkdtempSync(join(tmpdir(), 'thesmos-ext-workspace-'));
});
afterEach(() => {
  rmSync(storageDir, { recursive: true, force: true });
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe('extension savings ledger', () => {
  it('appends JSONL to private storage and reads it back', () => {
    const entry: SavingsEntry = {
      ts: '2026-07-09T12:00:00.000Z', type: 'model_tier',
      detail: 'turn on sonnet', estSavedUsd: 0.12, model: 'sonnet', costUsd: 0.03,
    };
    const ledger = privateLedgerPath(storageDir);
    appendSavings(ledger, entry);
    appendSavings(ledger, { ...entry, estSavedUsd: 0.08 });
    const lines = readFileSync(ledger, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(readSavingsEntries(storageDir, workspaceDir)).toHaveLength(2);
  });

  it('skips malformed lines and returns [] with no ledger', () => {
    expect(readSavingsEntries(storageDir, workspaceDir)).toEqual([]);
    // Inject malformed data at private path
    const ledger = privateLedgerPath(storageDir);
    mkdirSync(join(storageDir), { recursive: true });
    writeFileSync(ledger,
      '{"ts":"2026-07-09T12:00:00.000Z","type":"budget_stop","detail":"x"}\nnot json\n');
    expect(readSavingsEntries(storageDir, workspaceDir)).toHaveLength(1);
  });

  it('sums only the given month', () => {
    const mk = (ts: string, usd: number): SavingsEntry =>
      ({ ts, type: 'model_tier', detail: 'd', estSavedUsd: usd });
    const ledger = privateLedgerPath(storageDir);
    appendSavings(ledger, mk('2026-07-01T00:00:00Z', 1));
    appendSavings(ledger, mk('2026-07-20T00:00:00Z', 2));
    appendSavings(ledger, mk('2026-06-30T00:00:00Z', 99));
    expect(monthSavingsUsd(storageDir, workspaceDir, new Date('2026-07-09T00:00:00Z'))).toBe(3);
  });

  it('merges legacy workspace ledger with private storage', () => {
    const mk = (ts: string, usd: number): SavingsEntry =>
      ({ ts, type: 'model_tier', detail: 'd', estSavedUsd: usd });
    // Write one entry to legacy location, one to private
    const legacy = legacyLedgerPath(workspaceDir);
    mkdirSync(join(workspaceDir, '.thesmos'), { recursive: true });
    writeFileSync(legacy, JSON.stringify(mk('2026-07-01T00:00:00Z', 1)) + '\n');
    appendSavings(privateLedgerPath(storageDir), mk('2026-07-05T00:00:00Z', 2));
    // readSavingsEntries should merge both
    const entries = readSavingsEntries(storageDir, workspaceDir);
    expect(entries).toHaveLength(2);
    expect(monthSavingsUsd(storageDir, workspaceDir, new Date('2026-07-09T00:00:00Z'))).toBe(3);
  });

  it('migrates legacy ledger to private storage', () => {
    const legacy = legacyLedgerPath(workspaceDir);
    mkdirSync(join(workspaceDir, '.thesmos'), { recursive: true });
    writeFileSync(legacy, '{"ts":"2026-07-01T00:00:00Z","type":"model_tier","detail":"d"}\n');
    const moved = migrateLegacyLedger(storageDir, workspaceDir);
    expect(moved).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(privateLedgerPath(storageDir))).toBe(true);
  });

  it('migrateLegacyLedger returns false when no legacy file exists', () => {
    expect(migrateLegacyLedger(storageDir, workspaceDir)).toBe(false);
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
