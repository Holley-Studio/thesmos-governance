// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * The durability barrier is actually invoked.
 *
 * `fsync` cannot be observed from userspace by its effect — proving it would
 * need a real power loss — so what is provable is that the append path calls
 * it, and calls it on the same descriptor it just wrote to, before closing.
 *
 * This file mocks `node:fs`, which is why it is separate: the rest of the
 * record suites use the real filesystem, and mocking it globally would quietly
 * weaken them. Mutation testing is what surfaced the need — deleting the
 * `fsyncSync` call passed every other test in the module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const written: string[] = [];

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      calls.push(`open:${String(args[1])}`);
      return actual.openSync(...args);
    },
    writeSync: ((fd: number, data: string) => {
      calls.push('write');
      written.push(String(data));
      return actual.writeSync(fd, data);
    }) as unknown as typeof actual.writeSync,
    fsyncSync: (fd: number) => {
      calls.push('fsync');
      return actual.fsyncSync(fd);
    },
    closeSync: (fd: number) => {
      calls.push('close');
      return actual.closeSync(fd);
    },
  };
});

const { mkdtempSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { appendRecordInternal, journalPath } = await import('./journal.js');
const { buildRecordContent, sealRecord } = await import('./record.js');
const { GENESIS_HASH } = await import('./types.js');

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-durable-'));
  calls.length = 0;
  written.length = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function record(intent: string) {
  const content = buildRecordContent({
    event: 'mission.planned',
    identity: { correlationId: 'c', causationId: '' },
    actor: { kind: 'system', component: 'test' },
    intent,
    outcome: { kind: 'planned' },
  });
  return sealRecord(content, GENESIS_HASH, 0, '2026-01-01T00:00:00.000Z');
}

describe('append is durable', () => {
  it('fsyncs before closing the descriptor', () => {
    const result = appendRecordInternal(journalPath(root), record('durable write'));
    expect(result.ok).toBe(true);

    const fsyncAt = calls.indexOf('fsync');
    const writeAt = calls.indexOf('write');
    const closeAt = calls.indexOf('close');

    expect(fsyncAt, 'append did not fsync — a crash could leave a torn record').toBeGreaterThan(-1);
    expect(fsyncAt).toBeGreaterThan(writeAt);
    expect(closeAt).toBeGreaterThan(fsyncAt);
  });

  it('opens in append mode so concurrent writers cannot clobber each other', () => {
    appendRecordInternal(journalPath(root), record('one'));
    expect(calls.some((c) => c === 'open:a')).toBe(true);
  });

  it('writes exactly one newline-terminated line per record', () => {
    appendRecordInternal(journalPath(root), record('one'));
    expect(written).toHaveLength(1);
    expect(written[0]?.endsWith('\n')).toBe(true);
    expect(written[0]?.slice(0, -1).includes('\n')).toBe(false);
  });

  it('does not touch the filesystem when a record is refused', () => {
    // A refusal must happen before any descriptor is opened, or a rejected
    // record still creates the journal file.
    const bad = { ...record('ok'), digests: { blob: 'y'.repeat(70_000) } };
    const result = appendRecordInternal(journalPath(root), bad);

    expect(result.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
