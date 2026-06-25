// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos review — run review checks and report findings.
 * Always exits 0 (informational). Use `validate` to gate CI.
 *
 * Flags:
 *   --base=<branch>   diff HEAD against <branch> to get changed files
 *   --json            output as JSON
 *   --markdown        output as Markdown
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
  formatFindingsJson,
  formatFindingsSarif,
} from '../../review.ts';
import { shouldWarn } from '../../severity.ts';
import { getActiveRules } from '../../packs.ts';

export async function cmdReview(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags, positionals } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const sarif = flag(flags, 'sarif');
  const base = flagVal(flags, 'base');

  const scan = loadReport(root);

  if (!scan) {
    process.stderr.write('thesmos review: .thesmos/report.json not found — run thesmos scan first\n');
    process.exit(1);
  }

  let changedFiles;
  if (positionals.length > 0) {
    changedFiles = readFilesFromPaths(root, positionals);
  } else if (base) {
    changedFiles = getChangedFiles(root, base);
  }
  // undefined → scan-based checks only (no file content)

  const registry = await getActiveRules(root);
  const findings = coreRunReview({ scan, config, changedFiles }, registry);

  if (json) {
    process.stdout.write(formatFindingsJson(findings));
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

  if (shouldWarn(findings, config)) {
    process.stderr.write('\nwarning: findings match warnOnSeverity — review before merging\n');
  }
}
