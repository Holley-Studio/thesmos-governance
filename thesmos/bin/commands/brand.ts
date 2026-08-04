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
import { join } from 'node:path';
import { parseArgs, flag } from '../lib/args.ts';
import { runNamingLint, formatNamingLintConsole } from '../../brand.ts';

/** Minimum public-surface files a real scan must reach. */
const MIN_EXPECTED_FILES = 50;

export async function cmdBrandLint(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');

  // Resolve the monorepo root whether invoked from there or from the thesmos
  // workspace. Getting this wrong scans almost nothing and reports "clean" —
  // a false all-clear, which is worse than an error.
  const cwd = process.cwd();
  const repoRoot = cwd.endsWith('thesmos') ? join(cwd, '..') : cwd;

  let result;
  try {
    result = runNamingLint(repoRoot);
    if (result.filesScanned < MIN_EXPECTED_FILES) {
      console.error(
        `brand:lint: scanned only ${result.filesScanned} file(s) from "${repoRoot}" — ` +
          `expected at least ${MIN_EXPECTED_FILES}. Refusing to report a pass on a scan this small.`,
      );
      process.exit(2);
    }
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
