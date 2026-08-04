// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos brand:lint — enforce the canonical naming registry on public surfaces.
 *
 * Exit codes:
 *   0  no errors
 *   1  one or more naming errors (CI gates on this)
 *   2  the registry itself is invalid or missing
 *
 * Flags:
 *   --json   machine-readable findings
 *
 * A clean run means the repository is internally consistent with the
 * PROVISIONAL naming decision in brand-registry.json. It is not a trademark
 * clearance and must never be described as one.
 */
import { parseArgs, flag } from '../lib/args.ts';
import { runNamingLint, formatNamingLintConsole } from '../../brand.ts';

export async function cmdBrandLint(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');

  let result;
  try {
    result = runNamingLint(process.cwd());
  } catch (err) {
    // A missing or malformed registry must fail loudly. Degrading to "no
    // findings" would be a false all-clear on the exact thing being checked.
    console.error(`brand:lint: ${(err as Error).message}`);
    process.exit(2);
  }

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(formatNamingLintConsole(result));
  }

  if (result.errors > 0) process.exit(1);
}
