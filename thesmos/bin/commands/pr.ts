// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** thesmos pr:* — governed pull-request queue. */
import { spawnSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { fetchPullRequests, renderPlan } from '../../pr/fetch.ts';
import { computePlan, type MergePlan } from '../../pr/plan.ts';
import { executeWave, isAutonomyDisabled, setAutonomy, type GhRunner, type UnmarkedMerge } from '../../pr/execute.ts';
import { acquireLock, releaseLock } from '../../pr/lock.ts';
import { chooseCulprit, performRevert } from '../../pr/revert.ts';
import { deriveBlockers, governanceCoverage } from '../../pr/blockers.ts';
import { syncState, formatSyncFailure, LEDGER_PATH, SENTINEL_PATH, type Runner, type SyncResult } from '../../pr/sync.ts';
import { armedMergesFromGitHub, MERGED_LABEL, REVERTED_LABEL, type MarkResult } from '../../pr/marks.ts';
import type { PullRequest } from '../../pr/types.ts';

const DEFAULT_BRANCH_FALLBACK = 'main';
const DEFAULT_WATCH_RANGE = 5;

/** Shape of what spawnSync gives us — narrowed so the ENOENT path is testable without spawning a process. */
export interface RawGhResult {
  error?: NodeJS.ErrnoException | null;
  status: number | null;
  stdout: string | null;
  stderr: string | null;
}

/**
 * Pure translation from a raw process-spawn result into a GhRunner result.
 * spawnSync never throws for a missing binary — it reports it via `error`
 * with stdout/stderr left null. Left unhandled, that surfaces later as
 * "could not read pull requests: " with no detail, which is a confusing
 * dead end for someone who has never installed the GitHub CLI.
 */
export function classifyGhResult(r: RawGhResult): { ok: boolean; stdout: string; stderr: string } {
  if (r.error) {
    const isMissing = r.error.code === 'ENOENT';
    const hint = isMissing
      ? 'the "gh" command was not found. Install the GitHub CLI from https://cli.github.com and try again.'
      : r.error.message;
    return { ok: false, stdout: '', stderr: hint };
  }
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Builds a GhRunner from anything that can produce a RawGhResult for a
 * given argv. Split out so `realGh`'s exact composition — spawn, then
 * classifyGhResult — can be exercised in a test with a fake spawn function,
 * instead of only proving classifyGhResult works in isolation.
 */
export function makeGhRunner(spawn: (args: string[]) => RawGhResult): GhRunner {
  return (args) => classifyGhResult(spawn(args));
}

export const realGh: GhRunner = makeGhRunner((args) => spawnSync('gh', args, { encoding: 'utf8' }));

/**
 * The real git, for publishing ledger/sentinel state (thesmos/pr/sync.ts).
 * Written out rather than reusing makeGhRunner because that helper's ENOENT
 * path names the GitHub CLI specifically, and telling someone to install
 * `gh` when what is missing is `git` is a worse dead end than the raw error.
 */
export const realGit: Runner = (args) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.error) return { ok: false, stdout: '', stderr: r.error.message };
  return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/**
 * The repo's actual default branch, via gh — falling back to 'main' only
 * if that lookup fails. computePlan roots the merge graph by
 * `pr.baseRefName === defaultBranch`, so hardcoding 'main' would silently
 * mis-root every PR on a repo whose default branch is 'master' or anything
 * else: no error, just a wrong plan — the worst failure shape for a tool
 * whose entire job is deciding what merges.
 */
export function detectDefaultBranch(gh: GhRunner): string {
  const res = gh(['repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name']);
  const name = res.ok ? res.stdout.trim() : '';
  return name || DEFAULT_BRANCH_FALLBACK;
}

/**
 * Every path present on `branch`, for computePlan's OBSOLETE check
 * (detectObsolete in ../../pr/lock.ts). Returns undefined — never an empty
 * set — whenever the result cannot be trusted: the gh call failed, the
 * response was not parseable, GitHub reports the tree as `truncated` (it
 * caps recursive listings for very large repos, and a partial listing here
 * would make real-but-unlisted files look deleted), or the listing came
 * back empty. detectObsolete flags a PR once none of its files are found in
 * this set, so an empty set would read every PR with any changed files as
 * obsolete — undefined disables the check instead, which is the only safe
 * failure mode for a check whose job is to recommend closing a PR outright.
 */
export function fetchPathsOnTarget(gh: GhRunner, branch: string): Set<string> | undefined {
  const res = gh([
    'api', `repos/{owner}/{repo}/git/trees/${branch}?recursive=1`,
    '--jq', '{truncated: .truncated, paths: [.tree[] | select(.type=="blob") | .path]}',
  ]);
  if (!res.ok) return undefined;

  let parsed: { truncated?: boolean; paths?: unknown };
  try {
    parsed = JSON.parse(res.stdout) as { truncated?: boolean; paths?: unknown };
  } catch {
    return undefined;
  }

  if (parsed.truncated) return undefined;
  if (!Array.isArray(parsed.paths) || parsed.paths.length === 0) return undefined;

  return new Set(parsed.paths as string[]);
}

/**
 * Says out loud when the governance gate had nothing to read. An empty
 * blocker set has two very different causes — "every PR passed governance"
 * and "no PR reported a governance check at all" — and rendering them
 * identically is how a safety gate quietly becomes decoration. Silent when
 * at least one PR reported a check: the common case needs no commentary.
 */
export function formatGovernanceCoverage(coverage: { seen: number; total: number }): string {
  if (coverage.total === 0 || coverage.seen > 0) return '';
  return '  Note: none of these pull requests has a Thesmos governance result yet, ' +
    'so nothing was checked against the rules — only the merge order and reversibility were.\n';
}

/**
 * Says out loud when a merge happened but could not be marked. The mark is
 * how the auto-revert Action learns a merge was Thesmos's own
 * (thesmos/pr/marks.ts), so an unmarked merge is one that cannot be undone
 * automatically — the single case where the recoverability that justifies
 * unattended merging is genuinely absent. Silent when everything was marked.
 * What the labels mean, and what editing one by hand costs:
 * docs/pr-merge-labels.md.
 */
export function formatUnmarked(unmarked: UnmarkedMerge[]): string {
  if (unmarked.length === 0) return '';
  return unmarked.map((u) =>
    `  Note: #${u.pr} really did merge, but I could not label it "${MERGED_LABEL}" (${u.detail}). ` +
    'Until that label is there, the automatic revert cannot undo this one. ' +
    `Add it by hand with: gh pr edit ${u.pr} --add-label ${MERGED_LABEL}\n`).join('');
}

/** Pure formatter for `pr:explain <number>` — no gh calls, so it's directly testable. */
export function formatExplain(raw: string | undefined, prs: PullRequest[], plan: MergePlan): string {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) {
    return `  "${raw ?? ''}" is not a pull request number. Try: thesmos pr:explain <number>\n`;
  }

  const halt = plan.halted.find((h) => h.number === n);
  if (halt) return `  #${n} — ${halt.detail}\n`;

  // Distinguish "genuinely ready" from "never heard of it" — telling
  // someone a typo'd or already-closed PR number is ready to merge would
  // be a worse dead end than saying plainly that it was not found.
  if (!prs.some((p) => p.number === n)) {
    return `  #${n} is not among the ${prs.length} open pull requests I looked at. Run "thesmos pr:queue" to see the current list.\n`;
  }

  return `  #${n} is ready to merge.\n`;
}

