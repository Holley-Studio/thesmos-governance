/**
 * Autopilot sidebar panel — shows live session state as a TreeView.
 *
 * When a session is active, displays:
 *   ● Session header (branch, tasks complete/total)
 *   └── Task 1: Add widget        ✓ complete
 *   └── Task 2: Wire route        → running   (spin icon)
 *   └── CHECKPOINT                ◆
 *   └── Task 3: Add tests         ○ pending
 *   └── Task 4: Final review      ✗ blocked
 *
 * When no session is active:
 *   (No active autopilot session)
 *   Generate a plan: Prometheus: Generate Autopilot Plan
 */

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AutopilotWatcher, TaskDisplayState } from './autopilotWatcher.js';

// ── Tree item ─────────────────────────────────────────────────────────────────

class AutopilotItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly itemType: 'header' | 'task' | 'empty' | 'action',
    public readonly taskState?: TaskDisplayState,
    collapsible = vscode.TreeItemCollapsibleState.None,
  ) {
    super(label, collapsible);
    this.contextValue = itemType === 'task' ? `autopilotTask.${taskState?.status ?? 'pending'}` : itemType;
  }
}

// ── Icons per status ──────────────────────────────────────────────────────────

const STATUS_ICON: Record<string, vscode.ThemeIcon> = {
  complete: new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')),
  blocked: new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed')),
  timedout: new vscode.ThemeIcon('clock', new vscode.ThemeColor('disabledForeground')),
  running: new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('progressBar.background')),
  pending: new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground')),
  checkpoint: new vscode.ThemeIcon('milestone', new vscode.ThemeColor('charts.blue')),
};

const STATUS_DESCRIPTION: Record<string, string> = {
  complete: 'complete',
  blocked: 'blocked',
  timedout: 'timed out',
  running: 'running…',
  pending: 'pending',
  checkpoint: '',
};

// ── Tree provider ─────────────────────────────────────────────────────────────

export class AutopilotTreeProvider
  implements vscode.TreeDataProvider<AutopilotItem>, vscode.Disposable {

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<AutopilotItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly disposables: vscode.Disposable[] = [this._onDidChangeTreeData];
  private items: AutopilotItem[] = [];

  constructor(
    private readonly workspaceRoot: string,
    watcher: AutopilotWatcher,
  ) {
    const sub = watcher.onDidChange(() => {
      this.rebuild(watcher);
      this._onDidChangeTreeData.fire();
    });
    this.disposables.push(sub);

    // Set context flag for menu visibility
    this.rebuild(watcher);
  }

  private rebuild(watcher: AutopilotWatcher): void {
    const session = watcher.session;

    if (!session) {
      this.items = [
        Object.assign(new AutopilotItem('No active autopilot session', 'empty'), {
          description: 'Run: prometheus autopilot start MASTER_PLAN.md',
        }),
        Object.assign(new AutopilotItem('Generate a plan…', 'action'), {
          iconPath: new vscode.ThemeIcon('wand'),
          command: { command: 'thesmos.autopilot.generate', title: 'Generate Plan' },
        }),
      ];

      void vscode.commands.executeCommand('setContext', 'thesmos.autopilotActive', false);
      return;
    }

    void vscode.commands.executeCommand('setContext', 'thesmos.autopilotActive', true);

    const totalTasks = session.completedTaskIndexes.length
      + session.blockedTasks.length
      + session.timedOutTaskIndexes.length;
    const complete = session.completedTaskIndexes.length;
    const cancelling = watcher.isCancelling;

    // Header item
    const header = new AutopilotItem(
      `${session.planSlug}`,
      'header',
      undefined,
      vscode.TreeItemCollapsibleState.None,
    );
    header.description = cancelling
      ? 'cancelling…'
      : `${complete} / ${totalTasks + (session.blockedTasks.length > 0 ? 0 : 0)} done`;
    header.iconPath = cancelling
      ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('statusBarItem.warningBackground'))
      : new vscode.ThemeIcon('rocket');
    header.tooltip = new vscode.MarkdownString(
      `**Branch:** \`${session.branch}\`  \n` +
      `**Session:** ${session.id}  \n` +
      `**Adapter:** ${session.adapter}  \n` +
      `**Started:** ${session.startedAt}`,
    );
    header.contextValue = 'autopilotHeader';

    // Task items
    let planContent = '';
    const planPath = join(this.workspaceRoot, session.planPath);
    if (existsSync(planPath)) {
      try { planContent = readFileSync(planPath, 'utf8'); } catch { /* ignore */ }
    }

    const taskStates = watcher.buildTaskDisplayStates(planContent);

    const taskItems = taskStates.map((t): AutopilotItem => {
      const item = new AutopilotItem(
        t.isCheckpoint ? '─── CHECKPOINT ───' : `Task ${t.index + 1}: ${t.title}`,
        'task',
        t,
      );
      item.iconPath = STATUS_ICON[t.status] ?? STATUS_ICON['pending'];
      item.description = STATUS_DESCRIPTION[t.status] ?? '';
      if (t.blockReason) {
        item.tooltip = `Blocked: ${t.blockReason}`;
      }
      return item;
    });

    this.items = [header, ...taskItems];
  }

  getTreeItem(element: AutopilotItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AutopilotItem): AutopilotItem[] {
    if (element) return [];
    return this.items;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
