// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Command registrations for the Thesmos Governance extension.
 *
 * All commands are registered here and exposed as a Disposable so the
 * extension can cleanly tear them down on deactivation.
 *
 * Commands:
 *   thesmos.scan          — run `thesmos scan`, then refresh all findings
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
  runFix,
  runThesmos,
  runTokensReport,
  ThesmosNotFoundError,
  ThesmosReportMissingError,
} from './runner.js';
import type { FindingItem } from './treeView.js';
import { HealthPanel } from './panel.js';
import type { HealthEntry } from './panel.js';
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
  if (err instanceof ThesmosNotFoundError) {
    void vscode.window.showErrorMessage(
      `Thesmos Governance: ${err.message}`,
      'Install now',
    ).then((choice) => {
      if (choice === 'Install now') {
        const terminal = vscode.window.createTerminal('Thesmos');
        terminal.sendText('npm install --save-dev thesmos-governance');
        terminal.show();
      }
    });
    return;
  }

  if (err instanceof ThesmosReportMissingError) {
    void vscode.window.showWarningMessage(
      `Thesmos Governance: ${err.message}`,
      'Scan now',
    ).then((choice) => {
      if (choice === 'Scan now') {
        void vscode.commands.executeCommand('thesmos.scan');
      }
    });
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  void vscode.window.showErrorMessage(`Thesmos Governance: ${message}`);
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
          title: 'Thesmos: Scanning repository…',
          cancellable: false,
        },
        async () => {
          try {
            await runScan(workspaceRoot, cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Thesmos: Scan complete. Refreshing findings…',
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
          'Thesmos: No active file to review.',
        );
        return;
      }

      try {
        await onReviewFile(doc.uri);
        void vscode.window.showInformationMessage(
          `Thesmos: Review complete for ${doc.fileName.split('/').pop()}`,
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
          title: 'Thesmos: Loading health score…',
          cancellable: false,
        },
        async () => {
          try {
            const health = await runHealth(
              workspaceRoot,
              cfg.binaryPath || undefined,
            );
            const hist = context.workspaceState.get<HealthEntry[]>('thesmos.healthHistory', []);
            HealthPanel.show(context.extensionUri, health, hist);
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
          title: 'Thesmos: Regenerating AI adapters…',
          cancellable: false,
        },
        async () => {
          try {
            await runAdapters(workspaceRoot, cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Thesmos: AI adapter files updated (CLAUDE.md, GEMINI.md, .cursor/rules, …)',
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
      const configPath = join(workspaceRoot, '.thesmos', 'config.json');
      if (!existsSync(configPath)) {
        void vscode.window.showWarningMessage(
          'Thesmos: .thesmos/config.json not found. Run "Thesmos: Scan Repository" first.',
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
        name: 'Thesmos Autopilot',
        cwd: workspaceRoot,
      });
      terminal.sendText(`thesmos autopilot generate "${sanitizeShellArg(goal)}"`);
      terminal.show();

      void vscode.window.showInformationMessage(
        'Thesmos Autopilot: Generating plan in terminal. Answer the clarifying questions, then validate with: thesmos autopilot validate MASTER_PLAN.md',
      );
    }),
  );

  // ── thesmos.autopilot.cancel ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.cancel', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Thesmos Autopilot: No active session to cancel.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Cancel autopilot session "${session.planSlug}"? The current task will complete before stopping.`,
        { modal: true },
        'Cancel Session',
      );
      if (confirm !== 'Cancel Session') return;

      // Create the cancel sentinel file
      const cancelPath = join(workspaceRoot, '.thesmos', 'autopilot', '.cancel');
      try {
        writeFileSync(cancelPath, '', 'utf8');
        void vscode.window.showInformationMessage(
          'Thesmos Autopilot: Cancel signal sent. Session will stop after the current task.',
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Thesmos Autopilot: Could not create cancel sentinel: ${msg}`);
      }
    }),
  );

  // ── thesmos.autopilot.review ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.review', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage(
          'Thesmos Autopilot: No active session. Provide a session ID in the terminal: thesmos autopilot review <id>',
        );
        return;
      }

      const cfg = vscode.workspace.getConfiguration('thesmos');
      const baseBranch = cfg.get<string>('autopilot.baseBranch', 'main');

      const terminal = vscode.window.createTerminal({
        name: 'Thesmos Review',
        cwd: workspaceRoot,
      });
      const safeId = sanitizeId(session.id);
      const safeBase = sanitizeBranchName(baseBranch);
      terminal.sendText(`thesmos autopilot review "${safeId}" --base="${safeBase}"`);
      terminal.show();
    }),
  );

  // ── thesmos.autopilot.openPR ────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.openPR', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Thesmos Autopilot: No active session.');
        return;
      }

      const terminal = vscode.window.createTerminal({
        name: 'Thesmos PR',
        cwd: workspaceRoot,
      });
      terminal.sendText(`thesmos autopilot open-pr "${sanitizeId(session.id)}"`);
      terminal.show();
    }),
  );

  // ── thesmos.autopilot.viewJournal ──────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.autopilot.viewJournal', async () => {
      const session = getAutopilotWatcher().session;
      if (!session) {
        void vscode.window.showWarningMessage('Thesmos Autopilot: No active session.');
        return;
      }

      if (!existsSync(session.journalPath)) {
        void vscode.window.showWarningMessage(
          `Thesmos Autopilot: Journal not found at ${session.journalPath}`,
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
        void vscode.window.showWarningMessage('Thesmos Autopilot: No active session to revert.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Revert session "${session.planSlug}"? This deletes branch "${session.branch}" and cannot be undone.`,
        { modal: true },
        'Revert and Delete Branch',
      );
      if (confirm !== 'Revert and Delete Branch') return;

      try {
        await runThesmos(workspaceRoot, ['autopilot', 'revert', session.id]);
        void vscode.window.showInformationMessage(
          `Thesmos Autopilot: Session reverted. Branch "${session.branch}" deleted. main is unchanged.`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Thesmos Autopilot: Revert failed: ${msg}`);
      }
    }),
  );

  // ── thesmos.importScan ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.importScan', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Thesmos: Import Scan',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos import:scan');
      terminal.show();
    }),
  );

  // ── thesmos.debtScan ────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.debtScan', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Thesmos: Debt Scan',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos debt:scan');
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
          title: 'Thesmos: Snapshotting project context…',
          cancellable: false,
        },
        async () => {
          try {
            await runThesmos(workspaceRoot, ['context:snapshot'], cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage(
              'Thesmos: Context snapshot written to .thesmos/context.md',
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
          title: 'Thesmos: Checking context health…',
          cancellable: false,
        },
        async () => {
          try {
            const out = await runThesmos(
              workspaceRoot,
              ['context:health'],
              cfg.binaryPath || undefined,
            );
            // First non-empty line contains the score summary
            const summary = out.split('\n').find((l) => l.trim().startsWith('Context Health:')) ?? out.trim();
            void vscode.window.showInformationMessage(`Thesmos: ${summary.trim()}`);
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
        name: 'Thesmos: Scope Init',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos scope:init');
      terminal.show();
    }),
  );

  // ── thesmos.scopeStatus ─────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.scopeStatus', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Thesmos: Scope Status',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos scope:status');
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
        name: 'Thesmos: Scope Check',
        cwd: workspaceRoot,
      });
      terminal.sendText(`thesmos scope:check "${sanitizeShellArg(target)}"`);
      terminal.show();
    }),
  );

  // ── thesmos.tokensReport ────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.tokensReport', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Thesmos: Token Report',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos tokens:report');
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
        await runThesmos(workspaceRoot, ['tokens:reset', '--session'], cfg.binaryPath || undefined);
        void vscode.window.showInformationMessage('Thesmos: Session token budget reset.');
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
        name: 'Thesmos: Token Budget',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos tokens:budget');
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
          title: 'Thesmos: Linting last commit message…',
          cancellable: false,
        },
        async () => {
          try {
            await runThesmos(workspaceRoot, ['commit:lint', '--last'], cfg.binaryPath || undefined);
            void vscode.window.showInformationMessage('Thesmos: Commit message is valid.');
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
        name: 'Thesmos: Commit Wizard',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos commit:create');
      terminal.show();
    }),
  );

  // ── thesmos.vercelLint ──────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.vercelLint', () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const terminal = vscode.window.createTerminal({
        name: 'Thesmos: Vercel Lint',
        cwd: workspaceRoot,
      });
      terminal.sendText('thesmos vercel:lint');
      terminal.show();
    }),
  );

  // ── thesmos.tokens.report ───────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.tokens.report', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const outputChannel = vscode.window.createOutputChannel('Thesmos Token Usage');
      outputChannel.show(true);
      outputChannel.appendLine('Thesmos Token Usage — fetching…');

      try {
        const report = await runTokensReport(workspaceRoot, cfg.binaryPath || undefined);
        if (!report) {
          outputChannel.appendLine('No token usage recorded yet.');
          return;
        }

        const fmt = (n: number) => n < 0.01 ? '<$0.01' : `$${n.toFixed(4)}`;
        outputChannel.clear();
        outputChannel.appendLine('── Thesmos Token Usage ─────────────────────');
        outputChannel.appendLine(`  Session:  ${fmt(report.sessionCostUSD)}`);
        outputChannel.appendLine(`  Today:    ${fmt(report.todayCostUSD)}`);
        outputChannel.appendLine(`  Project:  ${fmt(report.projectCostUSD)}`);
        outputChannel.appendLine('');
        outputChannel.appendLine('Run `thesmos tokens:reset --session` to reset the session counter.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        outputChannel.appendLine(`Error: ${msg}`);
      }
    }),
  );

  // ── thesmos.fix.single ─────────────────────────────────────────────────
  // Invoked from tree view context menu — VS Code passes the FindingItem.

  disposables.push(
    vscode.commands.registerCommand('thesmos.fix.single', async (item: FindingItem) => {
      const cfg = getConfig();
      if (!cfg.enable || !item?.finding) return;

      const { category, message, file } = item.finding;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Thesmos: Fixing \`${category}\`…`,
          cancellable: false,
        },
        async () => {
          try {
            const output = await runFix(workspaceRoot, cfg.binaryPath || undefined, category);
            const changed = output.includes('fixed') || output.includes('changed') || output.includes('✓');

            if (changed) {
              void vscode.window.showInformationMessage(
                `Thesmos: Fixed \`${category}\` in ${file}. Refreshing…`,
              );
              await onRefresh();
            } else {
              // No auto-fix available — fall back to AI prompt clipboard
              const prompt =
                `Fix the following Thesmos governance finding:\n\n` +
                `Rule: ${category}\n` +
                `Severity: ${item.finding.severity}\n` +
                `File: ${file}${item.finding.line ? `:${item.finding.line}` : ''}\n` +
                `Message: ${message}\n` +
                (item.finding.suggestion ? `Suggestion: ${item.finding.suggestion}\n` : '') +
                `\nPlease fix this issue in the code.`;

              await vscode.env.clipboard.writeText(prompt);
              void vscode.window.showInformationMessage(
                `Thesmos: No automatic fix for \`${category}\`. AI fix prompt copied to clipboard.`,
                'OK',
              );
            }
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── thesmos.fix.all ─────────────────────────────────────────────────────

  disposables.push(
    vscode.commands.registerCommand('thesmos.fix.all', async () => {
      const cfg = getConfig();
      if (!cfg.enable) return;

      const confirm = await vscode.window.showWarningMessage(
        'Apply all auto-fixable Thesmos findings? This will modify files in the workspace.',
        { modal: true },
        'Fix All',
      );
      if (confirm !== 'Fix All') return;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Thesmos: Applying all auto-fixes…',
          cancellable: false,
        },
        async () => {
          try {
            const output = await runFix(workspaceRoot, cfg.binaryPath || undefined);
            const lines = output.split('\n').filter((l) => l.trim());
            const summary = lines.find((l) => l.includes('fixed') || l.includes('changed') || l.includes('✓'))
              ?? `${lines.length} operations completed.`;

            void vscode.window.showInformationMessage(`Thesmos: ${summary} Refreshing findings…`);
            await onRefresh();
          } catch (err) {
            handleError(err);
          }
        },
      );
    }),
  );

  // ── thesmos.fix.copyPrompt ──────────────────────────────────────────────
  // For findings without an auto-fixer: copy an AI fix prompt to clipboard.

  disposables.push(
    vscode.commands.registerCommand('thesmos.fix.copyPrompt', async (item: FindingItem) => {
      if (!item?.finding) return;

      const { category, severity, file, line, message, suggestion } = item.finding;
      const prompt =
        `Fix the following Thesmos governance finding:\n\n` +
        `Rule: ${category}\n` +
        `Severity: ${severity}\n` +
        `File: ${file}${line ? `:${line}` : ''}\n` +
        `Message: ${message}\n` +
        (suggestion ? `Suggestion: ${suggestion}\n` : '') +
        `\nPlease fix this issue in the code.`;

      await vscode.env.clipboard.writeText(prompt);
      void vscode.window.showInformationMessage(
        `Thesmos: AI fix prompt for \`${category}\` copied to clipboard.`,
      );
    }),
  );

  return vscode.Disposable.from(...disposables);
}
