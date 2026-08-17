// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Commits and pushes the small amount of Thesmos state the *other half* of
 * this system has to see (spec §6.2): the action ledger and the autonomy
 * sentinel.
 *
 * WHY THIS MODULE STILL EXISTS. The CLI merges on a laptop; `pr:watch` runs
 * as a GitHub Action on a fresh `actions/checkout`. The two carry two
 * different kinds of state, and only one of them still travels this way:
 *
 *  - THE LEDGER is the local audit trail (thesmos/pr/ledger.ts). Publishing
 *    it shares that record instead of trapping it on one machine. Auto-revert
 *    no longer reads it: the Action rebuilds what Thesmos merged from GitHub
 *    itself (thesmos/pr/marks.ts), because on a repository with a protected
 *    default branch this push is rejected and the file never arrived at all.
 *  - THE AUTONOMY SENTINEL genuinely does still travel this way. A kill
 *    switch the unattended half cannot see does not switch anything off, and
 *    the same protected branch rejects it. See limitation 4 below.
 *
 * WHAT IT DOES NOT GUARANTEE — read this before trusting recovery:
 *
 *  1. THE PUSH CAN FAIL, AND FAILURE IS NOT FATAL. A protected default
 *     branch (rulesets, required PRs, required reviews) will reject a direct
 *     push — this repo's own `main` is configured that way, with an empty
 *     `bypass_actors` list, so nothing can bypass it. When that happens the
 *     merges still happened, so callers report the failure loudly and carry
 *     on; reporting a merge as not-happened because its receipt could not be
 *     filed would be the worse lie. Auto-revert is no longer affected by
 *     this; the audit trail simply stays local until a push succeeds.
 *  2. IT IS NOT ATOMIC WITH THE MERGE. The ledger is fsynced locally before
 *     each action (thesmos/pr/ledger.ts), but published afterwards. A crash
 *     between the two leaves a correct local ledger and a stale remote one.
 *     The next successful sync republishes everything, because the file is
 *     append-only and committed whole.
 *  3. IT ONLY EVER TOUCHES THE PATHS IT IS GIVEN. `git commit -- <paths>`
 *     commits those paths regardless of what else is staged, so a user's
 *     work-in-progress index is never swept into a Thesmos commit.
 *  4. THE SENTINEL HAS NO SECOND TRANSPORT, AND THAT IS A REAL GAP. The
 *     ledger's dependency on this push was removed; the kill switch's was
 *     not. On a repository where the push is rejected, `thesmos autonomy off`
 *     set on a laptop never reaches the Action, and a failed revert's
 *     "autonomy off, do not retry" sentinel dies with the runner that wrote
 *     it. Two things narrow the blast radius rather than close it: the
 *     Action's own merges cannot be chosen twice (thesmos/pr/marks.ts marks
 *     a reverted merge on GitHub, which does survive), and every failure
 *     here is reported in plain language at the call site. It is not closed.
 *     Closing it needs the switch to live somewhere both halves can write —
 *     a repository variable, a label, or a bot identity with ruleset bypass —
 *     which is a design decision, not an implementation detail.
 *
 * Every commit it writes carries `[skip ci]`: these commits contain nothing
 * but Thesmos's own state files, so running the full CI matrix on them is
 * waste — and, more importantly, `thesmos-watch.yml` triggers on push to the
 * default branch, so a ledger push would otherwise re-trigger the very
 * watcher that wrote it.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type Runner = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

export interface SyncResult {
  /** False only when the state did not reach the remote. */
  ok: boolean;
  /** True when there was genuinely nothing to publish. */
  noop?: boolean;
  /** Plain-language reason, present whenever ok is false. */
  detail?: string;
}

/** Paths the Action half has to be able to read. Relative to the repo root. */
export const LEDGER_PATH = '.thesmos/pr-ledger.jsonl';
export const SENTINEL_PATH = '.thesmos/autonomy-disabled';

// An automated state commit is not the operator's own work, and in an Action
// there is no configured identity at all — an unset user.email is the most
// common way a headless `git commit` fails.
const BOT_NAME = 'thesmos';
const BOT_EMAIL = 'thesmos@users.noreply.github.com';

