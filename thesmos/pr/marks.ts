// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * How the two halves of this engine find each other: on GitHub itself, not
 * through a file one of them has to push.
 *
 * WHY THIS EXISTS. `thesmos pr:merge` runs on a laptop; `thesmos pr:watch` —
 * the auto-revert that makes unattended merging defensible — runs as a GitHub
 * Action on a fresh `actions/checkout`. The Action originally learned what
 * Thesmos had merged by reading `.thesmos/pr-ledger.jsonl` out of that
 * checkout, which required the CLI to commit and push the ledger to the
 * default branch (thesmos/pr/sync.ts). On any repository whose default branch
 * is protected — this one's `main` has an active ruleset with an empty
 * `bypass_actors` list — that push is rejected outright. The ledger never
 * reached the Action, `readEntries` returned `[]`, `chooseCulprit` returned
 * null, and auto-revert could not fire on a single run. The failure was
 * reported honestly, but it fired on 100% of runs, and the engine kept
 * merging while already knowing recoverability was absent.
 *
 * Granting a bot a ruleset bypass is the repository owner's security decision
 * and no code change may assume it, so the dependency is removed instead:
 * Thesmos marks its own merges with a label, and the Action reconstructs its
 * view by asking GitHub which merged pull requests carry that mark. Both
 * halves already authenticate to GitHub — that is the transport they actually
 * share, and unlike a pushed file it needs no write access to the default
 * branch.
 *
 * WHAT THIS DOES NOT GUARANTEE:
 *
 *  1. AN UNMARKED MERGE IS INVISIBLE HERE. If `markPr` fails, the merge still
 *     happened and is still recorded in the local ledger, but auto-revert
 *     cannot see it — exactly the state the ledger transport used to leave
 *     everything in, now narrowed to the single merge whose label failed.
 *     Callers must report it; `executeWave` returns it in `unmarked` and the
 *     CLI prints the by-hand remedy. It is deliberately NOT treated as a
 *     failed merge, because the merge really did happen.
 *  2. A FAILED LOOKUP IS NOT AN EMPTY LOOKUP. `armedMergesFromGitHub` reports
 *     `ok: false` when it cannot read the list, and never an empty array. An
 *     empty array means "main is red and none of it is ours"; a failed lookup
 *     means "I do not know". Reading the second as the first is the exact
 *     shape of bug this module was written to remove.
 */
import type { GhRunner } from './execute.ts';
import type { LedgerEntry } from './ledger.ts';

/** Applied by Thesmos to every pull request it merges. */
export const MERGED_LABEL = 'thesmos-merged';
/** Applied by Thesmos to a merge it has since reverted, so it is not chosen twice. */
export const REVERTED_LABEL = 'thesmos-reverted';

export type Mark = typeof MERGED_LABEL | typeof REVERTED_LABEL;

const LABEL_META: Record<Mark, { color: string; description: string }> = {
  [MERGED_LABEL]: { color: '5319e7', description: 'Merged automatically by Thesmos' },
  [REVERTED_LABEL]: { color: 'b60205', description: 'Reverted automatically by Thesmos after main regressed' },
};

/**
 * How many marked merges to consider. Sorted by recent activity (a merge is
 * an update), so the ones that could plausibly be in a failing range of a
 * handful of commits are always on the first page — which is why this is a
 * generous constant rather than a pagination loop.
 */
const LOOKUP_LIMIT = 100;

export interface MarkResult {
  ok: boolean;
  /** Plain-language reason, present whenever ok is false. */
  detail?: string;
}

export interface ArmedMergesResult {
  /** False when the list could not be read at all — NOT the same as no entries. */
  ok: boolean;
  entries: LedgerEntry[];
  detail?: string;
}

/** GhRunner's type promises it never throws; a real subprocess wrapper can. */
function run(gh: GhRunner, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  try {
    return gh(args);
  } catch (err) {
    return { ok: false, stdout: '', stderr: String(err) };
  }
}

