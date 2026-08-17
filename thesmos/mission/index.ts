// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mission Graph Runtime — internal surface.
 *
 * One import site for the CLI and tests. This barrel is deliberately *not*
 * re-exported from `thesmos/index.ts`: the mission runtime is CLI-internal for
 * now, so its shape can change without a breaking release of the published
 * library. See the Operation Olympus ledger, PR 2, for the decision record.
 */

export {
  MISSION_CODES,
  MISSION_SCHEMA_VERSION,
  SUPPORTED_MISSION_SCHEMA_VERSIONS,
  hasErrors,
  missionIssue,
  sortMissionIssues,
  type Mission,
  type MissionBindingResult,
  type MissionGraph,
  type MissionGraphResult,
  type MissionIssue,
  type MissionRequest,
  type MissionState,
  type MissionStatus,
  type MissionTask,
  type MissionTaskInput,
  type MissionTaskState,
  type MissionTaskStatus,
  type TaskAuthorization,
  type TaskAuthorizationRecord,
  type TaskBinding,
} from './types.js';

export {
  MAX_DELEGATION_DEPTH,
  MAX_MISSION_TASKS,
  MAX_TASK_DEPENDENCIES,
  buildMissionGraph,
} from './graph.js';

export {
  DEFAULT_MISSION_LIMITS,
  StepBudget,
  ceilingBoundedLimits,
  effectiveTaskLimits,
} from './limits.js';

export { authorizationIssue, authorizeTaskAction, bindMission } from './authority.js';

export { createMission, type MissionCreateResult } from './create.js';

export {
  deriveMissionStatus,
  initialMissionState,
  missionId,
  missionIdentityProjection,
  missionStateHash,
} from './state.js';

export {
  executeMission,
  type ExecuteMissionOptions,
  type MissionExecutionResult,
  type TaskRunContext,
  type TaskRunResult,
  type TaskRunner,
} from './execute.js';
