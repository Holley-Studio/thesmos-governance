// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Contract validation — deterministic, coded, and safe to share.
 *
 * Every issue carries a stable code so a consumer can react to the *kind* of
 * problem rather than to a sentence that may be reworded. Output ordering is
 * fixed (path, then code, then message), issues are redacted, and nothing in a
 * result depends on the host, the clock, or enumeration order — a validation
 * report can be pasted into a PR without leaking a machine layout, and two runs
 * always produce the same bytes.
 *
 * `warning` never fails a gate. Only safety-critical problems are errors, so
 * the 68 agents that predate the contract can be governed today and enriched
 * incrementally rather than all at once.
 */

import {
  type CouncilAgentContract,
  type CouncilPermissionChannel,
  COUNCIL_COMMAND_CHANNELS,
  COUNCIL_LIMIT_CEILINGS,
  COUNCIL_PERMISSION_CHANNELS,
  SUPPORTED_CONTRACT_SCHEMA_VERSIONS,
  isCouncilAgentMode,
  isCouncilPrimaryRole,
  isCouncilRiskTier,
  serializeContract,
} from './contract.js';
import { isEvidenceCategory } from './evidence.js';
import {
  dangerousCommandShapes,
  isBroadCommandPattern,
  isBroadPattern,
  normalizeCommandPattern,
  normalizeMatchPattern,
} from './matching.js';
import { COUNCIL_PERMISSION_BROAD_WRITE, COUNCIL_PERMISSION_INVALID_PATTERN } from './permissions.js';
import { isRoleLead } from './roles.js';
import { containsSecretLike, redactSecrets } from './sanitize.js';
import { scopeFromPermissions } from './compiler.js';

// ── Codes ─────────────────────────────────────────────────────────────────────

export const COUNCIL_CODES = {
  schemaVersionUnsupported: 'COUNCIL_SCHEMA_VERSION_UNSUPPORTED',
  idInvalid: 'COUNCIL_ID_INVALID',
  idDuplicate: 'COUNCIL_ID_DUPLICATE',
  versionInvalid: 'COUNCIL_VERSION_INVALID',
  descriptionMissing: 'COUNCIL_DESCRIPTION_MISSING',
  roleInvalid: 'COUNCIL_ROLE_INVALID',
  modeInvalid: 'COUNCIL_MODE_INVALID',
  roleLeadNotSelectable: 'COUNCIL_ROLE_LEAD_NOT_SELECTABLE',
  roleLeadMissing: 'COUNCIL_ROLE_LEAD_MISSING',
  permissionChannelMissing: 'COUNCIL_PERMISSION_CHANNEL_MISSING',
  permissionDecisionInvalid: 'COUNCIL_PERMISSION_DECISION_INVALID',
  permissionInvalidPattern: COUNCIL_PERMISSION_INVALID_PATTERN,
  permissionBroadWrite: COUNCIL_PERMISSION_BROAD_WRITE,
  permissionBroadRead: 'COUNCIL_PERMISSION_BROAD_READ',
  permissionDangerousShell: 'COUNCIL_PERMISSION_DANGEROUS_SHELL',
  permissionBroadDelegation: 'COUNCIL_PERMISSION_BROAD_DELEGATION',
  scopeMismatch: 'COUNCIL_SCOPE_MISMATCH',
  limitInvalid: 'COUNCIL_LIMIT_INVALID',
  limitExceedsCeiling: 'COUNCIL_LIMIT_EXCEEDS_CEILING',
  limitParallelExceedsChildren: 'COUNCIL_LIMIT_PARALLEL_EXCEEDS_CHILDREN',
  delegationWithoutPermission: 'COUNCIL_DELEGATION_WITHOUT_PERMISSION',
  riskTierInvalid: 'COUNCIL_RISK_TIER_INVALID',
  riskApprovalMissing: 'COUNCIL_RISK_APPROVAL_MISSING',
  riskCheckpointMissing: 'COUNCIL_RISK_CHECKPOINT_MISSING',
  evidenceEmpty: 'COUNCIL_EVIDENCE_EMPTY',
  evidenceCategoryUnknown: 'COUNCIL_EVIDENCE_CATEGORY_UNKNOWN',
  handoffSchemaInvalid: 'COUNCIL_HANDOFF_SCHEMA_INVALID',
  handoffFieldsMissing: 'COUNCIL_HANDOFF_FIELDS_MISSING',
  provenancePathInvalid: 'COUNCIL_PROVENANCE_PATH_INVALID',
  provenanceHashInvalid: 'COUNCIL_PROVENANCE_HASH_INVALID',
  ownershipInvalid: 'COUNCIL_OWNERSHIP_INVALID',
  externalAgentManagedClaim: 'COUNCIL_EXTERNAL_AGENT_MANAGED_CLAIM',
  secretSerialized: 'COUNCIL_SECRET_SERIALIZED',
  absolutePathLeak: 'COUNCIL_ABSOLUTE_PATH_LEAK',
  missingSafetyMetadata: 'COUNCIL_MISSING_SAFETY_METADATA',
  metadataDerived: 'COUNCIL_METADATA_DERIVED',
  providerPolicyConflict: 'COUNCIL_PROVIDER_POLICY_CONFLICT',
} as const;

