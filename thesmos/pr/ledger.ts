// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Append-only JSONL record of every autonomous action. Intent is durable
 * before the action runs, so a merge that left no record cannot happen.
 * Corrupt lines are isolated.
 *
 * THIS IS THE LOCAL AUDIT TRAIL, NOT A TRANSPORT (spec §6.2). It is the CLI's
 * own durable record of every autonomous action, and nothing else depends on
 * it reaching another machine. It holds PR numbers, SHAs, classes and
 * outcomes — never diffs, source, prompts, or secrets.
 *
 * It is committed to the repository (thesmos/pr/sync.ts) so that record is
 * shared rather than trapped on one laptop, and that push can legitimately
 * fail — a protected default branch rejects it outright. A merge is never
 * reported as not-happened just because the record of it could not be pushed.
 *
 * IT USED TO BE THE ACTION'S ONLY SOURCE OF TRUTH, and that did not work.
 * `thesmos pr:watch` runs on a fresh `actions/checkout`; on any repository
 * whose default branch is protected the ledger push is rejected, so that
 * checkout contained no ledger, `readEntries` returned `[]` on every run,
 * `chooseCulprit` returned null, and auto-revert could not fire in production
 * at all. The Action now reconstructs what Thesmos merged from GitHub itself
 * (thesmos/pr/marks.ts) and never reads this file. Do not reintroduce a
 * consumer of it on the unattended side.
 */
import { existsSync, mkdirSync, openSync, fsyncSync, closeSync, readFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Reversibility } from './classify.ts';

export type LedgerAction = 'merge' | 'revert' | 'close';

export interface LedgerEntry {
  ts: string;
  action: LedgerAction;
  pr: number;
  phase: 'intent' | 'outcome';
  /** Reversibility class the planner assigned, carried from PlanEntry. */
  class?: Reversibility;
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
  // Power-loss durability: guaranteed on Linux via fsync; weaker on macOS.
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
  // 2. The latest action for that PR failed (ok !== true) — a failed outcome of any action
  //    never changes armed status; the original merge remains live.
  return entries.filter((e) => {
    if (!(e.action === 'merge' && e.phase === 'outcome' && e.ok === true)) {
      return false;
    }
    const latest = latestOutcome.get(e.pr);
    if (!latest) return false;
    // This merge is armed if it's the latest action, or if latest outcome failed
    return latest === e || (latest.ok !== true);
  });
}
