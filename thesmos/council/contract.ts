// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Council Contract — the versioned, machine-readable governance envelope for
 * every agent Thesmos can route to.
 *
 * The contract is **compiled**, never hand-authored: agent Markdown stays
 * human-readable and is not rewritten (Olympus D2). Everything here is data —
 * no I/O, no side effects — so the contract can be produced, validated, hashed,
 * and compared deterministically on any platform.
 *
 * Safety posture (Olympus D3/D4): optional *descriptive* metadata may be
 * defaulted; *safety-critical* metadata is either declared explicitly, derived
 * from a conservative role baseline and recorded as derived, or reported as a
 * validation failure. Nothing here ever defaults to broad allow.
 */

// ── Schema version ────────────────────────────────────────────────────────────

/** Bump minor for additive fields; bump major when a consumer must migrate. */
export const COUNCIL_CONTRACT_SCHEMA_VERSION = '1.0.0';

/** Contract schema versions this build can read. */
export const SUPPORTED_CONTRACT_SCHEMA_VERSIONS: readonly string[] = [
  COUNCIL_CONTRACT_SCHEMA_VERSION,
];

// ── Classification ────────────────────────────────────────────────────────────

/**
 * The eight user-facing roles. A user picks a role, not one of 68 gods; the
 * specialists stay routable behind them (Olympus Phase 5).
 */
export type CouncilPrimaryRole =
  | 'build'
  | 'plan'
  | 'debug'
  | 'review'
  | 'security'
  | 'design'
  | 'growth'
  | 'operations';

/** Stable display order — every list, table, and JSON payload uses this. */
export const COUNCIL_PRIMARY_ROLES: readonly CouncilPrimaryRole[] = [
  'build',
  'plan',
  'debug',
  'review',
  'security',
  'design',
  'growth',
  'operations',
];

export function isCouncilPrimaryRole(value: unknown): value is CouncilPrimaryRole {
  return typeof value === 'string' && (COUNCIL_PRIMARY_ROLES as readonly string[]).includes(value);
}

/**
 * `primary`  — may lead a mission (a user can select it directly)
 * `subagent` — may only be dispatched by another agent
 * `all`      — both (Zeus, orchestrators)
 */
export type CouncilAgentMode = 'primary' | 'subagent' | 'all';

export const COUNCIL_AGENT_MODES: readonly CouncilAgentMode[] = ['primary', 'subagent', 'all'];

export function isCouncilAgentMode(value: unknown): value is CouncilAgentMode {
  return typeof value === 'string' && (COUNCIL_AGENT_MODES as readonly string[]).includes(value);
}

// ── Permissions ───────────────────────────────────────────────────────────────

export type CouncilPermissionDecision = 'allow' | 'ask' | 'deny';

/** Channels a contract must speak to. Adding one is a schema minor bump. */
export type CouncilPermissionChannel =
  | 'read'
  | 'edit'
  | 'shell'
  | 'web'
  | 'browser'
  | 'mcp'
  | 'task';

/** Stable iteration order for every permission-facing output. */
export const COUNCIL_PERMISSION_CHANNELS: readonly CouncilPermissionChannel[] = [
  'read',
  'edit',
  'shell',
  'web',
  'browser',
  'mcp',
  'task',
];

/** Channels whose targets are repo paths (vs commands / URLs / tool names). */
export const COUNCIL_PATH_CHANNELS: readonly CouncilPermissionChannel[] = ['read', 'edit'];

/** Channels whose targets are command lines — matched as text, never executed. */
export const COUNCIL_COMMAND_CHANNELS: readonly CouncilPermissionChannel[] = ['shell'];

export function isCouncilPermissionDecision(v: unknown): v is CouncilPermissionDecision {
  return v === 'allow' || v === 'ask' || v === 'deny';
}

export interface CouncilPermissionRule {
  decision: CouncilPermissionDecision;
  /** Glob patterns. Matching is order-independent and most-restrictive-wins. */
  patterns: string[];
  /** Why this rule exists. Required to justify a broad allow. */
  reason?: string;
}

export type CouncilPermissionPolicy = Record<CouncilPermissionChannel, CouncilPermissionRule[]>;

/** An empty policy denies nothing and allows nothing — every lookup is `ask`. */
export function emptyPermissionPolicy(): CouncilPermissionPolicy {
  return { read: [], edit: [], shell: [], web: [], browser: [], mcp: [], task: [] };
}

// ── Risk / limits / evidence ──────────────────────────────────────────────────

export type CouncilRiskTier = 'low' | 'medium' | 'high' | 'critical';

export const COUNCIL_RISK_TIERS: readonly CouncilRiskTier[] = ['low', 'medium', 'high', 'critical'];

