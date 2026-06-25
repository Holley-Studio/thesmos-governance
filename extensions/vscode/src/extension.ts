/**
 * Thesmos Governance — VS Code Extension
 * by Holley Studios
 *
 * Entry point. Wires together all subsystems:
 *   - DiagnosticsManager  → inline squiggles per file
 *   - StatusBarManager    → health grade always visible
 *   - FindingsTreeProvider → grouped findings in Explorer
 *   - HealthPanel         → webview dashboard
 *   - Commands            → palette + tree view actions
 *   - File watcher        → debounced re-review on save
 *
 * Activation: triggered automatically when a workspace contains
 * .thesmos/config.json (declared in package.json activationEvents).
 *
 * Lifecycle:
 *   activate()   → build subsystems, run initial analysis
 *   deactivate() → VS Code calls this; all disposables auto-clean
 */

import * as vscode from 'vscode';
import { relative } from 'node:path';
import type { LanguageClient as LanguageClientType } from 'vscode-languageclient/node';

import { DiagnosticsManager } from './diagnostics.js';
import { StatusBarManager } from './statusBar.js';
import { FindingsTreeProvider } from './treeView.js';
import { AutopilotWatcher } from './autopilotWatcher.js';
import { AutopilotTreeProvider } from './autopilotView.js';
import { AgentsTreeProvider, invokeAgentCommand } from './agentsPanel.js';
import { AutoModeGovernor } from './autoModeGovernor.js';
import { ThesmosCodeLensProvider } from './codeLens.js';
import { InlineDiagnosticsManager } from './inlineDiagnostics.js';
import { registerCommands } from './commands.js';
import type { HealthEntry } from './panel.js';
import { ThesmosHoverProvider } from './hover.js';
import { ThesmosCodeActionProvider } from './codeAction.js';
import {
  runReview,
  runHealth,
  isInstalled,
  hasReport,
  ThesmosNotFoundError,
  ThesmosReportMissingError,
} from './runner.js';

import type { ExtensionConfig, Finding } from './types.js';

// ── Config helper ─────────────────────────────────────────────────────────────

function readConfig(): ExtensionConfig {
  const cfg = vscode.workspace.getConfiguration('thesmos');
  return {
    enable: cfg.get<boolean>('enable', true),
    runOnSave: cfg.get<boolean>('runOnSave', true),
    debounceMs: cfg.get<number>('debounceMs', 1000),
    showStatusBar: cfg.get<boolean>('showStatusBar', true),
    binaryPath: cfg.get<string>('binaryPath', ''),
    autoScan: cfg.get<boolean>('autoScan', false),
  };
}

// ── Extension class ───────────────────────────────────────────────────────────