/**
 * Runs (at most) the requested wave(s) of the merge plan, computed fresh from
 * gh — never from a caller-supplied plan, so a stale plan can never be acted
 * on. autonomy is deliberately fixed at 'recoverable': a one-way PR must
 * never be merged by this command, however green it is (governing property
 * 1), and this is the only autonomy level this function is ever called with.
 * Execution halts at the first failed wave (governing property 2) — that
 * halt is enforced by executeWave per-PR and reinforced here across waves.
 *
 * Holds the single-holder lock (thesmos/pr/lock.ts) for the full duration of
 * a run (governing property 4): two Thesmos runs merging concurrently could
 * otherwise both plan the same wave and double-merge it. Acquired first,
 * before any gh call — a run that cannot get the lock must not read PR
 * state at all, since that state could already be stale by the time it acts
 * on it. Released in `finally` so a throw partway through a merge (a gh
 * call that throws instead of returning a failure, a bug in plan
 * computation, anything) can never leave the lock held forever.
 *
 * root is a parameter, not derived via createContext() here, so this stays
 * testable with a fake gh and a throwaway temp directory.
 */
export function runMerge(
  root: string,
  opts: { wave: number | 'all' },
  deps: { gh: GhRunner; now: () => Date; git: Runner },
): {
  merged: number[]; failed: number[]; unmarked: UnmarkedMerge[];
  locked?: boolean; unknownWave?: boolean;
  sync?: SyncResult; coverage?: { seen: number; total: number };
} {
  if (!acquireLock(root, deps.now())) {
    return { merged: [], failed: [], unmarked: [], locked: true };
  }

  try {
    const prs = fetchPullRequests(deps.gh);
    const defaultBranch = detectDefaultBranch(deps.gh);
    const pathsOnTarget = fetchPathsOnTarget(deps.gh, defaultBranch);
    const plan = computePlan(prs, {
      defaultBranch, blockers: deriveBlockers(prs), autonomy: 'recoverable', pathsOnTarget,
    });

    // A --wave index nobody planned is not the same as "nothing was ready",
    // and reporting them identically leaves someone who typed --wave 7 (or
    // --wave -1) believing the queue is empty when it is not.
    // Only when the plan HAS groups but not this one. With no groups at all
    // the honest answer is "nothing was ready", not "there is no group 0".
    const unknownWave = opts.wave !== 'all' && plan.waves.length > 0 && plan.waves[opts.wave] === undefined;
    const waves = opts.wave === 'all' ? plan.waves : [plan.waves[opts.wave] ?? []];
    const merged: number[] = [];
    const failed: number[] = [];
    const unmarked: UnmarkedMerge[] = [];

    for (const wave of waves) {
      const r = executeWave(root, wave, deps);
      merged.push(...r.merged);
      failed.push(...r.failed);
      unmarked.push(...r.unmarked);
      if (r.failed.length) break; // never continue past a failed wave
    }

    // Publish only when the ledger actually gained rows. Merged *or* failed:
    // a failed attempt is recorded too, and a record of an attempt that the
    // Action cannot see is as useless as a record of a success it cannot see.
    const sync = merged.length || failed.length
      ? syncState(root, [LEDGER_PATH], 'chore(thesmos): record merged pull requests', { git: deps.git })
      : undefined;

    // Reported on the merge path too, not only on pr:queue: someone who only
    // ever runs pr:merge would otherwise never learn that the governance gate
    // had nothing to read, which is the one way that gate goes quiet.
    return { merged, failed, unmarked, unknownWave, sync, coverage: governanceCoverage(prs) };
  } finally {
    releaseLock(root);
  }
}

