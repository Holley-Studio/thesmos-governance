// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos claims:lint / claims:check — enforce the product claims registry.
 *
 * Exit codes: 0 clean · 1 findings · 2 registry invalid or missing
 *
 * `lint` reports findings. `check` is the CI form and is identical in effect;
 * both fail on any finding. They are separate names so CI intent reads clearly.
 */
import { join } from 'node:path';
import { parseArgs, flag } from '../lib/args.ts';
import { loadClaimsRegistry, runClaimsLint, formatClaimsLint } from '../../claims.ts';

export async function cmdClaimsLint(argv: string[]): Promise<void> {
  const [mode = 'lint', ...rest] = argv;
  const { flags } = parseArgs(rest);
  const json = flag(flags, 'json');

  const cwd = process.cwd();
  const pkgRoot = cwd.endsWith('thesmos') ? cwd : join(cwd, 'thesmos');
  const repoRoot = cwd.endsWith('thesmos') ? join(cwd, '..') : cwd;

  let result;
  let disclaimer = '';
  try {
    disclaimer = loadClaimsRegistry(pkgRoot).disclaimer;
    result = runClaimsLint(repoRoot, pkgRoot);
  } catch (err) {
    console.error(`claims:${mode}: ${(err as Error).message}`);
    process.exit(2);
  }

  if (json) process.stdout.write(JSON.stringify({ ...result, disclaimer }, null, 2) + '\n');
  else console.log(formatClaimsLint(result, disclaimer));

  if (result.errors > 0) process.exit(1);
}
