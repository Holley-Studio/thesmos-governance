import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cmdEval } from './eval.js';
import { appendGovernanceEvent } from '../../governance-log.js';
import { createReceipt, writeExecutionReceipt } from '../../execution-receipt.js';
import { appendMetricsExport } from '../../metrics-export.js';

let root: string;
let output: string;
let previousExit: typeof process.exitCode;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-eval-'));
  output = '';
  previousExit = process.exitCode;
  process.exitCode = undefined;
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    output += String(chunk);
    return true;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = previousExit;
  rmSync(root, { recursive: true, force: true });
});
const pass = () =>
  appendGovernanceEvent(root, {
    source: 'mcp',
    rule: 'SEC_003',
    action: 'check',
    path: 'src/a.ts',
    outcome: 'PASS',
    override: false,
  });

describe('eval time windows and integrity', () => {
  it('applies the same selected period to receipts, activity and metrics', async () => {
    pass();
    writeExecutionReceipt(
      root,
      createReceipt({
        runId: 'old',
        taskId: 't',
        source: 'agent-run',
        terminalStatus: 'complete',
        ts: '2020-01-01T00:00:00Z',
      })
    );
    appendMetricsExport(root, {
      ts: '2020-01-01T00:00:00Z',
      kind: 'session',
      runId: 'old',
      source: 'test',
    });
    writeFileSync(
      join(root, '.thesmos', 'agent-activity.jsonl'),
      JSON.stringify({
        ts: '2020-01-01T00:00:00Z',
        type: 'spawn',
        sessionId: 's',
        agentId: 'a',
        description: 'old',
        subagentType: 'test',
      }) + '\n',
      'utf8'
    );
    await cmdEval(['--since=24h', '--json']);
    expect(JSON.parse(output).runtime).toMatchObject({
      receipts: 0,
      activityEvents: 0,
      metricsEvents: 0,
    });
  });
  it('reports malformed evidence as ERROR instead of a clean PASS', async () => {
    pass();
    writeFileSync(join(root, '.thesmos', 'governance.log.jsonl'), 'null\n{broken\n', 'utf8');
    await cmdEval(['--all', '--json']);
    expect(JSON.parse(output)).toMatchObject({ assuranceState: 'ERROR', complianceScore: null });
    expect(process.exitCode).toBe(1);
  });
  it('reports an empty log as INCOMPLETE rather than claiming perfect compliance', async () => {
    await cmdEval(['--json']);
    expect(JSON.parse(output)).toMatchObject({
      assuranceState: 'INCOMPLETE',
      complianceScore: null,
    });
    expect(process.exitCode).toBe(1);
  });
});
