// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos advise — recommend a model and Pantheon agents to execute a plan.
 *
 * Usage:
 *   thesmos advise <plan-file>
 *   thesmos advise --text "plan description..."
 *
 * Flags:
 *   --json   machine-readable JSON
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  buildAdvisory,
  formatAdvisoryConsole,
  formatKickoffPrompt,
  loadPantheonMap,
} from '../../advise.ts';

// Resolve relative to this file's own location, not process.cwd() — the CLI
// can be invoked from any directory, but the pantheon map always lives at a
// fixed path inside the thesmos package.
const PANTHEON_MAP_PATH = fileURLToPath(new URL('../../catalog/pantheon-map.json', import.meta.url));

export async function cmdAdvise(argv: string[]): Promise<void> {
  const { flags, positionals } = parseArgs(argv);
  const json = flag(flags, 'json');
  const textFlag = flagVal(flags, 'text');

  let planText: string;
  let planPath: string;

  if (textFlag) {
    planText = textFlag;
    planPath = '(inline --text)';
  } else {
    const filePath = positionals[0];
    if (!filePath) {
      process.stderr.write('thesmos advise: provide a plan file path or --text="..."\n');
      process.exit(1);
    }
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) {
      process.stderr.write(`thesmos advise: file not found: ${filePath}\n`);
      process.exit(1);
    }
    planText = readFileSync(resolved, 'utf-8');
    planPath = resolved;
  }

  const gods = loadPantheonMap(PANTHEON_MAP_PATH);
  const advisory = buildAdvisory(planText, gods);

  if (json) {
    process.stdout.write(JSON.stringify({ planPath, ...advisory }, null, 2) + '\n');
    return;
  }

  process.stdout.write(formatAdvisoryConsole(advisory) + '\n\n');
  if (planPath !== '(inline --text)') {
    process.stdout.write(formatKickoffPrompt(planPath, advisory, planText, gods) + '\n');
  }
}
