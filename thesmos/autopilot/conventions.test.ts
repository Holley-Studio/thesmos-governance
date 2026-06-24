import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  loadConventions,
  updateConventions,
  buildConventionContext,
  extractPatternFromDecision,
  mergePatterns,
  estimateCost,
} from './conventions.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'thesmos-conv-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('loadConventions', () => {
  it('returns defaults when no file exists', () => {
    const snap = loadConventions(tmpRoot);
    expect(snap.sessionCount).toBe(0);
    expect(snap.completedTaskCount).toBe(0);
    expect(snap.patterns).toEqual({});
    expect(snap.confirmedLibraries).toEqual([]);
    expect(snap.blockedLibraries).toEqual([]);
    expect(snap.costHistory).toEqual([]);
    expect(snap.repeatedDecisions).toEqual([]);
    expect(snap.ruleFireHistory).toEqual({});
  });
});

describe('updateConventions', () => {
  it('increments session count and saves cost history', () => {
    updateConventions(tmpRoot, {
      sessionId: '20260616-1200',
      date: '2026-06-16',
      completedTaskCount: 3,
      blockedTaskCount: 1,
      llmCalls: 5,
      firedRules: ['SEC_001', 'TS_001'],
      blockedPackages: ['lodash'],
      newDecisions: ['Used camelCase for all identifiers'],
      changedFiles: [],
    });

    const snap = loadConventions(tmpRoot);
    expect(snap.sessionCount).toBe(1);
    expect(snap.completedTaskCount).toBe(3);
    expect(snap.costHistory).toHaveLength(1);
    expect(snap.costHistory[0]).toMatchObject({
      sessionId: '20260616-1200',
      taskCount: 4,
      llmCalls: 5,
      blockedCount: 1,
      date: '2026-06-16',
    });
  });

  it('records fired rules with count and last fired date', () => {
    updateConventions(tmpRoot, {
      sessionId: 'sess-1',
      date: '2026-06-01',
      completedTaskCount: 2,
      blockedTaskCount: 0,
      llmCalls: 3,
      firedRules: ['SEC_001'],
      blockedPackages: [],
      newDecisions: [],
      changedFiles: [],
    });

    updateConventions(tmpRoot, {
      sessionId: 'sess-2',
      date: '2026-06-15',
      completedTaskCount: 1,
      blockedTaskCount: 0,
      llmCalls: 2,
      firedRules: ['SEC_001', 'GATE_002'],
      blockedPackages: [],
      newDecisions: [],
      changedFiles: [],
    });

    const snap = loadConventions(tmpRoot);
    expect(snap.sessionCount).toBe(2);
    expect(snap.ruleFireHistory['SEC_001']?.count).toBe(2);
    expect(snap.ruleFireHistory['SEC_001']?.lastFired).toBe('2026-06-15');
    expect(snap.ruleFireHistory['GATE_002']?.count).toBe(1);
  });

  it('accumulates blocked libraries without duplicates', () => {
    updateConventions(tmpRoot, {
      sessionId: 's1',
      date: '2026-06-01',
      completedTaskCount: 1,
      blockedTaskCount: 0,
      llmCalls: 1,
      firedRules: [],
      blockedPackages: ['lodash', 'moment'],
      newDecisions: [],
      changedFiles: [],
    });

    updateConventions(tmpRoot, {
      sessionId: 's2',
      date: '2026-06-02',
      completedTaskCount: 1,
      blockedTaskCount: 0,
      llmCalls: 1,
      firedRules: [],
      blockedPackages: ['lodash'],
      newDecisions: [],
      changedFiles: [],
    });

    const snap = loadConventions(tmpRoot);
    expect(snap.blockedLibraries).toEqual(['lodash', 'moment']);
  });

  it('caps cost history at 50 entries', () => {
    for (let i = 0; i < 55; i++) {
      updateConventions(tmpRoot, {
        sessionId: `s${i}`,
        date: '2026-06-01',
        completedTaskCount: 1,
        blockedTaskCount: 0,
        llmCalls: 2,
        firedRules: [],
        blockedPackages: [],
        newDecisions: [],
        changedFiles: [],
      });
    }
    const snap = loadConventions(tmpRoot);
    expect(snap.costHistory.length).toBeLessThanOrEqual(50);
  });
});

describe('buildConventionContext', () => {
  it('returns empty string when no sessions recorded', () => {
    const snap = loadConventions(tmpRoot);
    expect(buildConventionContext(snap)).toBe('');
  });

  it('includes session count and patterns once data exists', () => {
    updateConventions(tmpRoot, {
      sessionId: 's1',
      date: '2026-06-16',
      completedTaskCount: 2,
      blockedTaskCount: 0,
      llmCalls: 3,
      firedRules: ['SEC_001'],
      blockedPackages: ['lodash'],
      newDecisions: [],
      changedFiles: [],
    });
    mergePatterns(tmpRoot, { naming: 'camelCase for variables, PascalCase for components' });
    const snap = loadConventions(tmpRoot);
    const ctx = buildConventionContext(snap);
    expect(ctx).toContain('1 previous autopilot session');
    expect(ctx).toContain('camelCase');
    expect(ctx).toContain('Do NOT install: lodash');
    expect(ctx).toContain('SEC_001');
  });
});

describe('extractPatternFromDecision', () => {
  it('extracts naming pattern', () => {
    const patterns = extractPatternFromDecision('Used camelCase for all variables and PascalCase for class names');
    expect(patterns.naming).toBeDefined();
  });

  it('extracts error handling pattern', () => {
    const patterns = extractPatternFromDecision('Wrapped in try/catch and threw custom ApiError subclasses');
    expect(patterns.errorHandling).toBeDefined();
  });

  it('extracts testing pattern', () => {
    const patterns = extractPatternFromDecision('Tests use vitest with describe() and test() blocks');
    expect(patterns.testing).toBeDefined();
  });

  it('extracts import pattern', () => {
    const patterns = extractPatternFromDecision('Used named import with .js extension for ESM compatibility');
    expect(patterns.imports).toBeDefined();
  });

  it('returns empty for unrelated text', () => {
    const patterns = extractPatternFromDecision('Added the button component');
    expect(Object.keys(patterns)).toHaveLength(0);
  });
});

describe('estimateCost', () => {
  it('returns defaults when no history', () => {
    const snap = loadConventions(tmpRoot);
    const est = estimateCost(snap, 10);
    expect(est.basedOnSessions).toBe(0);
    expect(est.best).toBeCloseTo(10 * 0.05);
    expect(est.expected).toBeCloseTo(10 * 0.12);
    expect(est.worst).toBeCloseTo(10 * 0.25);
  });

  it('calibrates from real history', () => {
    updateConventions(tmpRoot, {
      sessionId: 's1',
      date: '2026-06-01',
      completedTaskCount: 4,
      blockedTaskCount: 0,
      llmCalls: 8,
      firedRules: [],
      blockedPackages: [],
      newDecisions: [],
      changedFiles: [],
    });
    updateConventions(tmpRoot, {
      sessionId: 's2',
      date: '2026-06-02',
      completedTaskCount: 2,
      blockedTaskCount: 0,
      llmCalls: 4,
      firedRules: [],
      blockedPackages: [],
      newDecisions: [],
      changedFiles: [],
    });
    const snap = loadConventions(tmpRoot);
    const est = estimateCost(snap, 5);
    expect(est.basedOnSessions).toBeGreaterThan(0);
    expect(est.expected).toBeGreaterThan(0);
  });
});
