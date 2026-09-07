// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Direct coverage for the anchor, lock and I/O helpers.
 *
 * Governance review reported `debt_exported_function_no_test` against fourteen
 * exports added by the correction. That finding is accurate rather than
 * heuristic: they were exercised only through the transaction, so nothing
 * pinned their individual contracts — the exact head state returned for each
 * disagreement, the timestamp grammar, or the byte accounting on a partial
 * write.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  clearPartialHead,
  commitHead,
  compareHead,
  headFor,
  headPathFor,
  newJournalId,
  readHead,
} from './head.js';
import { fsyncDirectory, writeAllSync } from './io.js';
import { repairTornTail, verificationFrom, type ScanResult } from './journal.js';
import { buildRecordContent, envelopeOf, hashRecordEnvelope, sealRecord } from './record.js';
import {
  GENESIS_HASH,
  RECORD_CODES,
  RECORD_SCHEMA_VERSION,
  isCanonicalTimestamp,
  isRecordAttestation,
  type CouncilRecord,
} from './types.js';

let dir = '';
const T0 = '2026-01-01T00:00:00.000Z';

function record(sequence: number, prev = GENESIS_HASH): CouncilRecord {
  const content = buildRecordContent({
    event: 'mission.planned',
    identity: { correlationId: 'c', causationId: '' },
    actor: { kind: 'system', component: 'test' },
    intent: `record-${sequence}`,
    outcome: { kind: 'planned' },
  });
  return sealRecord(content, prev, sequence, T0);
}

function chain(n: number): CouncilRecord[] {
  const out: CouncilRecord[] = [];
  let prev = GENESIS_HASH;
  for (let i = 0; i < n; i += 1) {
    const r = record(i, prev);
    out.push(r);
    prev = r.recordHash;
  }
  return out;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'thesmos-units-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('timestamp grammar', () => {
  it.each([
    '2026-01-01T00:00:00.000Z',
    '1999-12-31T23:59:59.999Z',
  ])('accepts canonical %p', (value) => {
    expect(isCanonicalTimestamp(value)).toBe(true);
  });

  it.each([
    '2026-01-01T00:00:00Z', // no milliseconds
    '2026-01-01T00:00:00.000+01:00', // not UTC
    '2026-1-1T00:00:00.000Z', // unpadded
    '2026-02-31T00:00:00.000Z', // shape valid, date is not
    '2026-13-01T00:00:00.000Z', // month 13
    'yesterday',
    '',
    null,
    12345,
  ])('rejects %p', (value) => {
    expect(isCanonicalTimestamp(value)).toBe(false);
  });
});

describe('attestation grammar', () => {
  it('accepts exactly the none state', () => {
    expect(isRecordAttestation({ kind: 'none' })).toBe(true);
  });

  it.each([
    { kind: 'signed' },
    { kind: 'none', signature: 'x' }, // extra keys are not none
    { kind: 'unverified' },
    {},
    null,
    'none',
  ])('rejects %p', (value) => {
    expect(isRecordAttestation(value)).toBe(false);
  });
});

describe('envelope helpers', () => {
  it('round-trips: lifting an envelope and re-hashing reproduces recordHash', () => {
    const r = record(0);
    expect(hashRecordEnvelope(envelopeOf(r))).toBe(r.recordHash);
  });

  it.each(['contentHash', 'prevRecordHash', 'sequence', 'recordedAt'])(
    'changing %s changes the envelope hash',
    (field) => {
      const base = envelopeOf(record(0));
      const mutated = {
        ...base,
        [field]: field === 'sequence' ? 99 : `${String(base[field as keyof typeof base])}x`,
      };
      expect(hashRecordEnvelope(mutated as typeof base)).not.toBe(hashRecordEnvelope(base));
    }
  );
});

