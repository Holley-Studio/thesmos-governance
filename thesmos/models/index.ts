// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Model Steward — one registry, one router, one price sheet.
 *
 * Import from here rather than reaching into the individual modules, so the
 * internal layout can change without churning every consumer.
 *
 * Consumers ask for a LOGICAL PROFILE ('balanced-agentic'), not a model id.
 * That is the whole point: a generation turns over by editing `registry.ts`,
 * not by grepping the monorepo for `claude-sonnet-4-6`.
 */

export {
  // types
  type AvailabilityRequirement,
  type CapabilityTier,
  type CostClass,
  type LatencyClass,
  type LegacyModelEntry,
  type LifecycleState,
  type LogicalProfile,
  type ModelEntry,
  type PricePoint,
  type Pricing,
  type Provider,
  // data
  LEGACY_MODELS,
  LOGICAL_PROFILES,
  MODEL_REGISTRY,
  PROFILE_ORDER,
  REGISTRY_VERSION,
  VERIFIED_AT,
  // lookup
  activeModelIds,
  entriesFor,
  isActiveModelId,
  lookupLegacyId,
  lookupModelId,
  priceOn,
  profileRank,
  registryHash,
  resolveProfile,
} from './registry.js';

export {
  type Ambiguity,
  type ApprovalState,
  type AvailabilityResult,
  type BillingMode,
  type FrontierApproval,
  type LatencyPreference,
  type ModelRouteDecision,
  type ReasonCode,
  type RiskTier,
  type RouteFallback,
  type RouteOptions,
  type RoutingSignals,
  explainDecision,
  hasModelMismatch,
  isLongHorizon,
  routeModel,
  selectProfile,
  withEffectiveModel,
} from './routing.js';

export {
  type CostResult,
  type KnownCost,
  type KnownSaving,
  type SavingResult,
  type UnknownCost,
  type UnknownSaving,
  SAVINGS_BASELINE_PROFILE,
  costFor,
  estimateTierSavingFromCost,
  formatSaving,
  savingVsBaseline,
} from './pricing.js';

export {
  type AgentModelRecord,
  type GeneratedMapRecord,
  type ModelAuditCode,
  type ModelAuditFinding,
  type ModelAuditInput,
  type ModelAuditResult,
  type ModelAuditSeverity,
  type RunModelAuditOptions,
  auditModels,
  checkAgentModelIds,
  checkCliVersion,
  checkEffectiveModelTruth,
  checkGeneratedMapDrift,
  checkNoFrontierPins,
  checkPickerDrift,
  checkRegistryIntegrity,
  compareSemver,
  formatModelAuditConsole,
  parseAgentModelRecord,
  parseGeneratedMap,
  runModelAuditForRoot,
} from './audit.js';
