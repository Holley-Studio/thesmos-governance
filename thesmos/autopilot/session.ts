// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Session state management for autopilot.
 * The session file (.thesmos/autopilot/.session.json) tracks what's been
 * done so --resume can pick up exactly where the session left off.
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
  copyFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import type { AutopilotSession } from '../types.js';

const SESSION_FILE = '.session.json';
const SESSIONS_DIR = 'sessions';
const AUTOPILOT_DIR = '.thesmos/autopilot';
const CANCEL_SENTINEL = '.cancel';

// ── Path helpers ──────────────────────────────────────────────────────────────

export function getAutopilotDir(root: string): string {
  return join(root, AUTOPILOT_DIR);
}

export function getSessionFilePath(root: string): string {
  return join(root, AUTOPILOT_DIR, SESSION_FILE);
}

export function getSessionsDir(root: string): string {
  return join(root, AUTOPILOT_DIR, SESSIONS_DIR);
}

export function getCancelSentinelPath(root: string): string {
  return join(root, AUTOPILOT_DIR, CANCEL_SENTINEL);
}

export function getJournalPath(root: string, sessionId: string): string {
  return join(root, AUTOPILOT_DIR, SESSIONS_DIR, `${sessionId}.md`);
}

export function getArchivedJournalPath(root: string, sessionId: string): string {
  return join(root, AUTOPILOT_DIR, SESSIONS_DIR, `archived`, `${sessionId}.md`);
}

export function getTaskLogPath(root: string, sessionId: string, taskIndex: number): string {
  return join(root, AUTOPILOT_DIR, SESSIONS_DIR, `${sessionId}-task-${taskIndex}.log`);
}

// ── Session ID generation ─────────────────────────────────────────────────────

export function generateSessionId(): string {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

// ── Persist / load ────────────────────────────────────────────────────────────

function ensureAutopilotDir(root: string): void {
  const dir = getAutopilotDir(root);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const sessionsDir = getSessionsDir(root);
  if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
}

export function saveSession(root: string, session: AutopilotSession): void {
  ensureAutopilotDir(root);
  const target = getSessionFilePath(root);
  const tmp = target + '.tmp';
  writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', 'utf8');
  renameSync(tmp, target);
}

export function loadSession(root: string): AutopilotSession | null {
  const path = getSessionFilePath(root);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as AutopilotSession;
  } catch (e) {
    console.warn('[thesmos] autopilot session file is corrupt, ignoring:', e);
    return null;
  }
}

export function clearSession(root: string): void {
  const path = getSessionFilePath(root);
  if (existsSync(path)) unlinkSync(path);
}

// ── Archive session journal on completion ─────────────────────────────────────

export function archiveSession(root: string, session: AutopilotSession): void {
  const archiveDir = join(root, AUTOPILOT_DIR, SESSIONS_DIR, 'archived');
  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  if (existsSync(session.journalPath)) {
    const archivePath = getArchivedJournalPath(root, session.id);
    copyFileSync(session.journalPath, archivePath);
  }
  clearSession(root);
}

// ── Cancel sentinel ───────────────────────────────────────────────────────────

export function isCancelRequested(root: string): boolean {
  return existsSync(getCancelSentinelPath(root));
}

export function createCancelSentinel(root: string): void {
  ensureAutopilotDir(root);
  writeFileSync(getCancelSentinelPath(root), '', 'utf8');
}

export function clearCancelSentinel(root: string): void {
  const path = getCancelSentinelPath(root);
  if (existsSync(path)) unlinkSync(path);
}

// ── Session status helpers ────────────────────────────────────────────────────

export function isTaskCompleted(session: AutopilotSession, taskIndex: number): boolean {
  return session.completedTaskIndexes.includes(taskIndex);
}

export function isTaskBlocked(session: AutopilotSession, taskIndex: number): boolean {
  return session.blockedTasks.some((b) => b.index === taskIndex);
}

export function markTaskComplete(session: AutopilotSession, taskIndex: number): void {
  if (!session.completedTaskIndexes.includes(taskIndex)) {
    session.completedTaskIndexes.push(taskIndex);
  }
  session.lastTaskStash = null;
}

export function markTaskBlocked(session: AutopilotSession, taskIndex: number, reason: string): void {
  if (!session.blockedTasks.some((b) => b.index === taskIndex)) {
    session.blockedTasks.push({ index: taskIndex, reason });
  }
  session.lastTaskStash = null;
}

export function addDecision(session: AutopilotSession, decision: string): void {
  session.decisionLog.push(decision);
}
