// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.

export type MergeState = 'CLEAN' | 'BEHIND' | 'DIRTY' | 'UNSTABLE' | 'BLOCKED' | 'UNKNOWN';

export interface PullRequest {
  number: number;
  title: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  mergeStateStatus: MergeState;
  changedFiles: number;
  files: string[];
}

export interface PrNode {
  pr: PullRequest;
  parent: number | null;
  children: number[];
  depth: number;
  /**
   * True when baseRefName is neither the default branch nor the head of any
   * PR in this fetch — i.e. the parent is not visible. Distinct from
   * `parent === null`, which such a node also has: without this flag the two
   * cases are indistinguishable and an invisible parent reads as "no parent".
   */
  unresolvedBase: boolean;
}

export interface PrGraph {
  nodes: Map<number, PrNode>;
  roots: number[];
  cycles: number[][];
}