describe('head anchor', () => {
  const headPath = (): string => join(dir, 'council.head.json');

  it('derives a path from the journal file', () => {
    expect(headPathFor('/x/y/council.jsonl')).toBe('/x/y/council.head.json');
  });

  it('mints distinct journal ids', () => {
    expect(newJournalId()).not.toBe(newJournalId());
  });

  it('commits and reads back a head', () => {
    const head = headFor('jid', chain(2));
    expect(commitHead(headPath(), head).ok).toBe(true);
    expect(readHead(headPath()).head).toEqual(head);
  });

  it('reports a corrupt head rather than parsing it loosely', () => {
    writeFileSync(headPath(), '{ not json', 'utf8');
    expect(readHead(headPath()).corrupt).toBe(true);

    writeFileSync(headPath(), JSON.stringify({ schemaVersion: '1.0.0' }), 'utf8');
    expect(readHead(headPath()).corrupt).toBe(true);
  });

  it('leaves no temporary file after a commit', () => {
    commitHead(headPath(), headFor('jid', chain(1)));
    expect(existsSync(`${headPath()}.partial`)).toBe(false);
  });

  it('clears a temporary file left by an interrupted commit', () => {
    writeFileSync(`${headPath()}.partial`, 'junk', 'utf8');
    clearPartialHead(headPath());
    expect(existsSync(`${headPath()}.partial`)).toBe(false);
  });

  it('describes an empty anchored journal as agreed', () => {
    expect(compareHead(null, false, []).state).toBe('agreed');
  });

  it.each([
    ['agreed', 2, 2],
    ['head-ahead', 2, 5],
    ['journal-ahead-recoverable', 5, 2],
  ])('returns %s when the journal has %i records and the anchor commits %i', (state, have, committed) => {
    const records = chain(have as number);
    const anchorIndex = (committed as number) - 1;
    const head = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      journalId: 'jid',
      sequence: anchorIndex,
      tipRecordHash:
        anchorIndex >= 0 && anchorIndex < records.length
          ? (records[anchorIndex] as CouncilRecord).recordHash
          : 'sha256:' + 'a'.repeat(64),
    };
    expect(compareHead(head, false, records).state).toBe(state);
  });

  it('returns tip-mismatch when the journal does not extend the anchored tip', () => {
    const records = chain(4);
    const head = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      journalId: 'jid',
      sequence: 1,
      tipRecordHash: 'sha256:' + 'b'.repeat(64),
    };
    expect(compareHead(head, false, records).state).toBe('tip-mismatch');
  });

  it('is unanchored when the head is corrupt or absent', () => {
    expect(compareHead(null, true, chain(1)).anchored).toBe(false);
    expect(compareHead(null, false, chain(1)).anchored).toBe(false);
  });
});

describe('write primitives', () => {
  it('reports the full byte count for a complete write', () => {
    const file = join(dir, 'out.bin');
    const fd = openSync(file, 'w');
    const buffer = Buffer.from('hello world', 'utf8');
    try {
      const result = writeAllSync(fd, buffer);
      expect(result.ok).toBe(true);
      expect(result.written).toBe(buffer.length);
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(file, 'utf8')).toBe('hello world');
  });

  it('reports failure with the byte count reached on a bad descriptor', () => {
    const result = writeAllSync(-1, Buffer.from('x', 'utf8'));
    expect(result.ok).toBe(false);
    expect(result.written).toBe(0);
    expect(result.issues.map((i) => i.code)).toContain(RECORD_CODES.writeIncomplete);
  });

  it('accepts an empty buffer without touching the descriptor', () => {
    expect(writeAllSync(-1, Buffer.alloc(0)).ok).toBe(true);
  });

  it('fsyncs a real directory and reports failure for a missing one', () => {
    expect(fsyncDirectory(dir)).toBe(true);
    expect(fsyncDirectory(join(dir, 'does-not-exist'))).toBe(false);
  });
});

describe('torn tail repair', () => {
  it('truncates to the intact boundary and reports the byte count', () => {
    const file = join(dir, 'j.jsonl');
    writeFileSync(file, 'complete\npartial-without-newline', 'utf8');

    const result = repairTornTail(file, 'complete\n'.length);
    expect(result.repaired).toBe('partial-without-newline'.length);
    expect(readFileSync(file, 'utf8')).toBe('complete\n');
  });

  it('is a no-op when there is nothing to repair', () => {
    const file = join(dir, 'j.jsonl');
    writeFileSync(file, 'complete\n', 'utf8');
    expect(repairTornTail(file, 'complete\n'.length).repaired).toBe(0);
  });
});

describe('verification assembly', () => {
  const scan = (over: Partial<ScanResult> = {}): ScanResult => ({
    records: [],
    issues: [],
    tornTail: false,
    intactBytes: 0,
    recordCount: 0,
    ...over,
  });

  it('is valid only when no error-severity issue is present', () => {
    expect(verificationFrom(scan(), [], 'agreed', true).valid).toBe(true);

    const withError = verificationFrom(
      scan(),
      [{ code: 'X', severity: 'error', sequence: -1, message: 'm' }],
      'head-ahead',
      true
    );
    expect(withError.valid).toBe(false);
  });

  it('stays valid for warnings alone', () => {
    const warned = verificationFrom(
      scan({ tornTail: true }),
      [{ code: 'W', severity: 'warning', sequence: -1, message: 'm' }],
      'missing',
      false
    );
    expect(warned.valid).toBe(true);
    expect(warned.tornTail).toBe(true);
    expect(warned.suffixAnchored).toBe(false);
  });
});

describe('directory creation', () => {
  it('creates a records directory that fsyncDirectory can open', () => {
    const nested = join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(fsyncDirectory(nested)).toBe(true);
  });
});
