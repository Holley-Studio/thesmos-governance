// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  calcCost,
  appendTokenEvent,
  readTokenEvents,
  getCurrentSessionId,
  buildBudgetReport,
  TOKEN_BUDGET_DEFAULTS,
  type TokenEvent,
  type TokenBudgetConfig,
} from './token-budget.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `thesmos-budget-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const FIXED_TABLE = {
  'claude-sonnet-4-6': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-8': { inputPer1M: 15.00, outputPer1M: 75.00 },
};

describe('calcCost', () => {
  it('calculates cost for known model', () => {
    // 1M input @ $3/M + 1M output @ $15/M = $18
    const cost = calcCost('claude-sonnet-4-6', 1_000_000, 1_000_000, FIXED_TABLE);
    expect(cost).toBeCloseTo(18.00, 4);
  });

  it('calculates cost for small token counts', () => {
    // 1000 input + 500 output on sonnet: (1000*3 + 500*15)/1M = (3000+7500)/1M = 0.0105
    const cost = calcCost('claude-sonnet-4-6', 1_000, 500, FIXED_TABLE);
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('falls back to sonnet pricing for unknown model', () => {
    const costUnknown = calcCost('unknown-model', 1_000, 1_000, FIXED_TABLE);
    const costSonnet = calcCost('claude-sonnet-4-6', 1_000, 1_000, FIXED_TABLE);
    expect(costUnknown).toBe(costSonnet);
  });

  it('uses opus pricing for opus model', () => {
    const costOpus = calcCost('claude-opus-4-8', 1_000_000, 0, FIXED_TABLE);
    expect(costOpus).toBeCloseTo(15.00, 4);
  });

  it('returns 0 for zero tokens', () => {
    expect(calcCost('claude-sonnet-4-6', 0, 0, FIXED_TABLE)).toBe(0);
  });
});

describe('appendTokenEvent / readTokenEvents', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('returns empty array when no log file exists', () => {
    expect(readTokenEvents(root)).toEqual([]);
  });

  it('writes and reads back a single event', () => {
    const event: TokenEvent = {
      ts: new Date().toISOString(),
      sessionId: 'sess-001',
      toolName: 'Bash',
      model: 'claude-sonnet-4-6',
      inputTokens: 5_000,
      outputTokens: 1_000,
      costUSD: 0.03,
    };
    appendTokenEvent(root, event);
    const events = readTokenEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sessionId: 'sess-001', toolName: 'Bash' });
  });

  it('appends multiple events in order', () => {
    for (let i = 0; i < 3; i++) {
      appendTokenEvent(root, {
        ts: new Date().toISOString(),
        sessionId: `sess-${i}`,
        toolName: 'Read',
        model: 'claude-sonnet-4-6',
        inputTokens: i * 100,
        outputTokens: i * 50,
        costUSD: i * 0.001,
      });
    }
    const events = readTokenEvents(root);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.sessionId)).toEqual(['sess-0', 'sess-1', 'sess-2']);
  });

  it('creates .thesmos/ directory if missing', () => {
    const nested = join(root, 'fresh-project');
    mkdirSync(nested);
    appendTokenEvent(nested, {
      ts: new Date().toISOString(), sessionId: 'x', toolName: 'Write',
      model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 0, costUSD: 0,
    });
    expect(readTokenEvents(nested)).toHaveLength(1);
  });
});

describe('getCurrentSessionId', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  it('creates and returns a session ID on first call', () => {
    const id = getCurrentSessionId(root);
    expect(typeof id).toBe('string');
    expect(id.startsWith('session-')).toBe(true);
  });

  it('returns the same ID on subsequent calls (stable within a session)', () => {
    const id1 = getCurrentSessionId(root);
    const id2 = getCurrentSessionId(root);
    expect(id1).toBe(id2);
  });
});

