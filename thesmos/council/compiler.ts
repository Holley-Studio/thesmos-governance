// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Contract compiler — existing agent Markdown in, governed contract out.
 *
 * Design constraints this file exists to satisfy (Olympus D2/D4/D6/D8):
 *
 *   - **No mass rewrite.** Sixty-eight agent documents stay human-readable and
 *     untouched. The contract is derived, not authored.
 *   - **No second source of truth.** Frontmatter, the ownership manifest, and
 *     the registry remain authoritative; a contract is a projection of them.
 *   - **Deterministic.** Same bytes in, byte-identical contract out, on any
 *     platform, in any order. No clock, no randomness, no host paths.
 *   - **No invented safety.** A field the document did not declare is filled
 *     from the conservative role baseline *and named* in
 *     `completeness.derivedFields`, so nobody can mistake a restriction Thesmos
 *     chose for a permission the author granted.
 *
 * Declaring contract metadata is opt-in, via flat `council_*` frontmatter keys.
 * Flat keys are deliberate: the catalog's frontmatter parser is a line-based
 * YAML subset that flattens nesting, so a nested block would parse into
 * something subtly different from what the author wrote. An author who opts in
 * must then declare *all* safety-critical fields — a half-declared contract is
 * a validation error, not a merge with the baseline.
 */

import { parseFrontmatter } from '../catalog.js';
import { deriveAgentId } from '../agent-lifecycle.js';
import { contentHash } from '../agent-ownership.js';
import {
  type CouncilAgentContract,
  type CouncilAgentMode,
  type CouncilDerivation,
  type CouncilOwnership,
  type CouncilPermissionChannel,
  type CouncilPermissionPolicy,
  type CouncilPermissionRule,
  type CouncilPrimaryRole,
  type CouncilRisk,
  type CouncilScope,
  COUNCIL_CONTRACT_SCHEMA_VERSION,
  COUNCIL_PERMISSION_CHANNELS,
  isCouncilAgentMode,
  isCouncilPrimaryRole,
  isCouncilRiskTier,
} from './contract.js';
import { baselineLimits, baselinePermissions, baselineRisk } from './baselines.js';
import { evidenceBaselineForRole, handoffRequiredFieldsForRole, isEvidenceCategory } from './evidence.js';
import { classifyPrimaryRole, isRoleLead, roleDefinition } from './roles.js';
import {
  SANITIZE_LIMITS,
  normalizeStringList,
  sanitizeText,
  sanitizeToken,
  toProvenancePath,
} from './sanitize.js';

export const AGENT_HANDOFF_SCHEMA_ID = 'thesmos.agent-handoff';

// ── Declared-metadata keys ────────────────────────────────────────────────────

/** Presence of any of these switches the document into explicit mode. */
const COUNCIL_KEY_PREFIX = 'council_';

/**
 * Fields an explicit contract must declare. Descriptive metadata may be
 * defaulted; these may not — an author who opts in owns them.
 */
export const COUNCIL_SAFETY_CRITICAL_KEYS: readonly string[] = [
  'council_edit',
  'council_evidence_required',
  'council_max_children',
  'council_max_parallel_children',
  'council_max_steps',
  'council_risk_tier',
];

const CHANNEL_KEYS: Readonly<Record<CouncilPermissionChannel, string>> = {
  read: 'council_read',
  edit: 'council_edit',
  shell: 'council_shell',
  web: 'council_web',
  browser: 'council_browser',
  mcp: 'council_mcp',
  task: 'council_task',
};

// ── Inputs / outputs ──────────────────────────────────────────────────────────

export interface CouncilCompileSource {
  /** Raw agent document, frontmatter included. */
  content: string;
  /** Path as discovered. Relativized against `root` for provenance. */
  sourcePath: string;
  ownership: CouncilOwnership;
  /** Repo root, so provenance never carries an absolute machine path. */
  root?: string;
  /** Overrides the frontmatter `owner`, when discovery knows better. */
  owner?: string;
  /** Overrides the derived id, when discovery already normalized one. */
  agentId?: string;
}

export interface CouncilCompileNote {
  code: string;
  /** Dotted contract path the note is about. */
  field: string;
  message: string;
}

