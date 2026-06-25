// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos validate — review checks that exit 1 on failOnSeverity findings.
 * Designed for CI: blocks merges when BLOCKER/HIGH findings are present.
 *
 * Flags:
 *   --base=<branch>   diff HEAD against <branch> to get changed files
 *   --json            output as JSON
 *   --markdown        output as Markdown
 * Positionals:
 *   [file...]         specific files to validate (overrides --base)
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { getChangedFiles, readFilesFromPaths } from '../lib/git.ts';
import { loadReport } from '../lib/report.ts';
import {
  runReview,
  formatFindingsConsole,
  formatFindingsMarkdown,
  formatFindingsJson,
  formatFindingsSarif,
} from '../../review.ts';
import { exitCodeFor, shouldWarn } from '../../severity.ts';
import { loadBaseline, partitionFindings } from '../../baseline.ts';
import { getActiveRules } from '../../packs.ts';

export async function cmdValidate(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags, positionals } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const sarif = flag(flags, 'sarif');
  const base = flagVal(flags, 'base');
  const noBaseline = flag(flags, 'no-baseline');

  const scan = loadReport(root);

  if (!scan) {
    process.stderr.write('thesmos validate: .thesmos/report.json not found — run thesmos scan first\n');
    process.exit(1);
  }

  let changedFiles;
  if (positionals.length > 0) {
    changedFiles = readFilesFromPaths(root, positionals);
  } else if (base) {
    changedFiles = getChangedFiles(root, base);
  }

  const registry = await getActiveRules(root);
  const allFindings = runReview({ scan, config, changedFiles }, registry);

  // Auto-load baseline if present (suppresses known debt from CI exit code)
  const baseline = noBaseline ? null : loadBaseline(root);
  const findings = baseline
    ? partitionFindings(allFindings, baseline).newFindings
    : allFindings;

  const exitCode = exitCodeFor(findings, config);

  if (json) {
    process.stdout.write(formatFindingsJson(findings));
    if (baseline) {
      const suppressed = allFindings.length - findings.length;
      if (suppressed > 0) process.stderr.write(`(${suppressed} baseline findings suppressed)\n`);
    }
    process.exit(exitCode);
    return;
  }

  if (sarif) {
    process.stdout.write(formatFindingsSarif(findings));
    process.exit(exitCode);
    return;
  }

  if (markdown) {
    process.stdout.write(formatFindingsMarkdown(findings, config.project));
    process.exit(exitCode);
    return;
  }

  console.log(formatFindingsConsole(findings, config.project, 'Validate'));

  if (baseline) {
    const suppressed = allFindings.length - findings.length;
    if (suppressed > 0) {
      process.stderr.write(`\nnote: ${suppressed} baseline finding${suppressed === 1 ? '' : 's'} suppressed — run thesmos baseline:report for details\n`);
    }
  }

  if (exitCode === 1) {
    process.stderr.write('\nerror: BLOCKER findings — pipeline must not merge\n');
  } else if (shouldWarn(findings, config)) {
    process.stderr.write('\nwarning: HIGH findings — review before merging\n');
  }

  process.exit(exitCode);
}