/**
 * Parses `--wave <n>` / `--all` out of a `pr:merge` argv. Defaults to wave 0
 * when neither flag is present. Number(undefined) is NaN, and NaN ?? 0 stays
 * NaN (?? only replaces null/undefined) — so this is written as an explicit
 * Number.isFinite check rather than a bare `??`, to avoid silently planning
 * against a nonexistent wave (which would merge nothing and report success).
 */
export function parseWaveArg(argv: string[]): number | 'all' {
  if (argv.includes('--all')) return 'all';
  const i = argv.indexOf('--wave');
  if (i === -1) return 0;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parses `--range <n>` out of a `pr:watch` argv. Same NaN trap as
 * parseWaveArg above (Number(undefined) is NaN, and NaN ?? default stays
 * NaN), so this is an explicit Number.isFinite check rather than `??`.
 */
export function parseRangeArg(argv: string[]): number {
  const i = argv.indexOf('--range');
  if (i === -1) return DEFAULT_WATCH_RANGE;
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? n : DEFAULT_WATCH_RANGE;
}

/**
 * Which commit `pr:watch` was told to judge. Three states, not two: a
 * `--sha` that is present but unusable must NOT collapse into "no --sha
 * given", because that fallback judges the tip of main — the exact bug the
 * flag exists to remove. thesmos-watch.yml passes
 * `${{ github.event.workflow_run.head_sha }}`, and an expression that
 * expands to nothing would otherwise silently reinstate it.
 */
export type ShaArg =
  | { kind: 'absent' }
  | { kind: 'sha'; sha: string }
  | { kind: 'invalid'; raw: string };

/** Abbreviated or full; `gh` accepts either, and so does the Checks API. */
const SHA_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Parses `--sha <commit>` out of a `pr:watch` argv. */
export function parseShaArg(argv: string[]): ShaArg {
  const i = argv.indexOf('--sha');
  if (i === -1) return { kind: 'absent' };
  const raw = argv[i + 1] ?? '';
  return SHA_PATTERN.test(raw) ? { kind: 'sha', sha: raw } : { kind: 'invalid', raw };
}

/**
 * A check run's conclusion is null while it is still queued or in progress
 * — GitHub only sets it once status is "completed". Anything not in this
 * set, and not in INDETERMINATE_CONCLUSIONS below, is treated as failing:
 * the same conservative default the original count-only version used.
 */
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
/**
 * Conclusions that are not verdicts. A cancelled check run never finished
 * judging anything, and ci.yml sets `cancel-in-progress`, so two pushes
 * landing close together routinely leave cancelled runs behind. Counting
 * one as a failure would open and merge a revert of a pull request nothing
 * ever actually judged — a real mutation off the back of a non-result.
 * They are treated exactly like a still-running check: not evidence yet.
 */
const INDETERMINATE_CONCLUSIONS = new Set(['cancelled', 'stale']);
const PENDING_MARKER = 'pending';

/**
 * Whether main is currently red, read through the GitHub Checks API
 * (`checks: read`) rather than the legacy commit-status endpoint
 * (`statuses: read`): this repo's CI runs as GitHub Actions jobs, which
 * report results through Check Runs, not classic commit statuses — reading
 * the status endpoint here would always see an empty result and pr:watch
 * would never fire.
 *
 * Returns four states, not three:
 *   'red'     — at least one check run has already concluded as a failure.
 *   'pending' — nothing has failed yet, but at least one check run has not
 *               produced a verdict: still queued/in_progress (conclusion is
 *               null), or cancelled/stale. This is NOT green. It matters
 *               less than it used to — thesmos-watch.yml no longer races
 *               CI, it runs from CI's own `workflow_run: completed` event —
 *               but the watcher's own job is itself a check run on the
 *               commit it is judging, and other workflows may still be in
 *               flight. Neither can mask a regression: a concluded failure
 *               returns 'red' below regardless of what else is pending.
 *   'green'   — every check run has concluded, and none failed.
 *   'unknown' — the API call itself failed, or nothing came back at all
 *               (no check runs reported for this commit). Also the state
 *               for any response watch can't parse — it must never guess a
 *               color it can't verify, because a wrong guess of 'red'
 *               triggers a real revert and a wrong guess of 'green' means
 *               a real regression goes unreverted.
 *
 * `sha` is the commit to judge, and the caller decides which one that is —
 * runWatch passes the SHA CI actually ran against, not the current tip.
 */
export function mainCheckStatus(gh: GhRunner, sha: string): 'green' | 'red' | 'pending' | 'unknown' {
  const res = gh([
    'api', `repos/{owner}/{repo}/commits/${sha}/check-runs`,
    '--jq', `.check_runs[] | (.conclusion // "${PENDING_MARKER}")`,
  ]);
  if (!res.ok) return 'unknown';

  const conclusions = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (conclusions.length === 0) return 'unknown';

  let anyPending = false;
  for (const c of conclusions) {
    if (c === PENDING_MARKER || INDETERMINATE_CONCLUSIONS.has(c)) { anyPending = true; continue; }
    if (!PASSING_CONCLUSIONS.has(c)) return 'red'; // a real failure outranks any pending check
  }
  return anyPending ? 'pending' : 'green';
}

export type WatchResult =
  | { status: 'autonomy-off' }
  | { status: 'unreadable-history' }
  | { status: 'no-history' }
  | { status: 'unknown' }
  | { status: 'pending' }
  | { status: 'green' }
  | { status: 'unreadable-merges'; detail?: string }
  | { status: 'no-culprit' }
  | { status: 'reverted'; pr: number; sync: SyncResult; mark?: MarkResult }
  | { status: 'revert-failed'; pr: number; sync: SyncResult };

/** One row of the recent-commit listing: the SHA and when it landed. */
interface CommitRow { sha: string; ts?: string }

/**
 * Parses `.[] | [.sha, .commit.committer.date] | @tsv` output. A line with
 * no timestamp still yields a usable SHA — the timestamp only bounds the
 * marked-merge lookup (thesmos/pr/marks.ts), and a missing one resolves
 * there to the conservative answer rather than dropping the commit.
 */
function parseCommitRows(stdout: string): CommitRow[] {
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [sha, ts] = line.split('\t');
    return { sha, ts: ts || undefined };
  }).filter((r) => Boolean(r.sha));
}

