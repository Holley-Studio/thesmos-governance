// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph — assembly.
 *
 * Turns a request into a validated `Mission`, or into the list of reasons it
 * could not be one. A mission is only ever handed back when its graph is a
 * valid DAG, so no downstream caller has to re-check the shape.
 */

import { emptyPermissionPolicy } from '../council/contract.js';
import { sanitizeText } from '../council/sanitize.js';
import { buildMissionGraph } from './graph.js';
import { ceilingBoundedLimits } from './limits.js';
import { missionId } from './state.js';
import {
  MISSION_SCHEMA_VERSION,
  type Mission,
  type MissionIssue,
  type MissionRequest,
  type MissionTaskInput,
} from './types.js';

export interface MissionCreateResult {
  valid: boolean;
  /** Present only when `valid` — an invalid graph yields no mission at all. */
  mission?: Mission;
  issues: MissionIssue[];
}

/**
 * Assemble a mission.
 *
 * The id is computed from the *normalized* task set rather than the raw input,
 * so two requests that differ only in whitespace, declaration order, or
 * duplicate dependency entries resolve to the same mission id.
 */
export function createMission(request: MissionRequest): MissionCreateResult {
  const goal = sanitizeText(request?.goal, 2000);
  const permissions = request?.permissions ?? emptyPermissionPolicy();
  const limits = ceilingBoundedLimits(request?.limits);

  const graphResult = buildMissionGraph(request?.tasks ?? []);
  if (!graphResult.valid) {
    return { valid: false, issues: graphResult.issues };
  }

  const normalized: MissionTaskInput[] = graphResult.graph.tasks.map((t) => ({
    id: t.id,
    agentId: t.agentId,
    title: t.title,
    intent: t.intent,
    dependsOn: t.dependsOn,
    ...(t.parentTaskId ? { parentTaskId: t.parentTaskId } : {}),
  }));

  const mission: Mission = {
    schemaVersion: MISSION_SCHEMA_VERSION,
    id: missionId(goal, normalized, permissions, limits),
    goal,
    permissions,
    limits,
    graph: graphResult.graph,
  };

  return { valid: true, mission, issues: graphResult.issues };
}
