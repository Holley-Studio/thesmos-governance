// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.

export type MergeState = 'CLEAN' | 'BEHIND' | 'DIRTY' | 'UNSTABLE' | 'BLOCKED' | 'UNKNOWN';

/**
 * One entry of gh's `statusCheckRollup`, which mixes two shapes: a CheckRun
 * (name/workflowName, verdict in `conclusion`) and a legacy StatusContext
 * (`context`, verdict in `state`). Every field is optional because which ones
 * are present depends on which shape it is.
 */
export interface CheckContext {
  name?: string;
  workflowName?: string;
  context?: string;
  conclusion?: string;
  state?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  mergeStateStatus: MergeState;
  changedFiles: number;
  files: string[];
  /**
   * Check results on the head commit. Required, not optional: this is what
   * the governance severity gate reads (thesmos/pr/blockers.ts), and a
   * fixture or fetch path that forgets to supply it would silently disarm
   * that gate rather than fail to compile.
   */
  checks: CheckContext[];
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
