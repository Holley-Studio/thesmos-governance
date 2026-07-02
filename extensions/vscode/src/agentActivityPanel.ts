// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent Activity sidebar panel — live timeline of Pantheon agent spawns and
 * completions. Reads `.thesmos/agent-activity.jsonl` via FileSystemWatcher,
 * mirrors the AutopilotWatcher + AutopilotTreeProvider pattern exactly.
 *
 * Three-level hierarchy — the gods report to Zeus:
 *   ● Session abc123 · 3 agents · 2 done · 1 running
 *   └── ⚡ Zeus Routing · 2 dispatched
 *        └── $(sync~spin) 👁 Argus — inspecting the perimeter…
 *        └── $(check) 🦉 Athena — strategy delivered · 1420ms
 *   └── $(check) Explore · 880ms          ← utility agents render outside Zeus
 */

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Event type (mirrors .claude/hooks/agent-activity.cjs) ─────────────────────

export interface AgentActivityEvent {
  ts: string;
  type: 'spawn' | 'complete' | 'error' | 'route';
  sessionId: string;
  agentId: string;
  parentId?: string;
  godEmoji?: string;
  progressVerb?: string;
  pantheon?: boolean;
  description: string;
  subagentType: string;
  durationMs?: number;
  resultSummary?: string;
}

/** A god spinning longer than this is presumed lost — render as timed out. */
const STALE_RUNNING_MS = 10 * 60 * 1000;

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

// ── Routing chain (for the status bar) ────────────────────────────────────────

/**
 * Chain of currently-running pantheon gods: "⚡ Zeus → 👁 Argus + 🦉 Athena".
 * Empty string when nothing pantheon is running (or everything is stale).
 */
export function buildRoutingChain(events: AgentActivityEvent[]): string {
  const states = new Map<string, AgentActivityEvent>();
  for (const e of events) {
    if (e.type === 'route') continue;
    const existing = states.get(e.agentId);
    if (!existing || e.type === 'complete' || e.type === 'error') {
      states.set(e.agentId, e);
    }
  }
  const now = Date.now();
  const running = [...states.values()].filter(
    (e) =>
      e.type === 'spawn' &&
      e.pantheon === true &&
      now - new Date(e.ts).getTime() < STALE_RUNNING_MS,
  );
  if (running.length === 0) return '';
  const gods = running
    .map((e) => `${e.godEmoji ?? '🔮'} ${godLabel(e.subagentType)}`)
    .join(' + ');
  return `⚡ Zeus → ${gods}`;
}

/** "Argus — Security Agent" → "Argus" */
function godLabel(subagentType: string): string {
  return subagentType.split(/[—–]/)[0].trim() || subagentType;
}

// ── Tree items ────────────────────────────────────────────────────────────────

type ActivityItemKind = 'session' | 'zeus' | 'agent';

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
  private staleTimer: ReturnType<typeof setInterval> | undefined;

  constructor(watcher: AgentActivityWatcher) {
    this.events = watcher.events;
    this.disposables.push(
      watcher.onDidChange((events) => {
        this.events = events;
        this._onDidChangeTreeData.fire();
        this.syncStaleTimer();
      }),
    );
    this.syncStaleTimer();
  }

  /**
   * Staleness is time-based, but the tree only re-renders on new events —
   * a god whose completion never arrives would spin forever. While anything
   * is running, re-render every 60s so the "timed out?" state actually shows.
   */
  private syncStaleTimer(): void {
    const anyRunning = this.events.some((e) => e.type === 'spawn');
    if (anyRunning && this.staleTimer === undefined) {
      this.staleTimer = setInterval(() => this._onDidChangeTreeData.fire(), 60_000);
    } else if (!anyRunning && this.staleTimer !== undefined) {
      clearInterval(this.staleTimer);
      this.staleTimer = undefined;
    }
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
      if (e.type === 'route') continue;
      const existing = map.get(e.agentId);
      if (!existing || e.type === 'complete' || e.type === 'error') {
        map.set(e.agentId, e);
      }
    }
    return map;
  }

  private zeusEventFor(events: AgentActivityEvent[]): AgentActivityEvent | undefined {
    return events.find((e) => e.type === 'route');
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
      const zeus = this.zeusEventFor(events);

      const items: ActivityTreeItem[] = [];

      if (zeus) {
        const godCount = [...states.values()].filter((e) => e.pantheon === true).length;
        const zeusItem = new ActivityTreeItem(
          '⚡ Zeus Routing',
          'zeus',
          vscode.TreeItemCollapsibleState.Expanded,
          element.sessionId,
          zeus.agentId,
        );
        zeusItem.description = `${godCount} dispatched`;
        zeusItem.iconPath = new vscode.ThemeIcon('zap');
        items.push(zeusItem);
      }

      // Non-pantheon (utility) agents render flat under the session — they are
      // not gods and must not appear under Zeus. Legacy events without the
      // pantheon flag also land here when no Zeus route event exists.
      const flat = [...states.values()].filter(
        (e) => e.pantheon !== true || !zeus,
      );
      for (const e of flat) items.push(this.toAgentItem(e, element.sessionId));

      return items;
    }

    if (element.kind === 'zeus' && element.sessionId) {
      const sessions = this.buildSessions();
      const events = sessions.get(element.sessionId) ?? [];
      const states = this.buildAgentStates(events);
      return [...states.values()]
        .filter((e) => e.pantheon === true)
        .map((e) => this.toAgentItem(e, element.sessionId));
    }

    return [];
  }

  private toAgentItem(e: AgentActivityEvent, sessionId?: string): ActivityTreeItem {
    const isError = e.type === 'error';
    const ageMs = Date.now() - new Date(e.ts).getTime();
    const isStale = e.type === 'spawn' && ageMs > STALE_RUNNING_MS;
    const isRunning = e.type === 'spawn' && !isStale;

    const name = godLabel(e.subagentType) || e.description.slice(0, 40) || e.agentId.slice(0, 8);
    const label = e.godEmoji ? `${e.godEmoji} ${name}` : name;
    const item = new ActivityTreeItem(label, 'agent', vscode.TreeItemCollapsibleState.None, sessionId, e.agentId);

    if (isRunning) {
      item.iconPath = new vscode.ThemeIcon('sync~spin');
      item.description = e.progressVerb
        ? `${e.progressVerb}…`
        : e.description
          ? e.description.slice(0, 50) + '…'
          : 'working…';
    } else if (isStale) {
      item.iconPath = new vscode.ThemeIcon('circle-slash');
      item.description = 'timed out?';
    } else if (isError) {
      item.iconPath = new vscode.ThemeIcon('error');
      item.description = 'error' + (e.durationMs !== undefined ? ` · ${e.durationMs}ms` : '');
    } else {
      item.iconPath = new vscode.ThemeIcon('check');
      item.description = e.durationMs !== undefined ? `${e.durationMs}ms` : 'complete';
    }

    if (e.resultSummary || e.description) {
      item.tooltip = new vscode.MarkdownString(
        `**${label}** — ${isRunning ? 'running' : isStale ? 'timed out?' : isError ? 'error' : 'complete'}\n\n` +
        (e.description ? `*${e.description}*\n\n` : '') +
        (e.resultSummary ? `> ${e.resultSummary}` : ''),
      );
    }

    return item;
  }

  dispose(): void {
    if (this.staleTimer !== undefined) clearInterval(this.staleTimer);
    for (const d of this.disposables) d.dispose();
  }
}