/**
 * The `pr:watch` logic, pulled out of runPr's dispatch (same shape as
 * runMerge above) so it is directly testable and runPr's dispatch body
 * stays a thin call-and-format.
 *
 * WHICH COMMIT IT JUDGES. `opts.sha` — supplied by thesmos-watch.yml as
 * `github.event.workflow_run.head_sha`, the commit CI actually ran against.
 * NOT the tip of main. By the time CI concludes the tip may already be a
 * newer commit whose own checks have not started, and judging that one reads
 * pending (or green) and stands down on a regression CI has already
 * reported. The commit listing is rooted at the same SHA (`?sha=`), so the
 * failing range holds that commit and its ancestors — never a commit that
 * landed after the build being judged, which chooseCulprit would otherwise
 * prefer as the newest match in range.
 *
 * It still determines redness for itself rather than trusting the trigger:
 * the workflow fires on every completed CI run, not only failing ones, and
 * a failed run may since have been re-run green.
 *
 * With no `opts.sha` it judges the tip, which is what a hand-run
 * `thesmos pr:watch` on a laptop means.
 *
 * The candidate merges come from GitHub (thesmos/pr/marks.ts), not from the
 * local ledger. This function runs on a fresh `actions/checkout`, and on any
 * repository with a protected default branch the ledger push is rejected, so
 * that checkout contains no ledger at all — `readEntries` returned `[]` here
 * on every real run. Selection is still `chooseCulprit`; only the source of
 * the list changed.
 */
