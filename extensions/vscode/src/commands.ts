/**
 * Command registrations for the Prometheus Governance extension.
 *
 * All commands are registered here and exposed as a Disposable so the
 * extension can cleanly tear them down on deactivation.
 *
 * Commands:
 *   prometheus.scan          — run `prometheus scan`, then refresh all findings
 *   prometheus.reviewFile    — review the currently open file
 *   prometheus.health        — open the health dashboard webview
 *   prometheus.adapters      — regenerate all AI adapter files
 *   prometheus.openConfig    — open .prometheus/config.json in the editor
 *   prometheus.refreshFindings — re-run full review and refresh the tree
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync, writeFileSync } from 'node:fs';

import {
  runScan,
  runHealth,
  runAdapters,
  runPrometheus,
  PrometheusNotFoundError,
  PrometheusReportMissingError,
} from './runner.js';
import { HealthPanel } from './panel.js';
import type { ExtensionConfig } from './types.js';
import type { AutopilotWatcher } from './autopilotWatcher.js';

// ── Callback types (supplied by extension.ts) ─────────────────────────────────

export type RefreshCallback = () => Promise<void>;
export type ReviewFileCallback = (uri: vscode.Uri) => Promise<void>;
export type GetAutopilotWatcher = () => AutopilotWatcher;

// ── Helper ────────────────────────────────────────────────────────────────────

function handleError(err: unknown): void {
  if (err instanceof PrometheusNotFoundError) {
    void vscode.window.showErrorMessage(
      `Prometheus Governance: ${err.message}`,
      'Install now',
    ).then((choice) => {
      if (choice === 'Install now') {
        const terminal = vscode.window.createTerminal('Prometheus');
        terminal.sendText('npm install --save-dev prometheus-governance');
        terminal.show();
      }
    });
    return;
  }

  if (err instanceof PrometheusReportMissingError) {
    void vscode.window.showWarningMessage(
      `Prometheus Governance: ${err.message}`,
      'Scan now',
    ).then((choice) => {
      if (choice === 'Scan now') {
        void vscode.commands.executeCommand('prometheus.scan');
      }
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(`Prometheus Governance: ${message}`);
}

// ── Command factory ───────────────────────────────────────────────────────────

export function registerCommands(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  getConfig: () => ExtensionConfig,
  onRefresh: RefreshCallback,
  onReviewFile: ReviewFileCallback,
  getAutopilotWatcher: GetAutopilotWatcher,
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];

  // ── prometheus.scan ────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.scan', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Scanning repository…',
          cancellable: false,
        },
        async () => {
          try {
            await runScan(workspaceRoot, cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Prometheus: Scan complete. Refreshing findings…',
            );
            await onRefresh();
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.reviewFile ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.reviewFile', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) {
        void vscode.window.showWarningMessage(
          'Prometheus: No active file to review.',
        );
        return;
      }

      try {
        await onReviewFile(doc.uri);
        void vscode.window.showInformationMessage(
          `Prometheus: Review complete for ${doc.fileName.split('/').pop()}`,
        );
      } catch (err) {
        handleError(err);
      }
    }),
  );

  // ── prometheus.health ──────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.health', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Loading health score…',
          cancellable: false,
        },
        async () => {
          try {
            const health = await runHealth(
              workspaceRoot,
              cfg.binaryPath || undefined,
            );
            HealthPanel.show(context.extensionUri, health);
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.adapters ────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.adapters', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Regenerating AI adapters…',
          cancellable: false,
        },
        async () => {
          try {
            await runAdapters(workspaceRoot, cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Prometheus: AI adapter files updated (CLAUDE.md, GEMINI.md, .cursor/rules, …)',
            );
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.openConfig ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.openConfig', async () => {
      const configPath = join(workspaceRoot, '.prometheus', 'config.json');
      if (!existsSync(configPath)) {
        void vscode.window.showWarningMessage(
          'Prometheus: .prometheus/config.json not found. Run "Prometheus: Scan Repository" first.',
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(configPath),
      );
      await vscode.window.showTextDocument(doc);
    }),
  );

  // ── prometheus.refreshFindings ─────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.refreshFindings', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      try {
        await onRefresh();
      } catch (err) {
        handleError(err);
      }
    }),
  );

  // ── prometheus.autopilot.generate ──────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.autopilot.generate', async () => {
      const goal = await vscode.window.showInputBox({
        prompt: 'Describe what you want to build',
        placeHolder: 'e.g. add Stripe checkout to the Express app',
        ignoreFocusOut: true,
      });
      if (!goal) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus Autopilot',
        cwd: workspaceRoot,
      });
      terminal.sendText(`prometheus autopilot generate "${goal.replace(/"/g, '\\"')}"`);
      terminal.show();

      void vscode.window.showInformationMessage(
        'Prometheus Autopilot: Generating plan in terminal. Answer the clarifying questions, then validate with: prometheus autopilot validate MASTER_PLAN.md',
      );
    }),
  );

  // ── prometheus.autopilot.cancel ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.autopilot.cancel', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Prometheus Autopilot: No active session to cancel.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Cancel autopilot session "${session.planSlug}"? The current task will complete before stopping.`,
        { modal: true },
        'Cancel Session',
      );
      if (confirm !== 'Cancel Session') return;

      // Create the cancel sentinel file
      const cancelPath = join(workspaceRoot, '.prometheus', 'autopilot', '.cancel');
      try {
        writeFileSync(cancelPath, '', 'utf8');
        void vscode.window.showInformationMessage(
          'Prometheus Autopilot: Cancel signal sent. Session will stop after the current task.',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Prometheus Autopilot: Could not create cancel sentinel: ${msg}`);
      }
    }),
  );

  // ── prometheus.autopilot.review ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.autopilot.review', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage(
          'Prometheus Autopilot: No active session. Provide a session ID in the terminal: prometheus autopilot review <id>',
        );
        return;
      }

      const cfg = vscode.workspace.getConfiguration('prometheus');
      const baseBranch = cfg.get<string>('autopilot.baseBranch', 'main');

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus Review',
        cwd: workspaceRoot,
      });
      terminal.sendText(`prometheus autopilot review ${session.id} --base=${baseBranch}`);
      terminal.show();
    }),
  );

  // ── prometheus.autopilot.openPR ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.autopilot.openPR', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Prometheus Autopilot: No active session.');
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus PR',
        cwd: workspaceRoot,
      });
      terminal.sendText(`prometheus autopilot open-pr ${session.id}`);
      terminal.show();
    }),
  );

  // ── prometheus.autopilot.viewJournal ──────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.autopilot.viewJournal', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Prometheus Autopilot: No active session.');
        return;
      }

      if (!existsSync(session.journalPath)) {
        void vscode.window.showWarningMessage(
          `Prometheus Autopilot: Journal not found at ${session.journalPath}`,
        );
        return;
      }

      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(session.journalPath),
      );
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
  );

  // ── prometheus.autopilot.revert ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.autopilot.revert', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Prometheus Autopilot: No active session to revert.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Revert session "${session.planSlug}"? This deletes branch "${session.branch}" and cannot be undone.`,
        { modal: true },
        'Revert and Delete Branch',
      );
      if (confirm !== 'Revert and Delete Branch') return;

      try {
        await runPrometheus(workspaceRoot, ['autopilot', 'revert', session.id]);
        void vscode.window.showInformationMessage(
          `Prometheus Autopilot: Session reverted. Branch "${session.branch}" deleted. main is unchanged.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Prometheus Autopilot: Revert failed: ${msg}`);
      }
    }),
  );

  // ── prometheus.importScan ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.importScan', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Import Scan',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus import:scan');
      terminal.show();
    }),
  );

  // ── prometheus.debtScan ────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.debtScan', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Debt Scan',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus debt:scan');
      terminal.show();
    }),
  );

  // ── prometheus.contextSnapshot ─────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.contextSnapshot', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Snapshotting project context…',
          cancellable: false,
        },
        async () => {
          try {
            await runPrometheus(workspaceRoot, ['context:snapshot'], cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Prometheus: Context snapshot written to .prometheus/context.md',
            );
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.contextHealth ───────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.contextHealth', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Checking context health…',
          cancellable: false,
        },
        async () => {
          try {
            const out = await runPrometheus(
              workspaceRoot,
              ['context:health'],
              cfg.binaryPath || undefined,
            );
            // First non-empty line contains the score summary
            const summary = out.split('\n').find((l) => l.trim().startsWith('Context Health:')) ?? out.trim();
            void vscode.window.showInformationMessage(`Prometheus: ${summary.trim()}`);
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── prometheus.scopeInit ───────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.scopeInit', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Scope Init',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus scope:init');
      terminal.show();
    }),
  );

  // ── prometheus.scopeStatus ─────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.scopeStatus', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Scope Status',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus scope:status');
      terminal.show();
    }),
  );

  // ── prometheus.scopeCheck ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.scopeCheck', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const target = await vscode.window.showInputBox({
        prompt: 'Enter a file path or shell command to check against scope',
        placeHolder: 'e.g.  src/api/users.ts  or  rm -rf ./dist',
        ignoreFocusOut: true,
      });
      if (!target) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Scope Check',
        cwd: workspaceRoot,
      });
      terminal.sendText(`prometheus scope:check "${target.replace(/"/g, '\\"')}"`);
      terminal.show();
    }),
  );

  // ── prometheus.tokensReport ────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.tokensReport', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Token Report',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus tokens:report');
      terminal.show();
    }),
  );

  // ── prometheus.tokensReset ─────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.tokensReset', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const confirm = await vscode.window.showWarningMessage(
        'Reset the current session token budget counter?',
        { modal: true },
        'Reset Session',
      );
      if (confirm !== 'Reset Session') return;

      try {
        await runPrometheus(workspaceRoot, ['tokens:reset', '--session'], cfg.binaryPath || undefined);
        void vscode.window.showInformationMessage('Prometheus: Session token budget reset.');
      } catch (err) {
        handleError(err);
      }
    }),
  );

  // ── prometheus.tokensBudget ────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('prometheus.tokensBudget', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Token Budget',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus tokens:budget');
      terminal.show();
    }),
  );

  return vscode.Disposable.from(...disposables);
}
