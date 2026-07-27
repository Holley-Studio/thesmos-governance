// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Contract — public surface.
 *
 * One import site for consumers (CLI, extension, tests) so the internal module
 * split can change without breaking anyone.
 */

export {
  COUNCIL_AGENT_MODES,
  COUNCIL_COMMAND_CHANNELS,
  COUNCIL_CONTRACT_SCHEMA_VERSION,
  COUNCIL_LIMIT_CEILINGS,
  COUNCIL_PATH_CHANNELS,
  COUNCIL_PERMISSION_CHANNELS,
  COUNCIL_PRIMARY_ROLES,
  COUNCIL_RISK_TIERS,
  SUPPORTED_CONTRACT_SCHEMA_VERSIONS,
  emptyPermissionPolicy,
  isCouncilAgentMode,
  isCouncilPermissionDecision,
  isCouncilPrimaryRole,
  isCouncilRiskTier,
  serializeContract,
  serializeStable,
  type CouncilAgentContract,
  type CouncilAgentMode,
  type CouncilCompleteness,
  type CouncilDerivation,
  type CouncilEvidenceContract,
  type CouncilHandoffContract,
  type CouncilLimits,
  type CouncilModelPolicy,
  type CouncilOwnership,
  type CouncilPermissionChannel,
  type CouncilPermissionDecision,
  type CouncilPermissionPolicy,
  type CouncilPermissionRule,
  type CouncilPrimaryRole,
  type CouncilProvenance,
  type CouncilRisk,
  type CouncilRiskTier,
  type CouncilScope,
} from './contract.js';

export {
  DANGEROUS_COMMAND_SHAPES,
  MATCH_LIMITS,
  dangerousCommandShapes,
  isBroadCommandPattern,
  isBroadPattern,
  matchesCommandPattern,
  matchesPattern,
  normalizeCommand,
  normalizeCommandPattern,
  normalizeMatchPath,
  normalizeMatchPattern,
  type NormalizedCommand,
  type NormalizedPath,
} from './matching.js';

export {
  COUNCIL_PERMISSION_ALLOWED,
  COUNCIL_PERMISSION_BROAD_WRITE,
  COUNCIL_PERMISSION_CONFIRMATION_REQUIRED,
  COUNCIL_PERMISSION_DENIED,
  COUNCIL_PERMISSION_ESCALATION,
  COUNCIL_PERMISSION_INVALID_PATTERN,
  COUNCIL_PERMISSION_INVALID_TARGET,
  COUNCIL_PERMISSION_UNKNOWN,
  detectPermissionEscalation,
  isMorePermissive,
  mostRestrictive,
  probeTargetsForPattern,
  resolveInheritedPermission,
  resolvePermission,
  summarizePolicy,
  type CouncilPermissionCode,
  type CouncilPermissionResolution,
  type PermissionEscalation,
} from './permissions.js';

export {
  PROTECTED_WRITE_PATTERNS,
  SECRET_PATTERNS,
  baselineLimits,
  baselinePermissions,
  baselineRisk,
} from './baselines.js';

export {
  COUNCIL_EVIDENCE_CATEGORIES,
  HANDOFF_BASE_REQUIRED_FIELDS,
  evidenceBaselineForRole,
  evidenceBaselinesAreDistinct,
  handoffRequiredFieldsForRole,
  isEvidenceCategory,
  type CouncilEvidenceCategory,
} from './evidence.js';

export {
  COUNCIL_ROLE_DEFINITIONS,
  FALLBACK_ROLE,
  classifyPrimaryRole,
  isRoleLead,
  roleDefinition,
  type CouncilRoleDefinition,
  type RoleClassification,
} from './roles.js';

export {
  AGENT_HANDOFF_SCHEMA_ID,
  COUNCIL_NOTE_DERIVED,
  COUNCIL_NOTE_INVALID_DECLARED,
  COUNCIL_NOTE_MISSING_SAFETY,
  COUNCIL_NOTE_ROLE_FALLBACK,
  COUNCIL_SAFETY_CRITICAL_KEYS,
  compileAgentContract,
  compileAgentContracts,
  hasDeclaredCouncilMetadata,
  primaryRoleContracts,
  scopeFromPermissions,
  type CouncilCompileNote,
  type CouncilCompileResult,
  type CouncilCompileSource,
} from './compiler.js';

export {
  COUNCIL_CODES,
  formatValidationResult,
  sortIssues,
  validateContract,
  validateContracts,
  type CouncilContractIssue,
  type CouncilContractValidationResult,
} from './validate.js';

export {
  AGENT_HANDOFF_SCHEMA_VERSION,
  AGENT_HANDOFF_STATUSES,
  HANDOFF_CODES,
  SUPPORTED_HANDOFF_SCHEMA_VERSIONS,
  isAgentHandoffStatus,
  normalizeHandoff,
  renderHandoffMarkdown,
  serializeHandoff,
  validateHandoff,
  type AgentHandoff,
  type AgentHandoffStatus,
  type AgentTestResult,
  type AgentTestStatus,
  type HandoffIssue,
  type HandoffValidationOptions,
  type HandoffValidationResult,
} from './handoff.js';

export {
  DEFAULT_REDACTION_PATTERNS,
  REDACTION_PLACEHOLDER,
  containsSecretLike,
  normalizeStringList,
  redactAbsolutePaths,
  redactSecrets,
  sanitizeText,
  sanitizeToken,
  scrubForOutput,
  stripControlChars,
  toProvenancePath,
} from './sanitize.js';

export {
  findContract,
  loadCouncilContracts,
  type CouncilLoadOptions,
  type CouncilLoadResult,
} from './load.js';
