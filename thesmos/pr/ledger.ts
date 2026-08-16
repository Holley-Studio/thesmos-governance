// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Append-only JSONL record of every autonomous action, mirroring the shipped
 * .thesmos/savings.jsonl pattern. Intent is durable before the action runs, so
 * a merge that left no record cannot happen. Corrupt lines are isolated.
 */
import { appendFileSync, existsSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync } from 'node:fs';
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
  appendFileSync(path, line, 'utf8');

  // Durability: the record must survive a crash between write and action.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
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
  const reverted = new Set(
    entries.filter((e) => e.action === 'revert' && e.phase === 'outcome').map((e) => e.pr),
  );
  return entries.filter(
    (e) => e.action === 'merge' && e.phase === 'outcome' && e.ok === true && !reverted.has(e.pr),
  );
}
