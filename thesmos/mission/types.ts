// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph — types.
 *
 * A mission turns one request into a DAG of tasks. Every task is bound to
 * exactly one compiled `CouncilAgentContract` and executes under permissions
 * resolved against the mission's own policy, so a task can never do something
 * the mission itself was not permitted to do.
 *
 * Nothing here carries a clock reading or a random value: mission state is
 * content-addressed, and two runs over the same inputs must hash identically.
 */

import type {
  CouncilAgentContract,
  CouncilLimits,
  CouncilPermissionChannel,
  CouncilPermissionDecision,
  CouncilPermissionPolicy,
} from '../council/contract.js';
import type { AgentHandoff } from '../council/handoff.js';
import type { CouncilPermissionResolution } from '../council/permissions.js';

/** Bumped when a persisted mission or mission state changes shape. */
export const MISSION_SCHEMA_VERSION = '1.0.0';

export const SUPPORTED_MISSION_SCHEMA_VERSIONS: readonly string[] = [MISSION_SCHEMA_VERSION];

// ── Issues ────────────────────────────────────────────────────────────────────

export const MISSION_CODES = {
  // Graph shape
  graphEmpty: 'MISSION_GRAPH_EMPTY',
  graphDuplicateTask: 'MISSION_GRAPH_DUPLICATE_TASK',
  graphUnknownDependency: 'MISSION_GRAPH_UNKNOWN_DEPENDENCY',
  graphSelfDependency: 'MISSION_GRAPH_SELF_DEPENDENCY',
  graphCycle: 'MISSION_GRAPH_CYCLE',
  graphTaskIdInvalid: 'MISSION_GRAPH_TASK_ID_INVALID',

  // Binding
  taskAgentUnknown: 'MISSION_TASK_AGENT_UNKNOWN',
  taskEscalation: 'MISSION_TASK_PERMISSION_ESCALATION',

  // Authority
  actionDenied: 'MISSION_ACTION_DENIED',
  actionConfirmationRequired: 'MISSION_ACTION_CONFIRMATION_REQUIRED',

  // Limits
  limitStepsExceeded: 'MISSION_LIMIT_STEPS_EXCEEDED',
  limitChildrenExceeded: 'MISSION_LIMIT_CHILDREN_EXCEEDED',
  limitParallelExceeded: 'MISSION_LIMIT_PARALLEL_EXCEEDED',
  limitDepthExceeded: 'MISSION_LIMIT_DEPTH_EXCEEDED',
  limitTasksExceeded: 'MISSION_LIMIT_TASKS_EXCEEDED',
  limitDependenciesExceeded: 'MISSION_LIMIT_DEPENDENCIES_EXCEEDED',

  // Handoffs
  handoffMissing: 'MISSION_HANDOFF_MISSING',
  handoffInvalid: 'MISSION_HANDOFF_INVALID',
  handoffTaskMismatch: 'MISSION_HANDOFF_TASK_MISMATCH',
  handoffMissionMismatch: 'MISSION_HANDOFF_MISSION_MISMATCH',
  handoffDowngraded: 'MISSION_HANDOFF_DOWNGRADED',

  // Execution integrity
  foldFailed: 'MISSION_FOLD_FAILED',

  // Execution
  dependencyUnsatisfied: 'MISSION_DEPENDENCY_UNSATISFIED',
  taskThrew: 'MISSION_TASK_THREW',
} as const;

export interface MissionIssue {
  code: string;
  severity: 'error' | 'warning';
  /** Dotted path into the mission — `tasks.review-api.handoff`, etc. */
  path: string;
  /** Redaction-safe. Same inputs → same string. */
  message: string;
  remediation?: string;
}

// ── Graph ─────────────────────────────────────────────────────────────────────

/** What a caller supplies. `depth` and ordering are derived, never declared. */
export interface MissionTaskInput {
  id: string;
  agentId: string;
  title: string;
  intent: string;
  dependsOn?: string[];
  /** Set only when this task was produced by delegation from another task. */
  parentTaskId?: string;
}

export interface MissionTask {
  id: string;
  /** Exactly one contract backs a task. A task is never "the council". */
  agentId: string;
  title: string;
  intent: string;
  dependsOn: string[];
  parentTaskId?: string;
  /** Delegation depth. Tasks declared in the request are 0. */
  depth: number;
}

