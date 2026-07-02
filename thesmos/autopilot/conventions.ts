// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Per-repo convention snapshot — learns from each autopilot session and
 * feeds accumulated knowledge back into future task prompts.
 *
 * Stored at: .thesmos/autopilot/conventions.json
 * Updated after every completed task. Never deleted between sessions.
 *
 * The more sessions you run, the richer this becomes. First session on a repo
 * uses generic context. Tenth session knows the repo's exact patterns, libraries,
 * naming conventions, and which Thesmos rules this AI tends to trip.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';

const CONVENTIONS_FILE = '.thesmos/autopilot/conventions.json';

// ── Data shape ────────────────────────────────────────────────────────────────

export interface RuleFireRecord {
  count: number;
  lastFired: string;
  contexts: string[];
}

export interface ConventionSnapshot {
  updatedAt: string;
  sessionCount: number;
  completedTaskCount: number;

  // Observed from AI decisions across sessions
  patterns: {
    naming?: string;
    errorHandling?: string;
    testing?: string;
    imports?: string;
    fileOrganization?: string;
    stateManagement?: string;
  };

  // Libraries seen in package.json and used by AI tasks
  confirmedLibraries: string[];

  // Libraries the AI tried to install but were blocked
  blockedLibraries: string[];

  // Files the AI has never modified (potential sacred files)
  untouchedFiles: string[];

  // Which Thesmos rules have fired as gate blockers in this repo
  ruleFireHistory: Record<string, RuleFireRecord>;

  // Actual LLM call counts per session (for cost calibration)
  costHistory: Array<{
    sessionId: string;
    taskCount: number;
    llmCalls: number;
    blockedCount: number;
    date: string;
  }>;

  // Decisions that were repeated across multiple sessions (reliable patterns)
  repeatedDecisions: string[];
}

// ── Defaults ──────────────────────────────────────────────────────────────────

function defaultSnapshot(): ConventionSnapshot {
  return {
    updatedAt: new Date().toISOString(),
    sessionCount: 0,
    completedTaskCount: 0,
    patterns: {},
    confirmedLibraries: [],
    blockedLibraries: [],
    untouchedFiles: [],
    ruleFireHistory: {},
    costHistory: [],
    repeatedDecisions: [],
  };
}

// ── File I/O ──────────────────────────────────────────────────────────────────

export function getConventionsPath(root: string): string {
  return join(root, CONVENTIONS_FILE);
}

export function loadConventions(root: string): ConventionSnapshot {
  const path = getConventionsPath(root);
  if (!existsSync(path)) return defaultSnapshot();
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ConventionSnapshot;
  } catch {
    return defaultSnapshot();
  }
}

function saveConventions(root: string, snapshot: ConventionSnapshot): void {
  const path = getConventionsPath(root);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  snapshot.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
}

// ── Update after a session ────────────────────────────────────────────────────

export interface SessionOutcome {
  sessionId: string;
  date: string;
  completedTaskCount: number;
  blockedTaskCount: number;
  llmCalls: number;
  firedRules: string[];
  blockedPackages: string[];
  newDecisions: string[];
  changedFiles: string[];
}

export function updateConventions(root: string, outcome: SessionOutcome): void {
  const snapshot = loadConventions(root);

  snapshot.sessionCount += 1;
  snapshot.completedTaskCount += outcome.completedTaskCount;

  // Cost history
  snapshot.costHistory.push({
    sessionId: outcome.sessionId,
    taskCount: outcome.completedTaskCount + outcome.blockedTaskCount,
    llmCalls: outcome.llmCalls,
    blockedCount: outcome.blockedTaskCount,
    date: outcome.date,
  });
  // Keep last 50 sessions
  if (snapshot.costHistory.length > 50) snapshot.costHistory = snapshot.costHistory.slice(-50);

  // Rule calibration
  const now = outcome.date;
  for (const rule of outcome.firedRules) {
    const existing = snapshot.ruleFireHistory[rule] ?? { count: 0, lastFired: now, contexts: [] };
    existing.count += 1;
    existing.lastFired = now;
    snapshot.ruleFireHistory[rule] = existing;
  }

  // Blocked libraries
  for (const pkg of outcome.blockedPackages) {
    if (!snapshot.blockedLibraries.includes(pkg)) {
      snapshot.blockedLibraries.push(pkg);
    }
  }

  // Repeated decisions (appear in more than 2 sessions)
  const decisionCounts = new Map<string, number>();
  for (const d of [...snapshot.repeatedDecisions, ...outcome.newDecisions]) {
    decisionCounts.set(d, (decisionCounts.get(d) ?? 0) + 1);
  }
  snapshot.repeatedDecisions = [...decisionCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([d]) => d)
    .slice(0, 20);

  saveConventions(root, snapshot);
}

