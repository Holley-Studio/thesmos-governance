// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Concurrent-writer safety, proven with real processes.
 *
 * The first revision's "concurrency" test was a sequential loop, which proves
 * nothing: it never put two writers at the same chain tip. An adversarial review
 * did, and found both writers were told they succeeded, the chain broke, and
 * one acknowledged record became unreadable.
 *
 * These spawn actual child processes. A sequential loop cannot fail the way
 * concurrency fails, so it cannot be evidence that concurrency is safe.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { journalPath } from './journal.js';
import { acquireLock, releaseLock } from './lock.js';
import { readRecords, verifyRecords, writeRecord } from './store.js';
import { RECORD_CODES } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-conc-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * A writer child process.
 *
 * Written to disk per test rather than kept as a fixture so the store path is
 * resolved from this checkout, and so the barrier file makes the start times
 * genuinely simultaneous rather than merely close.
 */
function writerScript(): string {
  const script = join(root, 'writer.mjs');
  writeFileSync(
    script,
    `
import { writeRecord } from ${JSON.stringify(join(HERE, 'store.ts'))};
import { existsSync } from 'node:fs';
const [root, intent, barrier] = process.argv.slice(2);
// Spin until released, so every child enters the transaction together.
if (barrier) { while (!existsSync(barrier)) { /* wait */ } }
const r = writeRecord(
  { root, lockTimeoutMs: 10000 },
  {
    event: 'mission.planned',
    identity: { correlationId: 'c', causationId: '' },
    actor: { kind: 'system', component: 'child' },
    intent,
    outcome: { kind: 'planned' },
  }
);
process.stdout.write(JSON.stringify({ ok: r.ok, seq: r.record ? r.record.sequence : null }));
`,
    'utf8'
  );
  return script;
}

/**
 * Spawn every writer, then release a barrier so they contend for real.
 *
 * `execFileSync` in a loop would run them one after another — which is exactly
 * the sequential-loop mistake this suite exists to correct. They are spawned
 * asynchronously, all block on the barrier file, and only then are released
 * together.
 */
async function runWriters(count: number): Promise<Array<{ ok: boolean; seq: number | null }>> {
  const script = writerScript();
  const barrier = join(root, 'go');
  const tsx = join(HERE, '..', '..', 'node_modules', '.bin', 'tsx');

  const children = Array.from({ length: count }, (_, i) => {
    const child = spawn(tsx, [script, root, `writer-${i}`, barrier], {
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    return new Promise<{ ok: boolean; seq: number | null }>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => {
        try {
          resolve(JSON.parse(out) as { ok: boolean; seq: number | null });
        } catch {
          resolve({ ok: false, seq: null });
        }
      });
    });
  });

  // Give every child time to reach the barrier, then release them at once.
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(barrier, 'go', 'utf8');

  return Promise.all(children);
}

