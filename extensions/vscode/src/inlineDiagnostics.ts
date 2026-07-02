// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import * as vscode from 'vscode';
import type { Finding, Severity } from './types.js';
import { relative } from 'node:path';

const COLOR_KEY: Record<Severity, string> = {
  BLOCKER:   'errorForeground',
  HIGH:      'errorForeground',
  MEDIUM:    'editorWarning.foreground',
  LOW:       'editorInfo.foreground',
  TECH_DEBT: 'editorHint.foreground',
};

export class InlineDiagnosticsManager implements vscode.Disposable {
  private readonly types = new Map<Severity, vscode.TextEditorDecorationType>();

  constructor() {
    for (const [sev, colorKey] of Object.entries(COLOR_KEY) as [Severity, string][]) {
      this.types.set(sev as Severity, vscode.window.createTextEditorDecorationType({
        isWholeLine: false,
        after: {
          color: new vscode.ThemeColor(colorKey),
          fontStyle: 'italic',
          margin: '0 0 0 3ch',
        },
      }));
    }
  }

  applyToEditor(editor: vscode.TextEditor, findings: Finding[], workspaceRoot: string): void {
    if (!vscode.workspace.getConfiguration('thesmos').get<boolean>('inlineDiagnostics.enable', true)) {
      this.clearEditor(editor);
      return;
    }

    const relPath = relative(workspaceRoot, editor.document.uri.fsPath);
    const fileFindings = findings.filter((f) => f.file === relPath);
    const bySev = new Map<Severity, vscode.DecorationOptions[]>();
    for (const [sev] of this.types) bySev.set(sev, []);

    for (const f of fileFindings) {
      const line = Math.max(0, (f.line ?? 1) - 1);
      const text = f.message.length > 80 ? f.message.slice(0, 80) + '…' : f.message;
      bySev.get(f.severity)?.push({
        range: new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER),
        renderOptions: { after: { contentText: `  ← [${f.severity}] ${text}` } },
      });
    }

    for (const [sev, decorType] of this.types) {
      editor.setDecorations(decorType, bySev.get(sev) ?? []);
    }
  }

  clearEditor(editor: vscode.TextEditor): void {
    for (const [, decorType] of this.types) editor.setDecorations(decorType, []);
  }

  dispose(): void {
    for (const [, decorType] of this.types) decorType.dispose();
    this.types.clear();
  }
}
