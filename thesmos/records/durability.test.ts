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
/** How many subsequent writes are truncated, and to how many bytes. */
const shortWrite = { remaining: 0, bytes: 0 };
const throwAfterPartial = { armed: false };

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      calls.push(`open:${String(args[1])}`);
      return actual.openSync(...args);
    },
    writeSync: ((fd: number, data: Buffer | string, offset?: number, length?: number) => {
      calls.push('write');
      written.push(String(data));

      // Short-write simulation. `write(2)` may accept fewer bytes than asked
      // for; the first implementation discarded the return value entirely, so a
      // partial write produced a torn record and still reported success.
      if (shortWrite.remaining > 0 && Buffer.isBuffer(data)) {
        shortWrite.remaining -= 1;
        const take = shortWrite.bytes;
        if (take <= 0) return 0; // zero progress — must be refused, not retried
        return actual.writeSync(fd, data, offset ?? 0, Math.min(take, length ?? data.length));
      }
      if (throwAfterPartial.armed && Buffer.isBuffer(data)) {
        throwAfterPartial.armed = false;
        actual.writeSync(fd, data, offset ?? 0, Math.min(8, length ?? data.length));
        throw Object.assign(new Error('simulated device failure'), { code: 'EIO' });
      }
      return Buffer.isBuffer(data)
        ? actual.writeSync(fd, data, offset ?? 0, length ?? data.length)
        : actual.writeSync(fd, data as string);
    }) as unknown as typeof actual.writeSync,
    ftruncateSync: (fd: number, len?: number) => {
      calls.push('ftruncate');
      return actual.ftruncateSync(fd, len);
    },
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

const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { appendRecordInternal, journalPath } = await import('./journal.js');
const { buildRecordContent, sealRecord } = await import('./record.js');
const { GENESIS_HASH, RECORD_CODES } = await import('./types.js');
const { readRecords } = await import('./store.js');

let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-durable-'));
  calls.length = 0;
  written.length = 0;
  shortWrite.remaining = 0;
  shortWrite.bytes = 0;
  throwAfterPartial.armed = false;
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

  it('F6 — completes a record across several short writes', () => {
    // Three partial writes of 16 bytes each, then the remainder.
    shortWrite.remaining = 3;
    shortWrite.bytes = 16;

    const result = appendRecordInternal(journalPath(root), record('short writes'));
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c === 'write').length).toBeGreaterThan(1);

    // The record is whole and readable despite being written in pieces.
    const { records, verification } = readRecords({ root });
    expect(verification.valid).toBe(true);
    expect(records[0]?.intent).toBe('short writes');
  });

  it('F6 — refuses a write that makes no progress', () => {
    shortWrite.remaining = 1;
    shortWrite.bytes = 0; // writeSync returns 0

    const result = appendRecordInternal(journalPath(root), record('no progress'));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(RECORD_CODES.writeIncomplete);
  });

  it('F6 — leaves the journal unchanged when a write throws after partial bytes', () => {
    expect(appendRecordInternal(journalPath(root), record('first')).ok).toBe(true);
    const before = readFileSync(journalPath(root), 'utf8');

    throwAfterPartial.armed = true;
    const result = appendRecordInternal(journalPath(root), record('doomed'));

    expect(result.ok).toBe(false);
    // The partial bytes are truncated away, so a failed append is a no-op.
    expect(readFileSync(journalPath(root), 'utf8')).toBe(before);
    expect(calls).toContain('ftruncate');
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
