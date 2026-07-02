// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * DiagnosticsManager — maps thesmos findings to VS Code squiggles.
 *
 * Severity mapping:
 *   BLOCKER  → DiagnosticSeverity.Error
 *   HIGH     → DiagnosticSeverity.Error
 *   MEDIUM   → DiagnosticSeverity.Warning
 *   LOW      → DiagnosticSeverity.Information
 *   TECH_DEBT→ DiagnosticSeverity.Hint
 *
 * When Finding.line is present, the squiggle targets that line (1-based → 0-based).
 * Otherwise the diagnostic appears on line 0 (the file header).
 */

import * as vscode from 'vscode';
import { join } from 'node:path';
import type { Finding, Severity } from './types.js';

const DIAGNOSTIC_SOURCE = 'Thesmos';

function toVscodeSeverity(severity: Severity): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'BLOCKER':
    case 'HIGH':
      return vscode.DiagnosticSeverity.Error;
    case 'MEDIUM':
      return vscode.DiagnosticSeverity.Warning;
    case 'LOW':
      return vscode.DiagnosticSeverity.Information;
    case 'TECH_DEBT':
      return vscode.DiagnosticSeverity.Hint;
  }
}

function toDiagnostic(finding: Finding): vscode.Diagnostic {
  const line = Math.max(0, (finding.line ?? 1) - 1);
  const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

  const diag = new vscode.Diagnostic(
    range,
    finding.suggestion
      ? `${finding.message}\n\nSuggestion: ${finding.suggestion}`
      : finding.message,
    toVscodeSeverity(finding.severity),
  );

  diag.source = DIAGNOSTIC_SOURCE;
  diag.code = finding.category;

  return diag;
}

export class DiagnosticsManager implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  }

  /**
   * Replaces all diagnostics with the findings from the latest full review.
   * Groups findings by file URI so VS Code can efficiently update each file.
   */
  setAll(findings: Finding[], workspaceRoot: string): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();

    for (const finding of findings) {
      const absPath = join(workspaceRoot, finding.file);
      const key = vscode.Uri.file(absPath).toString();

      const existing = byFile.get(key) ?? [];
      existing.push(toDiagnostic(finding));
      byFile.set(key, existing);
    }

    // Replace all at once to minimise flicker
    this.collection.clear();
    for (const [uriStr, diags] of byFile) {
      this.collection.set(vscode.Uri.parse(uriStr), diags);
    }
  }

  /**
   * Updates diagnostics for a single file.
   * Used for on-save reviews so other files' diagnostics are unaffected.
   */
  setForFile(uri: vscode.Uri, findings: Finding[]): void {
    this.collection.set(uri, findings.map(toDiagnostic));
  }

  /** Removes diagnostics for a single file (e.g. after deletion). */
  clearForFile(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  /** Removes all diagnostics. */
  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}
