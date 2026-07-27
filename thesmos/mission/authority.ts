// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph — authority.
 *
 * Binds each task to exactly one compiled contract and answers the only
 * permission question the runtime ever asks: may *this* task touch *this*
 * target on *this* channel?
 *
 * The answer always comes from `resolveInheritedPermission`, with the mission
 * as parent and the agent as child. There is no second resolver here, and no
 * path that consults an agent's policy on its own — a task's authority is
 * defined as the intersection with its mission's, never as its own claim.
 */

import { findContract } from '../council/load.js';
import { detectPermissionEscalation, resolveInheritedPermission } from '../council/permissions.js';
import type { CouncilAgentContract, CouncilPermissionChannel } from '../council/contract.js';
import { effectiveTaskLimits } from './limits.js';
import {
  MISSION_CODES,
  hasErrors,
  missionIssue,
  sortMissionIssues,
  type Mission,
  type MissionBindingResult,
  type MissionIssue,
  type TaskAuthorization,
  type TaskBinding,
} from './types.js';

/**
 * Escalations a contract declares against its mission.
 *
 * Reported as warnings rather than errors on purpose: `resolveInheritedPermission`
 * already makes the widening impossible at execution time, so an escalation is
 * an authoring smell — a rule that will never fire — not a live privilege gain.
 * Failing the mission on it would punish authors for a claim the runtime has
 * already neutralized.
 */
function escalationIssues(mission: Mission, contract: CouncilAgentContract): MissionIssue[] {
  return detectPermissionEscalation(mission.permissions, contract.permissions).map((e) =>
    missionIssue(
      MISSION_CODES.taskEscalation,
      'warning',
      `tasks.${contract.identity.id}.permissions.${e.channel}`,
      e.message,
      'narrow the agent rule, or widen the mission that dispatches it'
    )
  );
}

/**
 * Join every task to its contract.
 *
 * An unknown agent id is an error, not a skipped task: a mission that silently
 * dropped a step would report success having done less than it was asked.
 */
export function bindMission(
  mission: Mission,
  contracts: readonly CouncilAgentContract[]
): MissionBindingResult {
  const issues: MissionIssue[] = [];
  const bindings: TaskBinding[] = [];

  for (const task of mission.graph.tasks) {
    const contract = findContract(contracts, task.agentId);
    if (!contract) {
      issues.push(
        missionIssue(
          MISSION_CODES.taskAgentUnknown,
          'error',
          `tasks.${task.id}.agentId`,
          `task "${task.id}" is bound to unknown agent "${task.agentId}"`,
          'run `thesmos agents:list` to see routable agent ids'
        )
      );
      continue;
    }

    const escalations = escalationIssues(mission, contract);
    issues.push(...escalations);
    bindings.push({
      task,
      contract,
      limits: effectiveTaskLimits(mission.limits, contract.limits),
      escalations,
    });
  }

  const sorted = sortMissionIssues(issues);
  return { valid: !hasErrors(sorted), bindings, issues: sorted };
}

/**
 * Resolve one action for one task.
 *
 * `permitted` is true only for an outright `allow`. An `ask` is a question the
 * runtime has no way to answer on its own, so it is treated as "not permitted"
 * here and surfaced to whoever is driving the mission.
 */
export function authorizeTaskAction(
  mission: Mission,
  binding: TaskBinding,
  channel: CouncilPermissionChannel,
  target: string
): TaskAuthorization {
  const resolution = resolveInheritedPermission(
    mission.permissions,
    binding.contract.permissions,
    channel,
    target
  );

  return {
    taskId: binding.task.id,
    agentId: binding.contract.identity.id,
    channel,
    target: resolution.target,
    resolution,
    permitted: resolution.decision === 'allow',
  };
}

/** The issue a refused action produces, or `undefined` when it was allowed. */
export function authorizationIssue(auth: TaskAuthorization): MissionIssue | undefined {
  if (auth.resolution.decision === 'allow') return undefined;

  const denied = auth.resolution.decision === 'deny';
  return missionIssue(
    denied ? MISSION_CODES.actionDenied : MISSION_CODES.actionConfirmationRequired,
    denied ? 'error' : 'warning',
    `tasks.${auth.taskId}.${auth.channel}`,
    `${auth.channel}:${auth.target} resolved to ${auth.resolution.decision} — ${auth.resolution.reason}`,
    denied
      ? 'grant the channel on the mission and the agent, or drop the action'
      : 'confirm the action before the task proceeds'
  );
}
