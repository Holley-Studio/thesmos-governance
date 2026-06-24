/**
 * thesmos fix — auto-fix safe violations.
 *
 * Delegates all logic to the prometheus/fix.ts library module.
 * This file is intentionally thin: parse args → load data → call library → print.
 *
 * Flags:
 *   --apply          Write fixes to disk (default: dry-run/preview)
 *   --rule=<id>      Only fix this specific rule category
 *   --verify         After applying, re-scan to confirm each fix resolved its finding
 *   --json           Machine-readable output
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import { loadBaseline, partitionFindings } from '../../baseline.ts';
import { runFix, formatFixConsole, formatFixJson, applyFixer, verifyFix, AUTO_FIXABLE } from '../../fix.ts';
import type { VerifyResult } from '../../fix.ts';

export async function cmdFix(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const apply = flag(flags, 'apply');
  const ruleFilter = flagVal(flags, 'rule');
  const verify = flag(flags, 'verify');
  const json = flag(flags, 'json');

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write(
      'thesmos fix: .thesmos/report.json not found — run thesmos scan first\n',
    );
    process.exit(1);
  }

  const allFindings = runReview({ scan, config });
  const baseline = loadBaseline(root);
  const findings = baseline
    ? partitionFindings(allFindings, baseline).newFindings
    : allFindings;

  // Capture before-content for each file that has fixable findings (needed for --verify)
  const beforeContents = new Map<string, string>();
  if (verify) {
    for (const f of findings) {
      if (!AUTO_FIXABLE.has(f.category.toLowerCase())) continue;
      if (beforeContents.has(f.file)) continue;
      const absPath = f.file.startsWith('/') ? f.file : join(root, f.file);
      if (existsSync(absPath)) beforeContents.set(f.file, readFileSync(absPath, 'utf8'));
    }
  }

  const result = runFix(root, findings, { apply, ruleFilter: ruleFilter ?? undefined });

  if (json) {
    if (verify) {
      const verifyResults = buildVerifyResults(root, findings, beforeContents, config);
      process.stdout.write(JSON.stringify({ ...JSON.parse(formatFixJson(result)), verify: verifyResults }, null, 2) + '\n');
    } else {
      process.stdout.write(formatFixJson(result) + '\n');
    }
  } else {
    process.stdout.write(formatFixConsole(result));
    if (verify) {
      const verifyResults = buildVerifyResults(root, findings, beforeContents, config);
      process.stdout.write(formatVerifyConsole(verifyResults));
    }
  }
}

function buildVerifyResults(
  root: string,
  findings: import('../../types.ts').Finding[],
  beforeContents: Map<string, string>,
  config: import('../../types.ts').ThesmosConfig,
): VerifyResult[] {
  const results: VerifyResult[] = [];
  for (const f of findings) {
    if (!AUTO_FIXABLE.has(f.category.toLowerCase())) continue;
    const beforeContent = beforeContents.get(f.file);
    if (beforeContent === undefined) continue;
    const afterContent = applyFixer(beforeContent, f);
    if (afterContent === null) continue;
    const filePath = f.file.startsWith('/') ? f.file : join(root, f.file);
    results.push(verifyFix(filePath, beforeContent, afterContent, f, config));
  }
  return results;
}

function formatVerifyConsole(results: VerifyResult[]): string {
  if (results.length === 0) return '';
  const lines = ['', '  Verification results', ''];
  for (const r of results) {
    const loc = r.originalFinding.line != null ? `:${r.originalFinding.line}` : '';
    const file = r.originalFinding.file + loc;
    if (r.safe) {
      lines.push(`  ✅  Verified: ${file}  [${r.originalFinding.category}]  — fix confirmed, no regressions`);
    } else if (!r.findingResolved) {
      lines.push(`  ❌  Unresolved: ${file}  [${r.originalFinding.category}]  — finding still fires after fix`);
    } else {
      const n = r.newFindingsIntroduced.length;
      lines.push(`  ⚠️   Regression: ${file}  [${r.originalFinding.category}]  — fix resolved but introduced ${n} new finding(s)`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
