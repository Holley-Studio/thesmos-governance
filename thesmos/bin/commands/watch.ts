// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos watch — real-time governance feedback as you code.
 *
 * Watches source files in the repo and re-runs review on every change.
 * Prints a diff of new vs. resolved findings after each update.
 *
 * Flags:
 *   --clear          Clear the terminal on each update
 *   --debounce=<ms>  Debounce delay in ms (default: 400)
 *   --min=<severity> Only show findings at or above this severity
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { startWatcher } from '../../watcher.ts';

export async function cmdWatch(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);

  const clearOnUpdate = flag(flags, 'clear');
  const debounceMs    = parseInt(flagVal(flags, 'debounce') ?? '400', 10);
  const minSeverity   = flagVal(flags, 'min');

  const stop = startWatcher(root, config, {
    clearOnUpdate,
    debounceMs: isNaN(debounceMs) ? 400 : debounceMs,
    minSeverity,
  });

  // Keep the process alive until Ctrl+C
  process.on('SIGINT', () => {
    stop();
    process.stdout.write('\nWatch stopped.\n');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });

  // Return a never-resolving promise to keep the CLI alive
  await new Promise<void>(() => { /* intentionally never resolves */ });
}
