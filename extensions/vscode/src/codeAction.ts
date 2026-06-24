/**
 * PrometheusCodeActionProvider — suppression quick-fix lightbulbs.
 *
 * When a Prometheus diagnostic exists at the cursor, this provider offers a
 * "Suppress finding" quick-fix that inserts the canonical suppression comment
 * on the line above:
 *
 *   // prometheus-disable-next-line <category> -- reason: TODO
 *
 * The user then replaces "TODO" with the actual justification. The format is
 * parsed by thesmos-governance's suppress.ts — it requires a reason clause
 * to avoid a missing-reason audit finding.
 */

import * as vscode from 'vscode';

const PROMETHEUS_SOURCE = 'Prometheus';

export class PrometheusCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const prometheusDigas = context.diagnostics.filter(
      (d) => d.source === PROMETHEUS_SOURCE && typeof d.code === 'string',
    );

    return prometheusDigas.flatMap((diag) => {
      const category = diag.code as string;
      const targetLine = diag.range.start.line;

      // Preserve indentation of the flagged line
      const lineText = document.lineAt(targetLine).text;
      const indent = /^(\s*)/.exec(lineText)?.[1] ?? '';
      const suppressionText =
        `${indent}// prometheus-disable-next-line ${category} -- reason: TODO\n`;

      const action = new vscode.CodeAction(
        `Suppress: ${category} (add prometheus-disable-next-line comment)`,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diag];
      action.isPreferred = false;
      action.edit = new vscode.WorkspaceEdit();
      action.edit.insert(
        document.uri,
        new vscode.Position(targetLine, 0),
        suppressionText,
      );

      return [action];
    });
  }
}
