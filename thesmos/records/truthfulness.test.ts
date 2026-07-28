// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * The two properties that make a Council Record worth trusting.
 *
 * **A record cannot claim execution it has no evidence for.** Nothing in this
 * repository executes an agent — there is no `mission:run` — so a record that
 * could assert "this ran" would be capable of lying about the one thing the
 * evidence layer exists to establish. `executed` is the only outcome variant
 * carrying a receipt reference, and it is the only variant that can carry one.
 *
 * **Redaction is enforced at the boundary, not requested of callers.** The
 * journal is append-only, so a leaked credential cannot be corrected after the
 * fact. A caller that passes a secret must be refused, not trusted to have
 * cleaned it first.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRecord, journalPath } from './journal.js';
import { buildRecordContent, sealRecord, type RecordInput } from './record.js';
import { findRedactionViolations, redactField } from './redact.js';
import { executedRecords, readRecords, writeRecord } from './store.js';
import {
  GENESIS_HASH,
  RECORD_CODES,
  RECORD_SCHEMA_VERSION,
  isExecutedOutcome,
  type RecordContent,
  type RecordOutcome,
} from './types.js';

let root = '';
const FIXED_TIME = '2026-01-01T00:00:00.000Z';

function opts(): { root: string; now: () => string } {
  return { root, now: () => FIXED_TIME };
}

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    event: 'mission.planned',
    identity: { correlationId: 'corr-1', causationId: '' },
    actor: { kind: 'system', component: 'test' },
    intent: 'do the thing',
    outcome: { kind: 'planned' },
    ...overrides,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-truth-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a record cannot falsely claim execution', () => {
  it('a planned record is never reported as executed', () => {
    writeRecord(opts(), input({ outcome: { kind: 'planned' } }));
    const { records } = readRecords(opts());
    expect(executedRecords(records)).toHaveLength(0);
    expect(isExecutedOutcome(records[0]!.outcome)).toBe(false);
  });

  it('strips an execution field smuggled onto a non-executed outcome', () => {
    // The union has no such field, so a caller can only get one in by casting.
    // The builder reconstructs each variant rather than spreading, so it dies
    // here rather than being persisted and later read back as proof.
    const smuggled = {
      kind: 'planned',
      receiptRef: 'run-forged',
      receiptTaskId: 'task-forged',
    } as unknown as RecordOutcome;

    writeRecord(opts(), input({ outcome: smuggled }));

    const raw = readFileSync(journalPath(root), 'utf8');
    expect(raw).not.toContain('run-forged');
    expect(raw).not.toContain('receiptRef');

    const { records } = readRecords(opts());
    expect(executedRecords(records)).toHaveLength(0);
  });

  it('records execution only with a receipt reference', () => {
    writeRecord(
      opts(),
      input({
        outcome: { kind: 'executed', receiptRef: 'run-1', receiptTaskId: 'task-1' },
      })
    );
    const { records } = readRecords(opts());
    const executed = executedRecords(records);
    expect(executed).toHaveLength(1);

    const outcome = executed[0]!.outcome;
    expect(isExecutedOutcome(outcome)).toBe(true);
    if (isExecutedOutcome(outcome)) {
      expect(outcome.receiptRef).toBe('run-1');
      expect(outcome.receiptTaskId).toBe('task-1');
    }
  });

  it('does not treat refused or failed work as execution', () => {
    writeRecord(opts(), input({ outcome: { kind: 'refused', reasonCode: 'DENIED' } }));
    writeRecord(opts(), input({ outcome: { kind: 'failed', reasonCode: 'ERROR' } }));
    writeRecord(opts(), input({ outcome: { kind: 'validated', valid: true } }));

    const { records } = readRecords(opts());
    expect(records).toHaveLength(3);
    expect(executedRecords(records)).toHaveLength(0);
  });

  it('coerces a non-boolean validity claim rather than storing it', () => {
    const outcome = { kind: 'validated', valid: 'yes' } as unknown as RecordOutcome;
    const content = buildRecordContent(input({ outcome }));
    // 'yes' is truthy; storing it verbatim would let a string masquerade as a
    // passing validation to any reader doing a loose check.
    expect(content.outcome).toEqual({ kind: 'validated', valid: false });
  });

  it('degrades an unknown event kind instead of accepting it', () => {
    const content = buildRecordContent(
      input({ event: 'mission.executed' as unknown as RecordInput['event'] })
    );
    expect(content.event).toBe('failure.recorded');
  });
});

