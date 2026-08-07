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
import { MAX_DELEGATION_DEPTH, MAX_MISSION_TASKS, buildMissionGraph } from './graph.js';
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
  type TaskAuthorizationRecord,
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
  /**
   * Governed memory for this task, already bounded and filtered.
   *
   * Absent when no context provider was supplied, recall was disabled, or the
   * memory subsystem was unavailable — a runner must treat it as optional and
   * behave identically without it.
   *
   * The scope is derived from mission authority by the runtime, never asked for
   * by the task: a runner cannot widen what it is allowed to remember any more
   * than it can widen what it is allowed to touch.
   */
  memoryContext?: TaskMemoryContext;
}

/** Read-only memory handed to a task. */
export interface TaskMemoryContext {
  /** Fenced, sanitized memory block, ready to append below current evidence. */
  capsule: string;
  /** Ids of what was included — for receipts, never the content. */
  memoryIds: string[];
  /** Estimated tokens the block contributes. Estimated, not measured. */
  tokensEstimate: number;
}

/**
 * Supplies governed context for a task.
 *
 * Injected rather than imported so `execute.ts` stays pure and testable, and so
 * a mission can run with no memory subsystem at all. Must never throw — the
 * runtime treats a rejection as "no memory" and continues.
 */
export type MissionContextProvider = (
  mission: Mission,
  binding: TaskBinding,
) => Promise<TaskMemoryContext | undefined>;

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
  /**
   * Optional governed-memory supplier. Omitted means missions run exactly as
   * they did before — memory is additive, never load-bearing.
   */
  contextProvider?: MissionContextProvider;
}

export interface MissionExecutionResult {
  state: MissionState;
  /** `sha256:<hex>` over the final state. */
  stateHash: string;
  issues: MissionIssue[];
}

/** One extra round beyond the depth ceiling, so the breach is reported. */
const MAX_ROUNDS = MAX_DELEGATION_DEPTH + 1;

/**
 * Cap on authority questions recorded per task.
 *
 * A runner that probes in a loop must not be able to grow the mission state
 * without bound. Records are deduplicated as well, so this ceiling is only
 * reached by a task asking about genuinely distinct targets.
 */
