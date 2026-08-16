// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** thesmos pr:* — governed pull-request queue. */
import { spawnSync } from 'node:child_process';
import { createContext } from '../lib/context.ts';
import { fetchPullRequests, renderPlan } from '../../pr/fetch.ts';
import { computePlan, type MergePlan } from '../../pr/plan.ts';
import type { GhRunner } from '../../pr/execute.ts';
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

export interface PrDeps {
  gh: GhRunner;
  write: (s: string) => void;
}

/**
 * The actual queue/explain logic, with gh and stdout injected. This is the
 * function tests call — cmdPr itself is deliberately too thin to test
 * without a real gh process, so pulling the wiring in here (rather than
 * testing fetchPullRequests/detectDefaultBranch/formatExplain only in
 * isolation) is what proves cmdPr's dispatch actually uses them.
 */
export function runPr(argv: string[], deps: PrDeps): void {
  const [sub] = argv;
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
  createContext();
  runPr(argv, { gh: realGh, write: (s) => process.stdout.write(s) });
}
