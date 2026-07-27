// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph — the runtime.
 *
 * Walks a bound mission in dependency order, charging a shared step budget,
 * throttling each wave to the permitted parallel width, and validating the
 * handoff every task produces before letting anything downstream consume it.
 *
 * Two properties this file exists to hold:
 *
 * 1. **A task never exceeds its mission.** Authority comes only from
 *    `authorizeTaskAction`, which resolves against the mission as parent.
 * 2. **Determinism.** Tasks in a wave may run concurrently, but their results
 *    are folded back in sorted id order and the budget is charged in that same
 *    order, so the outcome does not depend on which one finished first.
 *
 * Delegation is handled by re-deriving the whole graph from the accumulated
 * task set each round. That reuses one DAG builder — cycles introduced across
 * generations are caught by the same code that catches them up front.
 */

import type { CouncilAgentContract, CouncilPermissionChannel } from '../council/contract.js';
import {
  normalizeHandoff,
  validateHandoff,
  type AgentHandoff,
} from '../council/handoff.js';
import { sanitizeToken } from '../council/sanitize.js';
import { authorizationIssue, authorizeTaskAction, bindMission } from './authority.js';
import { MAX_DELEGATION_DEPTH, buildMissionGraph } from './graph.js';
import {
  StepBudget,
  childrenExceededIssue,
  parallelExceededIssue,
  stepsExceededIssue,
} from './limits.js';
import { deriveMissionStatus, initialMissionState, missionStateHash } from './state.js';
import {
  MISSION_CODES,
  hasErrors,
  missionIssue,
  sortMissionIssues,
  type Mission,
  type MissionIssue,
  type MissionState,
  type MissionTaskInput,
  type MissionTaskState,
  type MissionTaskStatus,
  type TaskAuthorization,
  type TaskBinding,
} from './types.js';

// ── Runner contract ───────────────────────────────────────────────────────────

export interface TaskRunContext {
  mission: Mission;
  binding: TaskBinding;
  /** Validated handoffs from the tasks this one depends on, in id order. */
  upstream: AgentHandoff[];
  /** Steps left in the whole mission at dispatch time. */
  stepsRemaining: number;
  /** The only way to ask whether an action is allowed. */
  authorize(channel: CouncilPermissionChannel, target: string): TaskAuthorization;
}

export interface TaskRunResult {
  /** Raw handoff. Normalized and validated by the runtime before use. */
  handoff: unknown;
  /** Steps consumed. Defaults to 1; never charged as less than 1. */
  stepsUsed?: number;
  /** Tasks this task wants to bring into existence. Bounded per contract. */
  delegated?: MissionTaskInput[];
}

export type TaskRunner = (ctx: TaskRunContext) => Promise<TaskRunResult> | TaskRunResult;

export interface ExecuteMissionOptions {
  contracts: readonly CouncilAgentContract[];
  runTask: TaskRunner;
  /** Repo root, used to keep absolute paths out of handoffs. */
  root?: string;
}

export interface MissionExecutionResult {
  state: MissionState;
  /** `sha256:<hex>` over the final state. */
  stateHash: string;
  issues: MissionIssue[];
}

/** One extra round beyond the depth ceiling, so the breach is reported. */
const MAX_ROUNDS = MAX_DELEGATION_DEPTH + 1;

// ── Helpers ───────────────────────────────────────────────────────────────────

function taskInputsOf(mission: Mission): MissionTaskInput[] {
  return mission.graph.tasks.map((t) => ({
    id: t.id,
    agentId: t.agentId,
    title: t.title,
    intent: t.intent,
    dependsOn: t.dependsOn,
    ...(t.parentTaskId ? { parentTaskId: t.parentTaskId } : {}),
  }));
}

function failedState(mission: Mission, issues: MissionIssue[]): MissionExecutionResult {
  const state = initialMissionState(mission);
  state.status = 'failed';
  state.issues = sortMissionIssues(issues);
  return { state, stateHash: missionStateHash(state), issues: state.issues };
}

