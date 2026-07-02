// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos update — convenience command.
 *
 * Runs in sequence:
 *   1. scan        — refresh .thesmos/report.json
 *   2. adapters    — regenerate all AI adapter files
 *   3. drift       — check for adapter drift / missing files
 *
 * This replaces the common three-command CI setup pattern.
 * Exits 1 if drift detects BLOCKER issues.
 *
 * Flags:
 *   --json      Print JSON summary of each step
 *   --skip-adapters   Skip adapter regeneration (scan + drift only)
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { cmdScan } from './scan.ts';
import { cmdAdapters } from './adapters.ts';
import { cmdDrift } from './drift.ts';

export async function cmdUpdate(argv: string[]): Promise<void> {
  const { config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const skipAdapters = flag(flags, 'skip-adapters');

  const outputFlags = json ? ['--json'] : [];

  console.log('\n  thesmos update\n');

  // Step 1: scan
  console.log('  [1/3] scan — refreshing report.json…');
  try {
    await cmdScan(outputFlags);
  } catch (err) {
    process.stderr.write(`thesmos update: scan failed — ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  // Step 2: adapters
  if (!skipAdapters) {
    console.log('\n  [2/3] adapters — regenerating adapter files…');
    try {
      await cmdAdapters(outputFlags);
    } catch (err) {
      process.stderr.write(`thesmos update: adapters failed — ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  } else {
    console.log('\n  [2/3] adapters — skipped (--skip-adapters)');
  }

  // Step 3: drift
  console.log('\n  [3/3] drift — checking for adapter drift…');
  try {
    await cmdDrift(outputFlags);
  } catch (err) {
    // drift exits 1 on BLOCKER — let that propagate
    process.stderr.write(`thesmos update: drift check failed — ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }

  console.log('\n  ✅  thesmos update complete\n');
}
