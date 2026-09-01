// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Detached background fetch.
 *
 * The SessionStart hook cannot fetch in its blocking path, so a behind-count
 * read from week-old refs is *unknown*, not zero. The resolution is to report
 * that uncertainty (see `freshness.ts`) and refresh the refs out of band, so
 * the next turn has truth.
 *
 * **The child must not hold the event loop open.** `start.ts` exits by letting
 * the loop drain — a requirement of the never-call-process.exit() rule. Each
 * spawn option below guards a distinct, independently-reproducible failure
 * mode, not one shared rationale:
 *
 *  - `unref()` is what actually keeps the guard's own event loop from
 *    waiting on the child. Without it, the parent blocks until `git fetch`
 *    itself exits — verified by forcing that child to run for several
 *    seconds and watching the guard process block for the same duration.
 *  - `stdio: 'ignore'` prevents the detached child from inheriting the
 *    guard's stdout pipe. A child that inherits it holds that pipe open
 *    past the guard's own exit, so the *parent* of the guard process (e.g.
 *    the hook runner reading its stdout to EOF) blocks instead — same
 *    externally-visible hang, different mechanism, also reproduced by
 *    mutation.
 *  - `detached: true` guards a different hazard entirely: without it, the
 *    child stays in the guard's process group, so a signal delivered to
 *    that group (e.g. Ctrl-C hitting the whole foreground group) can kill
 *    the in-flight fetch along with the guard. It does not by itself cause
 *    a hang, so it will not show up in an event-loop-timing regression test.
 *
 * The spawned child is also fire-and-forget: a `git` binary that cannot be
 * found on the child's PATH (minimal containers, sandboxed hook
 * environments, PATH stripped for children) fails *asynchronously* — after
 * `spawnBackgroundFetch` has already returned — so it cannot be caught by
 * this function's own `try`/`catch`. An unhandled `'error'` event on that
 * child would crash the whole guard process (Node's default behavior),
 * which is a strictly worse outcome than the fetch silently not happening.
 * Hence the `child.on('error', ...)` handler below: a fetch that cannot
 * start is not an error worth surfacing, exactly like every other failure
 * mode in this module.
 */

import { spawn } from 'node:child_process';
import { existsSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Marker file inside .git, so it is never committed and never dirties status. */
export const FETCH_MARKER = 'THESMOS_LAST_FETCH_ATTEMPT';

/** Do not spawn more than one fetch per this interval. */
export const DEFAULT_MIN_INTERVAL_MS = 10 * 60 * 1000;

export function spawnBackgroundFetch(
  root: string,
  minIntervalMs: number = DEFAULT_MIN_INTERVAL_MS,
): boolean {
  try {
    const gitDir = join(root, '.git');
    if (!existsSync(gitDir)) return false;

    const marker = join(gitDir, FETCH_MARKER);
    if (existsSync(marker)) {
      const age = Date.now() - statSync(marker).mtimeMs;
      if (age < minIntervalMs) return false;
      utimesSync(marker, new Date(), new Date());
    } else {
      writeFileSync(marker, '');
    }

    const child = spawn('git', ['fetch', '--all', '--prune', '--quiet'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    // The spawn itself never throws synchronously even when `git` cannot be
    // found — Node reports that asynchronously via 'error', which fires
    // after this function has already returned. Left unhandled, that event
    // is fatal to the whole process (Node's default for unhandled 'error').
    // Swallow it: a fetch that cannot even start is not worth surfacing.
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
