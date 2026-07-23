// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  logReviewFindings,
  outcomeFromSeverity,
  readGovernanceLog,
  summariseGovernanceLog,
} from './governance-log.js';

describe('outcomeFromSeverity', () => {
  it('maps BLOCKER → BLOCKED, HIGH → WARN, else PASS', () => {
    expect(outcomeFromSeverity('BLOCKER')).toBe('BLOCKED');
    expect(outcomeFromSeverity('HIGH')).toBe('WARN');
    expect(outcomeFromSeverity('MEDIUM')).toBe('PASS');
    expect(outcomeFromSeverity('TECH_DEBT')).toBe('PASS');
  });
});

describe('logReviewFindings', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'thesmos-govlog-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes review.clean PASS when findings are empty (leaves INCOMPLETE behind)', () => {
    const events = logReviewFindings(dir, [], { source: 'scan', path: 'src/ok.ts' });
    expect(events).toHaveLength(1);
    expect(events[0]!.rule).toBe('review.clean');
    expect(events[0]!.outcome).toBe('PASS');

    const summary = summariseGovernanceLog(readGovernanceLog(dir));
    expect(summary.complianceScore).toBe(100);
    expect(summary.assuranceState).toBe('PASS');
    expect(existsSync(join(dir, '.thesmos', 'governance.log.jsonl'))).toBe(true);
  });

  it('logs BLOCKED/WARN/PASS from findings and FAIL assurance when blockers exist', () => {
    logReviewFindings(
      dir,
      [
        {
          severity: 'BLOCKER',
          category: 'SEC_004',
          file: 'a.ts',
          message: 'eval()',
        },
        {
          severity: 'HIGH',
          category: 'AUTH_001',
          file: 'b.ts',
          message: 'missing auth',
        },
        {
          severity: 'MEDIUM',
          category: 'QUAL_001',
          file: 'c.ts',
          message: 'console.log',
        },
      ],
      { source: 'mcp', action: 'scan_file' },
    );

    const summary = summariseGovernanceLog(readGovernanceLog(dir));
    expect(summary.total).toBe(3);
    expect(summary.blocked).toBe(1);
    expect(summary.warned).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.assuranceState).toBe('FAIL');
    // compliant = passed + warned = 2 of 3
    expect(summary.complianceScore).toBe(66.7);

    const raw = readFileSync(join(dir, '.thesmos', 'governance.log.jsonl'), 'utf8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(3);
  });

  it('empty log still summarises as INCOMPLETE with null score', () => {
    const summary = summariseGovernanceLog([]);
    expect(summary.complianceScore).toBeNull();
    expect(summary.assuranceState).toBe('INCOMPLETE');
  });
});
