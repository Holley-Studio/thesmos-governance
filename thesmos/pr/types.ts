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
}

export interface PrGraph {
  nodes: Map<number, PrNode>;
  roots: number[];
  cycles: number[][];
}