// ── Result types ──────────────────────────────────────────────────────────────

export interface CouncilContractIssue {
  code: string;
  severity: 'error' | 'warning';
  /** Dotted contract path, or `<agent-id>` scope for set-level issues. */
  path: string;
  message: string;
  remediation?: string;
}

export interface CouncilContractValidationResult {
  valid: boolean;
  issues: CouncilContractIssue[];
}

/** Fixed ordering: path, then code, then message. Never insertion order. */
export function sortIssues(issues: CouncilContractIssue[]): CouncilContractIssue[] {
  return [...issues].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message)
  );
}

const SEMVER_RE = /^\d+\.\d+\.\d+/;
const HASH_RE = /^sha256:[a-f0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// ── Contract validation ───────────────────────────────────────────────────────

/**
 * Validate a single contract.
 *
 * Bounded work: every loop is over a field of the contract itself, and pattern
 * checks are linear in pattern length, so validation cost tracks contract size
 * and cannot be blown up by a crafted document.
 */
export function validateContract(contract: CouncilAgentContract): CouncilContractValidationResult {
  const issues: CouncilContractIssue[] = [];
  const add = (
    code: string,
    severity: 'error' | 'warning',
    path: string,
    message: string,
    remediation?: string
  ): void => {
    issues.push({
      code,
      severity,
      path,
      message: redactSecrets(message),
      ...(remediation ? { remediation } : {}),
    });
  };

  if (!contract || typeof contract !== 'object') {
    return {
      valid: false,
      issues: [
        {
          code: COUNCIL_CODES.schemaVersionUnsupported,
          severity: 'error',
          path: 'schemaVersion',
          message: 'contract is not an object',
          remediation: 'recompile the agent with `thesmos agent:validate <id>`',
        },
      ],
    };
  }

  // ── schema ─────────────────────────────────────────────────────────────────
  if (!SUPPORTED_CONTRACT_SCHEMA_VERSIONS.includes(contract.schemaVersion)) {
    add(
      COUNCIL_CODES.schemaVersionUnsupported,
      'error',
      'schemaVersion',
      `unsupported contract schema version "${String(contract.schemaVersion)}" (supported: ${SUPPORTED_CONTRACT_SCHEMA_VERSIONS.join(', ')})`,
      'recompile with this Thesmos version, or upgrade Thesmos'
    );
  }

  // ── identity ───────────────────────────────────────────────────────────────
  const identity = contract.identity ?? ({} as CouncilAgentContract['identity']);
  if (typeof identity.id !== 'string' || !ID_RE.test(identity.id)) {
    add(
      COUNCIL_CODES.idInvalid,
      'error',
      'identity.id',
      `agent id "${String(identity.id)}" is not normalized kebab-case`,
      'rename the agent id to lowercase kebab-case'
    );
  }
  if (typeof identity.version !== 'string' || !SEMVER_RE.test(identity.version)) {
    add(
      COUNCIL_CODES.versionInvalid,
      'warning',
      'identity.version',
      `version "${String(identity.version)}" is not semver`,
      'add `version: x.y.z` to the agent frontmatter'
    );
  }
  if (typeof identity.description !== 'string' || identity.description.trim() === '') {
    add(
      COUNCIL_CODES.descriptionMissing,
      'warning',
      'identity.description',
      'no description could be derived',
      'add a `description:` line to the agent frontmatter'
    );
  }

  // ── classification ─────────────────────────────────────────────────────────
  const classification = contract.classification ?? ({} as CouncilAgentContract['classification']);
  if (!isCouncilPrimaryRole(classification.primaryRole)) {
    add(
      COUNCIL_CODES.roleInvalid,
      'error',
      'classification.primaryRole',
      `"${String(classification.primaryRole)}" is not one of the eight primary roles`,
      'set `council_role:` to build|plan|debug|review|security|design|growth|operations'
    );
  }
  if (!isCouncilAgentMode(classification.mode)) {
    add(
      COUNCIL_CODES.modeInvalid,
      'error',
      'classification.mode',
      `"${String(classification.mode)}" is not primary|subagent|all`,
      'set `council_mode:` to primary, subagent, or all'
    );
  }
  if (isRoleLead(identity.id) && classification.mode === 'subagent') {
    add(
      COUNCIL_CODES.roleLeadNotSelectable,
      'error',
      'classification.mode',
      `"${identity.id}" leads a primary role but is compiled as subagent-only — the role would have no selectable lead`,
      'set `council_mode: primary` (or `all`) for a role lead'
    );
  }

  // ── permissions ────────────────────────────────────────────────────────────
  const permissions = contract.permissions ?? ({} as CouncilAgentContract['permissions']);
  for (const channel of COUNCIL_PERMISSION_CHANNELS) {
    const rules = permissions[channel];
    if (!Array.isArray(rules)) {
      add(
        COUNCIL_CODES.permissionChannelMissing,
        'error',
        `permissions.${channel}`,
        `channel "${channel}" is absent — an unstated channel is an unknown state, and unknown must never resolve to allow`,
        `declare \`council_${channel}_deny\`/\`_ask\`/\`_allow\`, or recompile to pick up the baseline`
      );
      continue;
    }
    validateChannelRules(channel, rules, add);
  }

  // ── scope agreement ────────────────────────────────────────────────────────
  if (Array.isArray(permissions.read) && Array.isArray(permissions.edit)) {
    const derived = scopeFromPermissions(permissions);
    const actual = contract.scope;
    const mismatched = (Object.keys(derived) as Array<keyof typeof derived>).filter(
      (key) => JSON.stringify(derived[key]) !== JSON.stringify(actual?.[key] ?? [])
    );
    if (mismatched.length > 0) {
      add(
        COUNCIL_CODES.scopeMismatch,
        'error',
        'scope',
        `scope disagrees with permissions for: ${mismatched.sort().join(', ')}`,
        'scope is derived from permissions — recompile rather than editing it by hand'
      );
    }
  }

  // ── limits ─────────────────────────────────────────────────────────────────
  const limits = contract.limits ?? ({} as CouncilAgentContract['limits']);
  const checkLimit = (
    key: 'maximumSteps' | 'maximumChildren' | 'maximumParallelChildren',
    min: number
  ): void => {
    const value = limits[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      add(
        COUNCIL_CODES.limitInvalid,
        'error',
        `limits.${key}`,
        `${key} must be an integer >= ${min}, got ${String(value)}`,
        `set \`council_${key === 'maximumSteps' ? 'max_steps' : key === 'maximumChildren' ? 'max_children' : 'max_parallel_children'}\``
      );
      return;
    }
    const ceiling = COUNCIL_LIMIT_CEILINGS[key];
    if (value > ceiling) {
      add(
        COUNCIL_CODES.limitExceedsCeiling,
        'error',
        `limits.${key}`,
        `${key} ${value} exceeds the hard ceiling ${ceiling}`,
        `lower ${key} to at most ${ceiling}`
      );
    }
  };
  checkLimit('maximumSteps', 1);
  checkLimit('maximumChildren', 0);
  checkLimit('maximumParallelChildren', 0);

  if (
    typeof limits.maximumChildren === 'number' &&
    typeof limits.maximumParallelChildren === 'number' &&
    limits.maximumParallelChildren > limits.maximumChildren
  ) {
    add(
      COUNCIL_CODES.limitParallelExceedsChildren,
      'error',
      'limits.maximumParallelChildren',
      `parallel children (${limits.maximumParallelChildren}) exceeds total children (${limits.maximumChildren})`,
      'parallel delegation cannot exceed the total delegation budget'
    );
  }
  if (limits.timeoutMs !== undefined) {
    if (
      typeof limits.timeoutMs !== 'number' ||
      !Number.isInteger(limits.timeoutMs) ||
      limits.timeoutMs < 1
    ) {
      add(COUNCIL_CODES.limitInvalid, 'error', 'limits.timeoutMs', `timeoutMs must be a positive integer, got ${String(limits.timeoutMs)}`);
    } else if (limits.timeoutMs > COUNCIL_LIMIT_CEILINGS.timeoutMs) {
      add(
        COUNCIL_CODES.limitExceedsCeiling,
        'error',
        'limits.timeoutMs',
        `timeoutMs ${limits.timeoutMs} exceeds the hard ceiling ${COUNCIL_LIMIT_CEILINGS.timeoutMs}`
      );
    }
  }

  if (
    typeof limits.maximumChildren === 'number' &&
    limits.maximumChildren > 0 &&
    Array.isArray(permissions.task) &&
    permissions.task.some((r) => r?.decision === 'deny' && (r.patterns ?? []).some(isBroadPattern))
  ) {
    add(
      COUNCIL_CODES.delegationWithoutPermission,
      'warning',
      'limits.maximumChildren',
      `a delegation budget of ${limits.maximumChildren} is declared while the task channel denies everything — the budget is unreachable`,
      'either set maximumChildren to 0 or grant a task rule'
    );
  }

  // ── risk ───────────────────────────────────────────────────────────────────
  const risk = contract.risk ?? ({} as CouncilAgentContract['risk']);
  if (!isCouncilRiskTier(risk.tier)) {
    add(
      COUNCIL_CODES.riskTierInvalid,
      'error',
      'risk.tier',
      `"${String(risk.tier)}" is not low|medium|high|critical`,
      'set `council_risk_tier:`'
    );
  } else if ((risk.tier === 'high' || risk.tier === 'critical') && risk.requiresHumanApproval !== true) {
    add(
      COUNCIL_CODES.riskApprovalMissing,
      'error',
      'risk.requiresHumanApproval',
      `risk tier "${risk.tier}" requires human approval, but requiresHumanApproval is ${String(risk.requiresHumanApproval)}`,
      'set `council_requires_approval: true` or lower the risk tier'
    );
  } else if (risk.tier !== 'low' && risk.requiresCheckpoint !== true) {
    add(
      COUNCIL_CODES.riskCheckpointMissing,
      'warning',
      'risk.requiresCheckpoint',
      `risk tier "${risk.tier}" normally checkpoints, but requiresCheckpoint is ${String(risk.requiresCheckpoint)}`,
      'set `council_requires_checkpoint: true`'
    );
  }

  // ── evidence ───────────────────────────────────────────────────────────────
  const evidence = contract.evidence ?? ({} as CouncilAgentContract['evidence']);
  if (!Array.isArray(evidence.required) || evidence.required.length === 0) {
    add(
      COUNCIL_CODES.evidenceEmpty,
      'error',
      'evidence.required',
      'no required evidence — an agent with nothing to prove can always claim success',
      'declare `council_evidence_required:` or recompile to pick up the role baseline'
    );
  } else {
    for (const category of evidence.required) {
      if (!isEvidenceCategory(category)) {
        add(
          COUNCIL_CODES.evidenceCategoryUnknown,
          'error',
          'evidence.required',
          `unknown evidence category "${String(category)}"`,
          'use a category from COUNCIL_EVIDENCE_CATEGORIES'
        );
      }
    }
  }

  // ── handoff ────────────────────────────────────────────────────────────────
  const handoff = contract.handoff ?? ({} as CouncilAgentContract['handoff']);
  if (typeof handoff.schema !== 'string' || handoff.schema.trim() === '') {
    add(
      COUNCIL_CODES.handoffSchemaInvalid,
      'error',
      'handoff.schema',
      `handoff schema "${String(handoff.schema)}" is not a schema id`,
      'recompile the contract'
    );
  }
  if (!Array.isArray(handoff.requiredFields) || handoff.requiredFields.length === 0) {
    add(
      COUNCIL_CODES.handoffFieldsMissing,
      'error',
      'handoff.requiredFields',
      'handoff declares no required fields',
      'recompile the contract'
    );
  }

  // ── provenance ─────────────────────────────────────────────────────────────
  const provenance = contract.provenance ?? ({} as CouncilAgentContract['provenance']);
  const sourcePath = provenance.sourcePath;
  if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
    add(
      COUNCIL_CODES.provenancePathInvalid,
      'error',
      'provenance.sourcePath',
      'provenance has no source path — an unattributable contract cannot be reviewed',
      'recompile from a discovered agent document'
    );
  } else if (/^([a-zA-Z]:)?[\\/]/.test(sourcePath)) {
    add(
      COUNCIL_CODES.absolutePathLeak,
      'error',
      'provenance.sourcePath',
      'provenance source path is absolute — machine paths must not be serialized',
      'compile with `root` set so the path is stored repo-relative'
    );
  } else if (sourcePath.split('/').includes('..')) {
    add(
      COUNCIL_CODES.provenancePathInvalid,
      'error',
      'provenance.sourcePath',
      'provenance source path escapes the repository root',
      'recompile from a path inside the repository'
    );
  }
  if (typeof provenance.contentHash !== 'string' || !HASH_RE.test(provenance.contentHash)) {
    add(
      COUNCIL_CODES.provenanceHashInvalid,
      'error',
      'provenance.contentHash',
      `content hash "${String(provenance.contentHash)}" is not a sha256 digest`,
      'recompile the contract'
    );
  }
  if (!['managed', 'adopted', 'external'].includes(provenance.ownership)) {
    add(
      COUNCIL_CODES.ownershipInvalid,
      'error',
      'provenance.ownership',
      `"${String(provenance.ownership)}" is not managed|adopted|external`,
      'ownership comes from .thesmos/managed-agents.json — do not set it by hand'
    );
  } else if (provenance.ownership === 'external' && provenance.owner === 'thesmos') {
    add(
      COUNCIL_CODES.externalAgentManagedClaim,
      'error',
      'provenance.owner',
      'an external (user-owned) agent claims Thesmos ownership — filename or marker is never proof of ownership',
      'adopt it explicitly with `thesmos agent:adopt` if it should be managed'
    );
  }

  // ── declared vs derived ────────────────────────────────────────────────────
  const completeness = contract.completeness ?? { complete: true, derivedFields: [] };
  const derivedFields = Array.isArray(completeness.derivedFields) ? completeness.derivedFields : [];
  if (provenance.derivation === 'explicit' && derivedFields.length > 0) {
    add(
      COUNCIL_CODES.missingSafetyMetadata,
      'error',
      'completeness.derivedFields',
      `contract declares council_* metadata but omits safety-critical field(s): ${[...derivedFields].sort().join(', ')}`,
      'declare every safety-critical field, or remove the council_* keys to compile in compatibility mode'
    );
  } else if (derivedFields.length > 0) {
    add(
      COUNCIL_CODES.metadataDerived,
      'warning',
      'completeness.derivedFields',
      `compiled in compatibility mode — ${derivedFields.length} safety-critical field(s) came from the conservative role baseline: ${[...derivedFields].sort().join(', ')}`,
      'declare council_* frontmatter keys to replace the baseline with the author’s intent'
    );
  }

  // ── model policy ───────────────────────────────────────────────────────────
  const modelPolicy = contract.modelPolicy ?? ({} as CouncilAgentContract['modelPolicy']);
  const allowedProviders = modelPolicy.allowedProviders ?? [];
  const deniedProviders = modelPolicy.deniedProviders ?? [];
  const conflicting = allowedProviders.filter((p) => deniedProviders.includes(p)).sort();
  if (conflicting.length > 0) {
    add(
      COUNCIL_CODES.providerPolicyConflict,
      'error',
      'modelPolicy',
      `provider(s) both allowed and denied: ${conflicting.join(', ')}`,
      'a provider cannot be in both lists — deny wins, so remove it from allowedProviders'
    );
  }

  // ── secrets ────────────────────────────────────────────────────────────────
  if (containsSecretLike(serializeContract(contract, 0))) {
    add(
      COUNCIL_CODES.secretSerialized,
      'error',
      'provenance',
      'contract serialization contains a credential-shaped value',
      'remove the credential from the agent document — contracts are shared artifacts'
    );
  }

  const sorted = sortIssues(issues);
  return { valid: !sorted.some((i) => i.severity === 'error'), issues: sorted };
}

