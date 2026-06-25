// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos audit — combined doctor + scan-based review (no changed-file content).
 * Gives a full health snapshot: installation check + rule findings from the last scan.
 * Always exits 0 (informational). Use `validate` to gate CI.
 *
 * Flags:
 *   --json       output as JSON
 *   --markdown   output as Markdown
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runDoctorForRoot, formatDoctorMarkdown } from '../../doctor.ts';
import {
  runReview,
  formatFindingsConsole,
  formatFindingsMarkdown,
  formatFindingsJson,
} from '../../review.ts';
import { SEVERITY_EMOJI, SEVERITY_ORDER } from '../../severity.ts';
import type { DoctorCheck, Finding } from '../../types.ts';

// ── Pure formatter (exported for tests) ──────────────────────────────────────

export function formatAuditConsole(
  checks: DoctorCheck[],
  findings: Finding[],
  projectName: string
): string {
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.filter((c) => !c.pass).length;

  const bySeverity: Partial<Record<string, number>> = {};
  for (const f of findings) {
    bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  }
  const severitySummary = SEVERITY_ORDER.filter((s) => bySeverity[s])
    .map((s) => `${bySeverity[s]} ${s}`)
    .join(', ');

  const lines: string[] = [
    `Thesmos Audit — ${projectName}`,
    '',
    `Installation: ${passed} passed, ${failed} failed`,
  ];

  if (failed > 0) {
    lines.push('');
    for (const check of checks.filter((c) => !c.pass)) {
      lines.push(`  ✗  ${check.name}`);
      if (check.fixHint) lines.push(`     → ${check.fixHint}`);
    }
  }

  lines.push('');
  lines.push(`Review:  ${findings.length} finding${findings.length === 1 ? '' : 's'}${severitySummary ? ` (${severitySummary})` : ''}`);

  if (findings.length > 0) {
    lines.push('');
    for (const f of findings.slice(0, 10)) {
      const emoji = SEVERITY_EMOJI[f.severity] ?? '●';
      const loc = f.file ? (f.line ? `${f.file}:${f.line}` : f.file) : '';
      lines.push(`  ${emoji}  [${f.severity}] ${loc ? `${loc} — ` : ''}${f.message}`);
    }
    if (findings.length > 10) lines.push(`  … and ${findings.length - 10} more`);
  }

  return lines.join('\n');
}

// ── I/O command ───────────────────────────────────────────────────────────────

export async function cmdAudit(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');

  const checks = runDoctorForRoot(root, config);
  const scan = loadReport(root);

  if (!scan) {
    process.stderr.write('thesmos audit: .thesmos/report.json not found — run thesmos scan first\n');
    process.exit(1);
  }

  // No changedFiles — scan-based review only
  const findings = runReview({ scan, config });

  if (json) {
    process.stdout.write(
      JSON.stringify({ doctor: checks, findings }, null, 2) + '\n'
    );
    return;
  }

  if (markdown) {
    const lines = [
      `## Thesmos Audit — ${config.project}\n`,
      '### Installation',
      formatDoctorMarkdown(checks, config.project),
      '### Review',
      formatFindingsMarkdown(findings, config.project),
    ];
    process.stdout.write(lines.join('\n'));
    return;
  }

  console.log(formatAuditConsole(checks, findings, config.project));
}
