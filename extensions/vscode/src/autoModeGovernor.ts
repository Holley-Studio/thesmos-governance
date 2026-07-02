// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * AutoModeGovernor — watches .claude/settings.json for governance hook installation
 * and emits status-change events so the status bar and notification system
 * can surface whether Thesmos is actively governing Claude Code Auto Mode.
 */

import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AutoModeGovernanceState {
  /** True when the required PreToolUse hooks for Write/Edit/Bash are installed. */
  hooksInstalled: boolean;
  /** True when hooks are installed AND config.autoMode.enabled !== false. */
  governed: boolean;
  /** Hook commands detected in the settings file. */
  detectedHooks: string[];
  /** Path to the settings file being watched. */
  settingsPath: string;
}

const THESMOS_HOOK_PATTERNS = [
  /thesmos.*claude[:\s]govern/i,
  /thesmos.*check/i,
  /npx.*thesmos/i,
];

export class AutoModeGovernor implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<AutoModeGovernanceState>();
  readonly onDidChange = this._onDidChange.event;

  private currentState: AutoModeGovernanceState;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly workspaceRoot: string) {
    const settingsPath = join(workspaceRoot, '.claude', 'settings.json');
    this.currentState = this.readState(settingsPath);

    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(workspaceRoot),
      '.claude/settings.json',
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidChange(() => this.scheduleReload());
    watcher.onDidCreate(() => this.scheduleReload());
    watcher.onDidDelete(() => this.scheduleReload());

    this.disposables.push(watcher, this._onDidChange);
  }

  private scheduleReload(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      const settingsPath = join(this.workspaceRoot, '.claude', 'settings.json');
      const next = this.readState(settingsPath);
      if (JSON.stringify(next) !== JSON.stringify(this.currentState)) {
        this.currentState = next;
        this._onDidChange.fire(next);
      }
    }, 300);
  }

  private readState(settingsPath: string): AutoModeGovernanceState {
    const base: AutoModeGovernanceState = {
      hooksInstalled: false,
      governed: false,
      detectedHooks: [],
      settingsPath,
    };

    if (!existsSync(settingsPath)) return base;

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    } catch {
      return base;
    }

    const hookSections = [
      settings['hooks'],
      (settings as Record<string, unknown>)['PreToolUse'],
    ].filter(Boolean);

    const detectedHooks: string[] = [];
    const raw = JSON.stringify(hookSections);
    for (const pattern of THESMOS_HOOK_PATTERNS) {
      const match = raw.match(pattern);
      if (match) detectedHooks.push(match[0]);
    }

    const hooksInstalled = detectedHooks.length > 0;
    return { hooksInstalled, governed: hooksInstalled, detectedHooks, settingsPath };
  }

  get state(): AutoModeGovernanceState {
    return this.currentState;
  }

  dispose(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    for (const d of this.disposables) d.dispose();
  }
}
