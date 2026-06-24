/**
 * Session statistics and analytics for autopilot.
 *
 * Aggregates data across sessions to produce:
 *   - Overall completion rates
 *   - Most common block reasons and rule failures
 *   - Calibrated cost estimates (real data, not guesses)
 *   - Session history with status
 *
 * Used by: thesmos autopilot stats
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutopilotSession } from '../types.js';
import { loadConventions, type ConventionSnapshot } from './conventions.js';
import { getSessionsDir } from './session.js';

// ── Aggregated stats shape ────────────────────────────────────────────────────

export interface AutopilotStats {
  totalSessions: number;
  totalTasks: number;
  completedTasks: number;
  blockedTasks: number;
  timedOutTasks: number;
  completionRate: number;

  averageTasksPerSession: number;
  averageLlmCallsPerTask: number;
  averageCostPerSession: number;

  topBlockReasons: Array<{ reason: string; count: number }>;
  topFiredRules: Array<{ rule: string; count: number; lastFired: string }>;

  recentSessions: Array<{
    id: string;
    plan: string;
    completed: number;
    total: number;
    date: string;
    status: string;
  }>;

  calibratedCostPerTask: {
    best: number;
    expected: number;
    worst: number;
    basedOn: number;
  };
}

// ── Archive session state reader ──────────────────────────────────────────────

function readArchivedSessions(root: string): AutopilotSession[] {
  const sessionsDir = getSessionsDir(root);
  const archiveDir = join(sessionsDir, 'archived');
  const sessions: AutopilotSession[] = [];

  // Try both live sessions dir and archived
  for (const dir of [sessionsDir, archiveDir]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      try {
        const raw = readFileSync(join(dir, file), 'utf8');
        sessions.push(JSON.parse(raw) as AutopilotSession);
      } catch {
        // Skip malformed files
      }
    }
  }
  return sessions;
}

function extractBlockReasons(sessions: AutopilotSession[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    for (const b of s.blockedTasks) {
      // Normalise to the first meaningful fragment
      const key = b.reason.split(':')[0]?.trim().slice(0, 80) ?? b.reason.slice(0, 80);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
}

// ── Main aggregation ──────────────────────────────────────────────────────────

export function computeStats(root: string): AutopilotStats {
  const conventions = loadConventions(root);
  const sessions = readArchivedSessions(root);

  const totalSessions = Math.max(conventions.sessionCount, sessions.length);
  const totalTasks = sessions.reduce(
    (n, s) => n + s.completedTaskIndexes.length + s.blockedTasks.length + s.timedOutTaskIndexes.length,
    0,
  );
  const completedTasks = sessions.reduce((n, s) => n + s.completedTaskIndexes.length, 0);
  const blockedTasks = sessions.reduce((n, s) => n + s.blockedTasks.length, 0);
  const timedOutTasks = sessions.reduce((n, s) => n + s.timedOutTaskIndexes.length, 0);
  const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

  const averageTasksPerSession = totalSessions > 0 ? totalTasks / totalSessions : 0;

  // Cost data from conventions
  const history = conventions.costHistory;
  const totalCalls = history.reduce((n, h) => n + h.llmCalls, 0);
  const totalHistoryTasks = history.reduce((n, h) => n + h.taskCount, 0);
  const averageLlmCallsPerTask = totalHistoryTasks > 0 ? totalCalls / totalHistoryTasks : 1;
  const costPerCall = 0.05;
  const averageCostPerSession =
    conventions.sessionCount > 0
      ? (totalCalls * costPerCall) / conventions.sessionCount
      : averageLlmCallsPerTask * 5 * costPerCall;

  // Calibrated cost estimate
  const callsPerTask =
    history.length > 0
      ? history.map((h) => (h.taskCount > 0 ? h.llmCalls / h.taskCount : 1))
      : [1];
  const avgCalls = callsPerTask.reduce((a, b) => a + b, 0) / callsPerTask.length;
  const maxCalls = Math.max(...callsPerTask);

  const calibratedCostPerTask = {
    best: costPerCall,
    expected: avgCalls * costPerCall,
    worst: maxCalls * costPerCall,
    basedOn: history.length,
  };

  // Top fired rules
  const topFiredRules = Object.entries(conventions.ruleFireHistory)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([rule, rec]) => ({ rule, count: rec.count, lastFired: rec.lastFired }));

  // Block reasons
  const topBlockReasons = extractBlockReasons(sessions);

  // Recent session summaries (read from JSON session files)
  const recentSessions = sessions
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      plan: s.planSlug,
      completed: s.completedTaskIndexes.length,
      total: s.completedTaskIndexes.length + s.blockedTasks.length + s.timedOutTaskIndexes.length,
      date: s.startedAt.slice(0, 10),
      status:
        s.blockedTasks.length > 0
          ? `${s.blockedTasks.length} blocked`
          : s.timedOutTaskIndexes.length > 0
          ? `${s.timedOutTaskIndexes.length} timed out`
          : 'all complete',
    }));

  return {
    totalSessions,
    totalTasks,
    completedTasks,
    blockedTasks,
    timedOutTasks,
    completionRate,
    averageTasksPerSession,
    averageLlmCallsPerTask,
    averageCostPerSession,
    topBlockReasons,
    topFiredRules,
    recentSessions,
    calibratedCostPerTask,
  };
}

// ── Display ───────────────────────────────────────────────────────────────────

export function displayStats(root: string): void {
  const stats = computeStats(root);
  const DIVIDER = '─'.repeat(54);

  process.stdout.write(`\nThesmos Autopilot — Statistics\n`);
  process.stdout.write(`${DIVIDER}\n\n`);

  if (stats.totalSessions === 0) {
    process.stdout.write(`No sessions recorded yet.\nRun: thesmos autopilot start MASTER_PLAN.md --yes\n`);
    return;
  }

  process.stdout.write(`OVERVIEW\n`);
  process.stdout.write(`  Sessions run:       ${stats.totalSessions}\n`);
  process.stdout.write(`  Total tasks:        ${stats.totalTasks}\n`);
  process.stdout.write(`  Completed:          ${stats.completedTasks} (${(stats.completionRate * 100).toFixed(0)}%)\n`);
  process.stdout.write(`  Blocked:            ${stats.blockedTasks}\n`);
  process.stdout.write(`  Timed out:          ${stats.timedOutTasks}\n\n`);

  process.stdout.write(`COST (calibrated from real session data)\n`);
  const c = stats.calibratedCostPerTask;
  if (c.basedOn === 0) {
    process.stdout.write(`  No cost data yet — run a session to calibrate.\n\n`);
  } else {
    process.stdout.write(`  Per task — best:    $${c.best.toFixed(3)}\n`);
    process.stdout.write(`  Per task — typical: $${c.expected.toFixed(3)}\n`);
    process.stdout.write(`  Per task — worst:   $${c.worst.toFixed(3)}\n`);
    process.stdout.write(`  Avg cost/session:   $${stats.averageCostPerSession.toFixed(2)}\n`);
    process.stdout.write(`  (Based on ${c.basedOn} session${c.basedOn !== 1 ? 's' : ''})\n\n`);
  }

  if (stats.topFiredRules.length > 0) {
    process.stdout.write(`COMMON RULE FAILURES (gates that blocked tasks most)\n`);
    for (const r of stats.topFiredRules) {
      process.stdout.write(`  ${r.rule.padEnd(20)} ${r.count}× (last: ${r.lastFired})\n`);
    }
    process.stdout.write(`\n`);
  }

  if (stats.topBlockReasons.length > 0) {
    process.stdout.write(`COMMON BLOCK REASONS\n`);
    for (const b of stats.topBlockReasons) {
      process.stdout.write(`  ${b.count}×  ${b.reason}\n`);
    }
    process.stdout.write(`\n`);
  }

  if (stats.recentSessions.length > 0) {
    process.stdout.write(`RECENT SESSIONS\n`);
    process.stdout.write(`  ${'ID'.padEnd(16)} ${'Plan'.padEnd(24)} ${'Tasks'.padEnd(8)} ${'Status'}\n`);
    process.stdout.write(`  ${'-'.repeat(56)}\n`);
    for (const s of stats.recentSessions) {
      const tasks = `${s.completed}/${s.total}`;
      process.stdout.write(
        `  ${s.id.padEnd(16)} ${s.plan.slice(0, 22).padEnd(24)} ${tasks.padEnd(8)} ${s.status}\n`,
      );
    }
    process.stdout.write(`\n`);
  }

  process.stdout.write(`${DIVIDER}\n`);
}

// ── Extract fired rules from journal ─────────────────────────────────────────

export function extractFiredRulesFromJournal(journalPath: string): string[] {
  if (!existsSync(journalPath)) return [];
  const content = readFileSync(journalPath, 'utf8');

  // Look for rule IDs in gate output (SEC_001, GATE_001, etc.)
  const rulePattern = /\b([A-Z]{2,10}_\d{3})\b/g;
  const found = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(content)) !== null) {
    found.add(match[1]!);
  }
  return [...found];
}
