// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos doctor — verify Thesmos installation health and show fix hints.
 *
 * Exit codes:
 *   0  all checks passed
 *   1  one or more checks failed (honest contract — CI can gate on this)
 *
 * Flags:
 *   --json       output as JSON
 *   --markdown   output as Markdown
 *   --soft       always exit 0 (legacy informational mode)
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  runDoctorForRoot,
  formatDoctorConsole,
  formatDoctorMarkdown,
  formatDoctorJson,
} from '../../doctor.ts';

export async function cmdDoctor(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const soft = flag(flags, 'soft');

  const checks = runDoctorForRoot(root, config);
  const pass = checks.every((c) => c.pass);

  if (json) {
    process.stdout.write(formatDoctorJson(checks) + '\n');
  } else if (markdown) {
    process.stdout.write(formatDoctorMarkdown(checks, config.project));
  } else {
    console.log(formatDoctorConsole(checks, config.project));
  }

  if (!pass && !soft) process.exit(1);
}
