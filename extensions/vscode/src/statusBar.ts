// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * StatusBarManager — the single Thesmos/Pantheon status-bar surface.
 *
 * Two items total (down from five):
 *
 *   1. PRIMARY ITEM (left, priority 100) — adaptive Thesmos/Pantheon launcher.
 *      Shows governance health when idle; working state while the gods labour;
 *      approvals/blockers when action is needed; live routing chain while agents run.
 *      Doubles as the Thesmos Chat launcher.
 *
 *   2. USAGE ITEM (left, priority 99) — subscription plan usage from the live
 *      session stream. Shown only when the Thesmos Chat process has returned
 *      at least one rate_limit_event. Hidden otherwise (not unavailability noise).
 *
 * Everything that was previously separate items (tokenItem, pantheonItem,
 * governanceItem, chatItem) is now part of the primary item's tooltip or
 * folded into the adaptive text states.
 *
 * Severity-based background colors are used only for actionable error/warning
 * states — never decoratively.
 */

import * as vscode from 'vscode';
import type { HealthScore } from './types.js';
import type { SubscriptionUsageSnapshot } from './usage/subscriptionUsage.js';
import {
  formatStatusBarUsage,
  describeWindow,
  snapshotSeverity,
  relativeReset,
  DEFAULT_THRESHOLDS,
  type UsageThresholds,
} from './usage/usageDisplay.js';

