// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Versioned execution receipts — machine-readable run/task outcomes.
 *
 * Written to `.thesmos/receipts/<runId>.jsonl` (one JSON object per line).
 * I/O is stored as sha256 hashes only — never raw prompts or secrets.
 */
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isNonNegativeNumber, isObject, isTimestamp, readValidatedJsonl } from './jsonl.js';

export const RECEIPT_SCHEMA_VERSION = 1 as const;

export type ReceiptTerminalStatus =
  'complete' | 'blocked' | 'timed_out' | 'error' | 'dry_run' | 'cancelled';

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
   * What governed memory reached this execution.
   *
   * Ids and a capsule hash, never memory content: a receipt is an audit record
   * that may be shared or archived, and copying remembered project detail into
   * every one of them would turn an audit trail into a second, ungoverned
   * store of the same material.
   */
  memory?: ReceiptMemoryEvidence;
}

/** Auditable record of the context decision for one execution. */
export interface ReceiptMemoryEvidence {
  /** Ids injected into the capsule, in the order they appeared. */
  includedIds: string[];
  /** Candidates considered before filtering. */
  candidates: number;
  /** Why each rejected candidate was rejected — the useful half of an audit. */
  excluded?: Array<{ id: string; reason: string }>;
  /** sha256 of the rendered memory block, so the exact bytes are provable. */
  capsuleHash?: string;
  /** ESTIMATE — see `estimateTokens`. Never an measured token count. */
  tokensEstimate?: number;
  /** True when recall was attempted but the subsystem was unavailable. */
  degraded?: boolean;
}

function receiptsDir(root: string): string {
  return join(root, '.thesmos', 'receipts');
}

/** Portable single filename, including Windows reserved names and ADS syntax. */
export function isReceiptRunId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) &&
    !value.endsWith('.') &&
    !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value)
  );
}

function assertRunId(value: unknown): asserts value is string {
  if (!isReceiptRunId(value))
    throw new TypeError('Invalid receipt runId: use a portable filename identifier');
}

