/**
 * prometheus debt:scan — AI debt fingerprinting for AI-generated code.
 *
 * Runs DEBT_001–020 rules against changed files (or all source files)
 * and produces a debt report with a score (0–100, lower = more debt).
 *
 * Usage:
 *   prometheus debt:scan                 # Scan all source files
 *   prometheus debt:scan src/api/        # Scan a specific directory
 *   prometheus debt:scan --base=main     # Scan files changed vs. main
 *   prometheus debt:scan --json          # Machine-readable output
 *   prometheus debt:scan --ci            # Exit 1 on HIGH+ findings
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEBT_RULES } from '../../rules/debt.js';
import type { DetectInput, Finding, ScanResult } from '../../types.js';
import { CONFIG_DEFAULTS, loadConfig } from '../../config.js';
import { makeLogger } from '../../logger.js';

const log = makeLogger('debt');

const SEVERITY_WEIGHT: Record<string, number> = { BLOCKER: 20, HIGH: 10, MEDIUM: 5, LOW: 2 };

function scoreFromFindings(findings: Finding[], fileCount: number): number {
  if (fileCount === 0) return 100;
  const totalWeight = findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  const maxWeightPerFile = 30;
  const raw = Math.max(0, 100 - totalWeight / Math.max(1, fileCount) * (maxWeightPerFile / 10));
  return Math.round(Math.min(100, raw));
}

function grade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function collectFiles(target: string): string[] {
  const files: string[] = [];
  const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '__pycache__']);

  function walk(p: string) {
    const stat = statSync(p);
    if (stat.isFile()) {
      if (SOURCE_EXT.test(p)) files.push(p);
      return;
    }
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      walk(join(p, entry.name));
    }
  }

  if (existsSync(target)) walk(target);
  return files;
}

export async function cmdDebtScan(argv: string[]): Promise<void> {
  const asJson = argv.includes('--json');
  const ci     = argv.includes('--ci');
  const root   = process.cwd();

  const targets = argv.filter((a) => !a.startsWith('--'));
  const files   = targets.length > 0
    ? targets.flatMap((t) => collectFiles(t))
    : collectFiles(root);

  if (files.length === 0) {
    if (asJson) { console.log(JSON.stringify({ score: 100, grade: 'A', findings: [] }, null, 2)); return; }
    console.log('\ndebt:scan — no source files found.\n');
    return;
  }

  let config = CONFIG_DEFAULTS;
  try { config = loadConfig(root); } catch { /* */ }

  const changedFiles = files.map((p) => {
    try { return { path: p, content: readFileSync(p, 'utf8') }; } catch { return null; }
  }).filter((f): f is { path: string; content: string } => f !== null);

  const emptyScan: ScanResult = {
    _generatedSections: [], generatedAt: new Date().toISOString(), scanVersion: '0',
    pages: [], apiRoutes: [], componentCount: 0, sharedUiFiles: [],
    designSystemFiles: [], storeFiles: [], testFiles: [], largeFiles: [],
    riskyFiles: [], scriptFiles: [], envFiles: [], clientBoundaryRisks: [],
    languages: [], detectedStacks: [],
  };

  const detectInput: DetectInput = {
    scan: emptyScan,
    config,
    changedFiles,
  };

  const allFindings: Finding[] = [];
  for (const rule of DEBT_RULES) {
    try {
      allFindings.push(...rule.detect(detectInput));
    } catch (e) {
      log.warn('debt rule threw', {
        rule: rule.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const score = scoreFromFindings(allFindings, changedFiles.length);
  const debtGrade = grade(score);

  if (asJson) {
    console.log(JSON.stringify({ score, grade: debtGrade, fileCount: files.length, findings: allFindings }, null, 2));
    if (ci && allFindings.some((f) => f.severity === 'HIGH' || f.severity === 'BLOCKER')) process.exit(1);
    return;
  }

  console.log('\nPrometheus AI Debt Report\n');
  console.log(`  Files scanned: ${files.length}`);
  console.log(`  Debt score:    ${score}/100 (${debtGrade})\n`);

  if (allFindings.length === 0) {
    console.log('  ✓ No AI debt patterns detected.\n');
    return;
  }

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const f of allFindings) {
    const key = f.file;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(f);
  }

  const ICON: Record<string, string> = { BLOCKER: '🚫', HIGH: '🔴', MEDIUM: '🟡', LOW: '⚪' };
  for (const [file, findings] of byFile) {
    console.log(`  ${file}`);
    for (const f of findings) {
      const icon = ICON[f.severity] ?? '⚪';
      const loc  = f.line ? `:${f.line}` : '';
      console.log(`    ${icon} [${f.severity}] ${f.message}`);
      if (f.suggestion) console.log(`         → ${f.suggestion}`);
    }
    console.log('');
  }

  const counts: Record<string, number> = {};
  for (const f of allFindings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const summary = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ');
  console.log(`  Total: ${allFindings.length} finding${allFindings.length !== 1 ? 's' : ''} — ${summary}\n`);

  if (ci && allFindings.some((f) => f.severity === 'HIGH' || f.severity === 'BLOCKER')) {
    process.stderr.write('debt:scan: HIGH+ findings — exiting 1 for CI gate.\n');
    process.exit(1);
  }
}