function short(s: string, fallback: string): string {
  return s.trim().slice(0, 200) || fallback;
}

/**
 * Labels a pull request, creating the label first only if it turns out not to
 * exist. Add-then-create-and-retry rather than create-then-add: the steady
 * state is one API call per merge, and the retry — not the create — is what
 * decides the verdict, so a `gh label create` that fails because the label is
 * already there never counts against the result.
 */
export function markPr(gh: GhRunner, prNumber: number, label: Mark): MarkResult {
  const add = (): { ok: boolean; stderr: string } =>
    run(gh, ['pr', 'edit', String(prNumber), '--add-label', label]);

  const first = add();
  if (first.ok) return { ok: true };

  const meta = LABEL_META[label];
  const created = run(gh, ['label', 'create', label, '--color', meta.color, '--description', meta.description]);

  const retried = add();
  if (retried.ok) return { ok: true };

  // "already exists" is the expected outcome of the create on every run after
  // the first, so it is never worth reporting as the cause.
  const createIssue = created.ok || /already exists/i.test(created.stderr)
    ? ''
    : short(created.stderr, '');
  const addIssue = short(retried.stderr, `could not add the "${label}" label`);
  return {
    ok: false,
    detail: createIssue ? `${addIssue} (creating the "${label}" label also failed: ${createIssue})` : addIssue,
  };
}

interface RawMergedPr {
  number?: unknown;
  labels?: unknown;
  mergeCommit?: unknown;
  mergedAt?: unknown;
}

/**
 * The Action's candidate list, rebuilt from GitHub: every merged pull request
 * Thesmos marked and has not since reverted, shaped as the ledger rows
 * `chooseCulprit` already knows how to select from.
 *
 * Ordered oldest-merge-first. `chooseCulprit` takes the LAST match in the
 * failing range because a ledger is append-ordered; gh returns newest first,
 * so passing its order through unchanged would silently revert the oldest
 * merge in range instead of the newest.
 */
export function armedMergesFromGitHub(gh: GhRunner): ArmedMergesResult {
  const res = run(gh, [
    'pr', 'list',
    '--state', 'merged',
    '--label', MERGED_LABEL,
    '--search', 'sort:updated-desc',
    '--limit', String(LOOKUP_LIMIT),
    '--json', 'number,labels,mergeCommit,mergedAt',
  ]);
  if (!res.ok) {
    return { ok: false, entries: [], detail: short(res.stderr, 'could not read the list of merged pull requests') };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    return { ok: false, entries: [], detail: 'GitHub returned something that was not a list of pull requests' };
  }
  if (!Array.isArray(parsed)) {
    return { ok: false, entries: [], detail: 'GitHub returned something that was not a list of pull requests' };
  }

  const entries: LedgerEntry[] = [];
  for (const raw of parsed as RawMergedPr[]) {
    const pr = typeof raw?.number === 'number' ? raw.number : undefined;
    if (pr === undefined) continue;

    const names = Array.isArray(raw.labels)
      ? (raw.labels as Array<{ name?: unknown }>).map((l) => l?.name)
      : [];
    if (names.includes(REVERTED_LABEL)) continue;

    // Never fabricate a SHA: without one there is nothing to match against a
    // failing range, and a made-up value would revert something at random.
    const oid = (raw.mergeCommit as { oid?: unknown } | null | undefined)?.oid;
    if (typeof oid !== 'string' || !oid) continue;

    entries.push({
      ts: typeof raw.mergedAt === 'string' ? raw.mergedAt : '',
      action: 'merge',
      pr,
      phase: 'outcome',
      ok: true,
      mergeCommit: oid,
    });
  }

  entries.sort((a, b) => (a.ts === b.ts ? a.pr - b.pr : a.ts < b.ts ? -1 : 1));
  return { ok: true, entries };
}
