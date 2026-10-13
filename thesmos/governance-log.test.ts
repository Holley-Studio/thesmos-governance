import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  appendGovernanceEvent,
  logMcpBlock,
  logMcpPass,
  logMcpOverride,
  readGovernanceLog,
  readGovernanceLogSince,
  summariseGovernanceLog,
  type GovernanceEvent,
} from './governance-log.js';

const roots: string[] = [];
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'thesmos-governance-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const event = (overrides: Partial<GovernanceEvent> = {}): GovernanceEvent => ({
  ts: '2026-09-30T10:00:00Z',
  source: 'mcp',
  rule: 'SEC_003',
  action: 'write',
  path: 'src/index.ts',
  outcome: 'PASS',
  override: false,
  ...overrides,
});

describe('governance log integrity', () => {
  it('keeps override and session evidence and appends without replacing prior events', () => {
    const root = fixture();
    logMcpBlock(root, 'write', 'src/a.ts', 'SEC_003', 'blocked', 'session-a');
    logMcpPass(root, 'read', 'src/a.ts', 'session-a');
    logMcpOverride(root, 'write', 'src/a.ts', 'SEC_003', 'owner override', 'session-b');
    const rows = readGovernanceLog(root);
    expect(rows.map((r) => r.outcome)).toEqual(['BLOCKED', 'PASS', 'BYPASSED']);
    expect(rows[2]).toMatchObject({ override: true, session: 'session-b' });
    expect(
      readFileSync(join(root, '.thesmos', 'governance.log.jsonl'), 'utf8')
        .trim()
        .split('\n')
    ).toHaveLength(3);
  });
  it('ignores nulls, arrays and invalid event shapes without crashing the report', () => {
    const root = fixture();
    mkdirSync(join(root, '.thesmos'));
    writeFileSync(
      join(root, '.thesmos', 'governance.log.jsonl'),
      [null, [], { ...event(), ts: 'invalid' }, { ...event(), outcome: 'invented' }, event()]
        .map((r) => JSON.stringify(r))
        .join('\n') + '\n{broken\n',
      'utf8'
    );
    expect(readGovernanceLog(root)).toEqual([event()]);
    expect(readGovernanceLog(root, 0)).toEqual([]);
  });
  it('does not discard an older block inside the requested time window after 10,000 passes', () => {
    const root = fixture();
    mkdirSync(join(root, '.thesmos'));
    const blocked = event({ outcome: 'BLOCKED', ts: '2026-09-29T10:00:00Z' });
    const rows = [blocked, ...Array.from({ length: 10001 }, () => event())];
    writeFileSync(
      join(root, '.thesmos', 'governance.log.jsonl'),
      rows.map((r) => JSON.stringify(r)).join('\n'),
      'utf8'
    );
    const summary = summariseGovernanceLog(
      readGovernanceLogSince(root, new Date('2026-09-29T00:00:00Z'))
    );
    expect(summary.blocked).toBe(1);
    expect(summary.assuranceState).toBe('FAIL');
  });
  it('reports missing evidence honestly and computes a mixed outcome score', () => {
    expect(summariseGovernanceLog([])).toMatchObject({
      assuranceState: 'INCOMPLETE',
      complianceScore: null,
    });
    const summary = summariseGovernanceLog([
      event(),
      event({ outcome: 'WARN' }),
      event({ outcome: 'BLOCKED' }),
      event({ outcome: 'BYPASSED', override: true }),
    ]);
    expect(summary).toMatchObject({
      total: 4,
      passed: 1,
      warned: 1,
      blocked: 1,
      bypassed: 1,
      complianceScore: 50,
      assuranceState: 'FAIL',
    });
    expect(summary.ruleHits.SEC_003).toBe(4);
  });
  it('does not accept a structurally invalid writer payload', () => {
    expect(() =>
      appendGovernanceEvent(fixture(), { ...event(), outcome: 'invented' } as unknown as Omit<
        GovernanceEvent,
        'ts'
      >)
    ).toThrow(/governance|invalid/i);
  });
});
