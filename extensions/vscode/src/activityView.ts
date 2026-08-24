// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Activity view — active autopilot work and Pantheon agent activity in one
 * TreeView (replaces the separate Autopilot and AgentActivity panels).
 *
 * Layout (active items first, completed collapsed):
 *   ● Active
 *   └── Autopilot: 2/5 tasks · branch feat/X   (when a session is running)
 *       └── Task 1: Add widget        ✓ complete
 *       └── Task 2: Wire route        → running
 *       └── Task 3: Add tests         ○ pending
 *   └── $(sync~spin) 👁 Argus — inspecting…    (live agent spawns)
 *   ● Recent
 *   └── $(check) 🦉 Athena — strategy delivered · 1420ms
 *
 * The existing AutopilotWatcher and AgentActivityWatcher fire their own
 * onDidChange events — this provider subscribes to both and re-renders.
 */

import * as vscode from 'vscode';
import type { AutopilotWatcher } from './autopilotWatcher.js';
import type { AgentActivityWatcher, AgentActivityEvent } from './agentActivityPanel.js';

// ── Tree items ─────────────────────────────────────────────────────────────────

type ActivityItemKind =
  | 'sectionActive'
  | 'sectionRecent'
  | 'autopilotHeader'
  | 'autopilotTask'
  | 'agentSpawn'
  | 'agentDone'
  | 'empty';

class ActivityItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly itemKind: ActivityItemKind,
    collapsible = vscode.TreeItemCollapsibleState.None,
    public readonly taskState?: unknown,
    public readonly agentEvent?: AgentActivityEvent,
  ) {
    super(label, collapsible);
    this.contextValue = itemKind;
  }
}

// ── Provider ───────────────────────────────────────────────────────────────────

export class ActivityTreeProvider
  implements vscode.TreeDataProvider<ActivityItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ActivityItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly autopilotWatcher: AutopilotWatcher,
    private readonly activityWatcher: AgentActivityWatcher,
    private readonly workspaceRoot: string,
  ) {
    this.disposables.push(
      autopilotWatcher.onDidChange(() => this._onDidChangeTreeData.fire()),
      activityWatcher.onDidChange(() => this._onDidChangeTreeData.fire()),
    );
  }

  getTreeItem(element: ActivityItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ActivityItem): ActivityItem[] {
    if (!element) {
      return [
        this.makeSection('Active', 'sectionActive'),
        this.makeSection('Recent', 'sectionRecent'),
      ];
    }

    if (element.itemKind === 'sectionActive') {
      return this.buildActiveItems();
    }

    if (element.itemKind === 'sectionRecent') {
      return this.buildRecentItems();
    }

    if (element.itemKind === 'autopilotHeader') {
      return this.buildAutopilotTasks();
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) d.dispose();
  }

  // ── Section builders ────────────────────────────────────────────────────────

  private buildActiveItems(): ActivityItem[] {
    const items: ActivityItem[] = [];

    // Autopilot session (if running)
    const session = this.autopilotWatcher.session;
    if (session) {
      const completed = session.completedTaskIndexes.length;
      const header = new ActivityItem(
        `Autopilot: ${completed} done · ${session.branch}`,
        'autopilotHeader',
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      header.iconPath = new vscode.ThemeIcon('rocket');
      header.tooltip = `Autopilot session · branch ${session.branch}`;
      items.push(header);
    }

    // Running agent spawns
    const events = this.activityWatcher.events;
    const running = events.filter((e) => e.type === 'spawn' && !this.hasDone(events, e.agentId));
    for (const e of running.slice(-10)) {
      const item = new ActivityItem(`${e.godEmoji ?? '$(robot)'} ${e.description}`, 'agentSpawn');
      item.iconPath = new vscode.ThemeIcon('sync~spin');
      item.description = e.progressVerb ?? 'working…';
      items.push(item);
    }

    if (items.length === 0) {
      const empty = new ActivityItem('No active work', 'empty');
      empty.iconPath = new vscode.ThemeIcon('circle-outline');
      items.push(empty);
    }

    return items;
  }

  private buildAutopilotTasks(): ActivityItem[] {
    const session = this.autopilotWatcher.session;
    if (!session) return [];
    const completed = session.completedTaskIndexes.length;
    const blocked = session.blockedTasks.length;
    const info = new ActivityItem(`${completed} tasks complete · ${blocked} blocked`, 'autopilotTask');
    info.iconPath = new vscode.ThemeIcon('info');
    info.tooltip = `Branch: ${session.branch} · Started: ${new Date(session.startedAt).toLocaleTimeString()}`;
    return [info];
  }

  private buildRecentItems(): ActivityItem[] {
    const events = this.activityWatcher.events;
    const done = events
      .filter((e) => e.type === 'complete' || e.type === 'error')
      .slice(-20)
      .reverse();

    if (done.length === 0) {
      const empty = new ActivityItem('No completed agents yet', 'empty');
      empty.iconPath = new vscode.ThemeIcon('history');
      return [empty];
    }

    return done.map((e) => {
      const item = new ActivityItem(
        `${e.godEmoji ?? '$(robot)'} ${e.description}`,
        'agentDone',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        e,
      );
      item.iconPath = e.type === 'error'
        ? new vscode.ThemeIcon('error')
        : new vscode.ThemeIcon('check');
      return item;
    });
  }

  private hasDone(events: AgentActivityEvent[], agentId: string): boolean {
    return events.some((e) => e.agentId === agentId && (e.type === 'complete' || e.type === 'error'));
  }

  private makeSection(label: string, kind: ActivityItemKind): ActivityItem {
    const item = new ActivityItem(label, kind, vscode.TreeItemCollapsibleState.Expanded);
    item.iconPath = kind === 'sectionActive'
      ? new vscode.ThemeIcon('play-circle')
      : new vscode.ThemeIcon('history');
    return item;
  }
}
