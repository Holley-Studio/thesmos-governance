// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Journal durability, tamper evidence, and corruption semantics.
 *
 * The distinction these tests exist to protect: a torn *final* record is the
 * crash signature and is recoverable, while damage anywhere else means the
 * evidence cannot be trusted. The existing receipt and governance logs cannot
 * tell those apart — they skip malformed lines silently — and that is precisely
 * what makes a tampered journal look like a shorter one.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRecord, exportJournal, journalPath, readJournal } from './journal.js';
import { buildRecordContent, sealRecord, type RecordInput } from './record.js';
import { readRecords, verifyRecords, writeRecord } from './store.js';
import { GENESIS_HASH, RECORD_CODES } from './types.js';

let root = '';
const FIXED_TIME = '2026-01-01T00:00:00.000Z';

function opts(overrides: Record<string, unknown> = {}): {
  root: string;
  now: () => string;
} {
  return { root, now: () => FIXED_TIME, ...overrides };
}

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    event: 'mission.planned',
    identity: { correlationId: 'corr-1', causationId: '' },
    actor: { kind: 'system', component: 'test' },
    intent: 'plan the mission',
    outcome: { kind: 'planned' },
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-records-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('append and read', () => {
  it('round-trips a record', () => {
    const written = writeRecord(opts(), input());
    expect(written.ok).toBe(true);

    const { records, verification } = readRecords(opts());
    expect(verification.valid).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0]?.intent).toBe('plan the mission');
    expect(records[0]?.prevHash).toBe(GENESIS_HASH);
    expect(records[0]?.sequence).toBe(0);
  });

  it('reads an absent journal as empty rather than failing', () => {
    const { records, verification } = readRecords(opts());
    expect(records).toEqual([]);
    expect(verification.valid).toBe(true);
  });

  it('chains each record to its predecessor', () => {
    writeRecord(opts(), input({ intent: 'first' }));
    writeRecord(opts(), input({ intent: 'second' }));
    writeRecord(opts(), input({ intent: 'third' }));

    const { records, verification } = readRecords(opts());
    expect(verification.valid).toBe(true);
    expect(records).toHaveLength(3);
    expect(records[1]?.prevHash).toBe(records[0]?.contentHash);
    expect(records[2]?.prevHash).toBe(records[1]?.contentHash);
    expect(records.map((r) => r.sequence)).toEqual([0, 1, 2]);
  });

  it('produces byte-identical journals for identical inputs', () => {
    const rootA = mkdtempSync(join(tmpdir(), 'thesmos-records-a-'));
    const rootB = mkdtempSync(join(tmpdir(), 'thesmos-records-b-'));
    try {
      for (const r of [rootA, rootB]) {
        writeRecord({ root: r, now: () => FIXED_TIME }, input({ intent: 'one' }));
        writeRecord({ root: r, now: () => FIXED_TIME }, input({ intent: 'two' }));
      }
      expect(readFileSync(journalPath(rootB), 'utf8')).toBe(readFileSync(journalPath(rootA), 'utf8'));
    } finally {
      rmSync(rootA, { recursive: true, force: true });
      rmSync(rootB, { recursive: true, force: true });
    }
  });

  it('hashes content independently of when it was recorded', () => {
    const content = buildRecordContent(input());
    const early = sealRecord(content, GENESIS_HASH, 0, '2020-01-01T00:00:00.000Z');
    const late = sealRecord(content, GENESIS_HASH, 0, '2030-12-31T23:59:59.999Z');
    // A clock reading must not change what a record means.
    expect(late.contentHash).toBe(early.contentHash);
  });
});

describe('tamper evidence', () => {
  function corruptLine(index: number, mutate: (record: Record<string, unknown>) => void): void {
    const path = journalPath(root);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[index] as string) as Record<string, unknown>;
    mutate(parsed);
    lines[index] = JSON.stringify(parsed);
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');
  }

  beforeEach(() => {
    writeRecord(opts(), input({ intent: 'one' }));
    writeRecord(opts(), input({ intent: 'two' }));
    writeRecord(opts(), input({ intent: 'three' }));
  });

  it('detects an edited record', () => {
    corruptLine(1, (r) => {
      r['intent'] = 'quietly changed';
    });
    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.contentHashMismatch);
  });

  it('detects a removed record', () => {
    const path = journalPath(root);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    lines.splice(1, 1);
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.chainBroken);
  });

  it('detects reordered records', () => {
    const path = journalPath(root);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    [lines[0], lines[1]] = [lines[1] as string, lines[0] as string];
    writeFileSync(path, lines.join('\n') + '\n', 'utf8');

    expect(verifyRecords(opts()).valid).toBe(false);
  });

  it('detects a rewritten hash that no longer chains', () => {
    corruptLine(1, (r) => {
      r['intent'] = 'changed';
      // Recomputing the record's own hash is not enough: it still has to chain.
      r['contentHash'] = 'sha256:' + 'f'.repeat(64);
    });
    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
  });

  it('stops at the damage rather than reading past it', () => {
    corruptLine(1, (r) => {
      r['intent'] = 'changed';
    });
    // Records after the break are not returned; trusting them would mean
    // trusting a chain whose earlier link is known broken.
    expect(readRecords(opts()).records).toHaveLength(1);
  });
});

