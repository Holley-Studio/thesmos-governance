// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Journal integrity, anchoring and crash repair.
 *
 * Every test here is a regression for a defect an adversarial review found in
 * the first revision, when the suite was green and the journal was not sound:
 * timestamps were unauthenticated, suffix truncation was invisible, and a torn
 * tail was read around rather than repaired — so the first write after a crash
 * permanently destroyed the journal while reporting success.
 *
 * These exercise the public writer, not helpers. A detector that agrees with
 * itself proves nothing about what gets persisted.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { journalPath, scanJournal } from './journal.js';
import { headPathFor, readHead } from './head.js';
import { buildRecordContent, hashRecordContent, sealRecord, type RecordInput } from './record.js';
import { exportRecords, readRecords, verifyRecords, writeRecord } from './store.js';
import { GENESIS_HASH, RECORD_CODES } from './types.js';

let root = '';
const T0 = '2026-01-01T00:00:00.000Z';

function opts(over: Record<string, unknown> = {}): {
  root: string;
  now: () => string;
} {
  return { root, now: () => T0, ...over };
}

function input(over: Partial<RecordInput> = {}): RecordInput {
  return {
    event: 'mission.planned',
    identity: { correlationId: 'corr-1', causationId: '' },
    actor: { kind: 'system', component: 'test' },
    intent: 'plan the mission',
    outcome: { kind: 'planned' },
    ...over,
  };
}

function lines(): string[] {
  return readFileSync(journalPath(root), 'utf8').split('\n').filter(Boolean);
}

function rewrite(all: string[]): void {
  writeFileSync(journalPath(root), all.join('\n') + '\n', 'utf8');
}

