// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Versioned execution receipts — machine-readable run/task outcomes.
 *
 * Written to `.thesmos/receipts/<runId>.jsonl` (one JSON object per line).
 * I/O is stored as sha256 hashes only — never raw prompts or secrets.
 */
import { createHash, randomUUID } from 'node:crypto';
import { type ModelRouteDecision, hasModelMismatch } from './models/index.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const RECEIPT_SCHEMA_VERSION = 1 as const;

export type ReceiptTerminalStatus =
  | 'complete'
  | 'blocked'
  | 'timed_out'
  | 'error'
  | 'dry_run'
  | 'cancelled';

export interface ExecutionReceipt {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  ts: string;
  runId: string;
  taskId: string;
  requestId?: string;
  source: 'autopilot' | 'agent-run' | 'pantheon-orchestrate';
  agentId?: string;
  adapter?: string;
  routing?: { kind: string; detail?: string };
  dependsOn?: number[];
  dependencyTransition?: 'allowed' | 'blocked';
  retries?: number;
  loopDetected?: boolean;
  durationMs?: number;
  /** sha256 hex of prompt bytes (never the prompt itself) */
  promptHash?: string;
  /** sha256 hex of result summary bytes */
  resultHash?: string;
  commitHash?: string;
  artifacts?: string[];
  terminalStatus: ReceiptTerminalStatus;
  blockReason?: string;
  /**
   * The model routing decision behind this execution.
   *
   * Recorded on the receipt so "which model actually ran this, and why" is
   * answerable after the fact instead of being reconstructed from logs. Carries
   * the requested profile, the resolved and effective model ids, reason codes,
   * approval state, any fallback, and the registry version+hash the decision
   * was made against — so a decision stays interpretable even after the
   * registry moves on.
   *
   * Optional: receipts written before model routing existed remain valid.
   */
  modelDecision?: ModelDecisionReceipt;
}

/**
 * Flattened projection of a `ModelRouteDecision` for the receipt log.
 *
 * Deliberately a plain data shape rather than the live type: receipts are
 * append-only JSON read back months later, so they must not depend on the
 * current shape of routing code.
 */
export interface ModelDecisionReceipt {
  requestedProfile: string;
  provider: string;
  requestedModelId: string;
  /** What the runtime reported. null when it never reported back. */
  effectiveModelId: string | null;
  /** True when effective differs from requested — the mismatch signal. */
  mismatch: boolean;
  effort: string | null;
  reasonCodes: string[];
  approval: string;
  fallback?: { from: string; to: string; reason: string };
  registryVersion: string;
  registryHash: string;
}

/** Project a live routing decision into its receipt form. */
export function toModelDecisionReceipt(d: ModelRouteDecision): ModelDecisionReceipt {
  return {
    requestedProfile: d.requestedProfile,
    provider: d.resolvedProvider,
    requestedModelId: d.requestedModelId,
    effectiveModelId: d.effectiveModelId,
    mismatch: hasModelMismatch(d),
    effort: d.effort,
    reasonCodes: [...d.reasonCodes],
    approval: d.approval,
    ...(d.fallback ? { fallback: { ...d.fallback } } : {}),
    registryVersion: d.registryVersion,
    registryHash: d.registryHash,
  };
}

function receiptsDir(root: string): string {
  return join(root, '.thesmos', 'receipts');
}

export function hashPayload(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function createReceipt(
  partial: Omit<ExecutionReceipt, 'schemaVersion' | 'ts'> &
    Partial<Pick<ExecutionReceipt, 'ts'>>,
): ExecutionReceipt {
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    ts: partial.ts ?? new Date().toISOString(),
    ...partial,
  };
}

export function writeExecutionReceipt(root: string, receipt: ExecutionReceipt): string {
  const dir = receiptsDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${receipt.runId}.jsonl`);
  appendFileSync(path, JSON.stringify(receipt) + '\n', 'utf8');
  return path;
}

export function readExecutionReceipts(root: string, runId?: string, limit = 500): ExecutionReceipt[] {
  const dir = receiptsDir(root);
  if (!existsSync(dir)) return [];

  const files = runId
    ? [join(dir, `${runId}.jsonl`)].filter((p) => existsSync(p))
    : readdirSync(dir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(dir, f));

  const out: ExecutionReceipt[] = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as ExecutionReceipt;
        if (row.schemaVersion === RECEIPT_SCHEMA_VERSION) out.push(row);
      } catch {
        // skip malformed
      }
    }
  }
  return out.slice(-limit);
}

export function countExecutionReceipts(root: string): number {
  return readExecutionReceipts(root, undefined, 10_000).length;
}

export function newTaskId(): string {
  return randomUUID();
}
