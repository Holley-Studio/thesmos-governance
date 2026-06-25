// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Autopilot session watcher.
 *
 * File-watches `.thesmos/autopilot/.session.json` and emits change events
 * when the session state updates. This is how the sidebar and status bar stay
 * live without polling.
 *
 * Also watches for the cancel sentinel so the UI can reflect "cancelling..."
 * state immediately after the user triggers cancel.
 */

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Minimal session shape (mirrors AutopilotSession in thesmos types) ──────

export interface AutopilotTaskState {
  index: number;
  reason?: string;
}

export interface AutopilotSessionState {
  id: string;
  planPath: string;
  planSlug: string;
  branch: string;
  startedAt: string;
  adapter: string;
  completedTaskIndexes: number[];
  blockedTasks: AutopilotTaskState[];
  timedOutTaskIndexes: number[];
  decisionLog: string[];
  journalPath: string;
}

// ── Plan task shape (read from MASTER_PLAN.md via session planPath) ───────────

export interface PlanTaskSummary {
  index: number;
  title: string;
  isCheckpoint: boolean;
}

export type TaskStatus = 'complete' | 'blocked' | 'timedout' | 'running' | 'pending' | 'checkpoint';

export interface TaskDisplayState {
  index: number;
  title: string;
  status: TaskStatus;
  blockReason?: string;
  isCheckpoint: boolean;
}

// ── Watcher ───────────────────────────────────────────────────────────────────

export class AutopilotWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<AutopilotSessionState | null>();
  readonly onDidChange = this._onDidChange.event;

  private currentSession: AutopilotSessionState | null = null;
  private sessionPath: string;
  private cancelPath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly workspaceRoot: string) {
    this.sessionPath = join(workspaceRoot, '.thesmos', 'autopilot', '.session.json');
    this.cancelPath = join(workspaceRoot, '.thesmos', 'autopilot', '.cancel');

    // Watch the autopilot dir for any file changes
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(workspaceRoot),
      '.thesmos/autopilot/**',
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(() => this.scheduleReload());
    watcher.onDidCreate(() => this.scheduleReload());
    watcher.onDidDelete(() => this.scheduleReload());

    this.disposables.push(watcher, this._onDidChange);

    // Initial load
    this.reload();
  }

  private scheduleReload(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.reload();
    }, 250);
  }

  private reload(): void {
    const session = this.readSession();
    const changed =
      JSON.stringify(session) !== JSON.stringify(this.currentSession);
    if (changed) {
      this.currentSession = session;
      this._onDidChange.fire(session);
    }
  }

  private readSession(): AutopilotSessionState | null {
    if (!existsSync(this.sessionPath)) return null;
    try {
      return JSON.parse(readFileSync(this.sessionPath, 'utf8')) as AutopilotSessionState;
    } catch {
      return null;
    }
  }

  get session(): AutopilotSessionState | null {
    return this.currentSession;
  }

  get isCancelling(): boolean {
    return existsSync(this.cancelPath);
  }

  /** Derive task display states from the session + raw plan content. */
  buildTaskDisplayStates(planContent: string): TaskDisplayState[] {
    const session = this.currentSession;
    const rawTasks = parsePlanTasks(planContent);

    if (!session || rawTasks.length === 0) return [];

    // The first non-completed, non-blocked, non-timedout, non-checkpoint task
    const runningIndex = rawTasks
      .filter((t) => !t.isCheckpoint)
      .find((t) => {
        const done = session.completedTaskIndexes.includes(t.index);
        const blocked = session.blockedTasks.some((b) => b.index === t.index);
        const timedOut = session.timedOutTaskIndexes.includes(t.index);
        return !done && !blocked && !timedOut;
      })?.index ?? -1;

    return rawTasks.map((t): TaskDisplayState => {
      if (t.isCheckpoint) {
        return { index: t.index, title: 'CHECKPOINT', status: 'checkpoint', isCheckpoint: true };
      }

      if (session.completedTaskIndexes.includes(t.index)) {
        return { index: t.index, title: t.title, status: 'complete', isCheckpoint: false };
      }
      const block = session.blockedTasks.find((b) => b.index === t.index);
      if (block) {
        return { index: t.index, title: t.title, status: 'blocked', blockReason: block.reason, isCheckpoint: false };
      }
      if (session.timedOutTaskIndexes.includes(t.index)) {
        return { index: t.index, title: t.title, status: 'timedout', isCheckpoint: false };
      }
      if (t.index === runningIndex) {
        return { index: t.index, title: t.title, status: 'running', isCheckpoint: false };
      }
      return { index: t.index, title: t.title, status: 'pending', isCheckpoint: false };
    });
  }

  dispose(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    for (const d of this.disposables) d.dispose();
  }
}

// ── Minimal plan task parser (avoids importing the full thesmos package) ───

function parsePlanTasks(content: string): PlanTaskSummary[] {
  const tasks: PlanTaskSummary[] = [];
  let index = 0;

  for (const line of content.split('\n')) {
    if (line.trim() === '---CHECKPOINT---') {
      tasks.push({ index: index++, title: 'CHECKPOINT', isCheckpoint: true });
    } else if (line.startsWith('## ')) {
      tasks.push({ index: index++, title: line.slice(3).trim(), isCheckpoint: false });
    }
  }

  return tasks;
}
