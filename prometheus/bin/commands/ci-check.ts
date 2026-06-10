/**
 * prometheus ci-check — fast CI-critical health check.
 * Verifies required files, adapter freshness, and config validity.
 * Exits 1 when any check fails.
 *
 * Flags:
 *   --json       output as JSON
 *   --markdown   output as Markdown
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  runCiCheckForRoot,
  formatCiCheckConsole,
  formatCiCheckMarkdown,
  formatCiCheckJson,
} from '../../ci-check.ts';

export async function cmdCiCheck(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');

  const checks = runCiCheckForRoot(root, config);
  const hasFailures = checks.some((c) => !c.pass);

  if (json) {
    process.stdout.write(formatCiCheckJson(checks) + '\n');
  } else if (markdown) {
    process.stdout.write(formatCiCheckMarkdown(checks, config.project));
  } else {
    console.log(formatCiCheckConsole(checks, config.project));
  }

  if (hasFailures) process.exit(1);
}