describe('buildBudgetReport', () => {
  let root: string;
  beforeEach(() => { root = makeTmpDir(); });
  afterEach(() => { try { rmSync(root, { recursive: true }); } catch { /* */ } });

  const config: TokenBudgetConfig = {
    ...TOKEN_BUDGET_DEFAULTS,
    enabled: true,
    sessionMaxCostUSD: 5.00,
    dailyMaxCostUSD: 25.00,
    projectMaxCostUSD: 100.00,
    alertAt: 0.80,
    hardStopAt: 1.00,
  };

  it('returns zero totals when no events exist', () => {
    const report = buildBudgetReport(root, config, 'sess-empty');
    expect(report.session.costUSD).toBe(0);
    expect(report.session.totalTokens).toBe(0);
    expect(report.hardStop).toBe(false);
    expect(report.alerts).toHaveLength(0);
  });

  it('sums tokens and cost within the session', () => {
    const sessionId = 'test-sess';
    appendTokenEvent(root, {
      ts: new Date().toISOString(), sessionId, toolName: 'Write',
      model: 'claude-sonnet-4-6', inputTokens: 10_000, outputTokens: 2_000,
      costUSD: calcCost('claude-sonnet-4-6', 10_000, 2_000, TOKEN_BUDGET_DEFAULTS.modelCostTable),
    });
    appendTokenEvent(root, {
      ts: new Date().toISOString(), sessionId, toolName: 'Read',
      model: 'claude-sonnet-4-6', inputTokens: 5_000, outputTokens: 1_000,
      costUSD: calcCost('claude-sonnet-4-6', 5_000, 1_000, TOKEN_BUDGET_DEFAULTS.modelCostTable),
    });
    const report = buildBudgetReport(root, config, sessionId);
    expect(report.session.inputTokens).toBe(15_000);
    expect(report.session.outputTokens).toBe(3_000);
    expect(report.session.totalTokens).toBe(18_000);
  });

  it('does not include events from other sessions in session total', () => {
    appendTokenEvent(root, {
      ts: new Date().toISOString(), sessionId: 'other-sess', toolName: 'Bash',
      model: 'claude-sonnet-4-6', inputTokens: 50_000, outputTokens: 10_000,
      costUSD: 0.30,
    });
    const report = buildBudgetReport(root, config, 'my-sess');
    expect(report.session.costUSD).toBe(0);
    // project total includes all sessions
    expect(report.project.costUSD).toBeGreaterThan(0);
  });

  it('triggers alert when alertAt fraction is exceeded', () => {
    const sessionId = 'alert-sess';
    // Use a config with no token limit so only the cost alert fires
    const alertConfig: TokenBudgetConfig = { ...config, sessionMaxTokens: 0 };
    // Push 85% of $5 session budget = $4.25
    // Use mostly output tokens to keep input token count low
    appendTokenEvent(root, {
      ts: new Date().toISOString(), sessionId, toolName: 'Write',
      model: 'claude-sonnet-4-6', inputTokens: 0, outputTokens: 283_334,
      costUSD: 4.25,
    });
    const report = buildBudgetReport(root, alertConfig, sessionId);
    expect(report.alerts.length).toBeGreaterThan(0);
    expect(report.hardStop).toBe(false);
  });

  it('triggers hard stop when hardStopAt fraction is exceeded', () => {
    const sessionId = 'stop-sess';
    appendTokenEvent(root, {
      ts: new Date().toISOString(), sessionId, toolName: 'Write',
      model: 'claude-sonnet-4-6', inputTokens: 2_000_000, outputTokens: 50_000,
      costUSD: 6.00, // over $5 session limit
    });
    const report = buildBudgetReport(root, config, sessionId);
    expect(report.hardStop).toBe(true);
    expect(report.hardStopReason).not.toBeNull();
    // Could be cost-based or token-based message depending on which limit fires first
    expect(report.hardStopReason!.toLowerCase()).toMatch(/session|budget|exhausted/);
  });

  it('hard stops on token count when sessionMaxTokens exceeded', () => {
    const sessionId = 'tok-stop-sess';
    const tokConfig = { ...config, sessionMaxTokens: 1_000, sessionMaxCostUSD: 0 };
    appendTokenEvent(root, {
      ts: new Date().toISOString(), sessionId, toolName: 'Read',
      model: 'claude-sonnet-4-6', inputTokens: 1_500, outputTokens: 0, costUSD: 0.01,
    });
    const report = buildBudgetReport(root, tokConfig, sessionId);
    expect(report.hardStop).toBe(true);
    expect(report.hardStopReason).toContain('token');
  });

  it('no hard stop when budget limits are 0 (disabled)', () => {
    const disabledConfig: TokenBudgetConfig = {
      ...config,
      sessionMaxCostUSD: 0,
      dailyMaxCostUSD: 0,
      projectMaxCostUSD: 0,
      sessionMaxTokens: 0,
    };
    const sessionId = 'no-limit-sess';
    appendTokenEvent(root, {
      ts: new Date().toISOString(), sessionId, toolName: 'Write',
      model: 'claude-sonnet-4-6', inputTokens: 10_000_000, outputTokens: 5_000_000,
      costUSD: 105.00,
    });
    const report = buildBudgetReport(root, disabledConfig, sessionId);
    expect(report.hardStop).toBe(false);
  });
});
