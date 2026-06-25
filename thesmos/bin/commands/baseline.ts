// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos baseline:create / baseline:update / baseline:report
 *
 * create  — snapshot all current findings as known debt
 * update  — add newly accepted debt; remove fixed findings
 * report  — show debt status, new violations, and resolved entries
 *
 * Flags (report / update):
 *   --json       emit machine-readable JSON
 *   --markdown   emit Markdown
 *   --no-baseline  (create only) overwrite an existing baseline
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import {
  BASELINE_PATH,
  createBaseline,
  updateBaseline,
  partitionFindings,
  loadBaseline,
  saveBaseline,
  formatBaselineConsole,
  formatBaselineMarkdown,
  formatBaselineJson,
} from '../../baseline.ts';

export async function cmdBaseline(subcommand: string, argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write(
      `thesmos baseline:${subcommand}: .thesmos/report.json not found — run thesmos scan first\n`
    );
    process.exit(1);
  }

  const findings = runReview({ scan, config });

  if (subcommand === 'create') {
    const existing = loadBaseline(root);
    if (existing && !flag(flags, 'force')) {
      process.stderr.write(
        `thesmos baseline:create: baseline already exists at ${BASELINE_PATH}\n` +
          `  Run with --force to overwrite, or use baseline:update to merge changes.\n`
      );
      process.exit(1);
    }

    const baseline = createBaseline(findings, new Date());
    saveBaseline(root, baseline);

    const count = baseline.entries.length;
    process.stdout.write(
      `✅  Baseline created at ${BASELINE_PATH}\n` +
        `   ${count} finding${count === 1 ? '' : 's'} recorded as known debt.\n` +
        `   Future runs of thesmos validate will only fail on NEW violations.\n`
    );
    return;
  }

  if (subcommand === 'update') {
    const existing = loadBaseline(root);
    if (!existing) {
      process.stderr.write(
        `thesmos baseline:update: no baseline found — run baseline:create first\n`
      );
      process.exit(1);
    }

    const result = updateBaseline(existing, findings, new Date());
    saveBaseline(root, result.updated);

    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            added: result.added.length,
            resolved: result.resolved.length,
            total: result.updated.entries.length,
            addedEntries: result.added,
            resolvedEntries: result.resolved,
          },
          null,
          2
        ) + '\n'
      );
      return;
    }

    const { added, resolved, updated } = result;
    process.stdout.write(`Thesmos Baseline — ${config.project}\n`);
    process.stdout.write(`${'─'.repeat(56)}\n`);
    if (added.length === 0 && resolved.length === 0) {
      process.stdout.write(`  No changes — baseline is up to date.\n`);
    } else {
      if (added.length > 0) {
        process.stdout.write(`  + ${added.length} finding${added.length === 1 ? '' : 's'} added to baseline\n`);
        for (const e of added) {
          process.stdout.write(`    [${e.ruleCategory}] ${e.file}  ${e.message.slice(0, 70)}\n`);
        }
      }
      if (resolved.length > 0) {
        process.stdout.write(`  ✓ ${resolved.length} finding${resolved.length === 1 ? '' : 's'} resolved (removed from baseline)\n`);
        for (const e of resolved) {
          process.stdout.write(`    [${e.ruleCategory}] ${e.file}  ${e.message.slice(0, 70)}\n`);
        }
      }
    }
    process.stdout.write(`${'─'.repeat(56)}\n`);
    process.stdout.write(`  ${updated.entries.length} total baseline entr${updated.entries.length === 1 ? 'y' : 'ies'}\n`);
    return;
  }

  if (subcommand === 'report') {
    const existing = loadBaseline(root);
    if (!existing) {
      process.stderr.write(
        `thesmos baseline:report: no baseline found — run baseline:create first\n`
      );
      process.exit(1);
    }

    const partition = partitionFindings(findings, existing);

    if (json) {
      process.stdout.write(formatBaselineJson(partition, existing) + '\n');
      return;
    }

    if (markdown) {
      process.stdout.write(formatBaselineMarkdown(partition, existing, config.project) + '\n');
      return;
    }

    console.log(formatBaselineConsole(partition, existing, config.project));
    return;
  }

  process.stderr.write(
    `thesmos baseline: unknown subcommand "${subcommand}"\n` +
      `  Available: baseline:create  baseline:update  baseline:report\n`
  );
  process.exit(1);
}