export function runWatch(
  root: string,
  opts: { range: number; sha?: string },
  deps: { gh: GhRunner; now: () => Date; git: Runner },
): WatchResult {
  // Before anything, including the commit-list lookup: this command performs
  // two real mutations (`gh pr revert` opens a PR, `gh pr merge` lands it on
  // the default branch) and had no autonomy check anywhere in its path, so
  // spec §6.3's "checked before any mutation" held for pr:merge only.
  //
  // It is also what makes "one revert attempt per incident, it must never
  // thrash" (spec §6.2) true: performRevert switches autonomy off when a
  // revert fails, and until this check existed nothing ever read that back —
  // every subsequent push retried the same failing revert.
  if (isAutonomyDisabled(root)) return { status: 'autonomy-off' };

  // `?sha=` roots the listing at a commit rather than at the branch, so the
  // judged commit is always range[0] and nothing that landed after the build
  // can enter the failing range. The committer date comes back with it: it is
  // the only thing that lets armedMergesFromGitHub decide whether a full page
  // of marked merges could still be hiding one in this range.
  const rooted = opts.sha ? `sha=${opts.sha}&` : '';
  const log = deps.gh([
    'api', `repos/{owner}/{repo}/commits?${rooted}per_page=${opts.range}`,
    '--jq', '.[] | [.sha, .commit.committer.date] | @tsv',
  ]);
  if (!log.ok) return { status: 'unreadable-history' };

  const rows = parseCommitRows(log.stdout);
  if (rows.length === 0) return { status: 'no-history' };
  const range = rows.map((r) => r.sha);
  const oldestInRange = rows[rows.length - 1].ts;

  const status = mainCheckStatus(deps.gh, opts.sha ?? range[0]);
  if (status === 'unknown') return { status: 'unknown' };
  // Pending must never fall through to the ledger/revert path: outstanding
  // checks are not evidence of anything yet, and treating them as green
  // would mean auto-revert silently never fires on the push that triggered
  // watch — see mainCheckStatus's doc comment.
  if (status === 'pending') return { status: 'pending' };
  if (status === 'green') return { status: 'green' };

  // A lookup that failed is not the same as a lookup that found nothing, and
  // reporting them identically is how this safety net went inert the first
  // time: "none of it is ours, stand down" and "I could not find out" must
  // never render as the same outcome.
  const armed = armedMergesFromGitHub(deps.gh, oldestInRange);
  if (!armed.ok) return { status: 'unreadable-merges', detail: armed.detail };

  // NOTE: `partial` is consulted only when no culprit was found. When one IS
  // found it is acted on, even though a newer in-range merge could in
  // principle be sitting on page two. That rests on the lookup's
  // `sort:updated-desc`: a merge that just landed is the most recently
  // updated pull request there is, so anything inside a failing range of a
  // handful of commits is on page one. If that sort ever changes, this
  // becomes "revert the second-newest merge", which no test would notice.
  const culprit = chooseCulprit(armed.entries, range);
  // Finding nothing in a list that may be incomplete is not the same as
  // finding nothing. Only a complete list earns "nothing of ours".
  if (!culprit) {
    return armed.partial
      ? { status: 'unreadable-merges', detail: 'there are more marked merges than I can list in one go, so I cannot be sure none of them is in this range' }
      : { status: 'no-culprit' };
  }

  const { ok, sync, mark } = performRevert(root, culprit, deps);
  return ok
    ? { status: 'reverted', pr: culprit.pr, sync, mark }
    : { status: 'revert-failed', pr: culprit.pr, sync };
}