export class StatusBarManager implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly usageItem: vscode.StatusBarItem;

  /** Last idle (non-working) main-item state, for restoring after work completes. */
  private idleSnapshot:
    | { text: string; tooltip: string | vscode.MarkdownString; bg: vscode.ThemeColor | undefined; command: string | undefined }
    | undefined;

  /** Most recent cost values for the tooltip. */
  private lastSessionCostUsd = 0;
  private lastMonthSavedUsd = 0;

  /** Most recent governance state for the tooltip. */
  private lastGovernanceState: 'governed' | 'ungoverned' | 'none' = 'none';

  /** Most recent routing mode for the tooltip. */
  private lastRoutingMode: 'auto' | 'confirm' | 'off' = 'auto';

  /** Whether a [1m] context window is currently flagged. */
  private last1MSource: string | null = null;

  /** Current usage thresholds from settings. */
  private thresholds: UsageThresholds = DEFAULT_THRESHOLDS;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.item.command = 'thesmos.pantheon.chat.openInTab';
    this.item.tooltip = 'Thesmos Governance — open Thesmos Chat';
    this.showInactive();
    this.item.show();

    this.usageItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99,
    );
    this.usageItem.command = 'thesmos.commandCenter';
    this.usageItem.hide();
  }

  /** Update usage thresholds from settings. */
  setThresholds(warning: number, critical: number): void {
    this.thresholds = { warning, critical };
  }

  // ── Primary item states ──────────────────────────────────────────────────────

  showLoading(): void {
    this.item.text = '$(sync~spin) Thesmos';
    this.item.tooltip = 'Thesmos Governance — analysing…';
    this.item.backgroundColor = undefined;
    this.item.command = 'thesmos.health';
  }

  /** Working state driven by WorkingStateManager. Label already contains the spinner. */
  showWorking(label: string): void {
    this.item.text = label;
    this.item.tooltip = this.buildTooltip('Thesmos is working — the gods are at their labours.');
    this.item.backgroundColor = undefined;
    this.item.command = 'thesmos.health';
  }

  /** Restore the idle state that was active before work began. */
  restoreIdle(): void {
    if (!this.idleSnapshot) {
      this.showInactive();
      return;
    }
    this.item.text = this.idleSnapshot.text;
    this.item.tooltip = this.idleSnapshot.tooltip;
    this.item.backgroundColor = this.idleSnapshot.bg;
    this.item.command = this.idleSnapshot.command ?? 'thesmos.pantheon.chat.openInTab';
  }

  showHealth(health: HealthScore, findingCount: number, baselinedCount = 0): void {
    const { score, grade } = health;
    let bg: vscode.ThemeColor | undefined;

    if (grade === 'A+' || grade === 'A') {
      this.item.text = `$(shield) ${grade}  ${score}`;
      bg = undefined;
    } else if (grade === 'B' || grade === 'C') {
      this.item.text = `$(warning) ${grade}  ${score}`;
      bg = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(error) ${grade}  ${score}`;
      bg = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
    this.item.backgroundColor = bg;

    const issueText = findingCount === 0
      ? 'No findings'
      : `${findingCount} finding${findingCount === 1 ? '' : 's'}`;
    const baselineLine = baselinedCount > 0
      ? `\n\n${baselinedCount} accepted finding${baselinedCount === 1 ? '' : 's'} in baseline`
      : '';

    const tip = new vscode.MarkdownString(
      `**Thesmos Governance** — Health Score\n\n` +
      `Grade: **${grade}**   Score: **${score}/100**\n\n` +
      `${issueText}${baselineLine}\n\n` +
      this.tooltipExtras() +
      `_Click to open Thesmos Chat_`,
    );
    this.item.tooltip = tip;
    this.item.command = 'thesmos.pantheon.chat.openInTab';
    this.snapshotIdle();
  }

  /** Live routing chain while Pantheon agents run. */
  showAgentRouting(chain: string): void {
    this.item.text = `$(sync~spin) ${chain}`;
    this.item.tooltip = new vscode.MarkdownString(
      `**Thesmos Pantheon — routing in progress**\n\n${chain}\n\n_Gods are at work. Results land in the Activity view._`,
    );
    this.item.backgroundColor = undefined;
    this.item.command = 'thesmos.pantheon.chat.openInTab';
  }

  showScanNeeded(): void {
    this.item.text = '$(warning) Thesmos: scan needed';
    this.item.tooltip = 'Thesmos Governance — run "Thesmos: Scan Repository" to start';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.command = 'thesmos.scan';
    this.snapshotIdle();
  }

  showNotInstalled(): void {
    this.item.text = '$(cloud-download) Set Up Thesmos';
    this.item.tooltip = 'thesmos-governance not installed — click to install and initialise';
    this.item.command = 'thesmos.setup';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
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
      : 'Autopilot running — click to cancel';
  }

  clearAutopilotSession(): void {
    this.item.command = 'thesmos.pantheon.chat.openInTab';
    this.item.backgroundColor = undefined;
  }

  showInactive(): void {
    this.item.text = '$(sparkle) Pantheon';
    this.item.tooltip = this.buildTooltip('Thesmos Governance — open Thesmos Chat');
    this.item.command = 'thesmos.pantheon.chat.openInTab';
    this.item.backgroundColor = undefined;
    this.snapshotIdle();
  }

  // ── Governance state (folded into tooltip) ───────────────────────────────────

  showGoverningAutoMode(): void {
    this.lastGovernanceState = 'governed';
    this.refreshTooltip();
  }

  showAutoModeUngoverned(): void {
    this.lastGovernanceState = 'ungoverned';
    this.refreshTooltip();
  }

  clearGoverningAutoMode(): void {
    this.lastGovernanceState = 'none';
    this.refreshTooltip();
  }

  // ── Routing mode / 1M badge (folded into primary item state) ─────────────────

  showRoutingMode(mode: 'confirm' | 'off'): void {
    this.lastRoutingMode = mode;
    const icon = mode === 'confirm' ? '$(comment-discussion)' : '$(circle-slash)';
    const modeLabel = mode === 'confirm' ? 'confirm' : 'off';
    this.item.text = `${icon} Pantheon: ${modeLabel}`;
    this.item.tooltip = new vscode.MarkdownString(
      mode === 'confirm'
        ? '**Pantheon routing: confirm** — Zeus announces every route and waits for your go-ahead.\n\n_Click to open command center_'
        : '**Pantheon routing: off** — agents run only when you name them explicitly.\n\n_Click to open command center_',
    );
    this.item.backgroundColor = undefined;
    this.item.command = 'thesmos.commandCenter';
    this.snapshotIdle();
  }

  clearPantheonBadge(): void {
    this.lastRoutingMode = 'auto';
    // Restore the default Pantheon launcher state; snapshotIdle sets the fallback.
    this.showInactive();
  }

  show1MContextBadge(source: string): void {
    this.last1MSource = source;
    this.item.text = '$(warning) 1M ctx';
    this.item.tooltip = new vscode.MarkdownString(
      `**1M context window active** (${source})\n\n` +
      'Long-context requests bill at premium rates. Switch to the plain model ID, ' +
      'or deliberately enable via `context1M.allow1M` in .thesmos/config.json.\n\n' +
      '_Click to open command center_',
    );
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.command = 'thesmos.commandCenter';
  }

  // ── Cost meter (folded into tooltip) ─────────────────────────────────────────

  showTokenCost(sessionCostUSD: number, _todayCostUSD: number, monthSavedUSD = 0): void {
    this.lastSessionCostUsd = sessionCostUSD;
    this.lastMonthSavedUsd = monthSavedUSD;
    this.refreshTooltip();
  }

  clearTokenMeter(): void {
    this.lastSessionCostUsd = 0;
    this.lastMonthSavedUsd = 0;
    this.refreshTooltip();
  }

  // ── Subscription plan usage item ─────────────────────────────────────────────

  /**
   * Update the plan-usage item from a SubscriptionUsageProvider snapshot.
   * Shown only when at least one window has authoritative non-stale data.
   * The usage item never shows an invented percentage — see subscriptionUsage.ts.
   */
  showUsage(snapshot: SubscriptionUsageSnapshot): void {
    const now = new Date();
    const compactText = formatStatusBarUsage(snapshot, now);
    if (!compactText) {
      this.usageItem.hide();
      return;
    }

    const severity = snapshotSeverity(snapshot, this.thresholds);
    const icon = severity === 'critical'
      ? '$(error)'
      : severity === 'warning'
        ? '$(warning)'
        : '$(pulse)';
    this.usageItem.text = `${icon} ${compactText}`;
    this.usageItem.backgroundColor =
      severity === 'critical'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : severity === 'warning'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;

    // Build an honest tooltip: show what we know and clearly label what we don't.
    const lines: string[] = ['**Claude Plan Usage**\n'];
    for (const id of ['five_hour', 'seven_day'] as const) {
      const w = snapshot.windows[id];
      lines.push(describeWindow(w, now));
      if (w.available && w.resetsAt) {
        const rel = relativeReset(w.resetsAt, now);
        if (rel) lines.push(`  ↻ resets in ${rel}`);
      }
    }
    lines.push('');
    lines.push('_Source: live session stream · percentage not reported by headless CLI_');
    this.usageItem.tooltip = new vscode.MarkdownString(lines.join('\n'));
    this.usageItem.show();
  }

  clearUsage(): void {
    this.usageItem.hide();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  hide(): void { this.item.hide(); this.usageItem.hide(); }
  show(): void { this.item.show(); }

  dispose(): void {
    this.item.dispose();
    this.usageItem.dispose();
  }

  private snapshotIdle(): void {
    this.idleSnapshot = {
      text: this.item.text,
      tooltip: this.item.tooltip ?? '',
      bg: this.item.backgroundColor as vscode.ThemeColor | undefined,
      command: typeof this.item.command === 'string' ? this.item.command : undefined,
    };
  }

  private refreshTooltip(): void {
    if (this.idleSnapshot) {
      // Re-build the tooltip in-place without changing visible text or state.
      const tip = this.buildTooltip(this.currentMainDescription());
      this.idleSnapshot.tooltip = tip;
      this.item.tooltip = tip;
    }
  }

  private currentMainDescription(): string {
    const base = '**$(sparkle) Thesmos Governance**\n\nOpen Thesmos Chat';
    return base;
  }

  private tooltipExtras(): string {
    const lines: string[] = [];
    if (this.lastSessionCostUsd > 0) {
      const fmt = (n: number) => n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
      lines.push(`Session cost: **${fmt(this.lastSessionCostUsd)}**`);
      if (this.lastMonthSavedUsd > 0) {
        lines.push(`Saved this month: **~$${this.lastMonthSavedUsd.toFixed(2)}** _(estimated vs flagship)_`);
      }
    }
    if (this.lastGovernanceState === 'governed') {
      lines.push('$(eye) **Governing Auto Mode** — PreToolUse hooks active');
    } else if (this.lastGovernanceState === 'ungoverned') {
      lines.push('$(warning) **Auto Mode detected** — governance hooks not installed');
    }
    if (this.lastRoutingMode !== 'auto') {
      lines.push(`Routing mode: **${this.lastRoutingMode}**`);
    }
    if (this.last1MSource) {
      lines.push(`$(warning) 1M context active in \`${this.last1MSource}\``);
    }
    return lines.length > 0 ? lines.join('\n\n') + '\n\n' : '';
  }

  private buildTooltip(headline: string): vscode.MarkdownString {
    return new vscode.MarkdownString(headline + '\n\n' + this.tooltipExtras());
  }
}