export function isExecutionReceipt(value: unknown): value is ExecutionReceipt {
  if (!isObject(value)) return false;
  const allowed = new Set([
    'schemaVersion',
    'ts',
    'runId',
    'taskId',
    'requestId',
    'source',
    'agentId',
    'adapter',
    'routing',
    'dependsOn',
    'dependencyTransition',
    'retries',
    'loopDetected',
    'durationMs',
    'promptHash',
    'resultHash',
    'commitHash',
    'artifacts',
    'terminalStatus',
    'blockReason',
    'memory',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  return (
    value.schemaVersion === RECEIPT_SCHEMA_VERSION &&
    isTimestamp(value.ts) &&
    isReceiptRunId(value.runId) &&
    typeof value.taskId === 'string' &&
    value.taskId.length > 0 &&
    ['autopilot', 'agent-run', 'pantheon-orchestrate'].includes(value.source as string) &&
    ['complete', 'blocked', 'timed_out', 'error', 'dry_run', 'cancelled'].includes(
      value.terminalStatus as string
    ) &&
    ['requestId', 'agentId', 'adapter', 'commitHash', 'blockReason'].every(
      (key) => value[key] === undefined || typeof value[key] === 'string'
    ) &&
    (value.retries === undefined ||
      (Number.isSafeInteger(value.retries) && (value.retries as number) >= 0)) &&
    (value.loopDetected === undefined || typeof value.loopDetected === 'boolean') &&
    (value.artifacts === undefined ||
      (Array.isArray(value.artifacts) &&
        value.artifacts.every((item) => typeof item === 'string'))) &&
    (value.dependsOn === undefined ||
      (Array.isArray(value.dependsOn) &&
        value.dependsOn.every((item) => Number.isSafeInteger(item) && item >= 0))) &&
    (value.dependencyTransition === undefined ||
      ['allowed', 'blocked'].includes(value.dependencyTransition as string)) &&
    (value.routing === undefined ||
      (isObject(value.routing) &&
        Object.keys(value.routing).every((key) => ['kind', 'detail'].includes(key)) &&
        typeof value.routing.kind === 'string' &&
        (value.routing.detail === undefined || typeof value.routing.detail === 'string'))) &&
    (value.memory === undefined || isReceiptMemory(value.memory)) &&
    (value.durationMs === undefined || isNonNegativeNumber(value.durationMs)) &&
    (value.promptHash === undefined ||
      (typeof value.promptHash === 'string' && /^[a-f0-9]{64}$/.test(value.promptHash))) &&
    (value.resultHash === undefined ||
      (typeof value.resultHash === 'string' && /^[a-f0-9]{64}$/.test(value.resultHash)))
  );
}

function isReceiptMemory(value: unknown): value is ReceiptMemoryEvidence {
  return (
    isObject(value) &&
    Object.keys(value).every((key) =>
      [
        'includedIds',
        'candidates',
        'excluded',
        'capsuleHash',
        'tokensEstimate',
        'degraded',
      ].includes(key)
    ) &&
    Array.isArray(value.includedIds) &&
    value.includedIds.every((id) => typeof id === 'string') &&
    Number.isSafeInteger(value.candidates) &&
    (value.candidates as number) >= 0 &&
    (value.excluded === undefined ||
      (Array.isArray(value.excluded) &&
        value.excluded.every(
          (row) =>
            isObject(row) &&
            Object.keys(row).every((key) => ['id', 'reason'].includes(key)) &&
            typeof row.id === 'string' &&
            typeof row.reason === 'string'
        ))) &&
    (value.capsuleHash === undefined ||
      (typeof value.capsuleHash === 'string' && /^[a-f0-9]{64}$/.test(value.capsuleHash))) &&
    (value.tokensEstimate === undefined || isNonNegativeNumber(value.tokensEstimate)) &&
    (value.degraded === undefined || typeof value.degraded === 'boolean')
  );
}

export interface ReceiptReadResult {
  records: ExecutionReceipt[];
  invalidRecords: number;
  unreadableFiles: string[];
}

export function hashPayload(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function createReceipt(
  partial: Omit<ExecutionReceipt, 'schemaVersion' | 'ts'> & Partial<Pick<ExecutionReceipt, 'ts'>>
): ExecutionReceipt {
  return {
    ...partial,
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    ts: partial.ts ?? new Date().toISOString(),
  };
}

export function writeExecutionReceipt(root: string, receipt: ExecutionReceipt): string {
  assertRunId(receipt.runId);
  if (!isExecutionReceipt(receipt)) throw new TypeError('Invalid execution receipt');
  const dir = receiptsDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, `${receipt.runId}.jsonl`);
  appendFileSync(path, JSON.stringify(receipt) + '\n', 'utf8');
  return path;
}

export function readExecutionReceipts(
  root: string,
  runId?: string,
  limit = 500
): ExecutionReceipt[] {
  return readExecutionReceiptResult(root, runId, limit).records;
}

export function readExecutionReceiptResult(
  root: string,
  runId?: string,
  limit = 500
): ReceiptReadResult {
  if (runId !== undefined) assertRunId(runId);
  if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0))
    throw new RangeError('Receipt limit must be a non-negative integer or Infinity');
  const dir = receiptsDir(root);
  const result: ReceiptReadResult = { records: [], invalidRecords: 0, unreadableFiles: [] };
  if (!existsSync(dir)) return result;

  let files: string[];
  try {
    files =
      runId !== undefined
        ? [`${runId}.jsonl`]
        : readdirSync(dir)
            .filter((f) => f.endsWith('.jsonl'))
            .sort();
  } catch {
    result.unreadableFiles.push(dir);
    return result;
  }

  for (const file of files) {
    const id = file.slice(0, -6);
    if (!isReceiptRunId(id)) {
      result.unreadableFiles.push(file);
      continue;
    }
    const rows = readValidatedJsonl(
      join(dir, file),
      (value): value is ExecutionReceipt => isExecutionReceipt(value) && value.runId === id
    );
    result.records.push(...rows.records);
    result.invalidRecords += rows.invalidLines.length;
    if (rows.error) result.unreadableFiles.push(file);
  }
  result.records.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  if (limit === 0) result.records = [];
  else if (limit !== Number.POSITIVE_INFINITY) result.records = result.records.slice(-limit);
  return result;
}

export function countExecutionReceipts(root: string): number {
  return readExecutionReceipts(root, undefined, Number.POSITIVE_INFINITY).length;
}

export function newTaskId(): string {
  return randomUUID();
}
