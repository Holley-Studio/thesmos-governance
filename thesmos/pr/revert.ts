// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Auto-revert. The claim is not "we won't break main" but "we'll un-break it
 * fast" — this is what makes unattended merging honest. Runs from the watch
 * workflow, because a local poll dies with the laptop.
 */
import { appendEntry, armedMerges, type LedgerEntry } from './ledger.ts';
import { setAutonomy, type GhRunner } from './execute.ts';

export function chooseCulprit(entries: LedgerEntry[], failingRange: string[]): LedgerEntry | null {
  const inRange = armedMerges(entries).filter(
    (e) => e.mergeCommit && failingRange.includes(e.mergeCommit),
  );
  return inRange.length ? inRange[inRange.length - 1] : null;
}

/**
 * `gh pr revert` only *opens* a revert PR — it has no --merge flag — so this
 * is two steps: create, then merge the PR it printed.
 */
export function performRevert(
  root: string,
  culprit: LedgerEntry,
  deps: { gh: GhRunner; now: () => Date },
): boolean {
  appendEntry(root, { action: 'revert', pr: culprit.pr, phase: 'intent' }, deps.now());

  const fail = (detail: string): boolean => {
    appendEntry(root, { action: 'revert', pr: culprit.pr, phase: 'outcome', ok: false, detail }, deps.now());
    setAutonomy(root, false);  // a failed revert must never be retried blindly
    return false;
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

  appendEntry(root, {
    action: 'revert', pr: culprit.pr, phase: 'outcome',
    ok: true, detail: `main went red after this merge; reverted via #${revertPr}`,
  }, deps.now());
  return true;
}
