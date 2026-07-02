// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos doctor — verify Thesmos installation health and show fix hints.
 * Always exits 0 (informational, never blocks CI).
 *
 * Flags:
 *   --json       output as JSON
 *   --markdown   output as Markdown
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

  const checks = runDoctorForRoot(root, config);

  if (json) {
    process.stdout.write(formatDoctorJson(checks) + '\n');
    return;
  }

  if (markdown) {
    process.stdout.write(formatDoctorMarkdown(checks, config.project));
    return;
  }

  console.log(formatDoctorConsole(checks, config.project));
}
