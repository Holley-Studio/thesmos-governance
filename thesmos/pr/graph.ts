// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Builds the PR dependency forest. A PR whose baseRefName is another PR's
 * headRefName is stacked on that PR; GitHub renders these as independent.
 */
import type { PrGraph, PrNode, PullRequest } from './types.ts';

export function buildGraph(prs: PullRequest[], defaultBranch: string): PrGraph {
  const byHead = new Map<string, number>();
  for (const pr of prs) byHead.set(pr.headRefName, pr.number);

  const nodes = new Map<number, PrNode>();
  for (const pr of prs) {
    // `parent === null` used to mean two different things: "based on the
    // default branch, so it is a root" and "based on a branch we cannot see,
    // so we have no idea what has to land first". The second was silently
    // promoted to the first, which put a stacked PR into wave 0 and merged it
    // ahead of its own parent — spec §1 item 2, verbatim. They are now
    // distinguishable, and plan.ts refuses to plan the second.
    const onDefault = pr.baseRefName === defaultBranch;
    const parentNumber = onDefault ? undefined : byHead.get(pr.baseRefName);
    nodes.set(pr.number, {
      pr,
      parent: parentNumber ?? null,
      children: [],
      depth: 0,
      unresolvedBase: !onDefault && parentNumber === undefined,
    });
  }

  for (const node of nodes.values()) {
    if (node.parent !== null) nodes.get(node.parent)?.children.push(node.pr.number);
  }

  const cycles = findCycles(nodes);
  const inCycle = new Set(cycles.flat());

  const roots: number[] = [];
  for (const node of nodes.values()) {
    if (inCycle.has(node.pr.number)) continue;
    if (node.parent === null) roots.push(node.pr.number);
  }

  for (const root of roots) assignDepth(nodes, root, 0, inCycle);

  return { nodes, roots: roots.sort((a, b) => a - b), cycles };
}

function assignDepth(nodes: Map<number, PrNode>, n: number, depth: number, skip: Set<number>): void {
  const node = nodes.get(n);
  if (!node || skip.has(n)) return;
  node.depth = depth;
  for (const child of node.children) assignDepth(nodes, child, depth + 1, skip);
}

function findCycles(nodes: Map<number, PrNode>): number[][] {
  const cycles: number[][] = [];
  const seen = new Set<number>();

  for (const start of nodes.keys()) {
    if (seen.has(start)) continue;
    const path: number[] = [];
    const onPath = new Set<number>();
    let cur: number | null = start;

    while (cur !== null && !seen.has(cur)) {
      if (onPath.has(cur)) {
        cycles.push(path.slice(path.indexOf(cur)));
        break;
      }
      path.push(cur);
      onPath.add(cur);
      cur = nodes.get(cur)?.parent ?? null;
    }
    for (const n of path) seen.add(n);
  }
  return cycles;
}
