// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * SessionStart hook handler.
 *
 * ## Fail-open, deliberately
 *
 * Every other guard path in Thesmos fails **closed**: when governance cannot
 * determine whether an action is safe, the action is refused. That is correct
 * for PreToolUse, where wrongly allowing costs more than wrongly blocking.
 *
 * This handler inverts that, **including under `failClosed: true`**. It
 * authorizes nothing — it observes and reports. A failure to observe cannot
 * make an action unsafe; it can only leave the session as uninformed as it was
 * before this hook existed. A session that *refuses to start* because a
 * staleness probe threw is a broken tool, and its failure mode is catastrophic
 * rather than protective.
 *
 * ## Never call process.exit()
 *
 * A hook's stdout is a pipe and writes to it are asynchronous. `process.exit()`
 * immediately after `write()` truncates the JSON mid-flush and corrupts the
 * hook's own output. Set `process.exitCode` and return; the process exits when
 * the event loop drains. (Same discipline as `emitAskDecision` in
 * `claude-govern.ts`.) This is also why the background fetch in Task 6 must be
 * detached and unref'd.
 */

import { loadConfig, CONFIG_DEFAULTS } from '../config.js';
import { assessFreshness } from './freshness.js';
import { gatherFreshnessInputs } from './gather.js';
import { renderSessionContext } from './render.js';
import { resolveSessionOptions, resolveThresholds } from './thresholds.js';

export function buildSessionStartPayload(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context,
    },
  });
}

export async function runSessionStart(root: string): Promise<void> {
  // Nothing in this function may throw past this boundary.
  try {
    let config = CONFIG_DEFAULTS;
    try {
      config = loadConfig(root);
    } catch {
      // Malformed or absent config must not prevent a session from starting.
    }

    const options = resolveSessionOptions(config);
    if (!options.enabled) {
      process.exitCode = 0;
      return;
    }

    const inputs = gatherFreshnessInputs(root);
    const report = assessFreshness(inputs, resolveThresholds(config));
    const context = renderSessionContext(report, options.maxBytes);

    if (context.length > 0) {
      // Exactly one write; nothing else touches stdout on this path.
      process.stdout.write(buildSessionStartPayload(context) + '\n');
    }
  } catch {
    // Fail open — emit nothing.
  }
  process.exitCode = 0;
}
