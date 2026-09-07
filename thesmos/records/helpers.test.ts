// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Direct coverage for the exported helpers.
 *
 * Governance review reported `debt_exported_function_no_test` against nine of
 * them. That finding is accurate rather than heuristic: they were exercised
 * only through the journal, so nothing pinned their own contracts — issue
 * ordering, map normalization, projection stripping, or the exact shape a
 * caller receives. Direct tests, rather than an argument that indirect coverage
 * was enough.
 */

import { describe, expect, it } from 'vitest';
import { contentOf, hashRecordContent, sealRecord } from './record.js';
import { redactMap } from './redact.js';
import { recordsForCorrelation, recordsForMission } from './store.js';
import {
  GENESIS_HASH,
  RECORD_SCHEMA_VERSION,
  hasRecordErrors,
  isRecordEventKind,
  recordIssue,
  sortRecordIssues,
  type CouncilRecord,
  type RecordContent,
} from './types.js';

function content(overrides: Partial<RecordContent> = {}): RecordContent {
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    event: 'mission.planned',
    identity: { correlationId: 'c1', causationId: '' },
    actor: { kind: 'system', component: 'test' },
    intent: 'intent',
    outcome: { kind: 'planned' },
    digests: {},
    links: {},
    ...overrides,
  };
}

function record(overrides: Partial<CouncilRecord> = {}): CouncilRecord {
  return {
    ...sealRecord(content(), GENESIS_HASH, 0, '2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('isRecordEventKind', () => {
  it('accepts a known kind and rejects everything else', () => {
    expect(isRecordEventKind('pack.installed')).toBe(true);
    expect(isRecordEventKind('mission.executed')).toBe(false);
    expect(isRecordEventKind('')).toBe(false);
    expect(isRecordEventKind(null)).toBe(false);
    expect(isRecordEventKind(42)).toBe(false);
  });
});

describe('hashRecordContent', () => {
  it('is a sha256 digest and is stable for equal content', () => {
    expect(hashRecordContent(content())).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashRecordContent(content())).toBe(hashRecordContent(content()));
  });

  it('changes when any content field changes', () => {
    const base = hashRecordContent(content());
    expect(hashRecordContent(content({ intent: 'different' }))).not.toBe(base);
    expect(hashRecordContent(content({ event: 'pack.installed' }))).not.toBe(base);
    expect(hashRecordContent(content({ outcome: { kind: 'failed', reasonCode: 'X' } }))).not.toBe(base);
  });

  it('does not depend on key insertion order', () => {
    const a = hashRecordContent(content({ digests: { x: '1', y: '2' } }));
    const b = hashRecordContent(content({ digests: { y: '2', x: '1' } }));
    expect(b).toBe(a);
  });
});

describe('contentOf', () => {
  it('strips chain and journal metadata, leaving exactly the hashed projection', () => {
    const projection = contentOf(record());
    expect(projection).not.toHaveProperty('contentHash');
    expect(projection).not.toHaveProperty('prevHash');
    expect(projection).not.toHaveProperty('sequence');
    expect(projection).not.toHaveProperty('recordedAt');
    expect(projection).toHaveProperty('event');
  });

  it('round-trips: re-hashing the stripped projection reproduces the stored hash', () => {
    const sealed = record();
    expect(hashRecordContent(contentOf(sealed))).toBe(sealed.contentHash);
  });
});

describe('redactMap', () => {
  it('normalizes keys and reports what it dropped', () => {
    const { map, dropped } = redactMap({ 'good.key-1': 'v', '///': 'v' });
    expect(Object.keys(map)).toEqual(['good.key-1']);
    expect(dropped).toContain('///');
  });

  it('bounds the number of entries and names the overflow', () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 100; i += 1) input[`k${i}`] = 'v';
    const { map, dropped } = redactMap(input);
    expect(Object.keys(map)).toHaveLength(64);
    expect(dropped.length).toBe(36);
  });

  it('returns an empty result for non-object input', () => {
    for (const bad of [null, undefined, 'string', 42, ['a']]) {
      expect(redactMap(bad)).toEqual({ map: {}, dropped: [] });
    }
  });
});

describe('record queries', () => {
  const records: CouncilRecord[] = [
    record({ identity: { correlationId: 'a', causationId: '', missionId: 'm1' } }),
    record({ identity: { correlationId: 'b', causationId: '', missionId: 'm1' } }),
    record({ identity: { correlationId: 'a', causationId: '', missionId: 'm2' } }),
  ];

  it('filters by correlation id', () => {
    expect(recordsForCorrelation(records, 'a')).toHaveLength(2);
    expect(recordsForCorrelation(records, 'zzz')).toEqual([]);
  });

  it('filters by mission id', () => {
    expect(recordsForMission(records, 'm1')).toHaveLength(2);
    expect(recordsForMission(records, 'zzz')).toEqual([]);
  });
});

describe('issue helpers', () => {
  it('omits remediation when none is supplied', () => {
    expect(recordIssue('C', 'error', 0, 'm')).not.toHaveProperty('remediation');
    expect(recordIssue('C', 'error', 0, 'm', 'fix').remediation).toBe('fix');
  });

  it('orders by sequence, then code, then message', () => {
    const sorted = sortRecordIssues([
      recordIssue('B', 'error', 2, 'm'),
      recordIssue('A', 'error', 1, 'zzz'),
      recordIssue('A', 'error', 1, 'aaa'),
    ]);
    expect(sorted.map((i) => `${i.sequence}/${i.code}/${i.message}`)).toEqual([
      '1/A/aaa',
      '1/A/zzz',
      '2/B/m',
    ]);
  });

  it('does not mutate the list it sorts', () => {
    const original = [recordIssue('B', 'error', 2, 'm'), recordIssue('A', 'error', 1, 'm')];
    const snapshot = original.map((i) => i.code);
    sortRecordIssues(original);
    expect(original.map((i) => i.code)).toEqual(snapshot);
  });

  it('detects errors while ignoring warnings', () => {
    expect(hasRecordErrors([recordIssue('C', 'warning', 0, 'm')])).toBe(false);
    expect(hasRecordErrors([recordIssue('C', 'error', 0, 'm')])).toBe(true);
    expect(hasRecordErrors([])).toBe(false);
  });
});