function validateChannelRules(
  channel: CouncilPermissionChannel,
  rules: CouncilAgentContract['permissions'][CouncilPermissionChannel],
  add: (
    code: string,
    severity: 'error' | 'warning',
    path: string,
    message: string,
    remediation?: string
  ) => void
): void {
  const commandChannel = (COUNCIL_COMMAND_CHANNELS as readonly string[]).includes(channel);
  const path = `permissions.${channel}`;

  for (const rule of rules) {
    if (!rule || !['allow', 'ask', 'deny'].includes(rule.decision)) {
      add(
        COUNCIL_CODES.permissionDecisionInvalid,
        'error',
        path,
        `rule decision "${String(rule?.decision)}" is not allow|ask|deny`,
        'use allow, ask, or deny'
      );
      continue;
    }
    for (const pattern of rule.patterns ?? []) {
      const normalized = commandChannel
        ? normalizeCommandPattern(String(pattern))
        : normalizeMatchPattern(String(pattern));
      if (!normalized.ok) {
        add(
          COUNCIL_CODES.permissionInvalidPattern,
          'error',
          path,
          `pattern "${String(pattern)}" is not usable (${normalized.reason}) — a restriction that cannot be parsed fails closed at runtime`,
          'rewrite the pattern as a forward-slash glob without traversal segments'
        );
        continue;
      }
      if (rule.decision !== 'allow') continue; // broad restrictions are welcome

      // Broad grants are the whole risk surface — each is judged per channel.
      if (channel === 'edit' && isBroadPattern(String(pattern))) {
        add(
          COUNCIL_CODES.permissionBroadWrite,
          'error',
          path,
          `broad write grant "${String(pattern)}" — an agent that may write anywhere cannot be reviewed`,
          'enumerate the directories this agent may write to'
        );
      }
      if (channel === 'read' && isBroadPattern(String(pattern))) {
        add(
          COUNCIL_CODES.permissionBroadRead,
          'warning',
          path,
          `broad read grant "${String(pattern)}" includes files no reviewer enumerated`,
          'narrow to the file types this agent actually reads'
        );
      }
      if (channel === 'task' && isBroadPattern(String(pattern))) {
        add(
          COUNCIL_CODES.permissionBroadDelegation,
          'error',
          path,
          `broad delegation grant "${String(pattern)}" — an agent that may spawn anything escapes its own limits`,
          'name the agents this one may delegate to'
        );
      }
      if (commandChannel) {
        if (isBroadCommandPattern(String(pattern))) {
          add(
            COUNCIL_CODES.permissionDangerousShell,
            'error',
            path,
            `broad shell grant "${String(pattern)}" allows every command`,
            'enumerate the commands this agent may run'
          );
        }
        const shapes = dangerousCommandShapes(String(pattern));
        if (shapes.length > 0) {
          add(
            COUNCIL_CODES.permissionDangerousShell,
            'error',
            path,
            `shell grant "${String(pattern)}" matches dangerous shape(s): ${shapes.join(', ')}`,
            'move this command to a deny or ask rule'
          );
        }
      }
    }
  }
}