/** Pure formatter for `pr:watch` — no gh calls, so it's directly testable like formatExplain. */
export function formatWatchResult(result: WatchResult): string {
  switch (result.status) {
    case 'autonomy-off':
      return '  Autonomy is off, so I am not touching anything. Turn it back on with: thesmos autonomy on\n';
    case 'unreadable-history': return '  Could not read the recent history of main; doing nothing.\n';
    case 'no-history': return '  main has no commit history to check; doing nothing.\n';
    case 'unknown': return '  Could not tell whether main is currently green or red; doing nothing.\n';
    case 'pending': return "  main's checks are still running; nothing to judge yet.\n";
    case 'green': return '  main is currently green. Nothing to do.\n';
    case 'unreadable-merges':
      return `  Could not read which of these commits were mine (${result.detail ?? 'no further detail'}), ` +
        'so I cannot tell whether anything should be reverted; doing nothing.\n';
    case 'no-culprit': return '  Nothing of ours in the failing range.\n';
    case 'reverted': {
      // "Autonomy is now OFF" is only true where the sentinel can be
      // published. It is written to the runner's own checkout and pushed with
      // the ledger (thesmos/pr/revert.ts), and a protected default branch
      // rejects that push — so on such a repository the switch dies with the
      // runner about five seconds later. The next red build then finds #N
      // still carrying only thesmos-merged, still in range, selects it again
      // and reverts the revert: the regression comes back. Saying OFF flatly
      // in that case promises protection the repository cannot deliver. The
      // revert-failed branch below has always said this; the success branch
      // did not.
      const markFailed = Boolean(result.mark && !result.mark.ok);
      const offSwitchLost = markFailed && !result.sync.ok;
      return `  ✓ reverted #${result.pr} — main went red after it merged\n`
        + (markFailed
          ? `  I could not label #${result.pr} "${REVERTED_LABEL}" (${result.mark?.detail}), so I cannot promise not to revert it again. ` +
            `Autonomy is now OFF. Add the label by hand, then: thesmos autonomy on\n`
          : '')
        + (offSwitchLost
          ? `  I could not publish that OFF switch to the repository (${result.sync.detail}), so the automatic checks on GitHub will not see it — ` +
            `a later push there could select #${result.pr} again and revert the revert, putting the change back on main. ` +
            `Add the "${REVERTED_LABEL}" label to #${result.pr} by hand now.\n`
          : '')
        + formatSyncFailure(result.sync, [LEDGER_PATH, SENTINEL_PATH]);
    }
    case 'revert-failed':
      return `  ✗ could not revert #${result.pr}. Autonomy is now OFF and needs you.\n`
        + (result.sync.ok
          ? ''
          : `  I could not publish that OFF switch to the repository (${result.sync.detail}), so a later push here could attempt the same revert again.\n`);
  }
}

