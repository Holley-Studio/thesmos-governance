// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph — content-addressed state.
 *
 * Mission ids and state hashes are derived from content alone. Nothing here
 * reads a clock, a random source, or an environment value, so replaying the
 * same mission over the same inputs produces byte-identical output — which is
 * what makes a mission state comparable across machines and across runs.
 *
 * The hash is `sha256:<hex>` via the same `contentHash` the agent contracts
 * use. One hasher, one format, one thing to verify.
 */

import { contentHash } from '../agent-ownership.js';
import { serializeStable } from '../council/contract.js';
import type { CouncilLimits, CouncilPermissionPolicy } from '../council/contract.js';
import {
  MISSION_SCHEMA_VERSION,
  sortMissionIssues,
  type Mission,
  type MissionState,
  type MissionStatus,
  type MissionTaskInput,
  type MissionTaskState,
} from './types.js';

/**
 * The projection a mission id is computed over.
 *
 * Deliberately excludes everything derived — order, layers, depth — so a
 * mission's identity tracks what was *asked for*, not how the runtime chose to
 * schedule it. Reordering the declared task list does not mint a new mission.
 */
interface MissionIdentityProjection {
  schemaVersion: string;
  goal: string;
  permissions: CouncilPermissionPolicy;
  limits: CouncilLimits;
  tasks: Array<{
    id: string;
    agentId: string;
    title: string;
    intent: string;
    dependsOn: string[];
    parentTaskId: string;
  }>;
}

export function missionIdentityProjection(
  goal: string,
  tasks: readonly MissionTaskInput[],
  permissions: CouncilPermissionPolicy,
  limits: CouncilLimits
): MissionIdentityProjection {
  return {
    schemaVersion: MISSION_SCHEMA_VERSION,
    goal,
    permissions,
    limits,
    tasks: [...tasks]
      .map((t) => ({
        id: t.id,
        agentId: t.agentId,
        title: t.title,
        intent: t.intent,
        dependsOn: [...(t.dependsOn ?? [])].sort(),
        parentTaskId: t.parentTaskId ?? '',
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** `sha256:<hex>` over the normalized request. Same request → same id. */
export function missionId(
  goal: string,
  tasks: readonly MissionTaskInput[],
  permissions: CouncilPermissionPolicy,
  limits: CouncilLimits
): string {
  return contentHash(serializeStable(missionIdentityProjection(goal, tasks, permissions, limits)));
}

/**
 * `sha256:<hex>` over a whole mission state.
 *
 * Issues are sorted and task states are ordered by id before hashing, so two
 * runs that reached the same conclusion by different scheduling paths still
 * agree on the hash.
 */
export function missionStateHash(state: MissionState): string {
  const projection = {
    schemaVersion: state.schemaVersion,
    missionId: state.missionId,
    status: state.status,
    stepsUsed: state.stepsUsed,
    issues: sortMissionIssues(state.issues),
    tasks: [...state.tasks]
      .map((t) => ({
        taskId: t.taskId,
        agentId: t.agentId,
        status: t.status,
        stepsUsed: t.stepsUsed,
        childTaskIds: [...t.childTaskIds].sort(),
        // Effective bounds and authority answers are part of what the run
        // *meant*, not incidental telemetry, so both are sealed by the hash.
        limits: t.limits,
        authorizations: [...t.authorizations].sort(
          (a, b) =>
            a.channel.localeCompare(b.channel) ||
            a.target.localeCompare(b.target) ||
            a.decision.localeCompare(b.decision)
        ),
        handoff: t.handoff ?? null,
        issues: sortMissionIssues(t.issues),
      }))
      .sort((a, b) => a.taskId.localeCompare(b.taskId)),
  };
  return contentHash(serializeStable(projection));
}

/** Every task pending, nothing spent. */
export function initialMissionState(mission: Mission): MissionState {
  return {
    schemaVersion: MISSION_SCHEMA_VERSION,
    missionId: mission.id,
    status: 'partial',
    stepsUsed: 0,
    issues: [],
    tasks: mission.graph.tasks.map((task) => ({
      taskId: task.id,
      agentId: task.agentId,
      status: 'pending',
      stepsUsed: 0,
      childTaskIds: [],
      // Nothing is bound yet, so the mission ceiling is the honest value here.
      limits: mission.limits,
      authorizations: [],
      issues: [],
    })),
  };
}

/**
 * Roll task outcomes up into one mission status.
 *
 * Ordered worst-first: a single failure makes the mission failed regardless of
 * how much else succeeded. A mission is `complete` only when every task is, so
 * partial work can never present itself as a finished mission.
 */
export function deriveMissionStatus(tasks: readonly MissionTaskState[]): MissionStatus {
  if (tasks.length === 0) return 'failed';
  if (tasks.some((t) => t.status === 'failed')) return 'failed';
  if (tasks.some((t) => t.status === 'blocked')) return 'blocked';
  if (tasks.every((t) => t.status === 'complete')) return 'complete';
  return 'partial';
}