// ── Set validation ────────────────────────────────────────────────────────────

/**
 * Validate a whole catalog. Adds the checks that only exist across contracts:
 * duplicate normalized ids, and primary roles left without a selectable lead.
 */
export function validateContracts(
  contracts: readonly CouncilAgentContract[]
): CouncilContractValidationResult {
  const issues: CouncilContractIssue[] = [];

  for (const contract of contracts) {
    const scoped = validateContract(contract).issues.map((issue) => ({
      ...issue,
      path: `${contract?.identity?.id ?? '<unknown>'}:${issue.path}`,
    }));
    issues.push(...scoped);
  }

  const byId = new Map<string, string[]>();
  for (const contract of contracts) {
    const id = contract?.identity?.id;
    if (typeof id !== 'string' || id === '') continue;
    const paths = byId.get(id) ?? [];
    paths.push(contract.provenance?.sourcePath ?? '<unknown>');
    byId.set(id, paths);
  }
  for (const [id, paths] of [...byId.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const unique = [...new Set(paths)].sort();
    if (unique.length > 1) {
      issues.push({
        code: COUNCIL_CODES.idDuplicate,
        severity: 'error',
        path: `${id}:identity.id`,
        message: `normalized id "${id}" is claimed by ${unique.length} documents: ${unique.join(', ')}`,
        remediation: 'rename one of the agents — a duplicate id lets one document silently replace another',
      });
    }
  }

  const sorted = sortIssues(issues);
  return { valid: !sorted.some((i) => i.severity === 'error'), issues: sorted };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

/** Console rendering. Deterministic and already redacted. */
export function formatValidationResult(
  result: CouncilContractValidationResult,
  label: string
): string {
  if (result.issues.length === 0) return `  ${label}: valid — no issues.`;
  const lines = [`  ${label}: ${result.valid ? 'valid' : 'INVALID'}`, ''];
  for (const issue of result.issues) {
    const marker = issue.severity === 'error' ? 'ERROR  ' : 'warning';
    lines.push(`  ${marker} ${issue.code}`);
    lines.push(`          ${issue.path}: ${issue.message}`);
    if (issue.remediation) lines.push(`          fix: ${issue.remediation}`);
    lines.push('');
  }
  const errors = result.issues.filter((i) => i.severity === 'error').length;
  const warnings = result.issues.length - errors;
  lines.push(`  ${errors} error(s), ${warnings} warning(s).`);
  return lines.join('\n');
}
