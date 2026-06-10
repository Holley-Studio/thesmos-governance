/**
 * prometheus health — governance health score (0–100).
 *
 * Synthesises findings, drift, suppressions, and report freshness
 * into a single score and grade so teams can track governance health at a glance.
 *
 * Flags:
 *   --json       machine-readable JSON
 *   --markdown   markdown output
 *   --fail       exit 1 if score drops below --threshold (default 60)
 *   --threshold=<n>  score threshold for --fail (default 60)
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  computeHealthForRoot,
  formatHealthConsole,
  formatHealthMarkdown,
  formatHealthJson,
} from '../../health.ts';

export async function cmdHealth(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const fail = flag(flags, 'fail');
  const thresholdStr = flagVal(flags, 'threshold');
  const threshold = thresholdStr ? parseInt(thresholdStr, 10) : 60;

  const health = computeHealthForRoot(root, config);

  if (json) {
    process.stdout.write(formatHealthJson(health) + '\n');
  } else if (markdown) {
    process.stdout.write(formatHealthMarkdown(health, config.project) + '\n');
  } else {
    console.log(formatHealthConsole(health, config.project));
  }

  if (fail && health.score < threshold) {
    if (!json && !markdown) {
      process.stderr.write(`\nHealth score ${health.score} is below threshold ${threshold} — failing CI\n`);
    }
    process.exit(1);
  }
}
