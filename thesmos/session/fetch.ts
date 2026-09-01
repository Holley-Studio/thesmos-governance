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
 * the loop drain — a requirement of the never-call-process.exit() rule. A
 * non-detached child would keep the process alive and hang session startup,
 * which is precisely the failure this hook exists to prevent. Hence
 * `detached: true`, `stdio: 'ignore'`, and `unref()`.
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
    child.unref();
    return true;
  } catch {
    return false;
  }
}
