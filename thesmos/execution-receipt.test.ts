// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReceipt,
  hashPayload,
  readExecutionReceipts,
  writeExecutionReceipt,
} from './execution-receipt.js';

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'thesmos-receipt-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('execution-receipt', () => {
  it('hashes payloads stably and omits empties', () => {
    expect(hashPayload('hello')).toBe(hashPayload('hello'));
    expect(hashPayload('hello')).not.toBe(hashPayload('world'));
    expect(hashPayload(undefined)).toBeUndefined();
    expect(hashPayload('')).toBeUndefined();
  });

  it('rejects an untyped raw prompt field instead of leaking it into an audit file', () => {
    const root = fixture();
    const receipt = {
      ...createReceipt({
        runId: 'run',
        taskId: 't',
        source: 'agent-run',
        terminalStatus: 'complete',
      }),
      prompt: 'PRIVATE_INPUT_CANARY',
    };
    expect(() => writeExecutionReceipt(root, receipt)).toThrow(/invalid/i);
    expect(existsSync(join(root, '.thesmos', 'receipts', 'run.jsonl'))).toBe(false);
  });

  it('rejects unexpected nested routing and memory content fields', () => {
    const root = fixture();
    const base = createReceipt({
      runId: 'run',
      taskId: 'task',
      source: 'agent-run',
      terminalStatus: 'complete',
    });
    const withRouting = { ...base, routing: { kind: 'local', prompt: 'PRIVATE_INPUT_CANARY' } };
    const withMemory = {
      ...base,
      memory: {
        includedIds: [],
        candidates: 1,
        excluded: [{ id: 'm', reason: 'scope', content: 'PRIVATE_INPUT_CANARY' }],
      },
    };
    expect(() => writeExecutionReceipt(root, withRouting)).toThrow(/invalid/i);
    expect(() => writeExecutionReceipt(root, withMemory)).toThrow(/invalid/i);
  });

  it('writes and reads versioned receipts without raw prompt text', () => {
    const root = fixture();
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

  it.each([
    '../escaped',
    '..\\escaped',
    '/absolute',
    'C:\\absolute',
    'run:stream',
    'CON',
    'aux.txt',
    '',
    'x'.repeat(256),
  ])('rejects unsafe or non-portable run ID %j before writing', (runId) => {
    const root = fixture();
    expect(() =>
      writeExecutionReceipt(
        root,
        createReceipt({ runId, taskId: 't', source: 'agent-run', terminalStatus: 'complete' })
      )
    ).toThrow(/run.?id/i);
    expect(existsSync(join(root, '.thesmos', 'escaped.jsonl'))).toBe(false);
    expect(() => readExecutionReceipts(root, runId)).toThrow(/run.?id/i);
  });

  it('returns the latest receipt by timestamp rather than run filename', () => {
    const root = fixture();
    writeExecutionReceipt(
      root,
      createReceipt({
        runId: 'z-old',
        taskId: 'old',
        source: 'agent-run',
        terminalStatus: 'error',
        ts: '2026-09-01T00:00:00Z',
      })
    );
    writeExecutionReceipt(
      root,
      createReceipt({
        runId: 'a-new',
        taskId: 'new',
        source: 'agent-run',
        terminalStatus: 'complete',
        ts: '2026-09-30T00:00:00Z',
      })
    );
    expect(readExecutionReceipts(root, undefined, 1).map((r) => r.taskId)).toEqual(['new']);
    expect(readExecutionReceipts(root, undefined, 0)).toEqual([]);
  });

  it('ignores structurally invalid JSON rows without hiding valid receipts', () => {
    const root = fixture();
    const dir = join(root, '.thesmos', 'receipts');
    mkdirSync(dir, { recursive: true });
    const valid = createReceipt({
      runId: 'run',
      taskId: 't',
      source: 'agent-run',
      terminalStatus: 'complete',
    });
    writeFileSync(
      join(dir, 'run.jsonl'),
      [
        null,
        [],
        { schemaVersion: 1 },
        { ...valid, ts: 'invalid' },
        { ...valid, terminalStatus: 'invented' },
        valid,
      ]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n{broken\n',
      'utf8'
    );
    expect(readExecutionReceipts(root)).toEqual([valid]);
  });

  it('keeps the generated timestamp when an optional timestamp is explicitly undefined', () => {
    const receipt = createReceipt({
      runId: 'run',
      taskId: 't',
      source: 'agent-run',
      terminalStatus: 'complete',
      ts: undefined,
    });
    expect(Number.isFinite(Date.parse(receipt.ts))).toBe(true);
  });
});
