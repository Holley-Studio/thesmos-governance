// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Credit Guardian ledger (extension side) — append-only JSONL at
 * .thesmos/savings.jsonl.
 *
 * Formulas duplicated from thesmos/savings.ts — keep in sync (the extension
 * bundles independently of the engine). Honesty contract: every dollar figure
 * is an ESTIMATE vs the flagship-model baseline, computed only from events
 * that actually happened; display layers render "~" and the "estimated vs
 * flagship baseline" disclaimer.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SavingsEntry {
  ts: string;
  type: 'model_tier' | 'budget_stop' | 'context_1m_block';
  detail: string;
  estSavedUsd?: number;
  model?: string;
  costUsd?: number;
}

export function savingsLedgerPath(root: string): string {
  return join(root, '.thesmos', 'savings.jsonl');
}

export function appendSavings(root: string, entry: SavingsEntry): void {
  const path = savingsLedgerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
}

export function readSavingsEntries(root: string): SavingsEntry[] {
  const path = savingsLedgerPath(root);
  if (!existsSync(path)) return [];
  const out: SavingsEntry[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SavingsEntry;
      if (typeof parsed.ts === 'string' && typeof parsed.type === 'string') out.push(parsed);
    } catch {
      // Tolerant reader — a corrupt line never breaks the display.
    }
  }
  return out;
}

/** Month-to-date estimated savings (UTC month of `now`). */
export function monthSavingsUsd(root: string, now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let total = 0;
  for (const e of readSavingsEntries(root)) {
    const d = new Date(e.ts);
    if (d.getUTCFullYear() === y && d.getUTCMonth() === m) total += e.estSavedUsd ?? 0;
  }
  return total;
}

/**
 * Tier-discipline estimate vs the flagship baseline (AGNT_031 doctrine:
 * flagship ≈ 5× mid tier, mid ≈ 5× fast tier). Saving = cost × (multiple − 1).
 * Unknown/flagship models return undefined — no claim is made.
 */
export function estimateTierSaving(model: string, turnCostUsd: number): number | undefined {
  if (!Number.isFinite(turnCostUsd) || turnCostUsd <= 0) return undefined;
  if (/opus|fable/i.test(model)) return undefined;
  if (/sonnet/i.test(model)) return turnCostUsd * 4;
  if (/haiku/i.test(model)) return turnCostUsd * 24;
  return undefined;
}
