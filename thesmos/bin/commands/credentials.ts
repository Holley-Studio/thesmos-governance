// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos credentials:lint — detect fabricated agent credentials.
 *
 * Exit codes: 0 clean · 1 errors found · 2 policy invalid (broad glob exception)
 */
import { join } from 'node:path';
import { parseArgs, flag } from '../lib/args.ts';
import { runCredentialLint, formatCredentialLint } from '../../credentials.ts';

export async function cmdCredentialsLint(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');

  const cwd = process.cwd();
  // Works from the monorepo root or the thesmos workspace directory.
  const pkgRoot = cwd.endsWith('thesmos') ? cwd : join(cwd, 'thesmos');
  const repoRoot = cwd.endsWith('thesmos') ? join(cwd, '..') : cwd;

  let result;
  try {
    result = runCredentialLint(pkgRoot, repoRoot);
  } catch (err) {
    console.error(`credentials:lint: ${(err as Error).message}`);
    process.exit(2);
  }

  if (json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else console.log(formatCredentialLint(result));

  if (result.errors > 0) process.exit(1);
}
