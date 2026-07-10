// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Credit Guardian savings ledger — append-only JSONL at .thesmos/savings.jsonl.
 *
 * Honesty contract: every dollar figure is an ESTIMATE vs the flagship-model
 * baseline, computed only from events that actually happened (a turn genuinely
 * ran on a cheaper tier; a budget stop genuinely fired). Never counts a
 * recommendation the user didn't take. Display layers must render figures with
 * a "~" prefix and the "estimated vs flagship baseline" disclaimer.
 *
 * The extension keeps a thin twin of this module at
 * extensions/vscode/src/chat/savingsLedger.ts (it bundles independently of the
 * engine) — keep formulas in sync.
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

export function appendSavingsEntry(root: string, entry: SavingsEntry): void {
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
      // Tolerant reader — a corrupt line never breaks the report.
    }
  }
  return out;
}

export interface SavingsSummary {
  monthEstUsd: number;
  monthEvents: number;
  byType: Record<string, number>;
}

export function summarizeSavings(entries: SavingsEntry[], monthOf: Date): SavingsSummary {
  const y = monthOf.getUTCFullYear();
  const m = monthOf.getUTCMonth();
  const summary: SavingsSummary = { monthEstUsd: 0, monthEvents: 0, byType: {} };
  for (const e of entries) {
    const d = new Date(e.ts);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m) continue;
    summary.monthEvents += 1;
    summary.monthEstUsd += e.estSavedUsd ?? 0;
    summary.byType[e.type] = (summary.byType[e.type] ?? 0) + 1;
  }
  return summary;
}

/**
 * Tier-discipline estimate vs the flagship baseline (AGNT_031 doctrine:
 * flagship ≈ 5× mid tier, mid ≈ 5× fast tier). A turn that cost $C on the mid
 * tier would have cost ≈ 5×$C on the flagship → estimated saving = 4×$C.
 * Unknown/flagship models return undefined — no claim is made.
 */
export function estimateTierSaving(model: string, turnCostUsd: number): number | undefined {
  if (!Number.isFinite(turnCostUsd) || turnCostUsd <= 0) return undefined;
  if (/opus|fable/i.test(model)) return undefined;
  if (/sonnet/i.test(model)) return turnCostUsd * 4;
  if (/haiku/i.test(model)) return turnCostUsd * 24;
  return undefined;
}
