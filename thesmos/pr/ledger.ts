// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Append-only JSONL record of every autonomous action, mirroring the shipped
 * .thesmos/savings.jsonl pattern. Intent is durable before the action runs, so
 * a merge that left no record cannot happen. Corrupt lines are isolated.
 */
import { existsSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type LedgerAction = 'merge' | 'revert' | 'close';

export interface LedgerEntry {
  ts: string;
  action: LedgerAction;
  pr: number;
  phase: 'intent' | 'outcome';
  class?: string;
  mergeCommit?: string;
  ok?: boolean;
  detail?: string;
}

export function ledgerPath(root: string): string {
  return join(root, '.thesmos', 'pr-ledger.jsonl');
}

export function appendEntry(root: string, entry: Omit<LedgerEntry, 'ts'>, now: Date): void {
  const path = ledgerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const line = JSON.stringify({ ts: now.toISOString(), ...entry }) + '\n';

  // Durability: open once in append mode, write, and fsync to guarantee the record
  // survives a process crash on all platforms (Windows requires write-capable fd).
  // Power-loss durability: guaranteed on Linux via fsync; weaker on macOS/Windows.
  const fd = openSync(path, 'a');
  try { writeSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
}

export function readEntries(root: string): LedgerEntry[] {
  const path = ledgerPath(root);
  if (!existsSync(path)) return [];
  const out: LedgerEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as LedgerEntry); } catch { /* corrupt line is isolated */ }
  }
  return out;
}

/** Merges Thesmos performed that have not since been reverted. */
export function armedMerges(entries: LedgerEntry[]): LedgerEntry[] {
  // Track the latest outcome action for each PR to handle re-lands after reverts
  // and to distinguish failed reverts (ok:false) from successful ones.
  const latestOutcome = new Map<number, LedgerEntry>();
  for (const e of entries) {
    if (e.phase === 'outcome') {
      latestOutcome.set(e.pr, e);
    }
  }

  // Armed merge: merge with ok:true where either:
  // 1. The latest action for that PR is this merge (not reverted, or re-landed after revert)
  // 2. The latest action for that PR is a failed revert (ok !== true)
  return entries.filter((e) => {
    if (!(e.action === 'merge' && e.phase === 'outcome' && e.ok === true)) {
      return false;
    }
    const latest = latestOutcome.get(e.pr);
    if (!latest) return false;
    // This merge is armed if it's the latest action, or if latest is a failed revert
    return latest === e || (latest.action === 'revert' && latest.ok !== true);
  });
}