const MAX_AUTHORIZATION_RECORDS = 256;

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
        const dispatched: Array<{
          id: string;
          result?: TaskRunResult;
          error?: unknown;
          authorizations?: TaskAuthorizationRecord[];
        }> = [];

        // Two layers, deliberately. The inner guard covers the whole callback
        // body rather than just the runner call, so every dispatch resolves and
        // failure travels as data. The outer guard is a backstop: if a rejection
        // ever did escape, the wave degrades into missing entries — which the
        // fold below records as failed tasks — instead of destroying the report
        // for every task that already succeeded.
        try {
          await Promise.all(
            chunk.map(async (id) => {
              const authorizations: TaskAuthorizationRecord[] = [];
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

                // Retrieval is read-only and its failure is absorbed here, so a
                // memory outage can never fail a task or alter mission state.
                // Awaited per task rather than shared, so ordering of persisted
                // results stays exactly as deterministic as it was before.
                let memoryContext: TaskMemoryContext | undefined;
                if (options.contextProvider) {
                  try {
                    memoryContext = await options.contextProvider(mission, bound);
                  } catch {
                    memoryContext = undefined;
                  }
                }

                const ctx: TaskRunContext = {
                  mission,
                  binding: bound,
                  upstream,
                  stepsRemaining: budget.remaining,
                  memoryContext,
                  // Every answer is recorded, honoured or not. A `deny` the
                  // runner ignored still has to appear in the report, or the
                  // refusal is unauditable.
                  authorize: (channel, target) => {
                    const auth = authorizeTaskAction(mission, bound, channel, target);
                    if (authorizations.length < MAX_AUTHORIZATION_RECORDS) {
                      authorizations.push({
                        channel: auth.channel,
                        target: auth.target,
                        decision: auth.resolution.decision,
                      });
                    }
                    return auth;
                  },
                };

                dispatched.push({ id, result: await options.runTask(ctx), authorizations });
              } catch (error) {
                dispatched.push({ id, error, authorizations });
              }
            })
          );
        } catch (error) {
          missionIssues.push(
            missionIssue(
              MISSION_CODES.taskThrew,
              'error',
              `layers[${layerIndex}]`,
              `wave dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
              'this indicates a defect in the executor, not in a task'
            )
          );
        }

        // Fold results back deterministically. Guarded per task: normalization,
        // validation, and delegation all run here, and a throw from any of them
        // would otherwise abandon the whole mission mid-wave.
        for (const id of chunk) {
          const bound = bindingsByAgent.get(id);
          if (!bound) continue;
          const entry = dispatched.find((d) => d.id === id);

          try {
            const taskState = foldTaskResult({
              mission,
              bound,
              entry,
              states,
              budget,
              knownAgentIds,
              ...(options.root ? { root: options.root } : {}),
            });

            states.set(id, taskState);
            if (taskState.handoff) handoffs.set(id, taskState.handoff);

            const remainingTaskSlots = MAX_MISSION_TASKS - knownIds.size;
            const accepted = acceptDelegations(
              bound,
              entry?.result?.delegated ?? [],
              knownIds,
              remainingTaskSlots
            );
            delegatedThisRound.push(...accepted.tasks);
            taskState.childTaskIds = accepted.tasks.map((t) => t.id).sort();
            taskState.issues.push(...accepted.issues);
          } catch (error) {
            states.set(id, {
              taskId: id,
              agentId: bound.task.agentId,
              status: 'failed',
              stepsUsed: 0,
              childTaskIds: [],
              limits: bound.limits,
              authorizations: [],
              issues: [
                missionIssue(
                  MISSION_CODES.foldFailed,
                  'error',
                  `tasks.${id}`,
                  `recording the result failed: ${error instanceof Error ? error.message : String(error)}`,
                  'this indicates a defect in the executor, not in the task'
                ),
              ],
            });
          }
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

  // Hashing is the last thing that can fail, and a report without a hash is
  // still worth more than a rejected promise. An empty digest is an unmistakable
  // signal that the state could not be sealed.
  let stateHash = '';
  try {
    stateHash = missionStateHash(state);
  } catch (error) {
    state.issues = sortMissionIssues([
      ...state.issues,
      missionIssue(
        MISSION_CODES.foldFailed,
        'error',
        'stateHash',
        `mission state could not be hashed: ${error instanceof Error ? error.message : String(error)}`,
        'the report is complete but unsealed — treat it as unverified'
      ),
    ]);
  }

  return { state, stateHash, issues: state.issues };
}

// ── Result folding ────────────────────────────────────────────────────────────

interface FoldArgs {
  mission: Mission;
  bound: TaskBinding;
  entry:
    | {
        id: string;
        result?: TaskRunResult;
        error?: unknown;
        authorizations?: TaskAuthorizationRecord[];
      }
    | undefined;
  states: ReadonlyMap<string, MissionTaskState>;
  budget: StepBudget;
  knownAgentIds: readonly string[];
  root?: string;
}

/** Deduplicated and ordered, so the record is stable and hashable. */
function normalizeAuthorizations(
  records: readonly TaskAuthorizationRecord[] | undefined
): TaskAuthorizationRecord[] {
  if (!records || records.length === 0) return [];
  const seen = new Map<string, TaskAuthorizationRecord>();
  // Keyed by a serialized tuple rather than a delimited string: `shell` targets
  // are command lines, so any single-character delimiter is a target a caller
  // could legitimately supply.
  for (const r of records) seen.set(JSON.stringify([r.channel, r.target, r.decision]), r);
  return [...seen.values()].sort(
    (a, b) =>
      a.channel.localeCompare(b.channel) ||
      a.target.localeCompare(b.target) ||
      a.decision.localeCompare(b.decision)
  );
}

/**
 * Turn one runner outcome into a task state.
 *
 * A handoff that claims `complete` without the evidence its role requires is
 * recorded at its `effectiveStatus`, not the status it asserted — the downgrade
 * is the whole point of validating here rather than trusting the runner.
 */
function foldTaskResult(args: FoldArgs): MissionTaskState {
  const { mission, bound, entry, states, budget, knownAgentIds, root } = args;
  const task = bound.task;
  const issues: MissionIssue[] = [];
  const authorizations = normalizeAuthorizations(entry?.authorizations);

  // Any answer that was not an outright `allow` is surfaced, whether or not the
  // runner acted on it. `ask` is a question the runtime cannot answer alone.
  for (const record of authorizations) {
    if (record.decision === 'allow') continue;
    const denied = record.decision === 'deny';
    issues.push(
      missionIssue(
        denied ? MISSION_CODES.actionDenied : MISSION_CODES.actionConfirmationRequired,
        denied ? 'error' : 'warning',
        `tasks.${task.id}.${record.channel}`,
        `${record.channel}:${record.target} resolved to ${record.decision}`,
        denied
          ? 'grant the channel on the mission and the agent, or drop the action'
          : 'confirm the action before the task proceeds'
      )
    );
  }

  const base: MissionTaskState = {
    taskId: task.id,
    agentId: task.agentId,
    status: 'pending',
    stepsUsed: 0,
    childTaskIds: [],
    limits: bound.limits,
    authorizations,
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

  // The task's own ceiling is the effective one — the minimum of the mission's
  // and its contract's. Charging the mission budget alone would let an agent
  // that narrowed itself to a handful of steps spend the whole mission.
  const taskCeiling = bound.limits.maximumSteps;
  const overTaskCeiling = requested > taskCeiling;
  const chargeable = Math.min(requested, taskCeiling);
  if (overTaskCeiling) {
    issues.push(
      missionIssue(
        MISSION_CODES.limitStepsExceeded,
        'error',
        `tasks.${task.id}`,
        `task consumed ${requested} steps, exceeding its effective limit of ${taskCeiling}`,
        'raise `council_max_steps` on the agent and the mission, or split the task'
      )
    );
  }

  const charged = budget.charge(chargeable);
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

  const taskMismatched = handoff.taskId !== task.id;
  if (taskMismatched) {
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

  // A handoff carrying another mission's id is either a routing bug or a forged
  // result. Either way it must not be recorded as proof under this mission's
  // permission envelope.
  const missionMismatched = handoff.missionId !== mission.id;
  if (missionMismatched) {
    issues.push(
      missionIssue(
        MISSION_CODES.handoffMissionMismatch,
        'error',
        `tasks.${task.id}.handoff.missionId`,
        `handoff reports a different mission than the one that dispatched it`,
        'set handoff.missionId to the mission the task belongs to'
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

  const status: MissionTaskStatus =
    taskMismatched ||
    missionMismatched ||
    overTaskCeiling ||
    (!charged && validation.effectiveStatus === 'complete')
      ? 'failed'
      : validation.effectiveStatus;

  return {
    ...base,
    status,
    stepsUsed: chargeable,
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
  knownIds: Set<string>,
  remainingTaskSlots: number
): { tasks: MissionTaskInput[]; issues: MissionIssue[] } {
  if (requested.length === 0) return { tasks: [], issues: [] };

  const issues: MissionIssue[] = [];
  const childCeiling = bound.limits.maximumChildren;
  const ordered = [...requested].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));

  if (ordered.length > childCeiling) {
    issues.push(childrenExceededIssue(bound.task.id, ordered.length, childCeiling));
  }

  // Per-task children and whole-mission tasks are separate ceilings. Depth alone
  // does not bound a graph whose generations multiply, so the mission-wide slot
  // count is what actually stops runaway delegation.
  const slots = Math.max(0, Math.min(childCeiling, remainingTaskSlots));
  if (slots < Math.min(ordered.length, childCeiling)) {
    issues.push(
      missionIssue(
        MISSION_CODES.limitTasksExceeded,
        'error',
        `tasks.${bound.task.id}.children`,
        `delegation refused: the mission is at its ceiling of ${MAX_MISSION_TASKS} tasks`,
        'split the work across missions — this ceiling is compiled in and not configurable'
      )
    );
  }

  const admitted: MissionTaskInput[] = [];
  for (const child of ordered.slice(0, slots)) {
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
