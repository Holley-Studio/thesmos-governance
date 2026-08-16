// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Speculative verification: check each PR against the PROJECTED state of main,
 * not its current state. Two PRs green alone can be red together — one renames
 * a symbol, the other adds a caller. Git reports no conflict and CI was happy
 * on both, yet main breaks. Only intersecting pairs can produce that, so only
 * those are verified.
 */
import type { PullRequest } from './types.ts';

export type Runner = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

export function mayConflict(a: PullRequest, b: PullRequest): boolean {
  const set = new Set(a.files);
  return b.files.some((f) => set.has(f));
}

export function pairsToVerify(wave: PullRequest[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < wave.length; i++) {
    for (let j = i + 1; j < wave.length; j++) {
      if (mayConflict(wave[i], wave[j])) pairs.push([wave[i].number, wave[j].number]);
    }
  }
  return pairs;
}

/**
 * Builds each projected tree in turn (main, main+A, main+A+B, ...) and runs the
 * repo's own verification against it. Returns the first PR whose addition breaks it.
 */
export function verifyProjected(
  root: string,
  order: PullRequest[],
  deps: { run: Runner },
): { ok: boolean; failedAt?: number } {
  // Real git accumulates this for free: sequential `merge --no-ff --no-commit`
  // calls stack onto the same uncommitted working tree, so the repo itself is
  // "main + A + B + ..." by the time B's verify runs, no extra bookkeeping
  // needed. An injected fake runner has no working tree to inspect, so the
  // refs included so far are threaded onto the verify call explicitly —
  // otherwise every verify call is identical regardless of the projected
  // state, and nothing distinguishes "broke on B" from "broke on A".
  const included: string[] = [];
  for (const pr of order) {
    const merged = deps.run(['merge', '--no-ff', '--no-commit', pr.headRefName]);
    if (!merged.ok) return { ok: false, failedAt: pr.number };
    included.push(pr.headRefName);

    const verified = deps.run(['verify', root, ...included]);
    if (!verified.ok) return { ok: false, failedAt: pr.number };
  }
  return { ok: true };
}
