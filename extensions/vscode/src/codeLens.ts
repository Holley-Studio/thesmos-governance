// Copyright (c) 2026 Holley Studios. All rights reserved.
import * as vscode from 'vscode';
import type { Finding } from './types.js';
import { relative } from 'node:path';

const CRITICAL = new Set(['BLOCKER', 'HIGH']);

export class ThesmosCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private findings: Finding[] = [];
  private workspaceRoot = '';

  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onChange.event;

  update(findings: Finding[], workspaceRoot: string): void {
    this.findings = findings;
    this.workspaceRoot = workspaceRoot;
    this._onChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('thesmos').get<boolean>('codeLens.enable', true)) {
      return [];
    }

    const relPath = relative(this.workspaceRoot, document.uri.fsPath);
    return this.findings
      .filter((f) => f.file === relPath && CRITICAL.has(f.severity))
      .map((f) => {
        const line = Math.max(0, (f.line ?? 1) - 1);
        const msg = f.message.length > 72 ? f.message.slice(0, 72) + '…' : f.message;
        return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
          title: `$(error) [${f.severity}] ${f.category}: ${msg}`,
          command: 'vscode.open',
          arguments: [
            document.uri,
            { selection: new vscode.Range(line, 0, line, 0) } satisfies vscode.TextDocumentShowOptions,
          ],
        });
      });
  }

  dispose(): void {
    this._onChange.dispose();
  }
}
