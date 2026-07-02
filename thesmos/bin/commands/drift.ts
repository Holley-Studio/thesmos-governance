// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos drift — detect governance drift across adapter files, docs, and registry.
 *
 * Flags:
 *   --json      output as JSON
 *   --markdown  output as Markdown
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  runDriftForRoot,
  formatDriftConsole,
  formatDriftMarkdown,
  formatDriftJson,
} from '../../drift.ts';

export async function cmdDrift(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');

  const findings = runDriftForRoot(root, config);

  if (json) {
    process.stdout.write(formatDriftJson(findings) + '\n');
    return;
  }

  if (markdown) {
    process.stdout.write(formatDriftMarkdown(findings, config.project) + '\n');
    return;
  }

  console.log(formatDriftConsole(findings, config.project));

  // Exit 1 on any BLOCKER finding so drift can gate CI pipelines
  if (findings.some((f) => f.severity === 'BLOCKER')) {
    process.exit(1);
  }
}