export interface CouncilCompileResult {
  contract: CouncilAgentContract;
  notes: CouncilCompileNote[];
}

export const COUNCIL_NOTE_DERIVED = 'COUNCIL_METADATA_DERIVED';
export const COUNCIL_NOTE_MISSING_SAFETY = 'COUNCIL_MISSING_SAFETY_METADATA';
export const COUNCIL_NOTE_ROLE_FALLBACK = 'COUNCIL_ROLE_FALLBACK';
export const COUNCIL_NOTE_INVALID_DECLARED = 'COUNCIL_INVALID_DECLARED_VALUE';

// ── Frontmatter helpers ───────────────────────────────────────────────────────

type Frontmatter = Record<string, unknown>;

function fmString(fm: Frontmatter, key: string): string | undefined {
  const value = fm[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function fmList(fm: Frontmatter, key: string): string[] | undefined {
  const value = fm[key];
  if (Array.isArray(value)) return normalizeStringList(value);
  const single = fmString(fm, key);
  return single === undefined ? undefined : normalizeStringList([single]);
}

function fmNumber(fm: Frontmatter, key: string): number | undefined {
  const raw = fm[key];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fmBool(fm: Frontmatter, key: string): boolean | undefined {
  const raw = fm[key];
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

/** True when the author opted into declaring contract metadata. */
export function hasDeclaredCouncilMetadata(fm: Frontmatter): boolean {
  return Object.keys(fm).some((k) => k.startsWith(COUNCIL_KEY_PREFIX));
}

// ── Description derivation ────────────────────────────────────────────────────

/**
 * First readable sentence of the document, used only when no descriptive field
 * exists. Headings, markers, fences, and list bullets are skipped so the
 * description is prose rather than document scaffolding.
 */
function firstBodyParagraph(body: string): string {
  const lines = body.split('\n');
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || line === '') continue;
    if (line.startsWith('#') || line.startsWith('<!--') || line.startsWith('---')) continue;
    if (line.startsWith('-') || line.startsWith('*') || line.startsWith('|')) continue;
    return line;
  }
  return '';
}

// ── Permission assembly ───────────────────────────────────────────────────────

function declaredRulesForChannel(
  fm: Frontmatter,
  channel: CouncilPermissionChannel
): CouncilPermissionRule[] | undefined {
  const base = CHANNEL_KEYS[channel];
  const rules: CouncilPermissionRule[] = [];
  for (const decision of ['deny', 'ask', 'allow'] as const) {
    const patterns = fmList(fm, `${base}_${decision}`);
    if (patterns && patterns.length > 0) {
      rules.push({ decision, patterns, reason: `declared ${base}_${decision}` });
    }
  }
  return rules.length > 0 ? rules : undefined;
}

/** Human-facing scope view, derived from the policy so the two cannot disagree. */
export function scopeFromPermissions(policy: CouncilPermissionPolicy): CouncilScope {
  const patternsFor = (channel: CouncilPermissionChannel, decision: string): string[] =>
    (policy[channel] ?? [])
      .filter((r) => r.decision === decision)
      .flatMap((r) => r.patterns ?? []);

  const sortedUnique = (values: string[]): string[] => [...new Set(values)].sort();

  return {
    readablePaths: sortedUnique(patternsFor('read', 'allow')),
    writablePaths: sortedUnique(patternsFor('edit', 'allow')),
    forbiddenPaths: sortedUnique([...patternsFor('read', 'deny'), ...patternsFor('edit', 'deny')]),
    allowedCommands: sortedUnique(patternsFor('shell', 'allow')),
    confirmCommands: sortedUnique(patternsFor('shell', 'ask')),
    deniedCommands: sortedUnique(patternsFor('shell', 'deny')),
  };
}

// ── Compilation ───────────────────────────────────────────────────────────────

/**
 * Compile one agent document into a contract.
 *
 * Never throws on bad input: a malformed document produces a contract that
 * fails validation with a specific code, because one broken agent must not take
 * the whole catalog down with it.
 */
export function compileAgentContract(source: CouncilCompileSource): CouncilCompileResult {
  const notes: CouncilCompileNote[] = [];
  const content = typeof source.content === 'string' ? source.content : '';
  const { frontmatter, body } = parseFrontmatter(content);
  const fm = frontmatter as Frontmatter;

  const explicit = hasDeclaredCouncilMetadata(fm);
  const derivedFields: string[] = [];

  const note = (code: string, field: string, message: string): void => {
    notes.push({ code, field, message });
  };
  /** Record a field the baseline supplied rather than the document. */
  const derive = (field: string, why: string): void => {
    derivedFields.push(field);
    note(
      explicit ? COUNCIL_NOTE_MISSING_SAFETY : COUNCIL_NOTE_DERIVED,
      field,
      explicit
        ? `explicit contract does not declare ${field} — safety-critical fields cannot fall back to the baseline`
        : why
    );
  };

  // ── identity ────────────────────────────────────────────────────────────────
  const id = sanitizeToken(source.agentId ?? deriveAgentId(content, source.sourcePath), 120);
  const displayName =
    sanitizeText(fmString(fm, 'name'), SANITIZE_LIMITS.displayName) || id;
  const mythicIdentity = sanitizeText(fmString(fm, 'god'), SANITIZE_LIMITS.short) || undefined;
  const description =
    sanitizeText(fmString(fm, 'description')) ||
    sanitizeText(fmString(fm, 'vibe')) ||
    sanitizeText(fmString(fm, 'mythology')) ||
    sanitizeText(fmString(fm, 'role')) ||
    sanitizeText(firstBodyParagraph(body)) ||
    `${displayName} (no description declared)`;
  const declaredVersion = fmString(fm, 'version');
  if (declaredVersion === undefined) {
    // Descriptive, not safety-critical: `0.0.0` is a legible "undeclared", so it
    // is noted but does not make the contract incomplete.
    note(
      COUNCIL_NOTE_DERIVED,
      'identity.version',
      'no version declared — recorded as 0.0.0 so an unversioned agent is visibly unversioned'
    );
  }
  const version = declaredVersion ?? '0.0.0';

  // ── classification ──────────────────────────────────────────────────────────
  const tags = fmList(fm, 'tags') ?? [];
  const declaredRole = fmString(fm, 'council_role');
  let primaryRole: CouncilPrimaryRole;
  if (declaredRole !== undefined && isCouncilPrimaryRole(sanitizeToken(declaredRole))) {
    primaryRole = sanitizeToken(declaredRole) as CouncilPrimaryRole;
  } else {
    if (declaredRole !== undefined) {
      note(
        COUNCIL_NOTE_INVALID_DECLARED,
        'classification.primaryRole',
        `declared council_role "${sanitizeToken(declaredRole)}" is not one of the eight primary roles — classifying from tags instead`
      );
    }
    // Exported agent documents (the Claude Code format Thesmos writes into
    // `.claude/agents/`) carry no `tags:` — their domain words live in the
    // `description` line instead. Reading both is what keeps an exported copy
    // classified the same way as the catalog document it came from.
    const classified = classifyPrimaryRole({
      agentId: id,
      tags,
      roleText: [fmString(fm, 'role'), fmString(fm, 'description')]
        .filter((v): v is string => typeof v === 'string')
        .join(' ')
        .slice(0, 400),
    });
    primaryRole = classified.role;
    if (classified.fallback) {
      note(
        COUNCIL_NOTE_ROLE_FALLBACK,
        'classification.primaryRole',
        `no tag matched a primary role — filed under "${primaryRole}", the most constrained baseline`
      );
    }
  }

  const delegatesTo = fmList(fm, 'delegates_to') ?? [];
  const reportsTo = fmString(fm, 'reports_to');
  const orchestrator = delegatesTo.length > 0 && (reportsTo === undefined || reportsTo === 'null');

  const declaredMode = fmString(fm, 'council_mode');
  let mode: CouncilAgentMode;
  if (declaredMode !== undefined && isCouncilAgentMode(sanitizeToken(declaredMode))) {
    mode = sanitizeToken(declaredMode) as CouncilAgentMode;
  } else {
    if (declaredMode !== undefined) {
      note(
        COUNCIL_NOTE_INVALID_DECLARED,
        'classification.mode',
        `declared council_mode "${sanitizeToken(declaredMode)}" is not primary|subagent|all — deriving instead`
      );
    }
    mode = orchestrator ? 'all' : isRoleLead(id) ? 'primary' : 'subagent';
  }

  // A specialist is hidden from the default selector, never from the CLI, the
  // router, or execution evidence.
  const hidden = fmBool(fm, 'council_hidden') ?? !(isRoleLead(id) || mode === 'all');

  // ── model policy (descriptive — safe to default) ────────────────────────────
  const declaredProfiles = fmList(fm, 'council_model_profiles');
  const platformProfiles = normalizeStringList(
    [
      fmString(fm, 'model'),
      fmString(fm, 'claude_model'),
      fmString(fm, 'openai_model'),
      fmString(fm, 'chatgpt_model'),
    ].filter((v): v is string => typeof v === 'string')
  );
  const preferredProfiles = declaredProfiles ?? platformProfiles;
  const allowedProviders = fmList(fm, 'council_allowed_providers');
  const deniedProviders = fmList(fm, 'council_denied_providers');

  // ── permissions ─────────────────────────────────────────────────────────────
  const baselinePolicy = baselinePermissions(primaryRole, mode);
  const permissions: CouncilPermissionPolicy = {} as CouncilPermissionPolicy;
  for (const channel of COUNCIL_PERMISSION_CHANNELS) {
    const declared = declaredRulesForChannel(fm, channel);
    if (declared) {
      permissions[channel] = declared;
    } else {
      permissions[channel] = baselinePolicy[channel];
      if (channel === 'edit') {
        derive(
          'permissions.edit',
          'no edit rules declared — baseline denies secrets and build output and asks before any other write'
        );
      }
    }
  }

  // ── limits ──────────────────────────────────────────────────────────────────
  const limitBaseline = baselineLimits(mode);
  const maximumSteps = fmNumber(fm, 'council_max_steps');
  const maximumChildren = fmNumber(fm, 'council_max_children');
  const maximumParallelChildren = fmNumber(fm, 'council_max_parallel_children');
  const timeoutMs = fmNumber(fm, 'council_timeout_ms');
  if (maximumSteps === undefined) {
    derive('limits.maximumSteps', `no step limit declared — baseline ${limitBaseline.maximumSteps}`);
  }
  if (maximumChildren === undefined) {
    derive(
      'limits.maximumChildren',
      `no delegation limit declared — baseline ${limitBaseline.maximumChildren}`
    );
  }
  if (maximumParallelChildren === undefined) {
    derive(
      'limits.maximumParallelChildren',
      `no parallel-delegation limit declared — baseline ${limitBaseline.maximumParallelChildren}`
    );
  }
  const limits = {
    maximumSteps: maximumSteps ?? limitBaseline.maximumSteps,
    maximumChildren: maximumChildren ?? limitBaseline.maximumChildren,
    maximumParallelChildren: maximumParallelChildren ?? limitBaseline.maximumParallelChildren,
    timeoutMs: timeoutMs ?? limitBaseline.timeoutMs,
  };

  // ── risk ────────────────────────────────────────────────────────────────────
  const riskBaseline = baselineRisk(primaryRole, mode);
  const declaredTier = fmString(fm, 'council_risk_tier');
  let risk: CouncilRisk;
  if (declaredTier !== undefined && isCouncilRiskTier(sanitizeToken(declaredTier))) {
    const tier = sanitizeToken(declaredTier) as CouncilRisk['tier'];
    risk = {
      tier,
      requiresHumanApproval:
        fmBool(fm, 'council_requires_approval') ?? (tier === 'high' || tier === 'critical'),
      requiresCheckpoint: fmBool(fm, 'council_requires_checkpoint') ?? tier !== 'low',
      requiresFinalReview: fmBool(fm, 'council_requires_final_review') ?? riskBaseline.requiresFinalReview,
    };
  } else {
    if (declaredTier !== undefined) {
      note(
        COUNCIL_NOTE_INVALID_DECLARED,
        'risk.tier',
        `declared council_risk_tier "${sanitizeToken(declaredTier)}" is not low|medium|high|critical`
      );
    }
    derive('risk.tier', `no risk tier declared — baseline "${riskBaseline.tier}" for role ${primaryRole}`);
    risk = riskBaseline;
  }

  // ── evidence ────────────────────────────────────────────────────────────────
  const evidenceBaseline = evidenceBaselineForRole(primaryRole);
  const declaredRequired = fmList(fm, 'council_evidence_required');
  const declaredOptional = fmList(fm, 'council_evidence_optional');
  if (declaredRequired === undefined) {
    derive(
      'evidence.required',
      `no evidence contract declared — baseline for role ${primaryRole}`
    );
  }
  const evidence = {
    required: (declaredRequired ?? evidenceBaseline.required).filter(isEvidenceCategory).sort(),
    optional: (declaredOptional ?? evidenceBaseline.optional).filter(isEvidenceCategory).sort(),
  };
  if (declaredRequired !== undefined && evidence.required.length !== declaredRequired.length) {
    note(
      COUNCIL_NOTE_INVALID_DECLARED,
      'evidence.required',
      'one or more declared evidence categories are not recognized and were dropped'
    );
  }

  // ── handoff ─────────────────────────────────────────────────────────────────
  const handoff = {
    schema: AGENT_HANDOFF_SCHEMA_ID,
    requiredFields: handoffRequiredFieldsForRole(primaryRole),
  };

  // ── provenance ──────────────────────────────────────────────────────────────
  const normalizedContent = content.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd();
  // Derivation records the author's *intent*, not the outcome. An author who
  // declared `council_*` keys owns every safety-critical field, so a partial
  // declaration stays `explicit` and fails validation. Relabelling it
  // `compatibility` would quietly forgive the gap and make
  // COUNCIL_MISSING_SAFETY_METADATA unreachable.
  const derivation: CouncilDerivation = explicit ? 'explicit' : 'compatibility';
  const provenance = {
    sourcePath: toProvenancePath(source.sourcePath, source.root),
    owner: sanitizeToken(source.owner ?? fmString(fm, 'owner') ?? 'unknown', 120) || 'unknown',
    ownership: source.ownership,
    contentHash: contentHash(normalizedContent),
    derivation,
  };

  const contract: CouncilAgentContract = {
    schemaVersion: COUNCIL_CONTRACT_SCHEMA_VERSION,
    identity: {
      id,
      version,
      displayName,
      ...(mythicIdentity ? { mythicIdentity } : {}),
      description,
    },
    classification: {
      primaryRole,
      mode,
      hidden,
      domains: tags,
      capabilities: fmList(fm, 'skills') ?? [],
    },
    modelPolicy: {
      preferredProfiles,
      ...(allowedProviders ? { allowedProviders } : {}),
      ...(deniedProviders ? { deniedProviders } : {}),
    },
    permissions,
    limits,
    scope: scopeFromPermissions(permissions),
    risk,
    evidence,
    handoff,
    provenance,
    completeness: {
      complete: derivedFields.length === 0,
      derivedFields: [...new Set(derivedFields)].sort(),
    },
  };

  return { contract, notes: notes.sort(sortNotes) };
}

function sortNotes(a: CouncilCompileNote, b: CouncilCompileNote): number {
  if (a.field !== b.field) return a.field.localeCompare(b.field);
  if (a.code !== b.code) return a.code.localeCompare(b.code);
  return a.message.localeCompare(b.message);
}

/**
 * Compile a set of documents. Output order is by agent id, not by input order,
 * so two runs over the same catalog produce identical bytes regardless of how
 * the filesystem enumerated it.
 */
export function compileAgentContracts(
  sources: readonly CouncilCompileSource[]
): CouncilCompileResult[] {
  return sources
    .map((source) => compileAgentContract(source))
    .sort((a, b) => a.contract.identity.id.localeCompare(b.contract.identity.id));
}

/** The role lead's contract for each primary role, if present in the set. */
export function primaryRoleContracts(
  contracts: readonly CouncilAgentContract[]
): CouncilAgentContract[] {
  return contracts
    .filter((c) => isRoleLead(c.identity.id))
    .sort(
      (a, b) =>
        roleDefinition(a.classification.primaryRole).title.localeCompare(
          roleDefinition(b.classification.primaryRole).title
        ) || a.identity.id.localeCompare(b.identity.id)
    );
}
