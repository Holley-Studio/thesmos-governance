// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph — construction and ordering.
 *
 * Turns declared tasks into a validated DAG. Every rejection is reported with a
 * code and a path rather than thrown, so a caller can show an author all of
 * what is wrong with a mission at once instead of one error per attempt.
 *
 * Ordering is deterministic by construction: Kahn's algorithm with a
 * lexicographic tiebreak, so the same task set always yields the same order and
 * the same execution layers regardless of the order they were declared in.
 */

import { sanitizeText, sanitizeToken } from '../council/sanitize.js';
import {
  MISSION_CODES,
  hasErrors,
  missionIssue,
  sortMissionIssues,
  type MissionGraph,
  type MissionGraphResult,
  type MissionIssue,
  type MissionTask,
  type MissionTaskInput,
} from './types.js';

/** Task ids are slugs: they appear in paths, ids, and CLI output. */
const TASK_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** A delegation chain deeper than this is a bug, not a plan. */
const MAX_DELEGATION_DEPTH = 16;

/**
 * Hard ceiling on tasks in one mission.
 *
 * Depth alone does not bound the graph: each task may delegate up to
 * `maximumChildren`, so generations multiply rather than add, and a runner that
 * delegates the maximum every round reaches millions of tasks well before the
 * depth check stops it. This is the ceiling that actually bounds memory, and it
 * is compiled in — no configuration can raise it.
 */
const MAX_MISSION_TASKS = 1024;

/** Per-task dependency fan-in ceiling, applied before any edge is resolved. */
const MAX_TASK_DEPENDENCIES = 64;

const EMPTY_GRAPH: MissionGraph = { tasks: [], order: [], layers: [] };

function normalizeTask(input: MissionTaskInput): MissionTask {
  const dependsOn = Array.isArray(input.dependsOn)
    ? [...new Set(input.dependsOn.map((d) => sanitizeToken(d, 64)).filter((d) => d !== ''))].sort()
    : [];
  const parentTaskId = input.parentTaskId ? sanitizeToken(input.parentTaskId, 64) : '';

  return {
    id: sanitizeToken(input.id, 64),
    agentId: sanitizeToken(input.agentId, 64),
    title: sanitizeText(input.title, 200),
    intent: sanitizeText(input.intent, 2000),
    dependsOn,
    ...(parentTaskId ? { parentTaskId } : {}),
    depth: 0,
  };
}

/**
 * Effective edges into a task.
 *
 * A delegated task is treated as depending on the task that spawned it. The
 * static graph has no notion of "parent still running", so the conservative
 * ordering — parent first — is the only one that cannot execute a child before
 * the task that authorized it.
 */
function edgesInto(task: MissionTask): string[] {
  const edges = new Set(task.dependsOn);
  if (task.parentTaskId) edges.add(task.parentTaskId);
  return [...edges].sort();
}

function detectCycles(tasks: readonly MissionTask[]): MissionIssue[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const issues: MissionIssue[] = [];
  const reported = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === 'done') return;
    if (current === 'visiting') {
      // Rotate the cycle to start at its lexicographically smallest member so
      // the same cycle is always reported with the same signature.
      const at = stack.indexOf(id);
      const cycle = stack.slice(at);
      const pivot = cycle.indexOf([...cycle].sort()[0] as string);
      const rotated = [...cycle.slice(pivot), ...cycle.slice(0, pivot)];
      const signature = rotated.join(' -> ');
      if (!reported.has(signature)) {
        reported.add(signature);
        issues.push(
          missionIssue(
            MISSION_CODES.graphCycle,
            'error',
            `tasks.${rotated[0]}`,
            `dependency cycle: ${signature} -> ${rotated[0]}`,
            'break the cycle by removing one dependency'
          )
        );
      }
      return;
    }

    state.set(id, 'visiting');
    stack.push(id);
    const task = byId.get(id);
    if (task) {
      for (const dep of edgesInto(task)) {
        if (byId.has(dep)) visit(dep);
      }
    }
    stack.pop();
    state.set(id, 'done');
  };

  for (const id of [...byId.keys()].sort()) visit(id);
  return issues;
}

/** Delegation depth, walking `parentTaskId` upward with a hard bound. */
function computeDepth(task: MissionTask, byId: ReadonlyMap<string, MissionTask>): number {
  let depth = 0;
  let cursor = task.parentTaskId;
  const seen = new Set<string>([task.id]);

  while (cursor && depth <= MAX_DELEGATION_DEPTH) {
    if (seen.has(cursor)) break; // parent cycle — reported by detectCycles
    seen.add(cursor);
    depth += 1;
    cursor = byId.get(cursor)?.parentTaskId;
  }
  return depth;
}

/**
 * Kahn's algorithm, lexicographic within each wave.
 *
 * Returns layers as well as a flat order: a layer is a set of tasks whose
 * dependencies are all satisfied, which is exactly the unit the executor
 * throttles against `maximumParallelChildren`.
 */
