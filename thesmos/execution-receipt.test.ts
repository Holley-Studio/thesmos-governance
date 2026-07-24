// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createReceipt,
  hashPayload,
  readExecutionReceipts,
  writeExecutionReceipt,
} from './execution-receipt.js';

describe('execution-receipt', () => {
  it('hashes payloads stably and omits empties', () => {
    expect(hashPayload('hello')).toBe(hashPayload('hello'));
    expect(hashPayload('hello')).not.toBe(hashPayload('world'));
    expect(hashPayload(undefined)).toBeUndefined();
    expect(hashPayload('')).toBeUndefined();
  });

  it('writes and reads versioned receipts without raw prompt text', () => {
    const root = mkdtempSync(join(tmpdir(), 'thesmos-receipt-'));
    const receipt = createReceipt({
      runId: 'run-1',
      taskId: 'task-1',
      source: 'autopilot',
      promptHash: hashPayload('secret prompt with sk-ant-fake'),
      resultHash: hashPayload('ok'),
      terminalStatus: 'complete',
      durationMs: 12,
    });
    const path = writeExecutionReceipt(root, receipt);
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('secret prompt');
    expect(raw).not.toContain('sk-ant-fake');

    const rows = readExecutionReceipts(root, 'run-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.schemaVersion).toBe(1);
    expect(rows[0]?.terminalStatus).toBe('complete');
    expect(rows[0]?.promptHash).toHaveLength(64);
  });
});