describe('F4 — concurrent writers cannot corrupt the journal', () => {
  it('serializes two simultaneous writers into a valid chain', async () => {
    const results = await runWriters(2);

    const committed = results.filter((r) => r.ok);
    expect(committed.length).toBeGreaterThanOrEqual(1);

    const v = verifyRecords({ root });
    expect(v.valid, `journal invalid: ${v.issues.map((i) => i.code).join(',')}`).toBe(true);

    const { records } = readRecords({ root });
    // Every acknowledged write is present and readable.
    expect(records).toHaveLength(committed.length);
    // No two acknowledged records share a sequence.
    const sequences = committed.map((r) => r.seq);
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it('loses no acknowledged record across ten simultaneous writers', async () => {
    const results = await runWriters(10);
    const committed = results.filter((r) => r.ok);

    const v = verifyRecords({ root });
    expect(v.valid, `journal invalid: ${v.issues.map((i) => i.code).join(',')}`).toBe(true);

    const { records } = readRecords({ root });
    expect(records).toHaveLength(committed.length);
    expect(new Set(records.map((r) => r.sequence)).size).toBe(records.length);
    expect(new Set(committed.map((r) => r.seq)).size).toBe(committed.length);
  });

  it('never acknowledges a record that is absent from the journal', async () => {
    const results = await runWriters(6);
    const committed = results.filter((r) => r.ok).map((r) => r.seq);
    const present = new Set(readRecords({ root }).records.map((r) => r.sequence));

    for (const seq of committed) {
      expect(present.has(seq as number), `acknowledged sequence ${seq} is missing`).toBe(true);
    }
  });
});

describe('F4 — lock ownership', () => {
  const lockPath = (): string => `${journalPath(root).slice(0, -'.jsonl'.length)}.lock`;

  beforeEach(() => {
    // Writing a lock file directly needs the records directory to exist.
    mkdirSync(dirname(journalPath(root)), { recursive: true });
  });

  it('refuses a second writer while a lock is genuinely held', () => {
    const held = acquireLock(lockPath(), { timeoutMs: 50 });
    expect(held.ok).toBe(true);

    const second = acquireLock(lockPath(), { timeoutMs: 50 });
    expect(second.ok).toBe(false);
    expect(second.issues.map((i) => i.code)).toContain(RECORD_CODES.lockHeld);

    releaseLock(lockPath(), held.owner!);
  });

  it('leaves the journal untouched when a write times out', () => {
    writeRecord({ root }, {
      event: 'mission.planned',
      identity: { correlationId: 'c', causationId: '' },
      actor: { kind: 'system', component: 'test' },
      intent: 'first',
      outcome: { kind: 'planned' },
    });
    const before = readFileSync(journalPath(root), 'utf8');

    const held = acquireLock(lockPath(), { timeoutMs: 50 });
    const blocked = writeRecord({ root, lockTimeoutMs: 50 }, {
      event: 'mission.planned',
      identity: { correlationId: 'c', causationId: '' },
      actor: { kind: 'system', component: 'test' },
      intent: 'blocked',
      outcome: { kind: 'planned' },
    });

    expect(blocked.ok).toBe(false);
    expect(readFileSync(journalPath(root), 'utf8')).toBe(before);
    releaseLock(lockPath(), held.owner!);
  });

  it('does not let a wrong owner release the lock', () => {
    const held = acquireLock(lockPath(), { timeoutMs: 50 });
    const released = releaseLock(lockPath(), { token: 'not-mine', pid: 1, acquiredAt: 0 });

    expect(released.ok).toBe(false);
    expect(existsSync(lockPath())).toBe(true);
    releaseLock(lockPath(), held.owner!);
  });

  it('does not steal a lock that exists but has no contents yet', () => {
    // `wx` creates the lock file before its JSON is written, so a competing
    // writer can observe an empty lock that is about to become a live one.
    // Treating unreadable as abandoned let a second writer steal a held lock
    // and broke the chain under ten concurrent writers. That race is timing
    // dependent, so it is pinned deterministically here rather than left to
    // the multi-process test to catch by luck.
    writeFileSync(lockPath(), '', 'utf8');

    const attempt = acquireLock(lockPath(), { timeoutMs: 100, staleMs: 30_000 });
    expect(attempt.ok, 'an empty lock file was treated as abandoned').toBe(false);
    expect(existsSync(lockPath())).toBe(true);
  });

  it('reclaims an unreadable lock only once it is old', () => {
    writeFileSync(lockPath(), 'not json at all', 'utf8');
    // staleMs of 0 makes any age qualify, so this proves the age path is what
    // permits reclaim — not the unreadability itself.
    const attempt = acquireLock(lockPath(), { timeoutMs: 500, staleMs: 0 });
    expect(attempt.ok).toBe(true);
    releaseLock(lockPath(), attempt.owner!);
  });

  it('does not steal a young lock even from a dead pid', () => {
    // Age is checked before liveness, so a fresh lock is respected regardless.
    writeFileSync(
      lockPath(),
      JSON.stringify({ token: 't', pid: 999_999, acquiredAt: Date.now() }),
      'utf8'
    );
    const attempt = acquireLock(lockPath(), { timeoutMs: 50, staleMs: 30_000 });
    expect(attempt.ok).toBe(false);
  });

  it('reclaims a stale lock whose holder has exited', () => {
    writeFileSync(
      lockPath(),
      JSON.stringify({ token: 't', pid: 999_999, acquiredAt: Date.now() - 120_000 }),
      'utf8'
    );
    const attempt = acquireLock(lockPath(), { timeoutMs: 500, staleMs: 1000 });

    expect(attempt.ok).toBe(true);
    expect(attempt.issues.map((i) => i.code)).toContain(RECORD_CODES.lockStaleRecovered);
    releaseLock(lockPath(), attempt.owner!);
  });

  it('recovers after a killed writer left a lock and a torn tail', () => {
    writeRecord({ root }, {
      event: 'mission.planned',
      identity: { correlationId: 'c', causationId: '' },
      actor: { kind: 'system', component: 'test' },
      intent: 'before-crash',
      outcome: { kind: 'planned' },
    });
    // Simulate the crash: partial bytes plus an abandoned lock.
    const path = journalPath(root);
    writeFileSync(path, readFileSync(path, 'utf8') + '{"partial', 'utf8');
    writeFileSync(
      lockPath(),
      JSON.stringify({ token: 't', pid: 999_999, acquiredAt: Date.now() - 120_000 }),
      'utf8'
    );

    const result = writeRecord({ root, lockStaleMs: 1000, lockTimeoutMs: 2000 }, {
      event: 'mission.planned',
      identity: { correlationId: 'c', causationId: '' },
      actor: { kind: 'system', component: 'test' },
      intent: 'after-crash',
      outcome: { kind: 'planned' },
    });

    expect(result.ok).toBe(true);
    expect(result.repairedBytes).toBeGreaterThan(0);
    expect(verifyRecords({ root }).valid).toBe(true);
  });
});
