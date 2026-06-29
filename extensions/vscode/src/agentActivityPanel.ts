// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Agent Activity sidebar panel — live timeline of Pantheon agent spawns and
 * completions. Reads `.thesmos/agent-activity.jsonl` via FileSystemWatcher,
 * mirrors the AutopilotWatcher + AutopilotTreeProvider pattern exactly.
 *
 * Shows:
 *   ● Session abc123 · 3 agents · 2 complete · 1 running
 *   └── $(sync~spin) Explore — researching codebase…
 *   └── $(check) Zeus — Executive Orchestration · 1420ms
 *   └── $(check) Apollo — Content Agent · 880ms
 */

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Event type (mirrors thesmos/agent-activity.ts) ────────────────────────────

export interface AgentActivityEvent {
  ts: string;
  type: 'spawn' | 'complete' | 'error';
  sessionId: string;
  agentId: string;
  parentId?: string;
  description: string;
  subagentType: string;
  durationMs?: number;
  resultSummary?: string;
}

// ── Watcher ───────────────────────────────────────────────────────────────────

export class AgentActivityWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<AgentActivityEvent[]>();
  readonly onDidChange = this._onDidChange.event;

  private current: AgentActivityEvent[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly logPath: string;

  constructor(private readonly workspaceRoot: string) {
    this.logPath = join(workspaceRoot, '.thesmos', 'agent-activity.jsonl');

    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(workspaceRoot),
      '.thesmos/agent-activity.jsonl',
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(() => this.scheduleReload());
    watcher.onDidCreate(() => this.scheduleReload());
    watcher.onDidDelete(() => this.scheduleReload());

    this.disposables.push(watcher, this._onDidChange);
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
    const events = this.readLog();
    this.current = events;
    this._onDidChange.fire(events);
  }

  private readLog(): AgentActivityEvent[] {
    if (!existsSync(this.logPath)) return [];
    try {
      const lines = readFileSync(this.logPath, 'utf-8')
        .split('\n')
        .filter(Boolean)
        .slice(-200);
      const events: AgentActivityEvent[] = [];
      for (const line of lines) {
        try { events.push(JSON.parse(line) as AgentActivityEvent); } catch { /* skip */ }
      }
      // Prune events older than 4 hours
      const cutoff = Date.now() - 4 * 60 * 60 * 1000;
      return events.filter((e) => new Date(e.ts).getTime() > cutoff);
    } catch {
      return [];
    }
  }

  get events(): AgentActivityEvent[] { return this.current; }

  dispose(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    for (const d of this.disposables) d.dispose();
  }
}

// ── Tree items ────────────────────────────────────────────────────────────────

type ActivityItemKind = 'session' | 'agent';

class ActivityTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: ActivityItemKind,
    collapsible = vscode.TreeItemCollapsibleState.None,
    public readonly sessionId?: string,
    public readonly agentId?: string,
  ) {
    super(label, collapsible);
    this.contextValue = kind;
  }
}

// ── Tree provider ─────────────────────────────────────────────────────────────

export class AgentActivityTreeProvider
  implements vscode.TreeDataProvider<ActivityTreeItem>, vscode.Disposable {

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ActivityTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private events: AgentActivityEvent[] = [];
  private readonly disposables: vscode.Disposable[] = [this._onDidChangeTreeData];

  constructor(watcher: AgentActivityWatcher) {
    this.events = watcher.events;
    this.disposables.push(
      watcher.onDidChange((events) => {
        this.events = events;
        this._onDidChangeTreeData.fire();
      }),
    );
  }

  /** Group events into sessions; return last 3 sessions ordered newest-first. */
  private buildSessions(): Map<string, AgentActivityEvent[]> {
    const map = new Map<string, AgentActivityEvent[]>();
    for (const e of this.events) {
      const list = map.get(e.sessionId) ?? [];
      list.push(e);
      map.set(e.sessionId, list);
    }
    // Keep only last 3 sessions
    const sessions = [...map.entries()].slice(-3).reverse();
    return new Map(sessions);
  }

  /** For a session, derive the merged view: one entry per agentId, showing latest type. */
  private buildAgentStates(events: AgentActivityEvent[]): Map<string, AgentActivityEvent> {
    const map = new Map<string, AgentActivityEvent>();
    // Events are chronological; later ones win
    for (const e of events) {
      const existing = map.get(e.agentId);
      if (!existing || e.type === 'complete' || e.type === 'error') {
        map.set(e.agentId, e);
      }
    }
    return map;
  }

  getTreeItem(element: ActivityTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ActivityTreeItem): ActivityTreeItem[] {
    if (!element) {
      const sessions = this.buildSessions();
      if (sessions.size === 0) {
        const empty = new ActivityTreeItem('No agent activity yet', 'session');
        empty.iconPath = new vscode.ThemeIcon('info');
        empty.description = 'Agent spawns will appear here live';
        return [empty];
      }

      return [...sessions.entries()].map(([sessionId, events]) => {
        const states = this.buildAgentStates(events);
        const running = [...states.values()].filter((e) => e.type === 'spawn').length;
        const complete = [...states.values()].filter((e) => e.type === 'complete').length;
        const errored = [...states.values()].filter((e) => e.type === 'error').length;
        const total = states.size;

        const shortId = sessionId.slice(0, 8);
        const item = new ActivityTreeItem(
          `Session ${shortId}`,
          'session',
          vscode.TreeItemCollapsibleState.Expanded,
          sessionId,
        );
        const parts: string[] = [`${total} agent${total !== 1 ? 's' : ''}`];
        if (running > 0) parts.push(`${running} running`);
        if (complete > 0) parts.push(`${complete} done`);
        if (errored > 0) parts.push(`${errored} err`);
        item.description = parts.join(' · ');
        item.iconPath = new vscode.ThemeIcon(
          running > 0 ? 'comment-discussion' : 'check-all',
        );
        return item;
      });
    }

    if (element.kind === 'session' && element.sessionId) {
      const sessions = this.buildSessions();
      const events = sessions.get(element.sessionId) ?? [];
      const states = this.buildAgentStates(events);

      return [...states.values()].map((e) => {
        const isRunning = e.type === 'spawn';
        const isError = e.type === 'error';

        const label = e.subagentType || e.description.slice(0, 40) || e.agentId.slice(0, 8);
        const item = new ActivityTreeItem(label, 'agent', vscode.TreeItemCollapsibleState.None, element.sessionId, e.agentId);

        if (isRunning) {
          item.iconPath = new vscode.ThemeIcon('sync~spin');
          item.description = e.description ? e.description.slice(0, 50) + '…' : 'working…';
        } else if (isError) {
          item.iconPath = new vscode.ThemeIcon('error');
          item.description = 'error' + (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : '');
        } else {
          item.iconPath = new vscode.ThemeIcon('check');
          item.description = e.durationMs !== undefined ? `${e.durationMs}ms` : 'complete';
        }

        if (e.resultSummary) {
          item.tooltip = new vscode.MarkdownString(
            `**${label}** — ${isRunning ? 'running' : isError ? 'error' : 'complete'}\n\n` +
            (e.description ? `*${e.description}*\n\n` : '') +
            (e.resultSummary ? `> ${e.resultSummary}` : ''),
          );
        }

        return item;
      });
    }

    return [];
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
