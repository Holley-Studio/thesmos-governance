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
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SavingsEntry {
  ts: string;
  type: 'model_tier' | 'budget_stop' | 'context_1m_block';
  detail: string;
  estSavedUsd?: number;
  model?: string;
  costUsd?: number;
}

/**
 * Path of the LEGACY per-repo ledger written before v5.2.0.
 * New writes go to the VS Code private-storage path instead (see `privateLedgerPath`).
 * This function is kept so the migration command can locate the old file.
 */
export function legacyLedgerPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.thesmos', 'savings.jsonl');
}

/**
 * Path of the private ledger inside VS Code's workspace-scoped storage directory.
 * Nothing in this path is tracked by git — the extension directory is outside the repo.
 */
export function privateLedgerPath(storageRoot: string): string {
  return join(storageRoot, 'savings.jsonl');
}

export function appendSavings(ledgerPath: string, entry: SavingsEntry): void {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf-8');
}

function parseLedgerFile(path: string): SavingsEntry[] {
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

/**
 * Read savings entries from the private ledger, with a fallback to the
 * legacy workspace ledger so month totals remain correct during migration.
 */
export function readSavingsEntries(storagePath: string, workspaceRoot: string): SavingsEntry[] {
  const privatePath = privateLedgerPath(storagePath);
  const legacyPath = legacyLedgerPath(workspaceRoot);
  // Private ledger wins; legacy is a read-only fallback until migrated.
  return [...parseLedgerFile(legacyPath), ...parseLedgerFile(privatePath)];
}

/** Month-to-date estimated savings (UTC month of `now`). */
export function monthSavingsUsd(storagePath: string, workspaceRoot: string, now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let total = 0;
  for (const e of readSavingsEntries(storagePath, workspaceRoot)) {
    const d = new Date(e.ts);
    if (d.getUTCFullYear() === y && d.getUTCMonth() === m) total += e.estSavedUsd ?? 0;
  }
  return total;
}

/**
 * Migrate legacy `.thesmos/savings.jsonl` into private VS Code storage.
 * Returns `true` when migration succeeded, `false` when the legacy file was absent.
 * Throws if the move fails so the caller can surface the error.
 */
export function migrateLegacyLedger(storageRoot: string, workspaceRoot: string): boolean {
  const from = legacyLedgerPath(workspaceRoot);
  if (!existsSync(from)) return false;
  const to = privateLedgerPath(storageRoot);
  mkdirSync(dirname(to), { recursive: true });
  renameSync(from, to);
  return true;
}

/**
 * Tier-discipline estimate vs the flagship (Opus) baseline, using the real
 * price sheet (Opus $5/$25, Sonnet $3/$15, Haiku $1/$5 per MTok) — kept in
 * sync with thesmos/savings.ts. Saving = cost × (price ratio − 1):
 * Sonnet → (2/3)×cost, Haiku → 4×cost.
 * Unknown/flagship models return undefined — no claim is made.
 */
export function estimateTierSaving(model: string, turnCostUsd: number): number | undefined {
  if (!Number.isFinite(turnCostUsd) || turnCostUsd <= 0) return undefined;
  if (/opus|fable/i.test(model)) return undefined;
  if (/sonnet/i.test(model)) return turnCostUsd * (2 / 3);
  if (/haiku/i.test(model)) return turnCostUsd * 4;
  return undefined;
}