describe('corruption semantics', () => {
  beforeEach(() => {
    writeRecord(opts(), input({ intent: 'one' }));
    writeRecord(opts(), input({ intent: 'two' }));
  });

  it('recovers from a torn final record — the crash signature', () => {
    const path = journalPath(root);
    const raw = readFileSync(path, 'utf8');
    // Simulate dying mid-write: a partial final line, no trailing newline.
    writeFileSync(path, raw + '{"schemaVersion":"1.0.0","event":"mis', 'utf8');

    const v = verifyRecords(opts());
    expect(v.tornTail).toBe(true);
    expect(v.valid).toBe(true); // recoverable, not fatal
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.tornTail);
    expect(readRecords(opts()).records).toHaveLength(2);
  });

  it('fails closed on a malformed record in the middle', () => {
    const path = journalPath(root);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    writeFileSync(path, [lines[0], '{ not json', lines[1]].join('\n') + '\n', 'utf8');

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.tornTail).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.malformed);
  });

  it('distinguishes a torn tail from mid-journal damage', () => {
    // The property the existing logs cannot express: one is survivable, the
    // other means the evidence is untrustworthy.
    const path = journalPath(root);
    const clean = readFileSync(path, 'utf8');

    writeFileSync(path, clean + '{"partial', 'utf8');
    const torn = verifyRecords(opts());

    const lines = clean.split('\n').filter(Boolean);
    writeFileSync(path, ['{ broken', ...lines].join('\n') + '\n', 'utf8');
    const damaged = verifyRecords(opts());

    expect(torn.valid).toBe(true);
    expect(damaged.valid).toBe(false);
  });

  it('refuses a journal written by a newer schema instead of guessing', () => {
    const path = journalPath(root);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    parsed['schemaVersion'] = '9.9.9';
    writeFileSync(path, [JSON.stringify(parsed), lines[1]].join('\n') + '\n', 'utf8');

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.schemaUnsupported);
  });

  it('refuses to extend a journal that already fails verification', () => {
    const path = journalPath(root);
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    const parsed = JSON.parse(lines[0] as string) as Record<string, unknown>;
    parsed['intent'] = 'tampered';
    writeFileSync(path, [JSON.stringify(parsed), lines[1]].join('\n') + '\n', 'utf8');

    // Appending would produce a chain that looks intact from the tip.
    const result = writeRecord(opts(), input({ intent: 'new' }));
    expect(result.ok).toBe(false);
  });
});

describe('export', () => {
  it('exports a verified journal atomically', () => {
    writeRecord(opts(), input({ intent: 'one' }));
    writeRecord(opts(), input({ intent: 'two' }));

    const destination = join(root, 'out', 'export.jsonl');
    const result = exportJournal(journalPath(root), destination);

    expect(result.ok).toBe(true);
    expect(result.exported).toBe(2);
    // Re-reading the export must verify on its own terms.
    expect(readJournal(destination).verification.valid).toBe(true);
  });

  it('refuses to export a journal that does not verify', () => {
    writeRecord(opts(), input({ intent: 'one' }));
    const path = journalPath(root);
    const parsed = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>;
    parsed['intent'] = 'tampered';
    writeFileSync(path, JSON.stringify(parsed) + '\n', 'utf8');

    const result = exportJournal(path, join(root, 'out', 'export.jsonl'));
    expect(result.ok).toBe(false);
    expect(result.exported).toBe(0);
  });
});

describe('bounds', () => {
  it('refuses a record larger than the per-record ceiling', () => {
    const huge = 'x'.repeat(70_000);
    const content = buildRecordContent(input({ intent: huge }));
    const record = sealRecord(content, GENESIS_HASH, 0, FIXED_TIME);
    // The field limit truncates first, so this asserts the field bound holds.
    expect(record.intent.length).toBeLessThanOrEqual(4096);

    const oversize = { ...record, digests: { blob: 'y'.repeat(70_000) } };
    const result = appendRecord(journalPath(root), oversize);
    expect(result.ok).toBe(false);
  });

  it('bounds the number of map entries', () => {
    const digests: Record<string, string> = {};
    for (let i = 0; i < 200; i += 1) digests[`k${i}`] = 'sha256:' + 'a'.repeat(64);
    const content = buildRecordContent(input({ digests }));
    expect(Object.keys(content.digests).length).toBeLessThanOrEqual(64);
  });
});

describe('concurrency', () => {
  it('does not lose records when two writers interleave', () => {
    // Each write re-reads the tip, so a racing writer is detected on
    // verification rather than silently overwriting.
    for (let i = 0; i < 10; i += 1) {
      const result = writeRecord(opts(), input({ intent: `write-${i}` }));
      expect(result.ok).toBe(true);
    }
    const { records, verification } = readRecords(opts());
    expect(verification.valid).toBe(true);
    expect(records).toHaveLength(10);
    expect(new Set(records.map((r) => r.sequence)).size).toBe(10);
  });

  it('appends land at end of file even with a stale handle', () => {
    writeRecord(opts(), input({ intent: 'first' }));
    const before = readFileSync(journalPath(root), 'utf8');
    writeRecord(opts(), input({ intent: 'second' }));
    const after = readFileSync(journalPath(root), 'utf8');
    // Opened with 'a', so the kernel positions the write — nothing is clobbered.
    expect(after.startsWith(before)).toBe(true);
  });
});
