// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos review — run review checks and report findings.
 * Always exits 0 (informational). Use `validate` to gate CI.
 *
 * Baseline behavior (mirrors `validate`):
 *   By default, findings that match an entry in .thesmos/baseline.json (accepted
 *   debt) are suppressed from the default view — only NEW findings are shown.
 *   Use --no-baseline to see everything, including previously-accepted debt.
 *
 * Flags:
 *   --base=<branch>   diff HEAD against <branch> to get changed files
 *   --json            output as JSON
 *   --markdown        output as Markdown
 *   --no-baseline     ignore .thesmos/baseline.json — show all findings
 * Positionals:
 *   [file...]         specific files to review (overrides --base)
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { getChangedFiles, readFilesFromPaths } from '../lib/git.ts';
import { loadReport } from '../lib/report.ts';
import {
  runReview as coreRunReview,
  formatFindingsConsole,
  formatFindingsMarkdown,
  formatFindingsSarif,
} from '../../review.ts';
import { shouldWarn } from '../../severity.ts';
import { loadBaseline, partitionFindings } from '../../baseline.ts';
import { getActiveRules } from '../../packs.ts';

export async function cmdReview(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags, positionals } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const sarif = flag(flags, 'sarif');
  const base = flagVal(flags, 'base');
  const noBaseline = flag(flags, 'no-baseline');

  const scan = loadReport(root);

  if (!scan) {
    process.stderr.write('thesmos review: .thesmos/report.json not found — run thesmos scan first\n');
    process.exit(1);
  }

  let changedFiles;
  if (positionals.length > 0) {
    changedFiles = readFilesFromPaths(root, positionals, config.reviewIgnorePaths ?? []);
  } else if (base) {
    changedFiles = getChangedFiles(root, base, config.ignoredFolders ?? [], config.reviewIgnorePaths ?? []);
  }
  // undefined → scan-based checks only (no file content)

  const registry = await getActiveRules(root);
  const allFindings = coreRunReview({ scan, config, changedFiles, root }, registry);

  // Auto-load baseline if present (suppresses known/accepted debt from the default view)
  const baseline = noBaseline ? null : loadBaseline(root);
  const findings = baseline
    ? partitionFindings(allFindings, baseline).newFindings
    : allFindings;
  const baselinedCount = allFindings.length - findings.length;

  if (json) {
    process.stdout.write(JSON.stringify({ total: findings.length, findings, baselinedCount }, null, 2));
    return;
  }

  if (sarif) {
    process.stdout.write(formatFindingsSarif(findings));
    return;
  }

  if (markdown) {
    process.stdout.write(formatFindingsMarkdown(findings, config.project));
    return;
  }

  console.log(formatFindingsConsole(findings, config.project, 'Review'));

  if (baseline && baselinedCount > 0) {
    process.stderr.write(`\nnote: ${baselinedCount} baseline finding${baselinedCount === 1 ? '' : 's'} suppressed — run thesmos baseline:report for details\n`);
  }

  if (shouldWarn(findings, config)) {
    process.stderr.write('\nwarning: findings match warnOnSeverity — review before merging\n');
  }
}