const OK = 0;
const FAILED = 1;

/**
 * A watch run that could not do its job must not look like one that had
 * nothing to do. `revert-failed` means a regression is still on the default
 * branch and autonomy has switched itself off; `unknown`,
 * `unreadable-history` and `unreadable-merges` mean the watcher could not
 * even determine whether that is the case — indeterminate, not fine.
 * `autonomy-off` is a state the operator chose,
 * `green`/`pending`/`no-culprit`/`no-history` are ordinary nothing-to-do
 * outcomes, and `reverted` is success — those are all zero.
 *
 * A `reverted` run whose mark failed is NOT success: performRevert switches
 * autonomy off in that case (thesmos/pr/revert.ts), so the engine that was
 * merging unattended a minute ago is now disarmed, and the only signal of it
 * would otherwise be log text under a green tick in the Actions tab. Same
 * doctrine, one door further in.
 */
export function exitCodeForWatch(result: WatchResult): number {
  switch (result.status) {
    case 'revert-failed':
    case 'unknown':
    case 'unreadable-history':
    case 'unreadable-merges':
      return FAILED;
    case 'reverted':
      return result.mark && !result.mark.ok ? FAILED : OK;
    default:
      return OK;
  }
}

export interface PrDeps {
  gh: GhRunner;
  write: (s: string) => void;
  root: string;
  now: () => Date;
  /**
   * Publishes ledger/sentinel state (thesmos/pr/sync.ts). Required, not
   * optional with a real-git default: an omitted dependency that silently
   * falls back to running real `git` in a test is exactly how this branch
   * kept shipping mechanisms nothing invoked.
   */
  git: Runner;
}

/**
 * The actual queue/explain/merge/autonomy logic, with gh, stdout, root, and
 * the clock all injected. This is the function tests call — cmdPr itself is
 * deliberately too thin to test without a real gh process, so pulling the
 * wiring in here (rather than testing fetchPullRequests/detectDefaultBranch/
 * formatExplain/runMerge only in isolation) is what proves cmdPr's dispatch
 * actually uses them.
 *
 * autonomy and merge are dispatched before the queue/explain fetch below:
 * toggling the local autonomy switch must work fully offline (no gh call at
 * all), and refusing a merge while autonomy is off must not first waste a
 * network round-trip fetching PRs it is about to refuse to touch.
 */
