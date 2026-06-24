/**
 * thesmos scan — walk the repo, detect stack, write .thesmos/report.json.
 * Safe to run repeatedly: report.json is always overwritten with fresh scan data.
 *
 * Flags:
 *   --json       output as JSON
 *   --markdown   output as Markdown
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { runScanner } from '../../scanner/index.ts';
import { applyGeneratedSections, sortReport, type JsonValue } from '../../report.ts';
import type { ScanResult, ThesmosConfig } from '../../types.ts';

// ── Pure formatter (exported for tests) ──────────────────────────────────────

export function formatScanConsole(scan: ScanResult, config: ThesmosConfig): string {
  const d = scan.detector;
  const authRoutes = scan.apiRoutes.filter((r) => r.auth).length;
  const unauthMutating = scan.apiRoutes.filter(
    (r) => !r.auth && r.methods.some((m) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m))
  ).length;

  const lines: string[] = [
    `Thesmos Scan — ${config.project}`,
    '',
  ];

  if (d) {
    lines.push(
      `  Framework:   ${d.framework}`,
      `  Auth:        ${d.auth}`,
      `  Deployment:  ${d.deployment}`,
      `  TypeScript:  ${d.typescript ? 'yes' : 'no'}`,
      `  Pkg manager: ${d.packageManager}`,
      `  CSS:         ${d.cssFramework}`,
      `  UI library:  ${d.uiLibrary}`,
      ''
    );
  }

  lines.push(
    `  Pages:          ${scan.pages.length} routes`,
    `  API routes:     ${scan.apiRoutes.length} (${authRoutes} authenticated${unauthMutating > 0 ? `, ${unauthMutating} unprotected mutations` : ''})`,
    `  Components:     ${scan.componentCount} files`,
    `  Shared UI:      ${scan.sharedUiFiles.length} files`,
    `  State stores:   ${scan.storeFiles.length} files`,
    `  Test files:     ${scan.testFiles.length} files`,
    `  Large files:    ${scan.largeFiles.length} (above ${config.largeFileThreshold} lines)`,
    `  Risky files:    ${scan.riskyFiles.length}`,
    `  Env files:      ${scan.envFiles.length}`,
    `  Boundary risks: ${scan.clientBoundaryRisks.length}`,
    `  Env vars found: ${(d?.envVars ?? []).length}`,
    ''
  );

  if (scan.largeFiles.length > 0) {
    lines.push('  Large files:');
    for (const lf of scan.largeFiles.slice(0, 5)) {
      lines.push(`    ${lf.file} (${lf.lines} lines)`);
    }
    if (scan.largeFiles.length > 5) lines.push(`    … and ${scan.largeFiles.length - 5} more`);
    lines.push('');
  }

  if (scan.languages && scan.languages.length > 0) {
    lines.push('Languages detected:');
    for (const lang of scan.languages) {
      const namePad  = lang.language.padEnd(14);
      const filePart = `${lang.fileCount} file${lang.fileCount === 1 ? '' : 's'}`.padStart(10);
      const linePart = `${lang.lineCount.toLocaleString()} lines`.padStart(12);
      lines.push(`  ${namePad}${filePart}${linePart}`);
    }
    lines.push('');
  }

  if (scan.detectedStacks && scan.detectedStacks.length > 0) {
    lines.push(`Detected stacks:  ${scan.detectedStacks.join(', ')}`);
    lines.push('');
  }

  lines.push(`Report written to .thesmos/report.json`);
  return lines.join('\n');
}

export function formatScanMarkdown(scan: ScanResult, config: ThesmosConfig): string {
  const d = scan.detector;
  const lines = [`## Thesmos Scan — ${config.project}\n`];

  if (d) {
    lines.push('### Stack');
    lines.push('| Field | Value |');
    lines.push('|---|---|');
    lines.push(`| Framework | \`${d.framework}\` |`);
    lines.push(`| Auth | \`${d.auth}\` |`);
    lines.push(`| TypeScript | ${d.typescript ? 'yes' : 'no'} |`);
    lines.push(`| CSS | \`${d.cssFramework}\` |`);
    lines.push(`| UI Library | \`${d.uiLibrary}\` |`);
    lines.push('');
  }

  lines.push('### Summary');
  lines.push('| Metric | Count |');
  lines.push('|---|---|');
  lines.push(`| Pages | ${scan.pages.length} |`);
  lines.push(`| API routes | ${scan.apiRoutes.length} |`);
  lines.push(`| Components | ${scan.componentCount} |`);
  lines.push(`| Test files | ${scan.testFiles.length} |`);
  lines.push(`| Large files | ${scan.largeFiles.length} |`);
  lines.push(`| Boundary risks | ${scan.clientBoundaryRisks.length} |`);

  return lines.join('\n') + '\n';
}

// ── I/O command ───────────────────────────────────────────────────────────────

export async function cmdScan(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');

  const scan = runScanner(root, config);

  // Persist to .thesmos/report.json, preserving any manually-added keys
  const reportPath = join(root, '.thesmos', 'report.json');
  const reportDir = dirname(reportPath);
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  let existing: Record<string, JsonValue> = {};
  if (existsSync(reportPath)) {
    try {
      existing = JSON.parse(readFileSync(reportPath, 'utf8')) as Record<string, JsonValue>;
    } catch {
      // Corrupted or truncated report.json — start fresh rather than crash
    }
  }

  const scanData = scan as unknown as Record<string, JsonValue>;
  const generatedKeys = Object.keys(scanData);
  const merged = sortReport(applyGeneratedSections(existing, scanData, generatedKeys));
  writeFileSync(reportPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  if (json) {
    process.stdout.write(JSON.stringify(scan, null, 2) + '\n');
    return;
  }

  if (markdown) {
    process.stdout.write(formatScanMarkdown(scan, config));
    return;
  }

  console.log(formatScanConsole(scan, config));
}