function orderTasks(tasks: readonly MissionTask[]): { order: string[]; layers: string[][] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const task of tasks) {
    const deps = edgesInto(task).filter((d) => byId.has(d));
    indegree.set(task.id, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep) ?? [];
      list.push(task.id);
      dependents.set(dep, list);
    }
  }

  const order: string[] = [];
  const layers: string[][] = [];
  let ready = [...indegree.entries()]
    .filter(([, n]) => n === 0)
    .map(([id]) => id)
    .sort();

  while (ready.length > 0) {
    layers.push([...ready]);
    order.push(...ready);
    const next: string[] = [];
    for (const id of ready) {
      for (const dependent of (dependents.get(id) ?? []).sort()) {
        const remaining = (indegree.get(dependent) ?? 0) - 1;
        indegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    ready = [...new Set(next)].sort();
  }

  return { order, layers };
}

/**
 * Build a validated mission graph.
 *
 * Never throws. A graph with any error-severity issue comes back `valid: false`
 * with an empty order, because a partially-ordered cyclic graph is not
 * something a caller should be able to execute by ignoring the return value.
 */
export function buildMissionGraph(inputs: readonly MissionTaskInput[]): MissionGraphResult {
  const issues: MissionIssue[] = [];

  if (!Array.isArray(inputs) || inputs.length === 0) {
    issues.push(
      missionIssue(
        MISSION_CODES.graphEmpty,
        'error',
        'tasks',
        'a mission needs at least one task',
        'declare one task per unit of delegated work'
      )
    );
    return { valid: false, graph: EMPTY_GRAPH, issues };
  }

  // Checked before normalization so a pathological input is rejected without
  // being walked first.
  if (inputs.length > MAX_MISSION_TASKS) {
    issues.push(
      missionIssue(
        MISSION_CODES.limitTasksExceeded,
        'error',
        'tasks',
        `mission declares ${inputs.length} tasks, exceeding the ceiling of ${MAX_MISSION_TASKS}`,
        'split the work across missions — this ceiling is compiled in and not configurable'
      )
    );
    return { valid: false, graph: EMPTY_GRAPH, issues };
  }

  const tasks: MissionTask[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of inputs.entries()) {
    // Fan-in is checked against the raw array, before normalization walks it.
    const declaredDeps = Array.isArray(raw?.dependsOn) ? raw.dependsOn.length : 0;
    if (declaredDeps > MAX_TASK_DEPENDENCIES) {
      issues.push(
        missionIssue(
          MISSION_CODES.limitDependenciesExceeded,
          'error',
          `tasks[${index}].dependsOn`,
          `task declares ${declaredDeps} dependencies, exceeding the ceiling of ${MAX_TASK_DEPENDENCIES}`,
          'introduce an intermediate task rather than depending on everything at once'
        )
      );
      continue;
    }

    const task = normalizeTask(raw);

    if (!TASK_ID_RE.test(task.id)) {
      issues.push(
        missionIssue(
          MISSION_CODES.graphTaskIdInvalid,
          'error',
          `tasks[${index}].id`,
          `task id "${task.id}" is not a slug`,
          'use letters, digits, dot, dash, or underscore (max 64)'
        )
      );
      continue;
    }
    if (seen.has(task.id)) {
      issues.push(
        missionIssue(
          MISSION_CODES.graphDuplicateTask,
          'error',
          `tasks.${task.id}`,
          `duplicate task id "${task.id}"`,
          'task ids must be unique within a mission'
        )
      );
      continue;
    }
    if (task.dependsOn.includes(task.id) || task.parentTaskId === task.id) {
      issues.push(
        missionIssue(
          MISSION_CODES.graphSelfDependency,
          'error',
          `tasks.${task.id}.dependsOn`,
          `task "${task.id}" depends on itself`,
          'remove the self-reference'
        )
      );
      continue;
    }

    seen.add(task.id);
    tasks.push(task);
  }

  // Unknown edges are checked only once every id is known, so declaration order
  // never decides whether a forward reference is an error.
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!seen.has(dep)) {
        issues.push(
          missionIssue(
            MISSION_CODES.graphUnknownDependency,
            'error',
            `tasks.${task.id}.dependsOn`,
            `task "${task.id}" depends on unknown task "${dep}"`,
            'declare the dependency, or remove the reference'
          )
        );
      }
    }
    if (task.parentTaskId && !seen.has(task.parentTaskId)) {
      issues.push(
        missionIssue(
          MISSION_CODES.graphUnknownDependency,
          'error',
          `tasks.${task.id}.parentTaskId`,
          `task "${task.id}" names unknown parent "${task.parentTaskId}"`,
          'delegated tasks must name a task in the same mission'
        )
      );
    }
  }

  issues.push(...detectCycles(tasks));

  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const task of tasks) {
    task.depth = computeDepth(task, byId);
    if (task.depth > MAX_DELEGATION_DEPTH) {
      issues.push(
        missionIssue(
          MISSION_CODES.limitDepthExceeded,
          'error',
          `tasks.${task.id}`,
          `delegation depth ${task.depth} exceeds the ceiling of ${MAX_DELEGATION_DEPTH}`,
          'flatten the delegation chain'
        )
      );
    }
  }

  const sorted = sortMissionIssues(issues);
  if (hasErrors(sorted)) return { valid: false, graph: EMPTY_GRAPH, issues: sorted };

  const { order, layers } = orderTasks(tasks);
  const ordered = order.map((id) => byId.get(id) as MissionTask);

  return { valid: true, graph: { tasks: ordered, order, layers }, issues: sorted };
}

export { MAX_DELEGATION_DEPTH, MAX_MISSION_TASKS, MAX_TASK_DEPENDENCIES };
