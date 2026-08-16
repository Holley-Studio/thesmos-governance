// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** thesmos pr:* — governed pull-request queue. */
import { spawnSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { fetchPullRequests, renderPlan } from '../../pr/fetch.ts';
import { computePlan, type MergePlan } from '../../pr/plan.ts';
import { executeWave, isAutonomyDisabled, setAutonomy, type GhRunner } from '../../pr/execute.ts';
import type { PullRequest } from '../../pr/types.ts';

const DEFAULT_BRANCH_FALLBACK = 'main';

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
 * root is a parameter, not derived via createContext() here, so this stays
 * testable with a fake gh and a throwaway temp directory.
 */
export function runMerge(
  root: string,
  opts: { wave: number | 'all' },
  deps: { gh: GhRunner; now: () => Date },
): { merged: number[]; failed: number[] } {
  const prs = fetchPullRequests(deps.gh);
  const defaultBranch = detectDefaultBranch(deps.gh);
  const plan = computePlan(prs, { defaultBranch, blockers: new Set(), autonomy: 'recoverable' });

  const waves = opts.wave === 'all' ? plan.waves : [plan.waves[opts.wave] ?? []];
  const merged: number[] = [];
  const failed: number[] = [];

  for (const wave of waves) {
    const r = executeWave(root, wave, deps);
    merged.push(...r.merged);
    failed.push(...r.failed);
    if (r.failed.length) break; // never continue past a failed wave
  }

  return { merged, failed };
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

export interface PrDeps {
  gh: GhRunner;
  write: (s: string) => void;
  root: string;
  now: () => Date;
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
export function runPr(argv: string[], deps: PrDeps): void {
  const [sub] = argv;

  if (sub === 'autonomy') {
    const arg = argv[1];
    if (arg === 'on') {
      setAutonomy(deps.root, true);
      deps.write('  Autonomy is on. Thesmos may merge pull requests that meet the rules in place.\n');
      return;
    }
    if (arg === 'off') {
      setAutonomy(deps.root, false);
      deps.write('  Autonomy is off. Thesmos will not merge or change any pull request until you turn it back on: thesmos autonomy on\n');
      return;
    }
    const state = isAutonomyDisabled(deps.root) ? 'off' : 'on';
    deps.write(`  Autonomy is currently ${state}.\n`);
    return;
  }

  if (sub === 'merge') {
    if (isAutonomyDisabled(deps.root)) {
      deps.write('  Autonomy is off. Turn it back on with: thesmos autonomy on\n');
      return;
    }
    const wave = parseWaveArg(argv);
    const result = runMerge(deps.root, { wave }, { gh: deps.gh, now: deps.now });

    if (result.merged.length === 0 && result.failed.length === 0) {
      deps.write('  Nothing was ready to merge.\n');
    } else {
      if (result.merged.length) {
        deps.write(`  ✓ merged ${result.merged.length}: ${result.merged.map((n) => `#${n}`).join(', ')}\n`);
      }
      if (result.failed.length) {
        deps.write(`  ✗ stopped at #${result.failed[0]} — nothing after it was attempted\n`);
      }
    }
    return;
  }

  const prs = fetchPullRequests(deps.gh);
  const defaultBranch = detectDefaultBranch(deps.gh);
  const plan = computePlan(prs, { defaultBranch, blockers: new Set(), autonomy: 'recoverable' });

  if (sub === 'explain') {
    deps.write(formatExplain(argv[1], prs, plan));
    return;
  }

  deps.write(renderPlan(plan, prs));
}

export async function cmdPr(argv: string[]): Promise<void> {
  const { root } = createContext();
  runPr(argv, { gh: realGh, write: (s) => process.stdout.write(s), root, now: () => new Date() });
}
