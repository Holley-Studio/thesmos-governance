// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Computes merge waves from the PR graph. Pure: no network, no filesystem.
 * A PR is only planned when every ancestor is planned ahead of it.
 */
import { buildGraph } from './graph.ts';
import { classify, type Reversibility } from './classify.ts';
import { detectObsolete } from './lock.ts';
import type { PullRequest } from './types.ts';

export type HaltReason =
  | 'RED_BASE' | 'CYCLE' | 'DIRTY' | 'BLOCKER' | 'OBSOLETE' | 'DRAFT' | 'ONE_WAY' | 'PARENT_BLOCKED';

export interface PlanEntry { number: number; wave: number }
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

  for (const node of [...graph.nodes.values()].sort((a, b) => a.depth - b.depth)) {
    const { pr } = node;
    if (blocked.has(pr.number)) continue;

    if (opts.blockers.has(pr.number)) { halt(pr.number, 'BLOCKER', 'Thesmos BLOCKER finding'); continue; }
    if (opts.pathsOnTarget && detectObsolete(pr, opts.pathsOnTarget)) {
      halt(pr.number, 'OBSOLETE', 'every file it changes is already gone from main — close it');
      continue;
    }
    if (pr.mergeStateStatus === 'DIRTY') { halt(pr.number, 'DIRTY', 'merge conflict — needs a human'); continue; }
    if (pr.mergeStateStatus === 'UNSTABLE' || pr.mergeStateStatus === 'BLOCKED') {
      halt(pr.number, 'RED_BASE', 'checks are failing'); continue;
    }
    if (pr.isDraft) { halt(pr.number, 'DRAFT', 'still a draft'); continue; }

    const cls = classify(pr);
    if (!allowed.includes(cls.class)) { halt(pr.number, 'ONE_WAY', cls.reason); continue; }
  }

  const waves: PlanEntry[][] = [];
  for (const node of graph.nodes.values()) {
    if (blocked.has(node.pr.number)) continue;
    (waves[node.depth] ??= []).push({ number: node.pr.number, wave: node.depth });
  }

  const sized = new Map(prs.map((p) => [p.number, p.changedFiles]));
  for (const wave of waves) {
    if (wave) wave.sort((a, b) => (sized.get(a.number)! - sized.get(b.number)!) || a.number - b.number);
  }

  return { waves: waves.filter(Boolean), halted };
}
