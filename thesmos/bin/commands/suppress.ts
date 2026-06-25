// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos suppress <rule-id>
 *
 * Records a suppress event for a rule in the user profile (learning loop).
 * After AUTO_DOWNGRADE_THRESHOLD (3) suppressions, the rule is auto-flagged
 * as frequently-ignored in `thesmos profile:view`.
 *
 * Usage:
 *   thesmos suppress <rule-id>
 *   thesmos suppress <rule-id> --reason="legacy code" --owner=@alice --expires=2026-12-31
 *   thesmos suppress <rule-id> --json
 *
 * This command records the learning event; it also prints the inline comment
 * syntax so users can copy it into their source file.
 */

import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { recordSuppress, getFrequentlyIgnored } from '../../profile.ts';

export async function cmdSuppress(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv);
  const rule = positionals[0];
  const json = flag(flags, 'json');
  const reason = flagVal(flags, 'reason') ?? '';
  const owner = flagVal(flags, 'owner');
  const expires = flagVal(flags, 'expires');

  if (!rule) {
    process.stderr.write(
      'Usage: thesmos suppress <rule-id> [--reason="..."] [--owner=@alice] [--expires=YYYY-MM-DD]\n',
    );
    process.exit(1);
  }

  recordSuppress(rule);

  const frequently = getFrequentlyIgnored();
  const isFrequent = frequently.includes(rule);

  // Build inline comment for copy-paste
  const parts = [`// thesmos-disable-next-line ${rule}`];
  if (reason) parts.push(`-- reason: ${reason}`);
  if (owner) parts.push(`-- owner: ${owner}`);
  if (expires) parts.push(`-- expires: ${expires}`);
  const commentLine = parts.join(' ');

  if (json) {
    process.stdout.write(
      JSON.stringify({ rule, frequent: isFrequent, comment: commentLine }) + '\n',
    );
    return;
  }

  console.log(`\n  ✅ Suppress recorded: ${rule}\n`);
  console.log(`  Add this comment on the line BEFORE the violation:\n`);
  console.log(`    ${commentLine}\n`);
  if (reason) {
    // nothing extra — reason already shown in comment
  } else {
    console.log(`  💡 Tip: add --reason="..." to document why this is suppressed.\n`);
  }
  if (isFrequent) {
    console.log(
      `  ⚠️  This rule has been suppressed ${3}+ times. Consider running:\n` +
        `     thesmos profile:correct ${rule} --severity=LOW\n`,
    );
  }
}
