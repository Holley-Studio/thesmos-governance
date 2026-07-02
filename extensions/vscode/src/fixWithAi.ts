// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import * as vscode from 'vscode';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Finding } from './types.js';

export async function fixWithAi(
  workspaceRoot: string,
  findings: Finding[],
): Promise<void> {
  const actionable = findings.filter(
    (f) => f.severity === 'BLOCKER' || f.severity === 'HIGH',
  );

  if (!actionable.length) {
    void vscode.window.showInformationMessage(
      'No BLOCKER or HIGH findings — run a review first (Thesmos: Review Current File or Scan Repository).',
    );
    return;
  }

  // Group by file and build a structured markdown prompt
  const byFile = new Map<string, Finding[]>();
  for (const f of actionable) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }

  const lines: string[] = [
    '# Thesmos: Fix Governance Findings',
    '',
    'Fix each finding below in the specified file at the specified line.',
    'Apply only the minimum change needed. Do not refactor anything else.',
    '',
  ];
  for (const [file, fds] of byFile) {
    lines.push(`## ${file}`);
    for (const fd of fds.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      const loc = fd.line ? ` line ${fd.line}` : '';
      const fix = fd.suggestion ? ` → ${fd.suggestion}` : '';
      lines.push(`- **[${fd.category}]**${loc}: ${fd.message}${fix}`);
    }
    lines.push('');
  }
  lines.push('---', 'Fix each finding with the minimum change needed. Do not refactor beyond what is required.', '');

  const sessionFile = join(workspaceRoot, '.thesmos', '.ai-fix-session.md');
  try {
    writeFileSync(sessionFile, lines.join('\n'), 'utf8');
  } catch {
    void vscode.window.showErrorMessage(
      'Thesmos: Could not write .thesmos/.ai-fix-session.md — check directory permissions.',
    );
    return;
  }

  // Check if claude CLI is available on PATH
  let claudeAvailable = false;
  try {
    execFileSync('which', ['claude'], { timeout: 2000, stdio: 'ignore' });
    claudeAvailable = true;
  } catch {
    try {
      execFileSync('where', ['claude'], { timeout: 2000, stdio: 'ignore' });
      claudeAvailable = true;
    } catch { /* not installed */ }
  }

  if (claudeAvailable) {
    const terminal = vscode.window.createTerminal('Thesmos — Fix with AI');
    terminal.show();
    // Use stdin redirect — avoids all shell escaping issues with the prompt content
    terminal.sendText(`claude < "${sessionFile}"`);
    void vscode.window.showInformationMessage(
      `Sending ${actionable.length} finding${actionable.length === 1 ? '' : 's'} across ${byFile.size} file${byFile.size === 1 ? '' : 's'} to Claude Code…`,
    );
  } else {
    await vscode.env.clipboard.writeText(lines.join('\n'));
    void vscode.window.showInformationMessage(
      `Copied ${actionable.length} finding${actionable.length === 1 ? '' : 's'} to clipboard — paste into Claude Code or another AI assistant.`,
    );
  }
}