export function runPr(argv: string[], deps: PrDeps): number {
  const [sub] = argv;

  if (sub === 'autonomy') {
    const arg = argv[1];
    // The switch is published, not just written locally: the half of this
    // system that mutates GitHub unattended is a GitHub Action reading a
    // fresh checkout, so a sentinel that never leaves the laptop turns off
    // nothing that matters (spec §6.3).
    const publish = (message: string): void => {
      const sync = syncState(deps.root, [SENTINEL_PATH], message, { git: deps.git });
      if (!sync.ok) {
        deps.write(`  Note: the switch is set here, but I could not publish it to the repository (${sync.detail}), ` +
          'so the automatic checks that run on GitHub may not see it yet.\n');
      }
    };
    if (arg === 'on') {
      setAutonomy(deps.root, true);
      deps.write('  Autonomy is on. Thesmos may merge pull requests that meet the rules in place.\n');
      publish('chore(thesmos): autonomy on');
      return OK;
    }
    if (arg === 'off') {
      setAutonomy(deps.root, false);
      deps.write('  Autonomy is off. Thesmos will not merge or change any pull request until you turn it back on: thesmos autonomy on\n');
      publish('chore(thesmos): autonomy off');
      return OK;
    }
    const state = isAutonomyDisabled(deps.root) ? 'off' : 'on';
    deps.write(`  Autonomy is currently ${state}.\n`);
    return OK;
  }

  if (sub === 'merge') {
    if (isAutonomyDisabled(deps.root)) {
      deps.write('  Autonomy is off. Turn it back on with: thesmos autonomy on\n');
      return OK;  // a switch the operator set on purpose is not a failure
    }
    const wave = parseWaveArg(argv);
    const result = runMerge(deps.root, { wave }, { gh: deps.gh, now: deps.now, git: deps.git });

    if (result.locked) {
      deps.write('  Another Thesmos run is already merging. Try again shortly.\n');
      return OK;
    }

    if (result.merged.length === 0 && result.failed.length === 0) {
      deps.write(result.unknownWave
        ? `  There is no group ${wave} in the current plan. Run "thesmos pr:queue" to see the groups there are.\n`
        : '  Nothing was ready to merge.\n');
    } else {
      if (result.merged.length) {
        deps.write(`  ✓ merged ${result.merged.length}: ${result.merged.map((n) => `#${n}`).join(', ')}\n`);
      }
      if (result.failed.length) {
        deps.write(`  ✗ stopped at #${result.failed[0]} — nothing after it was attempted\n`);
      }
    }
    deps.write(formatUnmarked(result.unmarked));
    if (result.coverage) deps.write(formatGovernanceCoverage(result.coverage));
    if (result.sync) deps.write(formatSyncFailure(result.sync, [LEDGER_PATH]));
    // A wave that stopped at a failed merge is a failed run. Reporting it as
    // success is what put a green tick on a run that left the queue stuck.
    return result.failed.length ? FAILED : OK;
  }

  if (sub === 'watch') {
    const sha = parseShaArg(argv);
    // Refuse rather than fall back. Judging the tip when asked to judge a
    // specific commit is precisely the failure this flag was added to remove,
    // and doing it quietly would hide it again.
    if (sha.kind === 'invalid') {
      deps.write(`  I was told which commit to check ("${sha.raw}"), but that is not a commit. Doing nothing.\n`);
      return FAILED;
    }
    const result = runWatch(
      deps.root,
      { range: parseRangeArg(argv), sha: sha.kind === 'sha' ? sha.sha : undefined },
      { gh: deps.gh, now: deps.now, git: deps.git },
    );
    deps.write(formatWatchResult(result));
    return exitCodeForWatch(result);
  }

  const prs = fetchPullRequests(deps.gh);
  const defaultBranch = detectDefaultBranch(deps.gh);
  const pathsOnTarget = fetchPathsOnTarget(deps.gh, defaultBranch);
  const plan = computePlan(prs, {
    defaultBranch, blockers: deriveBlockers(prs), autonomy: 'recoverable', pathsOnTarget,
  });

  if (sub === 'explain') {
    deps.write(formatExplain(argv[1], prs, plan));
    return OK;
  }

  deps.write(renderPlan(plan, prs));
  deps.write(formatGovernanceCoverage(governanceCoverage(prs)));
  return OK;
}

/** The real dependencies. Built lazily so tests never touch createContext(). */
export function defaultPrDeps(): PrDeps {
  const { root } = createContext();
  return { gh: realGh, git: realGit, write: (s) => process.stdout.write(s), root, now: () => new Date() };
}

/**
 * deps is a defaulted parameter rather than a hardcoded construction so the
 * line below — the one that turns a returned status into an actual process
 * exit — is itself testable. It was not, and a sabotage run proved a test
 * suite that was entirely green with this assignment deleted. That is the
 * shape of bug this branch has shipped six times.
 *
 * cli.ts only exits non-zero on a *thrown* error, so a status returned as a
 * value — a failed revert, an unreadable history, a merge that stopped part
 * way — showed a green tick in the Actions tab, which is the only signal
 * anyone would ever have looked at. Setting exitCode rather than throwing
 * keeps the plain-language output as the primary report and adds the machine
 * signal alongside it.
 */
export async function cmdPr(argv: string[], deps: PrDeps = defaultPrDeps()): Promise<void> {
  process.exitCode = await runPr(argv, deps);
}