class ThesmosExtension implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly diagnostics: DiagnosticsManager;
  private readonly statusBar: StatusBarManager;
  private readonly treeProvider: FindingsTreeProvider;
  private readonly autopilotWatcher: AutopilotWatcher;
  private readonly autopilotView: AutopilotTreeProvider;
  private readonly agentsView: AgentsTreeProvider;
  private readonly autoModeGovernor: AutoModeGovernor;
  private readonly codeLensProvider: ThesmosCodeLensProvider;
  private readonly inlineDiagnostics: InlineDiagnosticsManager;
  private updateBadge: (count: number) => void = () => {};

  private workspaceRoot: string;
  private allFindings: Finding[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    workspaceRoot: string,
  ) {
    this.workspaceRoot = workspaceRoot;

    this.diagnostics = new DiagnosticsManager();
    this.statusBar = new StatusBarManager();
    this.treeProvider = new FindingsTreeProvider();
    this.autopilotWatcher = new AutopilotWatcher(workspaceRoot);
    this.autopilotView = new AutopilotTreeProvider(workspaceRoot, this.autopilotWatcher);
    this.agentsView = new AgentsTreeProvider();
    this.autoModeGovernor = new AutoModeGovernor(workspaceRoot);
    this.codeLensProvider = new ThesmosCodeLensProvider();
    this.inlineDiagnostics = new InlineDiagnosticsManager();

    this.disposables.push(
      this.diagnostics,
      this.statusBar,
      this.treeProvider,
      this.autopilotWatcher,
      this.autopilotView,
      this.agentsView,
      this.autoModeGovernor,
      this.codeLensProvider,
      this.inlineDiagnostics,
    );

    // Update status bar when autopilot session state changes
    this.autopilotWatcher.onDidChange((session) => {
      if (!session) {
        this.statusBar.clearAutopilotSession();
        return;
      }
      const completed = session.completedTaskIndexes.length;
      const total = completed + session.blockedTasks.length + session.timedOutTaskIndexes.length;
      const taskLabel = `${completed}/${total > 0 ? total : '?'} tasks`;
      this.statusBar.showAutopilotSession(taskLabel, this.autopilotWatcher.isCancelling);
    });

    // Surface governance status when .claude/settings.json changes
    this.autoModeGovernor.onDidChange((state) => {
      if (state.governed) {
        this.statusBar.showGoverningAutoMode();
      } else if (state.hooksInstalled === false) {
        this.statusBar.clearGoverningAutoMode();
      } else {
        this.statusBar.showAutoModeUngoverned();
      }
    });

    // Apply initial governance state
    const initialState = this.autoModeGovernor.state;
    if (initialState.governed) {
      this.statusBar.showGoverningAutoMode();
    } else if (!initialState.hooksInstalled) {
      // No hooks and no .claude/settings.json — silently do nothing (common for new projects)
    } else {
      this.statusBar.showAutoModeUngoverned();
    }
  }

  async activate(): Promise<void> {
    const cfg = readConfig();
    if (!cfg.enable) return;

    // Register findings tree view
    const treeView = vscode.window.createTreeView('thesmos.findingsView', {
      treeDataProvider: this.treeProvider,
      showCollapseAll: true,
    });
    this.disposables.push(treeView);

    // Badge on the activity bar icon: shows BLOCKER + HIGH count
    this.updateBadge = (count) => {
      treeView.badge = count > 0
        ? { value: count, tooltip: `${count} BLOCKER/HIGH finding${count === 1 ? '' : 's'}` }
        : undefined;
    };

    // Register autopilot tree view
    const autopilotTreeView = vscode.window.createTreeView('thesmos.autopilotView', {
      treeDataProvider: this.autopilotView,
      showCollapseAll: false,
    });
    this.disposables.push(autopilotTreeView);

    // Register agents tree view
    const agentsTreeView = vscode.window.createTreeView('thesmos.agentsView', {
      treeDataProvider: this.agentsView,
      showCollapseAll: true,
    });
    this.disposables.push(agentsTreeView);

    // Agents invoke command
    this.disposables.push(
      vscode.commands.registerCommand('thesmos.agents.invoke', invokeAgentCommand),
    );

    // Set context flag so tree view & menus are visible
    await vscode.commands.executeCommand(
      'setContext',
      'thesmos.active',
      true,
    );

    // Register all commands
    const commands = registerCommands(
      this.context,
      this.workspaceRoot,
      readConfig,
      () => this.runFullReview(),
      (uri) => this.reviewSingleFile(uri),
      () => this.autopilotWatcher,
    );
    this.disposables.push(commands);

    // Hover provider — rich tooltips on findings
    const hoverProvider = vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      new ThesmosHoverProvider(this.workspaceRoot, () => this.allFindings),
    );
    this.disposables.push(hoverProvider);

    // Code action provider — suppress quick-fix lightbulbs
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new ThesmosCodeActionProvider(),
      { providedCodeActionKinds: ThesmosCodeActionProvider.providedCodeActionKinds },
    );
    this.disposables.push(codeActionProvider);

    // CodeLens provider — BLOCKER/HIGH annotation above each affected line
    const codeLensProvider = vscode.languages.registerCodeLensProvider(
      [
        { scheme: 'file', language: 'typescript' },
        { scheme: 'file', language: 'typescriptreact' },
        { scheme: 'file', language: 'javascript' },
        { scheme: 'file', language: 'javascriptreact' },
        { scheme: 'file', language: 'python' },
      ],
      this.codeLensProvider,
    );
    this.disposables.push(codeLensProvider);

    // Inline diagnostics — re-apply when the user switches editor tabs
    const editorWatcher = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        this.inlineDiagnostics.applyToEditor(editor, this.allFindings, this.workspaceRoot);
      }
    });
    this.disposables.push(editorWatcher);

    // File save watcher (debounced)
    const saveWatcher = vscode.workspace.onDidSaveTextDocument((doc) => {
      const cfg = readConfig();
      if (!cfg.enable || !cfg.runOnSave) return;
      if (!this.isWatchedFile(doc.uri)) return;

      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(
        () => void this.reviewSingleFile(doc.uri),
        cfg.debounceMs,
      );
    });
    this.disposables.push(saveWatcher);

    // Config change watcher
    const cfgWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('thesmos')) {
        const updated = readConfig();
        if (updated.showStatusBar) {
          this.statusBar.show();
        } else {
          this.statusBar.hide();
        }
      }
    });
    this.disposables.push(cfgWatcher);

    // Hide status bar if disabled in config
    if (!cfg.showStatusBar) {
      this.statusBar.hide();
    }

    // Initial analysis
    await this.runInitialAnalysis(cfg);
  }

  private async runInitialAnalysis(cfg: ExtensionConfig): Promise<void> {
    if (!isInstalled(this.workspaceRoot, cfg.binaryPath || undefined)) {
      this.statusBar.showNotInstalled();
      this.treeProvider.setNotInstalled();

      void vscode.window.showWarningMessage(
        'Thesmos: thesmos-governance is not installed in this project.',
        'Install',
        'Dismiss',
      ).then((choice) => {
        if (choice === 'Install') {
          const terminal = vscode.window.createTerminal('Thesmos');
          terminal.sendText('npm install --save-dev thesmos-governance');
          terminal.show();
        }
      });
      return;
    }

    if (!hasReport(this.workspaceRoot)) {
      this.statusBar.showScanNeeded();
      this.treeProvider.setNoReport();

      if (cfg.autoScan) {
        void vscode.commands.executeCommand('thesmos.scan');
      } else {
        void vscode.window.showInformationMessage(
          'Thesmos: No scan report found.',
          'Scan now',
          'Dismiss',
        ).then((choice) => {
          if (choice === 'Scan now') {
            void vscode.commands.executeCommand('thesmos.scan');
          }
        });
      }
      return;
    }

    await this.runFullReview();
  }

  /** Runs a full repository review and refreshes all UI surfaces. */
  async runFullReview(): Promise<void> {
    const cfg = readConfig();
    this.statusBar.showLoading();
    this.treeProvider.setLoading();

    try {
      const output = await runReview(
        this.workspaceRoot,
        cfg.binaryPath || undefined,
      );
      this.allFindings = output.findings;

      // Update diagnostics for all files
      this.diagnostics.setAll(this.allFindings, this.workspaceRoot);

      // Update tree view
      this.treeProvider.refresh(this.allFindings, this.workspaceRoot);

      // Update CodeLens, inline decorations, and activity bar badge
      this.codeLensProvider.update(this.allFindings, this.workspaceRoot);
      for (const editor of vscode.window.visibleTextEditors) {
        this.inlineDiagnostics.applyToEditor(editor, this.allFindings, this.workspaceRoot);
      }
      this.updateBadge(
        this.allFindings.filter((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH').length,
      );

      // Update status bar with health score
      await this.refreshStatusBar(cfg);
    } catch (err) {
      this.handleAnalysisError(err);
    }
  }

  /** Reviews a single file on save; updates only that file's diagnostics. */
  async reviewSingleFile(uri: vscode.Uri): Promise<void> {
    const cfg = readConfig();
    if (!hasReport(this.workspaceRoot)) return;

    const relPath = relative(this.workspaceRoot, uri.fsPath);
    if (relPath.startsWith('..') || relPath.startsWith('/')) return;

    try {
      const output = await runReview(
        this.workspaceRoot,
        cfg.binaryPath || undefined,
        [relPath],
      );

      // Merge: replace this file's findings in the global list
      this.allFindings = [
        ...this.allFindings.filter((f) => f.file !== relPath),
        ...output.findings,
      ];

      this.diagnostics.setForFile(uri, output.findings);
      this.treeProvider.refresh(this.allFindings, this.workspaceRoot);
      this.codeLensProvider.update(this.allFindings, this.workspaceRoot);
      for (const editor of vscode.window.visibleTextEditors) {
        this.inlineDiagnostics.applyToEditor(editor, this.allFindings, this.workspaceRoot);
      }
      this.updateBadge(
        this.allFindings.filter((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH').length,
      );

      await this.refreshStatusBar(cfg);
    } catch (err) {
      if (!(err instanceof ThesmosReportMissingError)) {
        this.handleAnalysisError(err);
      }
    }
  }

  private async refreshStatusBar(cfg: ExtensionConfig): Promise<void> {
    if (!cfg.showStatusBar) return;

    try {
      const health = await runHealth(
        this.workspaceRoot,
        cfg.binaryPath || undefined,
      );
      this.statusBar.showHealth(health, this.allFindings.length);

      // Persist for trend chart (capped at 30 entries per workspace)
      const hist = this.context.workspaceState.get<HealthEntry[]>('thesmos.healthHistory', []);
      hist.push({ score: health.score, grade: health.grade, ts: Date.now() });
      if (hist.length > 30) hist.splice(0, hist.length - 30);
      void this.context.workspaceState.update('thesmos.healthHistory', hist);
    } catch {
      // Health score is a nice-to-have; don't surface the error
      this.statusBar.showInactive();
    }
  }

  private handleAnalysisError(err: unknown): void {
    if (err instanceof ThesmosNotFoundError) {
      this.statusBar.showNotInstalled();
      this.treeProvider.setNotInstalled();
      return;
    }

    if (err instanceof ThesmosReportMissingError) {
      this.statusBar.showScanNeeded();
      this.treeProvider.setNoReport();
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    this.statusBar.showInactive();
    void vscode.window.showErrorMessage(`Thesmos: ${message}`);
  }

  /**
   * Returns true for TypeScript, JavaScript, JSX, TSX, MDX, and JSON files
   * that live inside the workspace (not in node_modules / .git).
   */
  private isWatchedFile(uri: vscode.Uri): boolean {
    const relPath = relative(this.workspaceRoot, uri.fsPath);

    if (relPath.startsWith('..')) return false;
    if (relPath.startsWith('node_modules')) return false;
    if (relPath.startsWith('.git')) return false;
    if (relPath.startsWith('.thesmos')) return false;
    if (relPath.startsWith('dist/')) return false;

    const ext = uri.fsPath.slice(uri.fsPath.lastIndexOf('.'));
    return ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.mdx'].includes(ext);
  }

  dispose(): void {
    clearTimeout(this.debounceTimer);
    void vscode.commands.executeCommand('setContext', 'thesmos.active', false);
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

// ── VS Code entry points ──────────────────────────────────────────────────────

let extension: ThesmosExtension | undefined;
let lspClient: LanguageClientType | undefined;

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;

  const workspaceRoot = folders[0].uri.fsPath;

  extension = new ThesmosExtension(context, workspaceRoot);
  context.subscriptions.push(extension);

  await extension.activate();

  // Start Thesmos LSP server for real-time as-you-type diagnostics.
  // The server is the thesmos CLI launched with the "lsp" subcommand.
  // It runs alongside the existing on-save analysis and surfaces squiggles
  // for TypeScript and JavaScript files without requiring a scan report.
  void startLspClient(context, workspaceRoot);
}

async function startLspClient(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<void> {
  try {
    // Dynamic import so the extension still loads even if vscode-languageclient
    // is not yet installed (e.g. first-run before `npm install`).
    const { LanguageClient, TransportKind } = await import('vscode-languageclient/node');

    // Resolve the thesmos binary to use as the LSP server.
    // VS Code launched from the Dock doesn't inherit nvm PATH, so extend it
    // with common node version manager locations before spawning the server.
    const home = process['env']['HOME'] ?? process['env']['USERPROFILE'] ?? '';
    const extraPaths = [
      `${home}/.nvm/versions/node/v20.20.2/bin`,
      `${home}/.nvm/versions/node/v22.0.0/bin`,
      `${home}/.nvm/versions/node/v24.0.0/bin`,
      `${home}/.nvm/versions/node/v18.0.0/bin`,
      `${home}/.volta/bin`,
      `${home}/.fnm/aliases/default/bin`,
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ];
    const enhancedPath = [...extraPaths, process['env']['PATH'] ?? ''].join(process.platform === 'win32' ? ';' : ':');
    const serverEnv = { ...process['env'], PATH: enhancedPath };

    const serverCommand = 'npx';
    const serverArgs = ['thesmos', 'lsp', '--root', workspaceRoot];
    const serverOpts = { env: serverEnv };

    lspClient = new LanguageClient(
      'thesmos-lsp',
      'Thesmos Language Server',
      {
        run:   { command: serverCommand, args: serverArgs, transport: TransportKind.stdio, options: serverOpts },
        debug: { command: serverCommand, args: [...serverArgs, '--debug'], transport: TransportKind.stdio, options: serverOpts },
      },
      {
        documentSelector: [
          { scheme: 'file', language: 'typescript' },
          { scheme: 'file', language: 'typescriptreact' },
          { scheme: 'file', language: 'javascript' },
          { scheme: 'file', language: 'javascriptreact' },
        ],
        workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      },
    );

    const client = lspClient;
    if (client) {
      context.subscriptions.push(client);
      await client.start();
    }
  } catch {
    // vscode-languageclient not installed — real-time LSP unavailable.
    // On-save analysis via the extension's existing diagnostics path still works.
  }
}

export function deactivate(): Thenable<void> | undefined {
  extension?.dispose();
  extension = undefined;
  return lspClient?.stop();
}
