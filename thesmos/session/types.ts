// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Session freshness types.
 *
 * `null` in an input field means **unknown** — a probe that failed, timed out,
 * or does not apply (no upstream configured). It never means zero. The
 * distinction is load-bearing: reporting "0 commits behind" from a ref that was
 * last fetched a week ago is a false statement of fact, not a conservative one.
 */

export interface RepoInputs {
  isGitRepo: boolean;
  branch: string | null;
  upstream: string | null;
  /** Commits on upstream not in HEAD. null = unknown. */
  behind: number | null;
  /** Commits in HEAD not on upstream. null = unknown. */
  ahead: number | null;
  dirtyCount: number | null;
  /** Epoch ms of .git/FETCH_HEAD mtime. null = never fetched. */
  lastFetchMs: number | null;
}

export interface ArtifactInputs {
  reportMtimeMs: number | null;
  baselineMtimeMs: number | null;
  contextMtimeMs: number | null;
  /** Epoch ms of thesmos/dist/thesmos-guard.js. null = not built. */
  guardDistMtimeMs: number | null;
  /** Newest mtime across governance sources the guard is built from. */
  guardSourceMtimeMs: number | null;
}

export interface FreshnessInputs {
  nowMs: number;
  repo: RepoInputs;
  artifacts: ArtifactInputs;
}

export interface StalenessThresholds {
  reportDays: number;
  baselineDays: number;
  fetchHours: number;
}

export type SignalSeverity = 'ok' | 'notice' | 'warn';

export type SignalId =
  | 'behind'
  | 'ahead'
  | 'dirty'
  | 'report'
  | 'baseline'
  | 'context'
  | 'fetch'
  | 'guardDist';

export interface FreshnessSignal {
  id: SignalId;
  severity: SignalSeverity;
  /** One line, already human-readable. No trailing newline. */
  text: string;
  /** Command that resolves it, when one exists. */
  remedy?: string;
}

export interface FreshnessReport {
  signals: FreshnessSignal[];
  /** True when refs are too old for behind/ahead to be trusted. */
  refsUncertain: boolean;
}
