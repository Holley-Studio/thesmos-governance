// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos vercel:lint — governance scan for Vercel deployment configuration.
 *
 * Usage:
 *   thesmos vercel:lint              # Scan vercel.json + env vars + cron routes
 *   thesmos vercel:lint --json       # JSON output for CI
 *   thesmos vercel:lint --strict     # Also flag MEDIUM severity
 *   thesmos vercel:lint --fix        # Show suggested fixes inline
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { VERCEL_RULES } from '../../rules/vercel.js';
import type { DetectInput, Finding, ScanResult } from '../../types.js';
import { CONFIG_DEFAULTS, loadConfig } from '../../config.js';

function buildEmptyScan(): ScanResult {
  return {
    _generatedSections: [], generatedAt: new Date().toISOString(), scanVersion: '0',
    pages: [], apiRoutes: [], componentCount: 0, sharedUiFiles: [],
    designSystemFiles: [], storeFiles: [], testFiles: [], largeFiles: [],
    riskyFiles: [], scriptFiles: [], envFiles: [], clientBoundaryRisks: [],
    languages: [], detectedStacks: [],
  };
}

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '__pycache__', '.turbo']);

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];

  function walk(p: string, depth: number = 0) {
    if (depth > 8) return;
    let stat: ReturnType<typeof statSync>;
    try { stat = statSync(p); } catch { return; }
    if (stat.isFile()) {
      if (SOURCE_EXT.test(p) || p.endsWith('vercel.json')) files.push(p);
      return;
    }
    let entries: import('node:fs').Dirent<string>[];
    try { entries = readdirSync(p, { withFileTypes: true }) as import('node:fs').Dirent<string>[]; } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      walk(join(p, entry.name), depth + 1);
    }
  }

  walk(root);
  return files;
}

export async function cmdVercelLint(argv: string[]): Promise<void> {
  const asJson  = argv.includes('--json');
  const strict  = argv.includes('--strict');
  const showFix = argv.includes('--fix');
  const root    = process.cwd();

  // Check if this looks like a Vercel project
  const hasVercelJson = existsSync(join(root, 'vercel.json'));
  const hasNextConfig = existsSync(join(root, 'next.config.ts')) ||
                        existsSync(join(root, 'next.config.js')) ||
                        existsSync(join(root, 'next.config.mjs'));

  if (!hasVercelJson && !hasNextConfig) {
    if (asJson) {
      process.stdout.write(JSON.stringify({ findings: [], message: 'No Vercel project detected.' }, null, 2) + '\n');
    } else {
      console.log('\nvercel:lint — no vercel.json or next.config found. Skipping.\n');
    }
    return;
  }

  let config = CONFIG_DEFAULTS;
  try { config = loadConfig(root); } catch { /* */ }

  const files = collectSourceFiles(root);
  const changedFiles = files.map((p) => {
    try { return { path: p, content: readFileSync(p, 'utf8') }; } catch { return null; }
  }).filter((f): f is { path: string; content: string } => f !== null);

  // Also add vercel.json with relative path for rule matching
  if (hasVercelJson) {
    const vercelPath = join(root, 'vercel.json');
    if (!changedFiles.some((f) => f.path === 'vercel.json' || f.path === vercelPath)) {
      try {
        changedFiles.push({ path: 'vercel.json', content: readFileSync(vercelPath, 'utf8') });
      } catch { /* */ }
    }
  }

  const detectInput: DetectInput = {
    scan: buildEmptyScan(),
    config,
    changedFiles,
  };

  const allFindings: Finding[] = [];
  for (const rule of VERCEL_RULES) {
    try { allFindings.push(...rule.detect(detectInput)); } catch { /* */ }
  }

  const BLOCKER_HIGH = new Set(['BLOCKER', 'HIGH']);
  const relevant = strict
    ? allFindings
    : allFindings.filter((f) => BLOCKER_HIGH.has(f.severity));

  if (asJson) {
    process.stdout.write(JSON.stringify({ findings: allFindings, blockers: relevant.length }, null, 2) + '\n');
    if (allFindings.some((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH')) process.exit(1);
    return;
  }

  console.log('\nThesmos Vercel Lint\n');

  if (allFindings.length === 0) {
    console.log('  ✓ No Vercel governance issues detected.\n');
    return;
  }

  const ICON: Record<string, string> = { BLOCKER: '🚫', HIGH: '🔴', MEDIUM: '🟡', LOW: '⚪' };

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const f of allFindings) {
    const key = f.file ?? 'unknown';
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(f);
  }

  for (const [file, findings] of byFile) {
    // In strict mode show all; otherwise only BLOCKER/HIGH
    const shown = strict ? findings : findings.filter((f) => BLOCKER_HIGH.has(f.severity));
    if (shown.length === 0) continue;

    console.log(`  ${file}`);
    for (const f of shown) {
      const icon = ICON[f.severity] ?? '⚪';
      const loc = f.line ? `:${f.line}` : '';
      console.log(`    ${icon} [${f.severity}] ${f.message}`);
      if (showFix && f.suggestion) console.log(`         → Fix: ${f.suggestion}`);
    }
    console.log('');
  }

  const counts: Record<string, number> = {};
  for (const f of allFindings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const summary = Object.entries(counts).map(([s, n]) => `${n} ${s}`).join(', ');
  console.log(`  Total: ${allFindings.length} finding${allFindings.length !== 1 ? 's' : ''} — ${summary}\n`);

  if (!strict && allFindings.some((f) => f.severity === 'MEDIUM' || f.severity === 'LOW')) {
    console.log('  Tip: run with --strict to show MEDIUM and LOW findings too.\n');
  }

  if (allFindings.some((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH')) {
    process.stderr.write('vercel:lint: BLOCKER or HIGH findings — exiting 1.\n');
    process.exit(1);
  }
}
