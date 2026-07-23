// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendMetricsExport,
  isLocalMetricsEnabled,
  readMetricsExport,
} from './metrics-export.js';

describe('metrics-export', () => {
  it('enables only for local-jsonl when enabled=true', () => {
    expect(isLocalMetricsEnabled(undefined)).toBe(false);
    expect(isLocalMetricsEnabled({ enabled: false })).toBe(false);
    expect(isLocalMetricsEnabled({ enabled: true })).toBe(true);
    expect(isLocalMetricsEnabled({ enabled: true, exportTo: 'local-jsonl' })).toBe(true);
  });

  it('appends session snapshots to metrics-export.jsonl', () => {
    const root = mkdtempSync(join(tmpdir(), 'thesmos-metrics-'));
    appendMetricsExport(root, {
      ts: new Date().toISOString(),
      kind: 'session',
      runId: 'r1',
      source: 'autopilot',
      llmCalls: 3,
      completed: 2,
      blocked: 1,
    });
    const rows = readMetricsExport(root);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.llmCalls).toBe(3);
  });
});
