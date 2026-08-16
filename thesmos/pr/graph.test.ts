import { describe, it, expect } from 'vitest';
import { buildGraph } from './graph.ts';
import type { PullRequest } from './types.ts';

function pr(number: number, headRefName: string, baseRefName: string): PullRequest {
  return {
    number, title: `pr-${number}`, isDraft: false, baseRefName, headRefName,
    mergeStateStatus: 'CLEAN', changedFiles: 1, files: [],
  };
}

describe('buildGraph', () => {
  it('links a stacked chain by base/head and assigns depth', () => {
    // Mirrors the real chain observed 2026-08-05: #135 -> #136 -> #137
    const graph = buildGraph([
      pr(135, 'feat/model-routing-v5', 'main'),
      pr(136, 'feat/eunomia', 'feat/model-routing-v5'),
      pr(137, 'chore/phase-0', 'feat/eunomia'),
    ], 'main');

    expect(graph.roots).toEqual([135]);
    expect(graph.nodes.get(136)!.parent).toBe(135);
    expect(graph.nodes.get(137)!.parent).toBe(136);
    expect(graph.nodes.get(137)!.depth).toBe(2);
    expect(graph.nodes.get(135)!.children).toEqual([136]);
    expect(graph.cycles).toEqual([]);
  });

  it('detects a cycle instead of looping forever', () => {
    const graph = buildGraph([
      pr(1, 'a', 'b'),
      pr(2, 'b', 'a'),
    ], 'main');

    expect(graph.cycles.length).toBe(1);
    expect(graph.cycles[0].sort()).toEqual([1, 2]);
    expect(graph.roots).toEqual([]);
  });
});
