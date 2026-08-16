// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Computes merge waves from the PR graph. Pure: no network, no filesystem.
 * A PR is only planned when every ancestor is planned ahead of it.
 */
import { buildGraph } from './graph.ts';
import { classify, type Reversibility } from './classify.ts';
import type { PullRequest } from './types.ts';

export type HaltReason =
  | 'RED_BASE' | 'CYCLE' | 'DIRTY' | 'BLOCKER' | 'OBSOLETE' | 'DRAFT' | 'ONE_WAY' | 'PARENT_BLOCKED'
  | 'UNKNOWN_STATE' | 'UNRESOLVED_BASE';

/**
 * The only mergeStateStatus values that permit a merge (spec §5.2 item 2).
 * An allowlist, deliberately: the previous denylist halted DIRTY/UNSTABLE/
 * BLOCKED and let everything else through, so UNKNOWN — which GitHub returns
 * while it computes mergeability in the background, routinely on a cold
 * `gh pr list` over a large backlog — read as mergeable. Any value not named
 * here, including one GitHub adds later, halts.
 */
const MERGEABLE_STATES: ReadonlySet<PullRequest['mergeStateStatus']> = new Set(['CLEAN', 'BEHIND']);

/**
 * True when every file the PR touches is absent from the target branch.
 *
 * Lives here rather than in lock.ts (where it was first written) so this
 * module stays pure: lock.ts does real filesystem I/O, and importing it from
 * the planner dragged that I/O into the one module whose whole contract is
 * "no network, no filesystem".
 */
export function detectObsolete(pr: PullRequest, pathsOnTarget: Set<string>): boolean {
  if (pr.files.length === 0) return false;
  return pr.files.every((f) => !pathsOnTarget.has(f));
}

/**
 * `class` is carried through to the ledger at merge time (thesmos/pr/
 * execute.ts), so the record of what Thesmos landed says what *kind* of
 * change it was, not just its number. Required, not optional: a planned entry
 * whose class is unknown is a planned entry nobody can audit afterwards.
 */
export interface PlanEntry { number: number; wave: number; class: Reversibility }
export interface HaltEntry { number: number; reason: HaltReason; detail: string; blocks: number[] }
export interface MergePlan { waves: PlanEntry[][]; halted: HaltEntry[] }

export interface PlanOptions {
  defaultBranch: string;
  blockers: Set<number>;
  autonomy: 'reversible' | 'recoverable' | 'all';
  /**
   * Every path that exists on the target branch. When supplied, a PR whose
   * changed files are all absent here is halted as OBSOLETE rather than
   * planned. Left undefined, the check is skipped entirely — never pass an
   * empty set to mean "nothing to compare against": detectObsolete would
   * then read every PR with any files as obsolete.
   */
  pathsOnTarget?: Set<string>;
}

const ALLOWED: Record<PlanOptions['autonomy'], Reversibility[]> = {
  reversible: ['reversible'],
  recoverable: ['reversible', 'recoverable'],
  all: ['reversible', 'recoverable', 'one-way'],
};

