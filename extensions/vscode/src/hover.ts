// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * ThesmosHoverProvider — rich tooltips when hovering over squiggles.
 *
 * When the cursor rests on a line that has a Thesmos finding, this shows
 * a Markdown card with the severity, category, message, and fix suggestion.
 * Multiple findings on the same line are stacked in a single hover card.
 */

import * as vscode from 'vscode';
import { relative } from 'node:path';
import type { Finding, Severity } from './types.js';

const SEVERITY_EMOJI: Record<Severity, string> = {
  BLOCKER: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
  TECH_DEBT: '⚪',
};

export class ThesmosHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly workspaceRoot: string,
    private readonly getFindings: () => Finding[],
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | null {
    const relPath = relative(this.workspaceRoot, document.uri.fsPath).replace(/\\/g, '/');
    if (relPath.startsWith('..')) return null;

    const hoveredLine = position.line + 1; // findings are 1-based

    const matches = this.getFindings().filter(
      (f) => f.file === relPath && (f.line ?? 1) === hoveredLine,
    );
    if (matches.length === 0) return null;

    const md = new vscode.MarkdownString('', true);
    md.isTrusted = false;

    for (let i = 0; i < matches.length; i++) {
      const f = matches[i]!;
      const emoji = SEVERITY_EMOJI[f.severity] ?? '⬜';

      md.appendMarkdown(`**${emoji} ${f.severity}** &nbsp;·&nbsp; \`${f.category}\`\n\n`);
      md.appendMarkdown(`${f.message}\n\n`);

      if (f.suggestion) {
        md.appendMarkdown(`**Fix:** ${f.suggestion}\n\n`);
      }

      if (i < matches.length - 1) {
        md.appendMarkdown(`---\n\n`);
      }
    }

    md.appendMarkdown(`---\n_Thesmos Governance — use the 💡 lightbulb to suppress_`);

    const line = position.line;
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    return new vscode.Hover(md, range);
  }
}