function seed(n = 3): void {
  for (let i = 0; i < n; i += 1) writeRecord(opts(), input({ intent: `record-${i}` }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-records-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('append and read', () => {
  it('round-trips a record and anchors it', () => {
    expect(writeRecord(opts(), input()).ok).toBe(true);

    const { records, verification } = readRecords(opts());
    expect(verification.valid).toBe(true);
    expect(verification.headState).toBe('agreed');
    expect(verification.suffixAnchored).toBe(true);
    expect(records[0]?.prevRecordHash).toBe(GENESIS_HASH);
    expect(records[0]?.attestation).toEqual({ kind: 'none' });
  });

  it('chains on the envelope hash, not the semantic hash', () => {
    seed(3);
    const { records } = readRecords(opts());
    expect(records[1]?.prevRecordHash).toBe(records[0]?.recordHash);
    expect(records[2]?.prevRecordHash).toBe(records[1]?.recordHash);
  });

  it('reads an absent journal as empty and unanchored', () => {
    const v = verifyRecords(opts());
    expect(v.valid).toBe(true);
    expect(v.intactCount).toBe(0);
  });

  it('produces byte-identical journals for identical inputs', () => {
    const a = mkdtempSync(join(tmpdir(), 'ja-'));
    const b = mkdtempSync(join(tmpdir(), 'jb-'));
    try {
      for (const r of [a, b]) {
        writeRecord({ root: r, now: () => T0 }, input({ intent: 'one' }));
        writeRecord({ root: r, now: () => T0 }, input({ intent: 'two' }));
      }
      expect(readFileSync(journalPath(b), 'utf8')).toBe(readFileSync(journalPath(a), 'utf8'));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('F1 — the timestamp is authenticated', () => {
  it('detects backdating', () => {
    seed(3);
    const all = lines();
    const p = JSON.parse(all[1] as string) as Record<string, unknown>;
    p['recordedAt'] = '1999-12-31T00:00:00.000Z';
    all[1] = JSON.stringify(p);
    rewrite(all);

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.recordHashMismatch);
  });

  it('detects post-dating', () => {
    seed(2);
    const all = lines();
    const p = JSON.parse(all[0] as string) as Record<string, unknown>;
    p['recordedAt'] = '2099-01-01T00:00:00.000Z';
    all[0] = JSON.stringify(p);
    rewrite(all);

    expect(verifyRecords(opts()).valid).toBe(false);
  });

  it('refuses a malformed timestamp on read', () => {
    seed(1);
    const all = lines();
    const p = JSON.parse(all[0] as string) as Record<string, unknown>;
    p['recordedAt'] = 'yesterday';
    all[0] = JSON.stringify(p);
    rewrite(all);

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.timestampInvalid);
  });

  it.each(['2026-1-1T00:00:00.000Z', '2026-01-01T00:00:00Z', '2026-02-31T00:00:00.000Z', ''])(
    'refuses non-canonical timestamp %p at seal time',
    (bad) => {
      expect(() => sealRecord(buildRecordContent(input()), GENESIS_HASH, 0, bad)).toThrow();
    }
  );

  it('separates semantic identity from envelope integrity', () => {
    // The same event at two times must have the same meaning and a different
    // envelope. Collapsing these is what left timestamps forgeable.
    const content = buildRecordContent(input());
    const early = sealRecord(content, GENESIS_HASH, 0, '2026-01-01T00:00:00.000Z');
    const late = sealRecord(content, GENESIS_HASH, 0, '2026-06-01T00:00:00.000Z');

    expect(late.contentHash).toBe(early.contentHash);
    expect(late.recordHash).not.toBe(early.recordHash);
    expect(hashRecordContent(content)).toBe(early.contentHash);
  });

  it('binds sequence into the envelope too', () => {
    const content = buildRecordContent(input());
    const at0 = sealRecord(content, GENESIS_HASH, 0, T0);
    const at1 = sealRecord(content, GENESIS_HASH, 1, T0);
    expect(at1.recordHash).not.toBe(at0.recordHash);
  });
});

describe('F2 — suffix truncation is detected', () => {
  it('detects removal of the final record', () => {
    seed(3);
    rewrite(lines().slice(0, 2));

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.headState).toBe('head-ahead');
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.headAhead);
  });

  it('detects removal of the final two records', () => {
    seed(3);
    rewrite(lines().slice(0, 1));
    expect(verifyRecords(opts()).valid).toBe(false);
  });

  it('detects replacement of the final record at the same length', () => {
    seed(2);
    const all = lines();
    const p = JSON.parse(all[1] as string) as Record<string, unknown>;
    p['intent'] = 'swapped';
    all[1] = JSON.stringify(p);
    rewrite(all);
    // Caught by the record hash first; the anchor is a second, independent net.
    expect(verifyRecords(opts()).valid).toBe(false);
  });

  it('reports a missing anchor as degraded, never as verified', () => {
    seed(2);
    rmSync(headPathFor(journalPath(root)));

    const v = verifyRecords(opts());
    expect(v.headState).toBe('missing');
    expect(v.suffixAnchored).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.headMissing);
  });

  it('fails closed on a corrupt anchor', () => {
    seed(2);
    writeFileSync(headPathFor(journalPath(root)), '{ not json', 'utf8');

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.headState).toBe('corrupt');
  });

  it('recovers when the journal is validly ahead of its anchor', () => {
    // The crash signature between append and anchor commit.
    seed(2);
    const headPath = headPathFor(journalPath(root));
    const head = readHead(headPath).head!;
    writeFileSync(
      headPath,
      JSON.stringify({ ...head, sequence: 0, tipRecordHash: readRecords(opts()).records[0]!.recordHash }),
      'utf8'
    );

    const before = verifyRecords(opts());
    expect(before.headState).toBe('journal-ahead-recoverable');
    expect(before.valid).toBe(true);

    const result = writeRecord(opts(), input({ intent: 'after-recovery' }));
    expect(result.ok).toBe(true);
    expect(result.recoveredHead).toBe(true);
    expect(verifyRecords(opts()).headState).toBe('agreed');
  });

  it('refuses when the journal does not extend the anchored tip', () => {
    seed(2);
    const headPath = headPathFor(journalPath(root));
    const head = readHead(headPath).head!;
    writeFileSync(
      headPath,
      JSON.stringify({ ...head, sequence: 0, tipRecordHash: 'sha256:' + 'c'.repeat(64) }),
      'utf8'
    );

    expect(verifyRecords(opts()).valid).toBe(false);
    expect(writeRecord(opts(), input()).ok).toBe(false);
  });
});

describe('F3 — a torn tail is physically repaired', () => {
  function tear(): void {
    const path = journalPath(root);
    writeFileSync(path, readFileSync(path, 'utf8') + 'ZZTORNFRAGMENTZZ', 'utf8');
  }

  it('repairs before extending, and the journal stays valid', () => {
    seed(2);
    tear();
    const bytesBefore = statSync(journalPath(root)).size;

    const result = writeRecord(opts(), input({ intent: 'after-crash' }));
    expect(result.ok).toBe(true);
    expect(result.repairedBytes).toBeGreaterThan(0);

    const v = verifyRecords(opts());
    expect(v.valid).toBe(true);
    expect(v.tornTail).toBe(false);
    expect(readRecords(opts()).records).toHaveLength(3);
    // The partial bytes are gone from disk, not merely skipped on read.
    expect(readFileSync(journalPath(root), 'utf8')).not.toContain('ZZTORNFRAGMENTZZ');
    expect(statSync(journalPath(root)).size).toBeLessThan(bytesBefore + 4096);
  });

  it('keeps the new record readable and lets later writes succeed', () => {
    seed(1);
    tear();
    writeRecord(opts(), input({ intent: 'first-after' }));
    writeRecord(opts(), input({ intent: 'second-after' }));
    writeRecord(opts(), input({ intent: 'third-after' }));

    const { records, verification } = readRecords(opts());
    expect(verification.valid).toBe(true);
    expect(records.map((r) => r.intent)).toContain('third-after');
    expect(records).toHaveLength(4);
  });

  it('reports the torn tail on read without repairing it', () => {
    // Reading is non-destructive; only a transaction repairs.
    seed(2);
    tear();
    const sizeBefore = statSync(journalPath(root)).size;
    const v = verifyRecords(opts());

    expect(v.tornTail).toBe(true);
    expect(statSync(journalPath(root)).size).toBe(sizeBefore);
  });

  it('refuses to extend a journal with interior damage', () => {
    seed(2);
    const all = lines();
    rewrite([all[0] as string, '{ broken', all[1] as string]);

    const result = writeRecord(opts(), input());
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(RECORD_CODES.malformed);
  });
});

describe('interior tamper detection', () => {
  it('detects an edited record body', () => {
    seed(3);
    const all = lines();
    const p = JSON.parse(all[1] as string) as Record<string, unknown>;
    p['intent'] = 'quietly changed';
    all[1] = JSON.stringify(p);
    rewrite(all);

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.contentHashMismatch);
  });

  it('detects a removed interior record', () => {
    seed(3);
    const all = lines();
    all.splice(1, 1);
    rewrite(all);
    expect(verifyRecords(opts()).valid).toBe(false);
  });

  it('detects reordering', () => {
    seed(3);
    const all = lines();
    [all[0], all[1]] = [all[1] as string, all[0] as string];
    rewrite(all);
    expect(verifyRecords(opts()).valid).toBe(false);
  });

  it('stops reading at the damage rather than past it', () => {
    seed(3);
    const all = lines();
    const p = JSON.parse(all[1] as string) as Record<string, unknown>;
    p['intent'] = 'changed';
    all[1] = JSON.stringify(p);
    rewrite(all);
    expect(readRecords(opts()).records).toHaveLength(1);
  });

  it('refuses a journal written by a newer schema', () => {
    seed(2);
    const all = lines();
    const p = JSON.parse(all[0] as string) as Record<string, unknown>;
    p['schemaVersion'] = '9.9.9';
    all[0] = JSON.stringify(p);
    rewrite(all);

    const v = verifyRecords(opts());
    expect(v.valid).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain(RECORD_CODES.schemaUnsupported);
  });
});

describe('export', () => {
  it('exports a verified journal and the export verifies independently', () => {
    seed(2);
    const destination = join(root, 'out', 'export.jsonl');
    const result = exportRecords(opts(), destination);

    expect(result.ok).toBe(true);
    expect(result.exported).toBe(2);
    expect(scanJournal(destination).issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('refuses to export a journal that does not verify', () => {
    seed(2);
    rewrite(lines().slice(0, 1));

    const result = exportRecords(opts(), join(root, 'out', 'export.jsonl'));
    expect(result.ok).toBe(false);
    expect(result.exported).toBe(0);
    expect(existsSync(join(root, 'out', 'export.jsonl'))).toBe(false);
  });
});
