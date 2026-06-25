// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos suppressions:audit
 *
 * Scans the project for thesmos-disable-next-line comments and audits them for:
 *   - missing reasons
 *   - expired suppressions
 *   - unused suppressions (rule no longer fires at that line)
 *   - blanket suppressions (no rule ID)
 *
 * Flags:
 *   --json       machine-readable JSON
 *   --markdown   markdown output
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import {
  extractSuppressions,
  auditSuppressions,
  formatSuppressionAuditConsole,
  formatSuppressionAuditMarkdown,
  formatSuppressionAuditJson,
} from '../../suppress.ts';
import type { Suppression } from '../../suppress.ts';

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage']);

function walkSourceFiles(dir: string, root: string): string[] {
  const files: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(abs, root));
    } else if (SOURCE_EXTENSIONS.test(entry)) {
      files.push(abs);
    }
  }
  return files;
}

export async function cmdSuppressions(subcommand: string, argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');

  if (subcommand !== 'audit') {
    process.stderr.write(
      `thesmos suppressions: unknown subcommand "${subcommand}"\n` +
        `  Available: suppressions:audit\n`
    );
    process.exit(1);
  }

  // Collect all suppressions from source files
  const sourceFiles = walkSourceFiles(root, root);
  const allSuppressions: Suppression[] = [];

  for (const absPath of sourceFiles) {
    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }
    const relPath = relative(root, absPath);
    const sups = extractSuppressions(content, relPath);
    allSuppressions.push(...sups);
  }

  // Get current findings to detect unused suppressions
  const scan = loadReport(root);
  const findings = scan ? runReview({ scan, config }) : [];

  if (!scan) {
    process.stderr.write(
      'thesmos suppressions:audit: .thesmos/report.json not found — unused-suppression check skipped\n'
    );
  }

  const auditFindings = auditSuppressions({
    suppressions: allSuppressions,
    findings,
    now: new Date(),
  });

  if (json) {
    process.stdout.write(
      formatSuppressionAuditJson(auditFindings, allSuppressions.length) + '\n'
    );
    return;
  }

  if (markdown) {
    process.stdout.write(
      formatSuppressionAuditMarkdown(auditFindings, allSuppressions.length, config.project) + '\n'
    );
    return;
  }

  console.log(
    formatSuppressionAuditConsole(auditFindings, allSuppressions.length, config.project)
  );

  if (auditFindings.some((f) => f.severity === 'HIGH')) {
    process.exit(1);
  }
}
