// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Auto-revert. The claim is not "we won't break main" but "we'll un-break it
 * fast" — this is what makes unattended merging honest. Runs from the watch
 * workflow, because a local poll dies with the laptop.
 */
import { appendEntry, armedMerges, type LedgerEntry } from './ledger.ts';
import { setAutonomy, type GhRunner } from './execute.ts';
import { markPr, REVERTED_LABEL, type MarkResult } from './marks.ts';
import { syncState, LEDGER_PATH, SENTINEL_PATH, type Runner, type SyncResult } from './sync.ts';

export function chooseCulprit(entries: LedgerEntry[], failingRange: string[]): LedgerEntry | null {
  const inRange = armedMerges(entries).filter(
    (e) => e.mergeCommit && failingRange.includes(e.mergeCommit),
  );
  return inRange.length ? inRange[inRange.length - 1] : null;
}

export interface RevertResult {
  ok: boolean;
  sync: SyncResult;
  /** Present on the success path: whether the culprit could be marked reverted. */
  mark?: MarkResult;
}

/**
 * `gh pr revert` only *opens* a revert PR — it has no --merge flag — so this
 * is two steps: create, then merge the PR it printed.
 *
 * The success path also marks the culprit `thesmos-reverted` on GitHub
 * (thesmos/pr/marks.ts). That mark, not the ledger, is what stops the Action
 * choosing the same merge again: the runner's ledger is empty on arrival and
 * destroyed on exit, so it carries nothing between incidents. Reverting an
 * already-reverted pull request would re-land the change that broke main, so
 * a mark that cannot be applied switches autonomy off — the same response as
 * a failed revert, for the same reason: "one revert attempt per incident, it
 * must never thrash" (spec §6.2) can no longer be guaranteed.
 *
 * Both endings still publish state (thesmos/pr/sync.ts) so the local audit
 * trail and the autonomy sentinel reach the repository when they can. A
 * publish failure never changes the revert's own verdict; it is reported
 * through `sync` instead, and auto-revert no longer depends on it.
 */
export function performRevert(
  root: string,
  culprit: LedgerEntry,
  deps: { gh: GhRunner; now: () => Date; git: Runner },
): RevertResult {
  appendEntry(root, { action: 'revert', pr: culprit.pr, phase: 'intent' }, deps.now());

  const publish = (message: string): SyncResult =>
    syncState(root, [LEDGER_PATH, SENTINEL_PATH], message, { git: deps.git });

  const fail = (detail: string): RevertResult => {
    appendEntry(root, { action: 'revert', pr: culprit.pr, phase: 'outcome', ok: false, detail }, deps.now());
    setAutonomy(root, false);  // a failed revert must never be retried blindly
    return { ok: false, sync: publish(`chore(thesmos): failed to revert #${culprit.pr}, autonomy off`) };
  };

  const created = deps.gh([
    'pr', 'revert', String(culprit.pr),
    '--title', `Revert #${culprit.pr} — main regressed after merge`,
    '--body', `Automatic revert by Thesmos. main failed after #${culprit.pr} merged.`,
  ]);
  if (!created.ok) return fail(created.stderr.slice(0, 200));

  const revertPr = /\/pull\/(\d+)/.exec(created.stdout)?.[1];
  if (!revertPr) return fail('could not determine the revert PR number');

  const merged = deps.gh(['pr', 'merge', revertPr, '--squash', '--delete-branch']);
  if (!merged.ok) return fail(merged.stderr.slice(0, 200));

  const mark = markPr(deps.gh, culprit.pr, REVERTED_LABEL);
  if (!mark.ok) setAutonomy(root, false);

  appendEntry(root, {
    action: 'revert', pr: culprit.pr, phase: 'outcome',
    ok: true,
    detail: `main went red after this merge; reverted via #${revertPr}`
      + (mark.ok ? '' : `; could not add the "${REVERTED_LABEL}" label (${mark.detail}), autonomy off`),
  }, deps.now());
  return { ok: true, mark, sync: publish(`chore(thesmos): record auto-revert of #${culprit.pr}`) };
}
