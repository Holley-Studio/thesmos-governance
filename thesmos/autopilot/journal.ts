// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Session journal — the complete audit trail for an autopilot session.
 * Written to .thesmos/autopilot/sessions/[id].md incrementally.
 * Every decision, gate result, scope violation, and concern is recorded here.
 */
import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AutopilotSession, AutopilotPlan } from '../types.js';

export interface GateResult {
  gate: string;
  passed: boolean;
  output: string;
}

export interface DoneCriterionResult {
  criterion: string;
  passed: boolean;
}

export interface ScopeAudit {
  outOfScopeFiles: string[];
  unauthorizedPackages: string[];
}

export interface JournalTaskEntry {
  index: number;
  title: string;
  status: 'complete' | 'blocked' | 'timed_out';
  commitHash?: string;
  filesChanged: string[];
  gateResults: GateResult[];
  doneCriteriaResults: DoneCriterionResult[];
  scopeAudit: ScopeAudit;
  aiSummary?: string;
  decisionsLog?: string;
  alternativesRejected?: string;
  concerns?: string;
  retries: number;
  blockReason?: string;
  startedAt: string;
  completedAt: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatTimestamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}Z`;
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Journal initialization ────────────────────────────────────────────────────

export function initJournal(session: AutopilotSession, plan: AutopilotPlan): void {
  ensureDir(session.journalPath);

  const nonCheckpointTasks = plan.tasks.filter((t) => !t.isCheckpoint);
  const checkpoints = plan.tasks.filter((t) => t.isCheckpoint).length;

  const header = [
    `# Autopilot Session: ${session.id}`,
    `Plan: ${session.planPath}`,
    `Branch: ${session.branch}`,
    `Adapter: ${session.adapter}`,
    `Gates: ${plan.gates.join(' | ')}`,
    `Tasks: ${nonCheckpointTasks.length} (${checkpoints} checkpoint${checkpoints !== 1 ? 's' : ''})`,
    `Started: ${session.startedAt}`,
    ``,
    `## Permission State`,
    `Profile written: ${session.startedAt}`,
    `Backup: ${session.permissionsBackupPath ?? 'none'}`,
    `Restored: pending`,
    ``,
    `## Session Decision Log`,
    `_Decisions made in this session — included in every subsequent task prompt._`,
    ``,
    `---`,
    ``,
  ].join('\n');

  writeFileSync(session.journalPath, header, 'utf8');
}

// ── Task entry writing ────────────────────────────────────────────────────────

export function appendTaskEntry(journalPath: string, entry: JournalTaskEntry): void {
  const statusBadge =
    entry.status === 'complete' ? 'COMPLETE' :
    entry.status === 'blocked' ? 'BLOCKED' : 'TIMED_OUT';

  const lines: string[] = [
    `## Task ${entry.index + 1}: ${entry.title}`,
    `Status: ${statusBadge}`,
    entry.commitHash ? `Commit: ${entry.commitHash}` : '',
    `Started:   ${entry.startedAt}`,
    `Completed: ${entry.completedAt}`,
    `Retries:   ${entry.retries}`,
    ``,
  ];

  if (entry.blockReason) {
    lines.push(`Block reason: ${entry.blockReason}`, ``);
  }

  if (entry.filesChanged.length > 0) {
    lines.push(`Files changed:`);
    for (const f of entry.filesChanged) lines.push(`  ${f}`);
    lines.push(``);
  }

  lines.push(`Gate results:`);
  for (const g of entry.gateResults) {
    lines.push(`  ${g.passed ? '✓' : '✗'}  ${g.gate}`);
    if (!g.passed && g.output) {
      const excerpt = g.output.split('\n').slice(0, 10).join('\n');
      lines.push(`     ${excerpt.replace(/\n/g, '\n     ')}`);
    }
  }
  lines.push(``);

  lines.push(`Done criteria:`);
  for (const d of entry.doneCriteriaResults) {
    lines.push(`  ${d.passed ? '✓' : '✗'}  ${d.criterion}`);
  }
  lines.push(``);

  const { outOfScopeFiles, unauthorizedPackages } = entry.scopeAudit;
  lines.push(`Scope audit:`);
  lines.push(`  Out-of-scope files:      ${outOfScopeFiles.length === 0 ? 'none' : outOfScopeFiles.join(', ')}`);
  lines.push(`  Unauthorized packages:   ${unauthorizedPackages.length === 0 ? 'none' : unauthorizedPackages.join(', ')}`);
  lines.push(``);

  if (entry.aiSummary) {
    lines.push(`AI summary: ${entry.aiSummary}`, ``);
  }

  if (entry.decisionsLog) {
    lines.push(`Decisions made:`, entry.decisionsLog, ``);
  }

  if (entry.alternativesRejected) {
    lines.push(`Alternatives rejected:`, entry.alternativesRejected, ``);
  }

  if (entry.concerns) {
    lines.push(`Concerns flagged:`, entry.concerns, ``);
  }

  lines.push(`---`, ``);

  appendFileSync(journalPath, lines.filter((l) => l !== null).join('\n'), 'utf8');
}

// ── Decision log ──────────────────────────────────────────────────────────────

export function appendDecisionLogEntry(journalPath: string, taskIndex: number, taskTitle: string, decision: string): void {
  const content = readFileSync(journalPath, 'utf8');
  const marker = '## Session Decision Log\n_Decisions made in this session — included in every subsequent task prompt._\n';
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) return;

  const insertAt = markerIndex + marker.length;
  const entry = `- Task ${taskIndex + 1} (${taskTitle}): ${decision}\n`;
  const updated = content.slice(0, insertAt) + entry + content.slice(insertAt);
  writeFileSync(journalPath, updated, 'utf8');
}

// ── Permission state update ───────────────────────────────────────────────────

export function markPermissionsRestored(journalPath: string, restoredAt: string): void {
  if (!existsSync(journalPath)) return;
  const content = readFileSync(journalPath, 'utf8');
  const updated = content.replace('Restored: pending', `Restored: ${restoredAt}`);
  writeFileSync(journalPath, updated, 'utf8');
}

// ── Checkpoint marker ─────────────────────────────────────────────────────────

export function appendCheckpointEntry(journalPath: string, taskIndex: number, pausedAt: string): void {
  const lines = [
    `## Checkpoint (after Task ${taskIndex})`,
    `Status: PAUSED`,
    `Paused: ${pausedAt}`,
    ``,
    `Session paused for human review. Resume with:`,
    `  thesmos autopilot resume [PLAN_FILE]`,
    ``,
    `---`,
    ``,
  ].join('\n');
  appendFileSync(journalPath, lines, 'utf8');
}

// ── Session completion ────────────────────────────────────────────────────────

export function appendSessionSummary(
  journalPath: string,
  completedCount: number,
  blockedCount: number,
  timedOutCount: number,
  completedAt: string,
): void {
  const lines = [
    `## Session Complete`,
    `Completed: ${completedAt}`,
    `Tasks complete:   ${completedCount}`,
    `Tasks blocked:    ${blockedCount}`,
    `Tasks timed out:  ${timedOutCount}`,
    ``,
  ].join('\n');
  appendFileSync(journalPath, lines, 'utf8');
}

// ── Reading journal for context ───────────────────────────────────────────────

export function readDecisionLog(journalPath: string): string {
  if (!existsSync(journalPath)) return '';
  const content = readFileSync(journalPath, 'utf8');
  const start = content.indexOf('## Session Decision Log');
  const end = content.indexOf('\n---\n', start);
  if (start === -1 || end === -1) return '';
  return content.slice(start, end).trim();
}
