/**
 * Command registrations for the Prometheus Governance extension.
 *
 * All commands are registered here and exposed as a Disposable so the
 * extension can cleanly tear them down on deactivation.
 *
 * Commands:
 *   thesmos.scan          — run `prometheus scan`, then refresh all findings
 *   thesmos.reviewFile    — review the currently open file
 *   thesmos.health        — open the health dashboard webview
 *   thesmos.adapters      — regenerate all AI adapter files
 *   thesmos.openConfig    — open .thesmos/config.json in the editor
 *   thesmos.refreshFindings — re-run full review and refresh the tree
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
  ThesmosReportMissingError,
} from './runner.js';
import { HealthPanel } from './panel.js';
import type { ExtensionConfig } from './types.js';
import type { AutopilotWatcher } from './autopilotWatcher.js';

// ── Callback types (supplied by extension.ts) ─────────────────────────────────

export type RefreshCallback = () => Promise<void>;
export type ReviewFileCallback = (uri: vscode.Uri) => Promise<void>;
export type GetAutopilotWatcher = () => AutopilotWatcher;

// ── Shell sanitizers ──────────────────────────────────────────────────────────

/** Strips characters that expand inside double-quoted bash strings ($, backtick, newlines). */
export function sanitizeShellArg(input: string): string {
  return input.replace(/[`$\n\r]/g, '').replace(/"/g, '\\"');
}

/** Keeps only characters valid in git branch names. */
export function sanitizeBranchName(input: string): string {
  return input.replace(/[^a-zA-Z0-9/_.-]/g, '');
}

/** Keeps only alphanumeric, hyphens, and underscores (session ID format). */
export function sanitizeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '');
}

// ── Helper ────────────────────────────────────────────────────────────────────

function handleError(err: unknown): void {
  if (err instanceof PrometheusNotFoundError) {
    void vscode.window.showErrorMessage(
      `Prometheus Governance: ${err.message}`,
      'Install now',
    ).then((choice) => {
      if (choice === 'Install now') {
        const terminal = vscode.window.createTerminal('Prometheus');
        terminal.sendText('npm install --save-dev thesmos-governance');
        terminal.show();
      }
    });
    return;
  }

  if (err instanceof ThesmosReportMissingError) {
    void vscode.window.showWarningMessage(
      `Prometheus Governance: ${err.message}`,
      'Scan now',
    ).then((choice) => {
      if (choice === 'Scan now') {
        void vscode.commands.executeCommand('thesmos.scan');
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

  // ── thesmos.scan ────────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.scan', async () => {
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

  // ── thesmos.reviewFile ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.reviewFile', async () => {
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

  // ── thesmos.health ──────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.health', async () => {
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

  // ── thesmos.adapters ────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.adapters', async () => {
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

  // ── thesmos.openConfig ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.openConfig', async () => {
      const configPath = join(workspaceRoot, '.prometheus', 'config.json');
      if (!existsSync(configPath)) {
        void vscode.window.showWarningMessage(
          'Prometheus: .thesmos/config.json not found. Run "Prometheus: Scan Repository" first.',
        );
        return;
      }
      const doc = await vscode.workspace.openTextDocument(
        vscode.Uri.file(configPath),
      );
      await vscode.window.showTextDocument(doc);
    }),
  );

  // ── thesmos.refreshFindings ─────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.refreshFindings', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      try {
        await onRefresh();
      } catch (err) {
        handleError(err);
      }
    }),
  );

  // ── thesmos.autopilot.generate ──────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.generate', async () => {
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
      terminal.sendText(`prometheus autopilot generate "${sanitizeShellArg(goal)}"`);
      terminal.show();

      void vscode.window.showInformationMessage(
        'Prometheus Autopilot: Generating plan in terminal. Answer the clarifying questions, then validate with: prometheus autopilot validate MASTER_PLAN.md',
      );
    }),
  );

  // ── thesmos.autopilot.cancel ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.cancel', async () => {
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

  // ── thesmos.autopilot.review ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.review', async () => {
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
      const safeId = sanitizeId(session.id);
      const safeBase = sanitizeBranchName(baseBranch);
      terminal.sendText(`prometheus autopilot review "${safeId}" --base="${safeBase}"`);
      terminal.show();
    }),
  );

  // ── thesmos.autopilot.openPR ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.openPR', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Prometheus Autopilot: No active session.');
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus PR',
        cwd: workspaceRoot,
      });
      terminal.sendText(`prometheus autopilot open-pr "${sanitizeId(session.id)}"`);
      terminal.show();
    }),
  );

  // ── thesmos.autopilot.viewJournal ──────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.viewJournal', async () => {
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

  // ── thesmos.autopilot.revert ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.revert', async () => {
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

  // ── thesmos.importScan ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.importScan', () => {
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

  // ── thesmos.debtScan ────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.debtScan', () => {
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

  // ── thesmos.contextSnapshot ─────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.contextSnapshot', async () => {
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
              'Prometheus: Context snapshot written to .thesmos/context.md',
            );
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── thesmos.contextHealth ───────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.contextHealth', async () => {
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

  // ── thesmos.scopeInit ───────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.scopeInit', () => {
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

  // ── thesmos.scopeStatus ─────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.scopeStatus', () => {
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

  // ── thesmos.scopeCheck ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.scopeCheck', async () => {
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
      terminal.sendText(`prometheus scope:check "${sanitizeShellArg(target)}"`);
      terminal.show();
    }),
  );

  // ── thesmos.tokensReport ────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.tokensReport', () => {
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

  // ── thesmos.tokensReset ─────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.tokensReset', async () => {
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

  // ── thesmos.tokensBudget ────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.tokensBudget', () => {
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

  // ── thesmos.commitLint ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.commitLint', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Prometheus: Linting last commit message…',
          cancellable: false,
        },
        async () => {
          try {
            await runPrometheus(workspaceRoot, ['commit:lint', '--last'], cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage('Prometheus: Commit message is valid.');
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── thesmos.commitCreate ────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.commitCreate', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Commit Wizard',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus commit:create');
      terminal.show();
    }),
  );

  // ── thesmos.vercelLint ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.vercelLint', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Prometheus: Vercel Lint',
        cwd: workspaceRoot,
      });
      terminal.sendText('prometheus vercel:lint');
      terminal.show();
    }),
  );

  return vscode.Disposable.from(...disposables);
}