function short(s: string, fallback: string): string {
  return s.trim().slice(0, 200) || fallback;
}

export function syncState(
  root: string,
  paths: string[],
  message: string,
  deps: { git: Runner },
): SyncResult {
  const git = (args: string[]) => {
    try {
      return deps.git(['-C', root, ...args]);
    } catch (err) {
      return { ok: false, stdout: '', stderr: String(err) };
    }
  };

  // Per-path. A failure is tolerated ONLY when the file is genuinely absent
  // from disk: `git add -A -- x` errors when x has never existed and was
  // never tracked, which is the ordinary state of the sentinel on a repo
  // where autonomy was never switched off. -A (not plain add) so that
  // *removing* the sentinel — `autonomy on` — is staged as the deletion it is.
  //
  // A file that IS on disk and still cannot be staged is a hard failure, not
  // a no-op. The case that matters: if the ledger were ever git-ignored
  // again, `git add` would refuse it, nothing would be staged, and the
  // "nothing to publish" path below would report ok — reviving Critical 1
  // exactly, and silently. Found by sweeping this module for the very
  // pattern it was written to fix.
  for (const path of paths) {
    const added = git(['add', '-A', '--', path]);
    if (!added.ok && existsSync(join(root, path))) {
      return { ok: false, detail: short(`${path} is on disk but git refused to stage it: ${added.stderr}`, `could not stage ${path}`) };
    }
  }

  const staged = git(['diff', '--cached', '--name-only', '--', ...paths]);
  if (!staged.ok) {
    return { ok: false, detail: short(staged.stderr, 'could not work out what had changed') };
  }
  if (!staged.stdout.trim()) return { ok: true, noop: true };

  const committed = git([
    '-c', `user.name=${BOT_NAME}`, '-c', `user.email=${BOT_EMAIL}`,
    'commit', '-m', `${message} [skip ci]`, '--', ...paths,
  ]);
  if (!committed.ok) {
    return { ok: false, detail: short(committed.stderr, 'the commit was refused') };
  }

  // `git push` with no arguments depends on push.default and an upstream that
  // may not be configured; naming the branch explicitly does not. A detached
  // HEAD has no branch to name, and pushing a guess would be worse than
  // saying so.
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = head.ok ? head.stdout.trim() : '';
  if (!branch || branch === 'HEAD') {
    return { ok: false, detail: 'the record was committed here, but there is no branch checked out to push it to' };
  }

  const pushed = git(['push', 'origin', branch]);
  if (!pushed.ok) {
    return { ok: false, detail: short(pushed.stderr, 'the push was rejected') };
  }
  return { ok: true };
}

/**
 * The one-line warning shown when state could not be published. Says what
 * still definitely happened before it says what failed — a merge that
 * happened must never read as a merge that did not.
 *
 * `paths` is what the caller actually tried to publish, and it is required
 * rather than defaulted because the two cases end in opposite reassurances:
 *
 *  - LEDGER ONLY (`pr:merge`). Auto-revert has not gone blind, because the
 *    Action reconstructs what Thesmos merged from GitHub's own record
 *    (thesmos/pr/marks.ts), not from this file. Only the audit trail stayed
 *    local.
 *  - LEDGER AND SENTINEL (`performRevert`, `autonomy on|off`). Auto-revert
 *    absolutely does read the sentinel — `isAutonomyDisabled` is the first
 *    statement of `runWatch`. Telling someone it is "unaffected" here would
 *    be wrong about the half that matters, and on the failed-mark path this
 *    is the last line printed.
 */
export function formatSyncFailure(result: SyncResult, paths: string[]): string {
  if (result.ok) return '';
  const happened = `  Note: everything above really did happen, but I could not publish the record of it to the repository (${result.detail}). ` +
    `The audit trail in ${LEDGER_PATH} is complete here; it just exists only on this machine until that push succeeds. `;
  return paths.includes(SENTINEL_PATH)
    ? `${happened}The automatic revert on GitHub does not read that file — but the autonomy switch (${SENTINEL_PATH}) travels the same way and did not reach the repository either, ` +
      'so a run there may not see that autonomy was switched off.\n'
    : `${happened}The automatic revert on GitHub does not read this file, so it is unaffected.\n`;
}