// ── Extract patterns from AI output ──────────────────────────────────────────

export function extractPatternFromDecision(decision: string): Partial<ConventionSnapshot['patterns']> {
  const lower = decision.toLowerCase();
  const patterns: Partial<ConventionSnapshot['patterns']> = {};

  if (lower.includes('camelcase') || lower.includes('pascal')) {
    patterns.naming = decision.slice(0, 120);
  }
  if (lower.includes('try/catch') || lower.includes('error class') || lower.includes('apierror')) {
    patterns.errorHandling = decision.slice(0, 120);
  }
  if (lower.includes('vitest') || lower.includes('jest') || lower.includes('describe(') || lower.includes('test(')) {
    patterns.testing = decision.slice(0, 120);
  }
  if (lower.includes('named import') || lower.includes('.js extension') || lower.includes('esm')) {
    patterns.imports = decision.slice(0, 120);
  }

  return patterns;
}

export function mergePatterns(root: string, newPatterns: Partial<ConventionSnapshot['patterns']>): void {
  const snapshot = loadConventions(root);
  snapshot.patterns = { ...snapshot.patterns, ...newPatterns };
  saveConventions(root, snapshot);
}

// ── Build context string for task prompts ─────────────────────────────────────

export function buildConventionContext(snapshot: ConventionSnapshot): string {
  if (snapshot.sessionCount === 0) return '';

  const lines: string[] = [
    `REPO CONVENTIONS (learned from ${snapshot.sessionCount} previous autopilot session${snapshot.sessionCount !== 1 ? 's' : ''} on this codebase):`,
  ];

  const p = snapshot.patterns;
  if (p.naming) lines.push(`  Naming: ${p.naming}`);
  if (p.errorHandling) lines.push(`  Error handling: ${p.errorHandling}`);
  if (p.testing) lines.push(`  Testing: ${p.testing}`);
  if (p.imports) lines.push(`  Imports: ${p.imports}`);
  if (p.fileOrganization) lines.push(`  File organization: ${p.fileOrganization}`);
  if (p.stateManagement) lines.push(`  State management: ${p.stateManagement}`);

  if (snapshot.confirmedLibraries.length > 0) {
    lines.push(`  Libraries in use: ${snapshot.confirmedLibraries.slice(0, 10).join(', ')}`);
  }

  if (snapshot.blockedLibraries.length > 0) {
    lines.push(`  ⚠ Do NOT install: ${snapshot.blockedLibraries.join(', ')} (blocked in previous sessions)`);
  }

  if (snapshot.repeatedDecisions.length > 0) {
    lines.push(`  Repeated decisions across sessions:`);
    for (const d of snapshot.repeatedDecisions.slice(0, 5)) {
      lines.push(`    - ${d}`);
    }
  }

  // Top rule warnings
  const topRules = Object.entries(snapshot.ruleFireHistory)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 3);

  if (topRules.length > 0) {
    lines.push(`  ⚠ Thesmos rules that commonly fire in this repo (avoid triggering):`);
    for (const [rule, rec] of topRules) {
      lines.push(`    ${rule}: fired ${rec.count} time${rec.count !== 1 ? 's' : ''}`);
    }
  }

  return lines.join('\n');
}

// ── Cost calibration ──────────────────────────────────────────────────────────

export interface CostEstimate {
  best: number;
  expected: number;
  worst: number;
  basedOnSessions: number;
}

export function estimateCost(snapshot: ConventionSnapshot, taskCount: number): CostEstimate {
  if (snapshot.costHistory.length < 2) {
    // No calibration data — use defaults
    return {
      best: taskCount * 0.05,
      expected: taskCount * 0.12,
      worst: taskCount * 0.25,
      basedOnSessions: 0,
    };
  }

  const recent = snapshot.costHistory.slice(-10);
  const callsPerTask = recent.map((h) => (h.taskCount > 0 ? h.llmCalls / h.taskCount : 1));
  const avg = callsPerTask.reduce((a, b) => a + b, 0) / callsPerTask.length;
  const max = Math.max(...callsPerTask);

  // Rough cost per call: ~$0.05 average for claude-sonnet
  const costPerCall = 0.05;

  return {
    best: taskCount * costPerCall,
    expected: taskCount * avg * costPerCall,
    worst: taskCount * max * costPerCall,
    basedOnSessions: recent.length,
  };
}
