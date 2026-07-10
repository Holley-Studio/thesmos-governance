// @vitest-environment node
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DORA_RULES } from './dora';
import { CONFIG_DEFAULTS } from '../config';
import type { ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

let emptyRoot: string;
beforeEach(() => { emptyRoot = mkdtempSync(join(tmpdir(), 'thesmos-dora-')); });
afterEach(() => { rmSync(emptyRoot, { recursive: true, force: true }); });

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const r = DORA_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files, root: emptyRoot });
}

describe('DORA_001 — financial-service applicability classifier', () => {
  it('does NOT fire on a single weak term ("ledger" in an audit/savings ledger)', () => {
    const findings = detect('DORA_001', [{
      path: 'src/savingsLedger.ts',
      content: 'export function appendToLedger(entry: LedgerEntry) { /* audit ledger */ }',
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on a single weak term ("transaction" in DB code)', () => {
    const findings = detect('DORA_001', [{
      path: 'src/db.ts',
      content: 'await prisma.$transaction(async (tx) => { await tx.user.update(data); });',
    }]);
    expect(findings).toHaveLength(0);
  });

  it('fires on a strong financial term with no policy doc', () => {
    const findings = detect('DORA_001', [{
      path: 'src/payments.ts',
      content: 'export async function processPayment(order: Order) { /* wire transfer */ }',
    }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on two distinct weak terms in the same file', () => {
    const findings = detect('DORA_001', [{
      path: 'src/finance.ts',
      content: 'updateAccountBalance(acct); writeLedger(entry);',
    }]);
    expect(findings).toHaveLength(1);
  });
});
