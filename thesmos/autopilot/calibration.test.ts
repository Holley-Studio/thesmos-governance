import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeStats, extractFiredRulesFromJournal } from './calibration.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'thesmos-calib-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('computeStats', () => {
  it('returns all-zero stats when no sessions or conventions', () => {
    const stats = computeStats(tmpRoot);
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalTasks).toBe(0);
    expect(stats.completedTasks).toBe(0);
    expect(stats.blockedTasks).toBe(0);
    expect(stats.timedOutTasks).toBe(0);
    expect(stats.completionRate).toBe(0);
    expect(stats.recentSessions).toEqual([]);
    expect(stats.topFiredRules).toEqual([]);
    expect(stats.topBlockReasons).toEqual([]);
  });

  it('aggregates stats from archived session JSON files', () => {
    const sessionsDir = join(tmpRoot, '.thesmos', 'autopilot', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    const session = {
      id: '20260616-1200',
      planPath: 'MASTER_PLAN.md',
      planSlug: 'my-project',
      branch: 'autopilot/my-project-20260616-1200',
      restoreTag: 'thesmos-pre-autopilot-20260616-1200',
      startedAt: '2026-06-16T12:00:00Z',
      adapter: 'claude',
      completedTaskIndexes: [0, 1, 2],
      blockedTasks: [{ index: 3, reason: 'Gate failure: npm test failed' }],
      timedOutTaskIndexes: [],
      decisionLog: [],
      journalPath: join(sessionsDir, '20260616-1200.md'),
      permissionsBackupPath: null,
      lastTaskStash: null,
    };

    writeFileSync(join(sessionsDir, '20260616-1200.json'), JSON.stringify(session));

    const stats = computeStats(tmpRoot);
    expect(stats.completedTasks).toBe(3);
    expect(stats.blockedTasks).toBe(1);
    expect(stats.totalTasks).toBe(4);
    expect(stats.completionRate).toBeCloseTo(0.75);
    expect(stats.recentSessions).toHaveLength(1);
    expect(stats.recentSessions[0]!.plan).toBe('my-project');
    expect(stats.topBlockReasons[0]!.reason).toContain('Gate failure');
  });

  it('reads from archived subdirectory too', () => {
    const archiveDir = join(tmpRoot, '.thesmos', 'autopilot', 'sessions', 'archived');
    mkdirSync(archiveDir, { recursive: true });

    const session = {
      id: '20260601-0900',
      planPath: 'MASTER_PLAN.md',
      planSlug: 'old-project',
      branch: 'autopilot/old-project-20260601-0900',
      restoreTag: 'thesmos-pre-autopilot-20260601-0900',
      startedAt: '2026-06-01T09:00:00Z',
      adapter: 'claude',
      completedTaskIndexes: [0],
      blockedTasks: [],
      timedOutTaskIndexes: [],
      decisionLog: [],
      journalPath: '',
      permissionsBackupPath: null,
      lastTaskStash: null,
    };

    writeFileSync(join(archiveDir, '20260601-0900.json'), JSON.stringify(session));

    const stats = computeStats(tmpRoot);
    expect(stats.completedTasks).toBeGreaterThanOrEqual(1);
  });
});

describe('extractFiredRulesFromJournal', () => {
  it('returns empty array when file does not exist', () => {
    const result = extractFiredRulesFromJournal('/nonexistent/journal.md');
    expect(result).toEqual([]);
  });

  it('extracts rule IDs from journal content', () => {
    const journalPath = join(tmpRoot, 'journal.md');
    writeFileSync(
      journalPath,
      `## Task 1
Gate output:
  ✗ Gate failed — rule SEC_001 triggered
  ✗ TS_002: type mismatch detected
  ✗ SEC_001 fired again
## Session Decision Log
Used GATE_003 pattern throughout.
`,
    );

    const rules = extractFiredRulesFromJournal(journalPath);
    expect(rules).toContain('SEC_001');
    expect(rules).toContain('TS_002');
    expect(rules).toContain('GATE_003');
    // Deduped
    expect(rules.filter((r) => r === 'SEC_001')).toHaveLength(1);
  });

  it('ignores short sequences that are not rule IDs', () => {
    const journalPath = join(tmpRoot, 'journal.md');
    writeFileSync(journalPath, `## Session\nSome text: AB_123 and ABCDEFGHIJK_001 and valid SEC_001\n`);
    const rules = extractFiredRulesFromJournal(journalPath);
    expect(rules).toContain('SEC_001');
    // ABCDEFGHIJK is 11 chars — over the {2,10} limit, should not appear
    expect(rules.find((r) => r.includes('ABCDEFGHIJK'))).toBeUndefined();
  });
});