export function isCouncilRiskTier(v: unknown): v is CouncilRiskTier {
  return typeof v === 'string' && (COUNCIL_RISK_TIERS as readonly string[]).includes(v);
}

/**
 * Hard ceilings. A contract may be stricter; it may never exceed these, and a
 * missing value is never "unlimited" — see `validateContract`.
 */
export const COUNCIL_LIMIT_CEILINGS = {
  maximumSteps: 200,
  maximumChildren: 16,
  maximumParallelChildren: 8,
  timeoutMs: 3_600_000,
} as const;

export interface CouncilLimits {
  maximumSteps: number;
  maximumChildren: number;
  maximumParallelChildren: number;
  timeoutMs?: number;
}

export interface CouncilScope {
  readablePaths: string[];
  writablePaths: string[];
  forbiddenPaths: string[];
  allowedCommands: string[];
  confirmCommands: string[];
  deniedCommands: string[];
}

export interface CouncilRisk {
  tier: CouncilRiskTier;
  requiresHumanApproval: boolean;
  requiresCheckpoint: boolean;
  requiresFinalReview: boolean;
}

export interface CouncilEvidenceContract {
  required: string[];
  optional: string[];
}

export interface CouncilHandoffContract {
  schema: string;
  requiredFields: string[];
}

export interface CouncilModelPolicy {
  preferredProfiles: string[];
  minimumCapability?: string;
  allowedProviders?: string[];
  deniedProviders?: string[];
  subscriptionPreferred?: boolean;
  localAllowed?: boolean;
}

// ── Provenance ────────────────────────────────────────────────────────────────

export type CouncilOwnership = 'managed' | 'adopted' | 'external';

/**
 * `explicit`      — every safety-critical field came from the agent document.
 * `compatibility` — one or more were derived from the conservative role
 *                   baseline because the document predates the contract. The
 *                   derived fields are listed in `completeness.derivedFields`
 *                   so "restrictive default" can never be mistaken for
 *                   "author's declared intent".
 */
export type CouncilDerivation = 'explicit' | 'compatibility';

export interface CouncilProvenance {
  /** Repo-relative, forward-slash. Never an absolute machine path. */
  sourcePath: string;
  owner: string;
  ownership: CouncilOwnership;
  /** `sha256:<hex>` over the normalized agent document. */
  contentHash: string;
  signature?: string;
  derivation: CouncilDerivation;
}

/** The explicit incomplete state required by Olympus D4. */
export interface CouncilCompleteness {
  /** True only when no safety-critical field was derived. */
  complete: boolean;
  /** Dotted contract paths that were filled from the role baseline. Sorted. */
  derivedFields: string[];
}

// ── The contract ──────────────────────────────────────────────────────────────

export interface CouncilAgentContract {
  schemaVersion: string;

  identity: {
    id: string;
    version: string;
    displayName: string;
    mythicIdentity?: string;
    description: string;
  };

  classification: {
    primaryRole: CouncilPrimaryRole;
    mode: CouncilAgentMode;
    /** Hidden from the default role selector. Never "secret" — still routable. */
    hidden: boolean;
    domains: string[];
    capabilities: string[];
  };

  modelPolicy: CouncilModelPolicy;
  permissions: CouncilPermissionPolicy;
  limits: CouncilLimits;
  scope: CouncilScope;
  risk: CouncilRisk;
  evidence: CouncilEvidenceContract;
  handoff: CouncilHandoffContract;
  provenance: CouncilProvenance;
  completeness: CouncilCompleteness;
}

// ── Deterministic serialization ───────────────────────────────────────────────

/**
 * Key order for `JSON.stringify`. Two runs over the same inputs must produce
 * byte-identical output on any platform, so ordering is fixed here rather than
 * left to object-literal insertion order.
 */
const CONTRACT_KEY_ORDER: readonly string[] = [
  'schemaVersion',
  'identity',
  'classification',
  'modelPolicy',
  'permissions',
  'limits',
  'scope',
  'risk',
  'evidence',
  'handoff',
  'provenance',
  'completeness',
];

function orderedReplacer(this: unknown, _key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const isContract = CONTRACT_KEY_ORDER.every((k) => keys.includes(k));
  const order = isContract
    ? CONTRACT_KEY_ORDER.filter((k) => keys.includes(k))
    : [...keys].sort();
  const out: Record<string, unknown> = {};
  for (const k of order) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** Stable JSON for hashing, diffing, and `--json` output. */
export function serializeContract(contract: CouncilAgentContract, indent = 2): string {
  return JSON.stringify(contract, orderedReplacer, indent);
}

/** Stable JSON for any contract-adjacent payload (lists, validation results). */
export function serializeStable(value: unknown, indent = 2): string {
  return JSON.stringify(value, orderedReplacer, indent);
}