/** A dependency only counts as satisfied when it actually completed. */
function unmetDependencies(
  edges: readonly string[],
  states: ReadonlyMap<string, MissionTaskState>
): string[] {
  return edges.filter((id) => states.get(id)?.status !== 'complete').sort();
}

// ── Execution ─────────────────────────────────────────────────────────────────

/**
 * Execute a mission.
 *
 * Never throws on task failure — a runner that throws is recorded as a failed
 * task and the mission continues, so one broken agent cannot take down the
 * report for everything that did work.
 */
export async function executeMission(
  mission: Mission,
  options: ExecuteMissionOptions
): Promise<MissionExecutionResult> {
  const binding = bindMission(mission, options.contracts);
  if (!binding.valid) return failedState(mission, binding.issues);

  const knownAgentIds = options.contracts.map((c) => c.identity.id).sort();
  const bindingsByAgent = new Map(binding.bindings.map((b) => [b.task.id, b]));
  const missionIssues: MissionIssue[] = [...binding.issues];
  const budget = new StepBudget(mission.limits.maximumSteps);
  const states = new Map<string, MissionTaskState>();
  const handoffs = new Map<string, AgentHandoff>();
  const childrenByParent = new Map<string, string[]>();

  let allInputs = taskInputsOf(mission);
  const knownIds = new Set(allInputs.map((t) => t.id));
  let round = 0;

  while (round < MAX_ROUNDS) {
    round += 1;

    const graphResult = buildMissionGraph(allInputs);
    if (!graphResult.valid) {
      missionIssues.push(...graphResult.issues);
      break;
    }

    const pendingRound = graphResult.graph.order.filter((id) => !states.has(id));
    if (pendingRound.length === 0) break;

    const rebound = bindMission({ ...mission, graph: graphResult.graph }, options.contracts);
    for (const b of rebound.bindings) bindingsByAgent.set(b.task.id, b);
    if (!rebound.valid) missionIssues.push(...rebound.issues.filter((i) => i.severity === 'error'));

    const delegatedThisRound: MissionTaskInput[] = [];

    for (const [layerIndex, layer] of graphResult.graph.layers.entries()) {
      const pending = layer.filter((id) => !states.has(id));
      if (pending.length === 0) continue;

      const width = mission.limits.maximumParallelChildren;
      if (pending.length > width) {
        missionIssues.push(parallelExceededIssue(pending.length, width, layerIndex));
      }

      // Sorted, chunked dispatch. The budget is checked before a chunk goes out
      // and charged after it returns, both in id order, so a wide wave and a
      // narrow one consume the budget identically.
      const queue = [...pending].sort();
      while (queue.length > 0) {
        const chunk = queue.splice(0, Math.max(1, Math.min(width, budget.remaining || 1)));
        const dispatched: Array<{ id: string; result?: TaskRunResult; error?: unknown }> = [];

        // The whole callback body is guarded, not just the runner call. A
        // rejection escaping here would reject `Promise.all` and take down the
        // entire mission report — the one thing this executor promises never to
        // do — so every dispatch resolves, and failure travels as data.
        await Promise.all(
          chunk.map(async (id) => {
            try {
              const bound = bindingsByAgent.get(id);
              if (!bound) return;

              const edges = [
                ...bound.task.dependsOn,
                ...(bound.task.parentTaskId ? [bound.task.parentTaskId] : []),
              ];
              if (unmetDependencies(edges, states).length > 0 || budget.exhausted) {
                dispatched.push({ id });
                return;
              }

              const upstream = edges
                .slice()
                .sort()
                .map((dep) => handoffs.get(dep))
                .filter((h): h is AgentHandoff => h !== undefined);

              const ctx: TaskRunContext = {
                mission,
                binding: bound,
                upstream,
                stepsRemaining: budget.remaining,
                authorize: (channel, target) =>
                  authorizeTaskAction(mission, bound, channel, target),
              };

              dispatched.push({ id, result: await options.runTask(ctx) });
            } catch (error) {
              dispatched.push({ id, error });
            }
          })
        );

        // Fold results back deterministically.
        for (const id of chunk) {
          const bound = bindingsByAgent.get(id);
          if (!bound) continue;
          const entry = dispatched.find((d) => d.id === id);
          const taskState = foldTaskResult({
            bound,
            entry,
            states,
            budget,
            knownAgentIds,
            ...(options.root ? { root: options.root } : {}),
          });

          states.set(id, taskState);
          if (taskState.handoff) handoffs.set(id, taskState.handoff);

          const accepted = acceptDelegations(bound, entry?.result?.delegated ?? [], knownIds);
          delegatedThisRound.push(...accepted.tasks);
          taskState.childTaskIds = accepted.tasks.map((t) => t.id).sort();
          taskState.issues.push(...accepted.issues);
          childrenByParent.set(id, taskState.childTaskIds);
        }
      }
    }

    if (delegatedThisRound.length === 0) break;
    allInputs = [...allInputs, ...delegatedThisRound];

    if (round === MAX_ROUNDS) {
      missionIssues.push(
        missionIssue(
          MISSION_CODES.limitDepthExceeded,
          'error',
          'tasks',
          `delegation did not settle within ${MAX_ROUNDS} rounds`,
          'flatten the delegation chain'
        )
      );
    }
  }

  const taskStates = [...states.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
  const state: MissionState = {
    schemaVersion: mission.schemaVersion,
    missionId: mission.id,
    status: deriveMissionStatus(taskStates),
    stepsUsed: budget.used,
    issues: sortMissionIssues(missionIssues),
    tasks: taskStates.map((t) => ({ ...t, issues: sortMissionIssues(t.issues) })),
  };

  return { state, stateHash: missionStateHash(state), issues: state.issues };
}

// ── Result folding ────────────────────────────────────────────────────────────

interface FoldArgs {
  bound: TaskBinding;
  entry: { id: string; result?: TaskRunResult; error?: unknown } | undefined;
  states: ReadonlyMap<string, MissionTaskState>;
  budget: StepBudget;
  knownAgentIds: readonly string[];
  root?: string;
}

/**
 * Turn one runner outcome into a task state.
 *
 * A handoff that claims `complete` without the evidence its role requires is
 * recorded at its `effectiveStatus`, not the status it asserted — the downgrade
 * is the whole point of validating here rather than trusting the runner.
 */
function foldTaskResult(args: FoldArgs): MissionTaskState {
  const { bound, entry, states, budget, knownAgentIds, root } = args;
  const task = bound.task;
  const issues: MissionIssue[] = [];

  const base: MissionTaskState = {
    taskId: task.id,
    agentId: task.agentId,
    status: 'pending',
    stepsUsed: 0,
    childTaskIds: [],
    issues,
  };

  const edges = [...task.dependsOn, ...(task.parentTaskId ? [task.parentTaskId] : [])];
  const unmet = unmetDependencies(edges, states);
  if (unmet.length > 0) {
    issues.push(
      missionIssue(
        MISSION_CODES.dependencyUnsatisfied,
        'warning',
        `tasks.${task.id}.dependsOn`,
        `skipped: dependencies did not complete — ${unmet.join(', ')}`,
        'resolve the upstream task, then re-run the mission'
      )
    );
    return { ...base, status: 'skipped' };
  }

  if (!entry || (entry.result === undefined && entry.error === undefined)) {
    if (budget.exhausted) {
      issues.push(stepsExceededIssue(task.id, budget.used));
      return { ...base, status: 'blocked' };
    }
    issues.push(
      missionIssue(
        MISSION_CODES.handoffMissing,
        'error',
        `tasks.${task.id}`,
        'task produced no handoff',
        'every task must return a handoff, even a failed one'
      )
    );
    return { ...base, status: 'failed' };
  }

  if (entry.error !== undefined) {
    budget.charge(1);
    issues.push(
      missionIssue(
        MISSION_CODES.taskThrew,
        'error',
        `tasks.${task.id}`,
        `task runner threw: ${entry.error instanceof Error ? entry.error.message : String(entry.error)}`,
        'return a failed handoff instead of throwing'
      )
    );
    return { ...base, status: 'failed', stepsUsed: 1 };
  }

  const result = entry.result as TaskRunResult;
  const requested = Math.max(1, Math.floor(result.stepsUsed ?? 1));
  const charged = budget.charge(requested);
  if (!charged) issues.push(stepsExceededIssue(task.id, budget.used));

  const handoff = normalizeHandoff(result.handoff, root);
  const validation = validateHandoff(handoff, {
    contract: bound.contract,
    knownAgentIds,
    role: bound.contract.classification.primaryRole,
  });

  for (const issue of validation.issues) {
    issues.push(
      missionIssue(
        issue.code,
        issue.severity,
        `tasks.${task.id}.handoff.${issue.path}`,
        issue.message,
        issue.remediation
      )
    );
  }

  if (handoff.taskId !== task.id) {
    issues.push(
      missionIssue(
        MISSION_CODES.handoffTaskMismatch,
        'error',
        `tasks.${task.id}.handoff.taskId`,
        `handoff reports task "${handoff.taskId}" but was produced for "${task.id}"`,
        'set handoff.taskId to the task it belongs to'
      )
    );
  }

  if (validation.effectiveStatus !== handoff.status) {
    issues.push(
      missionIssue(
        MISSION_CODES.handoffDowngraded,
        'warning',
        `tasks.${task.id}.handoff.status`,
        `handoff claimed "${handoff.status}" but proves "${validation.effectiveStatus}"`,
        'attach the evidence the role requires, or report the lower status'
      )
    );
  }

  const mismatched = handoff.taskId !== task.id;
  const status: MissionTaskStatus =
    mismatched || (!charged && validation.effectiveStatus === 'complete')
      ? 'failed'
      : validation.effectiveStatus;

  return {
    ...base,
    status,
    stepsUsed: requested,
    handoff,
    issues,
  };
}

// ── Delegation ────────────────────────────────────────────────────────────────

/**
 * Admit the children a task asked for, up to its own limit.
 *
 * Over-delegation truncates rather than fails: the tasks that fit still run,
 * and the breach is reported, so a runner that asks for too much loses the
 * excess instead of losing the whole task.
 */
function acceptDelegations(
  bound: TaskBinding,
  requested: readonly MissionTaskInput[],
  knownIds: Set<string>
): { tasks: MissionTaskInput[]; issues: MissionIssue[] } {
  if (requested.length === 0) return { tasks: [], issues: [] };

  const issues: MissionIssue[] = [];
  const ceiling = bound.limits.maximumChildren;
  const ordered = [...requested].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));

  if (ordered.length > ceiling) {
    issues.push(childrenExceededIssue(bound.task.id, ordered.length, ceiling));
  }

  const admitted: MissionTaskInput[] = [];
  for (const child of ordered.slice(0, ceiling)) {
    if (!child || typeof child.id !== 'string') continue;
    // Checked against every id the mission knows about, not just the ones that
    // have run — a child colliding with a task still queued is just as broken.
    const id = sanitizeToken(child.id, 64);
    if (knownIds.has(id)) {
      issues.push(
        missionIssue(
          MISSION_CODES.graphDuplicateTask,
          'error',
          `tasks.${bound.task.id}.children`,
          `delegated task "${id}" collides with an existing task id`,
          'give each delegated task a unique id'
        )
      );
      continue;
    }
    knownIds.add(id);
    admitted.push({ ...child, parentTaskId: bound.task.id });
  }

  return { tasks: admitted, issues };
}

export { hasErrors, authorizationIssue };
