import { afterEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  logAgentSpawn,
  logAgentComplete,
  logAgentError,
  readAgentActivityLog,
  readAgentActivityResult,
  readAgentActivitySince,
} from './agent-activity.js';
import {
  appendMetricsExport,
  countMetricsExport,
  readMetricsExport,
  readMetricsExportResult,
} from './metrics-export.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thesmos local evidence '));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('agent and metric evidence integrity', () => {
  it('preserves spawn, completion, and error events around damaged siblings', () => {
    const root = fixture();
    const spawn = logAgentSpawn(root, {
      agentId: 'agent',
      sessionId: 'session',
      description: 'fixture',
      subagentType: 'Hermes',
    });
    const complete = logAgentComplete(root, {
      agentId: 'agent',
      sessionId: 'session',
      durationMs: 20,
    });
    const error = logAgentError(root, { agentId: 'other', sessionId: 'session' });
    appendFileSync(join(root, '.thesmos', 'agent-activity.jsonl'), '\nnull\n{}\n{broken\n', 'utf8');
    expect(readAgentActivityLog(root)).toEqual([spawn, complete, error]);
    expect(readAgentActivityResult(root).invalidLines).toHaveLength(3);
    expect(readAgentActivityLog(root, 0)).toEqual([]);
    expect(readAgentActivitySince(root, new Date('2020-01-01T00:00:00Z'))).toEqual([
      spawn,
      complete,
      error,
    ]);
  });
  it('counts valid metric history without trusting malformed cost or token values', () => {
    const root = fixture();
    const valid = {
      ts: '2026-09-30T00:00:00Z',
      kind: 'task' as const,
      runId: 'run',
      source: 'fixture',
      costUSD: 0,
      tokens: 12,
    };
    appendMetricsExport(root, valid);
    appendFileSync(
      join(root, '.thesmos', 'metrics-export.jsonl'),
      JSON.stringify({ ...valid, costUSD: -1 }) + '\nnull\n',
      'utf8'
    );
    expect(readMetricsExport(root)).toEqual([valid]);
    expect(readMetricsExportResult(root).invalidLines).toEqual([2, 3]);
    expect(countMetricsExport(root)).toBe(1);
    expect(readMetricsExport(root, 0)).toEqual([]);
    writeFileSync(join(root, '.thesmos', 'metrics-export.jsonl'), '{broken\n', 'utf8');
    expect(countMetricsExport(root)).toBe(0);
    expect(readMetricsExportResult(root).invalidLines).toEqual([1]);
  });
});