export function computePlan(prs: PullRequest[], opts: PlanOptions): MergePlan {
  const graph = buildGraph(prs, opts.defaultBranch);
  const halted: HaltEntry[] = [];
  const blocked = new Set<number>();

  // Cycle-safe: a cycle member's children loop back to another cycle member,
  // so an unguarded walk would recurse forever. The visited set (seeded with
  // the start node) makes this safe for every caller, cyclic or not.
  const descendantsOf = (n: number): number[] => {
    const out: number[] = [];
    const visited = new Set<number>([n]);
    const walk = (id: number) => {
      for (const c of graph.nodes.get(id)?.children ?? []) {
        if (visited.has(c)) continue;
        visited.add(c);
        out.push(c);
        walk(c);
      }
    };
    walk(n);
    return out;
  };

  // Mark every cycle member blocked up front, across all cycles, before any
  // cascade runs. This guarantees the PARENT_BLOCKED cascade below (and the
  // one in halt()) can never relabel a cycle member — the `blocked.has`
  // guard always sees it as already claimed by CYCLE.
  for (const cycle of graph.cycles) {
    for (const n of cycle) blocked.add(n);
  }
  for (const cycle of graph.cycles) {
    const cycleSet = new Set(cycle);
    for (const n of cycle) {
      // A PR stacked on a cycle member inherits the halt too — a red base
      // poisons its whole column even when the base itself is cyclic.
      const blocks = descendantsOf(n).filter((d) => !cycleSet.has(d));
      halted.push({ number: n, reason: 'CYCLE', detail: `dependency cycle: ${cycle.join(' → ')}`, blocks });
      for (const d of blocks) {
        if (!blocked.has(d)) {
          halted.push({ number: d, reason: 'PARENT_BLOCKED', detail: `waiting on #${n}`, blocks: [] });
          blocked.add(d);
        }
      }
    }
  }

  const halt = (n: number, reason: HaltReason, detail: string) => {
    if (blocked.has(n)) return;
    const blocks = descendantsOf(n);
    halted.push({ number: n, reason, detail, blocks });
    blocked.add(n);
    for (const d of blocks) {
      if (!blocked.has(d)) {
        halted.push({ number: d, reason: 'PARENT_BLOCKED', detail: `waiting on #${n}`, blocks: [] });
        blocked.add(d);
      }
    }
  };

  const allowed = ALLOWED[opts.autonomy];
  // Classified up front for every PR, not lazily inside the halt cascade, so
  // the wave builder below can read a class for any node it plans without a
  // fallback that could disagree with the one the halt check used.
  const classOf = new Map(prs.map((p) => [p.number, classify(p)]));

  for (const node of [...graph.nodes.values()].sort((a, b) => a.depth - b.depth)) {
    const { pr } = node;
    if (blocked.has(pr.number)) continue;

    if (opts.blockers.has(pr.number)) { halt(pr.number, 'BLOCKER', 'Thesmos BLOCKER finding'); continue; }
    if (node.unresolvedBase) {
      halt(pr.number, 'UNRESOLVED_BASE',
        `it is built on "${pr.baseRefName}", which is neither ${opts.defaultBranch} nor any pull request I can see`);
      continue;
    }
    if (opts.pathsOnTarget && detectObsolete(pr, opts.pathsOnTarget)) {
      halt(pr.number, 'OBSOLETE', `every file it changes is already gone from ${opts.defaultBranch} — close it`);
      continue;
    }
    if (pr.mergeStateStatus === 'DIRTY') { halt(pr.number, 'DIRTY', 'merge conflict — needs a human'); continue; }
    if (pr.mergeStateStatus === 'UNKNOWN') {
      halt(pr.number, 'UNKNOWN_STATE', 'GitHub has not finished working out whether this one can merge');
      continue;
    }
    if (!MERGEABLE_STATES.has(pr.mergeStateStatus)) {
      halt(pr.number, 'RED_BASE', 'checks are failing'); continue;
    }
    if (pr.isDraft) { halt(pr.number, 'DRAFT', 'still a draft'); continue; }

    const cls = classOf.get(pr.number)!;
    if (!allowed.includes(cls.class)) { halt(pr.number, 'ONE_WAY', cls.reason); continue; }
  }

  const waves: PlanEntry[][] = [];
  for (const node of graph.nodes.values()) {
    if (blocked.has(node.pr.number)) continue;
    (waves[node.depth] ??= []).push({
      number: node.pr.number, wave: node.depth, class: classOf.get(node.pr.number)!.class,
    });
  }

  const sized = new Map(prs.map((p) => [p.number, p.changedFiles]));
  for (const wave of waves) {
    if (wave) wave.sort((a, b) => (sized.get(a.number)! - sized.get(b.number)!) || a.number - b.number);
  }

  return { waves: waves.filter(Boolean), halted };
}
