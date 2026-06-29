// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * ThesmosCodeActionProvider — suppression quick-fix lightbulbs.
 *
 * When a Thesmos diagnostic exists at the cursor, this provider offers a
 * "Suppress finding" quick-fix that inserts the canonical suppression comment
 * on the line above:
 *
 *   // thesmos-disable-next-line <category> -- reason: TODO
 *
 * The user then replaces "TODO" with the actual justification. The format is
 * parsed by thesmos-governance's suppress.ts — it requires a reason clause
 * to avoid a missing-reason audit finding.
 */

import * as vscode from 'vscode';

const THESMOS_SOURCE = 'Thesmos';

export class ThesmosCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const thesmosDigas = context.diagnostics.filter(
      (d) => d.source === THESMOS_SOURCE && typeof d.code === 'string',
    );

    return thesmosDigas.flatMap((diag) => {
      const category = diag.code as string;
      const targetLine = diag.range.start.line;

      // Preserve indentation of the flagged line
      const lineText = document.lineAt(targetLine).text;
      const indent = /^(\s*)/.exec(lineText)?.[1] ?? '';
      const suppressionText =
        `${indent}// thesmos-disable-next-line ${category} -- reason: TODO\n`;

      const action = new vscode.CodeAction(
        `Suppress: ${category} (add thesmos-disable-next-line comment)`,
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
