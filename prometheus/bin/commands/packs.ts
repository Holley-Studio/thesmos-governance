/**
 * prometheus pack:list / pack:validate
 *
 * list      — show all installed packs
 * validate  — validate all pack manifests
 *
 * Flags:
 *   --json   machine-readable JSON
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  discoverPacks,
  validateAllPacks,
  formatPackListConsole,
  formatPackListJson,
  formatPackValidateConsole,
  formatPackValidateJson,
} from '../../packs.ts';

export async function cmdPacks(subcommand: string, argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');

  const packs = discoverPacks(root);

  if (subcommand === 'list') {
    if (json) {
      process.stdout.write(formatPackListJson(packs) + '\n');
      return;
    }
    console.log(formatPackListConsole(packs, config.project));
    return;
  }

  if (subcommand === 'validate') {
    const results = validateAllPacks(packs);
    if (json) {
      process.stdout.write(formatPackValidateJson(results) + '\n');
      return;
    }
    console.log(formatPackValidateConsole(results));
    const anyInvalid = [...results.values()].some((r) => !r.result.valid);
    if (anyInvalid) process.exit(1);
    return;
  }

  process.stderr.write(
    `prometheus pack: unknown subcommand "${subcommand}"\n` +
      `  Available: pack:list  pack:validate\n`
  );
  process.exit(1);
}
