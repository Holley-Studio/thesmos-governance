// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * StatusBarManager — shows governance health in the VS Code status bar.
 *
 * States:
 *   loading  → $(sync~spin) Thesmos: analysing…
 *   healthy  → $(shield) A+  96         (no background)
 *   warning  → $(warning) B  72         (warningBackground)
 *   error    → $(error) 3 issues        (errorBackground)
 *   inactive → $(shield) Thesmos        (no background, no score)
 *   missing  → $(warning) Thesmos: scan needed
 */

import * as vscode from 'vscode';
import type { HealthScore } from './types.js';

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly governanceItem: vscode.StatusBarItem;
  private readonly tokenItem: vscode.StatusBarItem;
  private readonly pantheonItem: vscode.StatusBarItem;

  /** Last idle (non-working) main-item state, restored when work completes. */
  private idleSnapshot: { text: string; tooltip: string | vscode.MarkdownString; bg: vscode.ThemeColor | undefined } | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.command = 'thesmos.health';
    this.item.tooltip = 'Thesmos Governance — click to view health score';
    this.showInactive();
    this.item.show();

    this.governanceItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99,
    );
    this.governanceItem.command = 'thesmos.governance.status';
    this.governanceItem.hide();

    this.tokenItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98,
    );
    this.tokenItem.command = 'thesmos.tokens.report';
    this.tokenItem.tooltip = 'Thesmos token usage — click for full report';
    this.tokenItem.hide();

    this.pantheonItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      97,
    );
    this.pantheonItem.command = 'thesmos.pantheon.routingMode';
    this.pantheonItem.hide();
  }

  /** Routing-mode indicator — shown only when routing is not the default 'auto'. */
  showRoutingMode(mode: 'confirm' | 'off'): void {
    this.pantheonItem.text = mode === 'confirm'
      ? '$(comment-discussion) Pantheon: confirm'
      : '$(circle-slash) Pantheon: off';
    this.pantheonItem.tooltip = new vscode.MarkdownString(
      mode === 'confirm'
        ? '**Pantheon routing: confirm** — Zeus announces every route and waits for your go-ahead.\n\n_Click to change routing mode_'
        : '**Pantheon routing: off** — agents run only when you name them explicitly.\n\n_Click to change routing mode_',
    );
    this.pantheonItem.backgroundColor = undefined;
    this.pantheonItem.show();
  }

  /** 1M context window warning — visible whenever a [1m] model variant is active. */
  show1MContextBadge(source: string): void {
    this.pantheonItem.text = '$(warning) 1M ctx';
    this.pantheonItem.tooltip = new vscode.MarkdownString(
      `**1M context window active** (${source})\n\n` +
      'Long-context requests bill at premium rates. Switch to the plain model ID, ' +
      'or deliberately enable via `context1M.allow1M` in .thesmos/config.json.\n\n' +
      '_Click to review routing & context settings_',
    );
    this.pantheonItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.pantheonItem.show();
  }

  clearPantheonBadge(): void {
    this.pantheonItem.hide();
  }

  showLoading(): void {
    this.item.text = '$(sync~spin) Thesmos';
    this.item.tooltip = 'Thesmos Governance — analysing…';
    this.item.backgroundColor = undefined;
  }

  private snapshotIdle(): void {
    this.idleSnapshot = {
      text: this.item.text,
      tooltip: this.item.tooltip ?? '',
      bg: this.item.backgroundColor as vscode.ThemeColor | undefined,
    };
  }

  /** Working state — driven by WorkingStateManager. Label already contains the spinner codicon. */
  showWorking(label: string): void {
    this.item.text = label;
    this.item.tooltip = 'Thesmos is working — the gods are at their labors.';
    this.item.backgroundColor = undefined;
  }

  /** Restore whatever idle state was showing before work began. */
  restoreIdle(): void {
    if (!this.idleSnapshot) {
      this.showInactive();
      return;
    }
    this.item.text = this.idleSnapshot.text;
    this.item.tooltip = this.idleSnapshot.tooltip;
    this.item.backgroundColor = this.idleSnapshot.bg;
  }

  showHealth(health: HealthScore, findingCount: number, baselinedCount = 0): void {
    const { score, grade } = health;

    if (grade === 'A+' || grade === 'A') {
      this.item.text = `$(shield) ${grade}  ${score}`;
      this.item.backgroundColor = undefined;
    } else if (grade === 'B' || grade === 'C') {
      this.item.text = `$(warning) ${grade}  ${score}`;
      this.item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground',
      );
    } else {
      this.item.text = `$(error) ${grade}  ${score}`;
      this.item.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.errorBackground',
      );
    }

    const issueText =
      findingCount === 0
        ? 'No findings'
        : `${findingCount} finding${findingCount === 1 ? '' : 's'}`;

    // Subtle, non-nagging line — accepted debt is informational, not a badge.
    const baselineLine =
      baselinedCount > 0
        ? `\n\n${baselinedCount} accepted finding${baselinedCount === 1 ? '' : 's'} in baseline`
        : '';

    this.item.tooltip = new vscode.MarkdownString(
      `**Thesmos Governance** — Health Score\n\n` +
        `Grade: **${grade}**   Score: **${score}/100**\n\n` +
        `${issueText}${baselineLine}\n\n` +
        `_Click to open health dashboard_`,
    );
    this.snapshotIdle();
  }

  /**
   * Live Pantheon routing chain while god agents run:
   *   ⚡ Zeus → 👁 Argus
   *   ⚡ Zeus → 👁 Argus + 🦉 Athena
   */
  showAgentRouting(chain: string): void {
    this.item.text = `$(sync~spin) ${chain}`;
    this.item.tooltip = new vscode.MarkdownString(
      `**Thesmos Pantheon — routing in progress**\n\n${chain}\n\n_Gods are at work. Results land in the Agent Activity panel._`,
    );
    this.item.backgroundColor = undefined;
  }

  showScanNeeded(): void {
    this.item.text = '$(warning) Thesmos: scan needed';
    this.item.tooltip =
      'Thesmos Governance — run "Thesmos: Scan Repository" to start';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground',
    );
    this.snapshotIdle();
  }

  showNotInstalled(): void {
    this.item.text = '$(error) Thesmos: not installed';
    this.item.tooltip =
      'thesmos-governance not found — run: npm install --save-dev thesmos-governance';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground',
    );
    this.snapshotIdle();
  }

  showAutopilotSession(taskLabel: string, cancelling: boolean): void {
    if (cancelling) {
      this.item.text = `$(stop-circle) Autopilot: cancelling…`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(sync~spin) Autopilot: ${taskLabel}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    }
    this.item.command = 'thesmos.autopilot.cancel';
    this.item.tooltip = cancelling
      ? 'Autopilot cancelling — click to view session'
      : `Autopilot running — click to cancel`;
  }

  clearAutopilotSession(): void {
    this.item.command = 'thesmos.health';
    this.item.tooltip = 'Thesmos Governance — click to view health score';
    this.item.backgroundColor = undefined;
  }

  showGoverningAutoMode(): void {
    this.governanceItem.text = '$(eye) Governing Auto Mode';
    this.governanceItem.tooltip = new vscode.MarkdownString(
      '**Thesmos is governing this Auto Mode session**\n\n' +
      'PreToolUse hooks block violations before every Write, Edit, and Bash.\n\n' +
      '_Click to view governance status_',
    );
    this.governanceItem.backgroundColor = undefined;
    this.governanceItem.show();
  }

  showAutoModeUngoverned(): void {
    this.governanceItem.text = '$(warning) Auto Mode: no governance';
    this.governanceItem.tooltip = new vscode.MarkdownString(
      '**Auto Mode detected but governance hooks are not installed**\n\n' +
      'Run `thesmos claude:govern install` to protect this session.\n\n' +
      '_Click to install hooks_',
    );
    this.governanceItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.governanceItem.command = 'thesmos.governance.install';
    this.governanceItem.show();
  }

  clearGoverningAutoMode(): void {
    this.governanceItem.hide();
  }

  showInactive(): void {
    this.item.text = '$(shield) Thesmos';
    this.item.tooltip = 'Thesmos Governance';
    this.item.backgroundColor = undefined;
    this.snapshotIdle();
  }

  showTokenCost(sessionCostUSD: number, todayCostUSD: number, monthSavedUSD = 0): void {
    const fmt = (n: number) =>
      n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
    this.tokenItem.text = `$(circuit-board) ${fmt(sessionCostUSD)}`;
    this.tokenItem.tooltip = new vscode.MarkdownString(
      `**Thesmos Token Usage**\n\n` +
      `Session: **${fmt(sessionCostUSD)}**\n\n` +
      `Today: **${fmt(todayCostUSD)}**\n\n` +
      (monthSavedUSD > 0 ? `⚖ Saved this month: **~$${monthSavedUSD.toFixed(2)}** _(estimated vs flagship baseline)_\n\n` : '') +
      `_Click for full report_`,
    );
    this.tokenItem.show();
  }

  clearTokenMeter(): void {
    this.tokenItem.hide();
  }

  hide(): void {
    this.item.hide();
  }

  show(): void {
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
    this.governanceItem.dispose();
    this.tokenItem.dispose();
    this.pantheonItem.dispose();
  }
}
