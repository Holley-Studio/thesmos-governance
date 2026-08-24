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
 *     shape of bug this module was written to remove. A full page sets
 *     `partial`, which callers must treat the same way when they find no
 *     match, for the same reason.
 *  3. A ROW WITH NO MERGE COMMIT IS SKIPPED SILENTLY. There is nothing to
 *     match against a failing range without one, and inventing a SHA would
 *     revert something at random — but it does mean such a merge is invisible
 *     here and nothing says so. Thesmos merges with `--squash`, which always
 *     produces exactly one merge commit, so its own marked merges always have
 *     one; a `thesmos-merged` pull request without a merge commit would mean
 *     the label was applied by something other than Thesmos.
 *  4. THE LOOKUP GOES THROUGH GITHUB'S SEARCH INDEX, WHICH IS EVENTUALLY
 *     CONSISTENT. `--search sort:updated-desc` routes `gh pr list` through
 *     the search API rather than the plain list endpoint, and a pull request
 *     merged seconds ago may not be indexed yet. An unindexed merge reads
 *     here as simply absent — an indeterminate rendering as safe, which is
 *     this module's own named failure shape arriving through the transport
 *     rather than the data. It is narrow (the window is seconds, and the
 *     watcher only runs after a full CI cycle has completed on the commit)
 *     but it is real, and it is not detectable from the response.
 *  5. THE LABELS ARE HUMAN-MUTABLE. Anyone with write access can remove
 *     `thesmos-merged` from a merge, making it unrevertable here, or add it
 *     to a pull request Thesmos never touched, making someone else's work
 *     eligible for automatic reverting. See docs/pr-merge-labels.md.
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
  /**
   * True when GitHub returned a full page, so there may be marked merges this
   * list does not contain. Callers must not read "no match here" as "nothing
   * of ours" while this is set — that is the same indeterminate-reads-as-safe
   * shape as an outright failed lookup.
   */
  partial?: boolean;
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
  updatedAt?: unknown;
}

/** Milliseconds, or undefined for anything that is not a usable timestamp. */
function millis(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * The earliest activity timestamp on the page, or undefined if any row lacks
 * one. The page comes back sorted by activity descending, so every row on
 * page two was touched no later than this — and a merged pull request's
 * `updatedAt` is never earlier than its merge (merging updates it, and so
 * does the label Thesmos adds straight afterwards). That makes this a real
 * upper bound on when anything on page two could have merged.
 *
 * `mergedAt` would NOT work as the bound: the sort is on activity, so a page
 * two row merged recently but never touched since can sit behind a page one
 * row merged long ago and commented on yesterday.
 */
function pageActivityFloor(rows: RawMergedPr[]): number | undefined {
  let floor: number | undefined;
  for (const row of rows) {
    const t = millis(row?.updatedAt);
    if (t === undefined) return undefined;  // an unbounded page cannot be reasoned about
    if (floor === undefined || t < floor) floor = t;
  }
  return floor;
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
 *
 * `oldestCommitInRange` is when the earliest commit of the failing range
 * landed, and it decides `partial`. It is a required parameter, not an
 * option: nothing removes the `thesmos-merged` label, so any repository that
 * has merged LOOKUP_LIMIT pull requests through Thesmos returns a full page
 * forever. Treating "full page" as "there may be more in range" on its own
 * turned every honest stand-down into an alarm on every red-main run — and a
 * warning that fires on 100% of runs is wallpaper. Pass `undefined` only when
 * the range genuinely has no timestamp; that resolves to the cautious answer.
 */
export function armedMergesFromGitHub(gh: GhRunner, oldestCommitInRange: string | undefined): ArmedMergesResult {
  const res = run(gh, [
    'pr', 'list',
    '--state', 'merged',
    '--label', MERGED_LABEL,
    '--search', 'sort:updated-desc',
    '--limit', String(LOOKUP_LIMIT),
    '--json', 'number,labels,mergeCommit,mergedAt,updatedAt',
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

  // A full page only means the list might be incomplete IN A WAY THAT
  // MATTERS. Page two holds only rows touched no later than the earliest on
  // page one; if that is already before the whole failing range, nothing on
  // page two can have merged inside it. Anything unknown — a row with no
  // activity timestamp, a range with no timestamp — leaves the page
  // unbounded, and an unbounded page stays partial.
  const rows = parsed as RawMergedPr[];
  const floor = rows.length >= LOOKUP_LIMIT ? pageActivityFloor(rows) : undefined;
  const rangeStart = millis(oldestCommitInRange);
  const reachesPastRange = floor !== undefined && rangeStart !== undefined && floor < rangeStart;
  return rows.length >= LOOKUP_LIMIT && !reachesPastRange
    ? { ok: true, entries, partial: true }
    : { ok: true, entries };
}