describe('redaction is enforced at the boundary', () => {
  const SECRET = ['sk', 'live', 'A'.repeat(32)].join('-');

  it('redacts a secret passed in an intent', () => {
    writeRecord(opts(), input({ intent: `token is ${SECRET}` }));
    const raw = readFileSync(journalPath(root), 'utf8');
    expect(raw).not.toContain(SECRET);
  });

  it('redacts an absolute path passed in an intent', () => {
    writeRecord(opts(), input({ intent: `wrote ${root}/secret/file.txt` }));
    const raw = readFileSync(journalPath(root), 'utf8');
    expect(raw).not.toContain(root);
  });

  it('strips control characters', () => {
    const esc = String.fromCharCode(27);
    writeRecord(opts(), input({ intent: `${esc}[31mred${esc}[0m` }));
    const raw = readFileSync(journalPath(root), 'utf8');
    expect(raw).not.toContain(esc);
  });

  it('redacts values inside digest and link maps', () => {
    writeRecord(opts(), input({ digests: { blob: SECRET }, links: { path: `${root}/x` } }));
    const raw = readFileSync(journalPath(root), 'utf8');
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(root);
  });

  it('drops map keys that are not safe identifiers', () => {
    const content = buildRecordContent(input({ digests: { '../../etc/passwd': 'x' } }));
    // Normalized, not silently accepted as a traversal-shaped key.
    expect(Object.keys(content.digests).some((k) => k.includes('/'))).toBe(false);
  });

  it('bounds an oversized field', () => {
    const content = buildRecordContent(input({ intent: 'x'.repeat(100_000) }));
    expect(content.intent.length).toBeLessThanOrEqual(4096);
  });

  it('refuses to append a record that still contains a secret', () => {
    // Exercises the appender's own refusal, not just the detector. Redaction
    // normally happens in the builder, so a violating record can only reach
    // here by bypassing it — which is exactly the case worth proving, because
    // an append-only journal cannot be corrected afterwards.
    //
    // An earlier version of this test called findRedactionViolations directly
    // and asserted nothing about appendRecord. Mutation testing caught it:
    // disabling the appender's refusal passed the whole suite.
    const content: RecordContent = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      event: 'mission.planned',
      identity: { correlationId: 'c', causationId: '' },
      actor: { kind: 'system', component: 'test' },
      intent: `credential ${SECRET}`,
      outcome: { kind: 'planned' },
      digests: {},
      links: {},
    };
    const record = sealRecord(content, GENESIS_HASH, 0, FIXED_TIME);

    const result = appendRecord(journalPath(root), record);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(RECORD_CODES.secretPresent);
    // Nothing was written.
    expect(existsSync(journalPath(root))).toBe(false);
  });

  it('refuses to append a record containing an absolute path', () => {
    const content: RecordContent = {
      schemaVersion: RECORD_SCHEMA_VERSION,
      event: 'mission.planned',
      identity: { correlationId: 'c', causationId: '' },
      actor: { kind: 'system', component: 'test' },
      intent: `wrote /Users/someone/thing.txt`,
      outcome: { kind: 'planned' },
      digests: {},
      links: {},
    };
    const record = sealRecord(content, GENESIS_HASH, 0, FIXED_TIME);

    const result = appendRecord(journalPath(root), record);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(RECORD_CODES.absolutePath);
  });

  it('detects violations on read as well as on write', () => {
    // A journal written by an older build with weaker redaction must not be
    // silently accepted just because this build would have cleaned it.
    const findings = findRedactionViolations({ nested: { deep: `/Users/someone/thing` } });
    expect(findings.some((f) => f.kind === 'absolute-path')).toBe(true);
  });

  it('does not re-flag its own placeholder as a leak', () => {
    const cleaned = redactField('/Users/someone/secret.txt', '/Users/someone');
    expect(findRedactionViolations({ v: cleaned })).toEqual([]);
  });

  it('leaves an ordinary relative path alone', () => {
    const content = buildRecordContent(input({ intent: 'edited src/app.ts' }));
    expect(content.intent).toContain('src/app.ts');
  });
});

describe('attestation is honest about being unsigned', () => {
  it('does not claim a signature anywhere in a written record', () => {
    writeRecord(opts(), input());
    const raw = readFileSync(journalPath(root), 'utf8');
    // No key management or trust root exists in this repository, so nothing
    // may look like a signature.
    expect(raw).not.toContain('signature');
    expect(raw).not.toContain('signed');
  });
});
