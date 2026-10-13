// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Local cost/token metrics export (AGNT_020).
 *
 * When `.thesmos/config.json` has `metrics.enabled` + `exportTo: "local-jsonl"`,
 * session snapshots append to `.thesmos/metrics-export.jsonl`.
 * No third-party SaaS — BYOK observability stays in-repo.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { MetricsConfig } from './types.js';
import {
  isObject,
  isTimestamp,
  isNonNegativeNumber,
  readValidatedJsonl,
  type JsonlReadResult,
} from './jsonl.js';

export interface MetricsExportEvent {
  ts: string;
  kind: 'session' | 'task';
  runId: string;
  source: string;
  adapter?: string;
  taskCount?: number;
  completed?: number;
  blocked?: number;
  timedOut?: number;
  llmCalls?: number;
  durationMs?: number;
  /** Estimated or reported USD; optional */
  costUSD?: number;
  /** Estimated or reported tokens; optional */
  tokens?: number;
}

function exportPath(root: string): string {
  return join(root, '.thesmos', 'metrics-export.jsonl');
}

export function isLocalMetricsEnabled(metrics: MetricsConfig | undefined): boolean {
  if (!metrics?.enabled) return false;
  const dest = metrics.exportTo ?? 'local-jsonl';
  return dest === 'local-jsonl';
}

export function appendMetricsExport(root: string, event: MetricsExportEvent): void {
  const dir = join(root, '.thesmos');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(exportPath(root), JSON.stringify(event) + '\n', 'utf8');
}

export function readMetricsExport(root: string, limit = 200): MetricsExportEvent[] {
  return readMetricsExportResult(root, limit).records;
}

export function readMetricsExportResult(
  root: string,
  limit = 200
): JsonlReadResult<MetricsExportEvent> {
  return readValidatedJsonl(
    exportPath(root),
    (value): value is MetricsExportEvent =>
      isObject(value) &&
      isTimestamp(value.ts) &&
      ['session', 'task'].includes(value.kind as string) &&
      typeof value.runId === 'string' &&
      typeof value.source === 'string' &&
      [
        'taskCount',
        'completed',
        'blocked',
        'timedOut',
        'llmCalls',
        'durationMs',
        'costUSD',
        'tokens',
      ].every((key) => value[key] === undefined || isNonNegativeNumber(value[key])),
    limit
  );
}

export function countMetricsExport(root: string): number {
  return readMetricsExport(root, Number.POSITIVE_INFINITY).length;
}