export interface MissionGraph {
  tasks: MissionTask[];
  /** Deterministic topological order. Ties break lexicographically by id. */
  order: string[];
  /** Execution waves. Tasks within a wave have no dependency between them. */
  layers: string[][];
}

export interface MissionGraphResult {
  valid: boolean;
  graph: MissionGraph;
  issues: MissionIssue[];
}

// ── Mission ───────────────────────────────────────────────────────────────────

export interface MissionRequest {
  goal: string;
  tasks: MissionTaskInput[];
  /**
   * The mission's own permission envelope. Every task resolves against this as
   * the parent policy, so it is the ceiling for the whole graph.
   */
  permissions?: CouncilPermissionPolicy;
  limits?: Partial<CouncilLimits>;
}

export interface Mission {
  schemaVersion: string;
  /** `sha256:<hex>` over the normalized request. Same request → same id. */
  id: string;
  goal: string;
  permissions: CouncilPermissionPolicy;
  limits: CouncilLimits;
  graph: MissionGraph;
}

// ── Binding ───────────────────────────────────────────────────────────────────

/** A task joined to the one contract that will execute it. */
export interface TaskBinding {
  task: MissionTask;
  contract: CouncilAgentContract;
  /** Most-restrictive of mission limits, contract limits, and the ceilings. */
  limits: CouncilLimits;
  /** Places the contract claims more than the mission grants. Advisory. */
  escalations: MissionIssue[];
}

export interface MissionBindingResult {
  valid: boolean;
  bindings: TaskBinding[];
  issues: MissionIssue[];
}

/** The result of asking "may this task do this, here?". */
export interface TaskAuthorization {
  taskId: string;
  agentId: string;
  channel: CouncilPermissionChannel;
  target: string;
  resolution: CouncilPermissionResolution;
  /** True only for `allow`. `ask` is not permission — it is a question. */
  permitted: boolean;
}

// ── State ─────────────────────────────────────────────────────────────────────

export type MissionTaskStatus =
  | 'pending'
  | 'complete'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'skipped';

export type MissionStatus = 'complete' | 'partial' | 'blocked' | 'failed';

/**
 * One authority question a task asked, and what it was told.
 *
 * Recorded whether or not the runner honoured the answer. A runtime that
 * answered `deny` and then said nothing about it in the report would make the
 * refusal unauditable — the decision has to survive even a runner that ignores
 * it. Deliberately compact: no reason string, so the record stays hashable and
 * bounded.
 */
export interface TaskAuthorizationRecord {
  channel: CouncilPermissionChannel;
  target: string;
  decision: CouncilPermissionDecision;
}

export interface MissionTaskState {
  taskId: string;
  agentId: string;
  status: MissionTaskStatus;
  /** Steps this task consumed against the mission budget. */
  stepsUsed: number;
  /** Ids of tasks this task delegated into existence. */
  childTaskIds: string[];
  /**
   * The bounds this task actually ran under — the minimum of the mission's and
   * its contract's. Recorded because a contract whose limits changed changes
   * what the run means, and a state hash blind to that would call two
   * materially different runs identical.
   */
  limits: CouncilLimits;
  /** Every authority question this task asked, deduplicated and sorted. */
  authorizations: TaskAuthorizationRecord[];
  /** Present only when the task produced one and it survived validation. */
  handoff?: AgentHandoff;
  issues: MissionIssue[];
}

export interface MissionState {
  schemaVersion: string;
  missionId: string;
  status: MissionStatus;
  tasks: MissionTaskState[];
  /** Total steps consumed across the whole graph. */
  stepsUsed: number;
  issues: MissionIssue[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function missionIssue(
  code: string,
  severity: 'error' | 'warning',
  path: string,
  message: string,
  remediation?: string
): MissionIssue {
  return { code, severity, path, message, ...(remediation ? { remediation } : {}) };
}

/**
 * Stable issue order so two runs over the same mission produce byte-identical
 * reports: path, then code, then message.
 */
export function sortMissionIssues(issues: readonly MissionIssue[]): MissionIssue[] {
  return [...issues].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message)
  );
}

export function hasErrors(issues: readonly MissionIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
