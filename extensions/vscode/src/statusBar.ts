// Copyright (c) 2026 Holley Studios. All rights reserved.
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
  }

  showLoading(): void {
    this.item.text = '$(sync~spin) Thesmos';
    this.item.tooltip = 'Thesmos Governance — analysing…';
    this.item.backgroundColor = undefined;
  }

  showHealth(health: HealthScore, findingCount: number): void {
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

    this.item.tooltip = new vscode.MarkdownString(
      `**Thesmos Governance** — Health Score\n\n` +
        `Grade: **${grade}**   Score: **${score}/100**\n\n` +
        `${issueText}\n\n` +
        `_Click to open health dashboard_`,
    );
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
  }

  showNotInstalled(): void {
    this.item.text = '$(error) Thesmos: not installed';
    this.item.tooltip =
      'thesmos-governance not found — run: npm install --save-dev thesmos-governance';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground',
    );
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
  }

  showTokenCost(sessionCostUSD: number, todayCostUSD: number): void {
    const fmt = (n: number) =>
      n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
    this.tokenItem.text = `$(circuit-board) ${fmt(sessionCostUSD)}`;
    this.tokenItem.tooltip = new vscode.MarkdownString(
      `**Thesmos Token Usage**\n\n` +
      `Session: **${fmt(sessionCostUSD)}**\n\n` +
      `Today: **${fmt(todayCostUSD)}**\n\n` +
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
  }
}
