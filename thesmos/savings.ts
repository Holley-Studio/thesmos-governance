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
 * engine). Both now derive their ratios from the SAME registry data — core
 * imports thesmos/models directly, the extension reads a generated snapshot —
 * so the two formulas can no longer drift apart by hand.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { estimateTierSavingFromCost } from './models/index.js';

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
 * Tier-discipline estimate vs the deep-reasoning (Opus 5) baseline.
 *
 * Now DERIVED from the model registry rather than hardcoded ratios. Two things
 * the old constants got wrong:
 *
 *  - The `(2/3)` Sonnet constant assumed Sonnet at $3/$15. Sonnet 5 currently
 *    carries an introductory $2/$10 rate that lapses 2026-08-31, so the real
 *    ratio is 2.5× until then and 1.67× after. A constant is wrong on one side
 *    of that date no matter which value you pick; the registry's dated price
 *    windows are right on both.
 *
 *  - `/opus|fable/` lumped Fable in with the baseline and returned undefined.
 *    Fable is $10/$50 against Opus 5's $5/$25 — running on it costs TWICE the
 *    baseline. That is a premium, and it is now reported as a negative number
 *    rather than hidden behind "no claim".
 *
 * Returns undefined only when the cost is genuinely unknowable: a model absent
 * from the registry, or one with no verified price.
 */
export function estimateTierSaving(
  model: string,
  turnCostUsd: number,
  at: Date = new Date(),
): number | undefined {
  const result = estimateTierSavingFromCost(model, turnCostUsd, at);
  return result.known ? result.estSavedUsd : undefined;
}
