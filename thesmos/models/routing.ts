// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Model Routing Policy — turns mission evidence into a recorded model decision.
 *
 * ── Why this replaces keyword percentages ───────────────────────────────────
 * The previous router counted keyword hits and sent any plan that was ≥30%
 * "creative" to the creative flagship. That meant the word "brand" appearing
 * three times in a plan could silently select the most expensive model in the
 * catalog, with no approval and no record. Cost was a function of vocabulary.
 *
 * Routing now reads structured signals — risk, blast radius, architectural
 * impact, security and release sensitivity — and every decision carries reason
 * codes explaining itself. A creative, legal, finance, or product task cannot
 * reach the frontier tier on topic alone; it needs the same evidence anything
 * else does, plus explicit human approval.
 *
 * ── The invariant ───────────────────────────────────────────────────────────
 * Fable is never a static default and never an inference. It is a decision a
 * human makes, on the record, with a stated reason Opus 5 is insufficient.
 */

import {
  type LogicalProfile,
  type ModelEntry,
  type Provider,
  PROFILE_ORDER,
  profileRank,
  resolveProfile,
  REGISTRY_VERSION,
  registryHash,
} from './registry.js';

// ── Signals ──────────────────────────────────────────────────────────────────

export type RiskTier = 'low' | 'medium' | 'high' | 'critical';
export type Ambiguity = 'low' | 'medium' | 'high';
export type LatencyPreference = 'fast' | 'balanced' | 'thorough';
export type BillingMode = 'subscription' | 'metered';

/**
 * Evidence about the work. Every field is optional — routing degrades to the
 * balanced default rather than demanding a fully-populated form, because a
 * caller who cannot describe the work has not thereby earned a bigger model.
 */
export interface RoutingSignals {
  /** Declared risk tier of the task. */
  riskTier?: RiskTier;
  /** Expected number of discrete execution steps. */
  expectedSteps?: number;
  /** Distinct workspaces or subsystems the change touches. */
  affectedSubsystems?: number;
  /** Changes module boundaries, data models, or protocols. */
  architecturalImpact?: boolean;
  /** Reasoning about authn/authz, secrets, or attack surface. */
  securitySensitive?: boolean;
  /** Touches the release, publish, or versioning system. */
  releaseSensitive?: boolean;
  /** How much is genuinely unknown or novel. */
  ambiguity?: Ambiguity;
  /** Depth of the dependency graph the work must reason across. */
  dependencyDepth?: number;
  /** Conclusions must be backed by reproducible evidence. */
  evidenceRequired?: boolean;
  latencyPreference?: LatencyPreference;
  /** Providers currently reachable. Empty/undefined means "assume all". */
  providerAvailability?: readonly Provider[];
  billingMode?: BillingMode;
  /**
   * Work is bounded and mechanical, and CANNOT make architectural, security,
   * product, or release decisions. Required for the fast tier.
   */
  boundedMechanical?: boolean;
  /** The agent's catalog baseline profile, if routing on behalf of an agent. */
  baselineProfile?: LogicalProfile;
  /** Explicit caller override. Still subject to the Fable approval gate. */
  userOverride?: LogicalProfile;
  /** Recorded justification + human approval for the frontier tier. */
  frontierApproval?: FrontierApproval;
}

/**
 * The frontier gate. All fields are required because each closes a distinct
 * failure mode: without `reasonOpusInsufficient` you cannot tell an informed
 * escalation from a reflex, and without `approvedBy` no human is accountable.
 */
export interface FrontierApproval {
  /** Who approved, acknowledging the capability and cost tier. */
  approvedBy: string;
  /** Why Opus 5 is not sufficient. Free text, but must be non-empty. */
  reasonOpusInsufficient: string;
  /** ISO timestamp of the approval. */
  approvedAt: string;
  /** Optional pointer to an evaluation showing frontier is justified. */
  evaluationRef?: string;
}

// ── Decision ─────────────────────────────────────────────────────────────────

export type ReasonCode =
  | 'default-balanced'
  | 'agent-baseline'
  | 'user-override'
  | 'bounded-mechanical'
  | 'architectural-impact'
  | 'security-sensitive'
  | 'release-sensitive'
  | 'high-risk-tier'
  | 'cross-subsystem'
  | 'deep-dependency-graph'
  | 'high-ambiguity'
  | 'long-horizon'
  | 'evidence-required'
  | 'latency-preferred-fast'
  | 'frontier-approved'
  | 'frontier-denied-no-approval'
  | 'frontier-denied-not-long-horizon'
  | 'provider-unavailable'
  | 'fallback-applied';

export type ApprovalState = 'not-required' | 'granted' | 'required-but-missing';

export interface AvailabilityResult {
  available: boolean;
  /** Requirements the caller must satisfy, copied from the registry entry. */
  requirements: readonly string[];
  reason: string | null;
}

export interface RouteFallback {
  from: LogicalProfile;
  to: LogicalProfile;
  reason: string;
}

/**
 * The complete, auditable record of one routing decision.
 *
 * `requestedModelId` vs `effectiveModelId` is the pair that makes model truth
 * checkable: the router states what it asked for, the runtime reports what
 * actually answered, and any divergence is visible rather than silent.
 */
export interface ModelRouteDecision {
  requestedProfile: LogicalProfile;
  resolvedProvider: Provider;
  resolvedModelId: string;
  /** What the router asked the runtime for. */
  requestedModelId: string;
  /**
   * What the runtime actually reported (e.g. from a session init event).
   * null until the runtime reports back — never assume it equals requested.
   */
  effectiveModelId: string | null;
  effort: string | null;
  reasonCodes: readonly ReasonCode[];
  approval: ApprovalState;
  availability: AvailabilityResult;
  fallback: RouteFallback | null;
  registryVersion: string;
  registryHash: string;
}

/** True when the runtime answered with a different model than was requested. */
export function hasModelMismatch(d: ModelRouteDecision): boolean {
  return d.effectiveModelId !== null && d.effectiveModelId !== d.requestedModelId;
}

// ── Policy ───────────────────────────────────────────────────────────────────

/**
 * Does the evidence justify deep reasoning (Opus 5)?
 *
 * Any ONE of these is sufficient — they are each independently the kind of work
 * where being wrong costs more than being slow.
 */
function warrantsDeepReasoning(s: RoutingSignals): ReasonCode[] {
  const codes: ReasonCode[] = [];
  if (s.architecturalImpact) codes.push('architectural-impact');
  if (s.securitySensitive) codes.push('security-sensitive');
  if (s.releaseSensitive) codes.push('release-sensitive');
  if (s.riskTier === 'high' || s.riskTier === 'critical') codes.push('high-risk-tier');
  if ((s.affectedSubsystems ?? 0) >= 3) codes.push('cross-subsystem');
  if ((s.dependencyDepth ?? 0) >= 4) codes.push('deep-dependency-graph');
  if (s.ambiguity === 'high') codes.push('high-ambiguity');
  return codes;
}

/**
 * Is this genuinely long-horizon work — the precondition for even CONSIDERING
 * the frontier tier?
 *
 * "Long-horizon" is deliberately mechanical: more than a normal single-session
 * scope, or at least three materially coupled systems. Neither is a topic test,
 * which is the point — a creative or legal task passes this only by actually
 * being large, never by being creative or legal.
 */
export function isLongHorizon(s: RoutingSignals): boolean {
  const exceedsSingleSession = (s.expectedSteps ?? 0) >= 40;
  const materiallyCoupled = (s.affectedSubsystems ?? 0) >= 3;
  return exceedsSingleSession || materiallyCoupled;
}

function availabilityFor(entry: ModelEntry, s: RoutingSignals): AvailabilityResult {
  const requirements = entry.availability.map((a) => a.requirement);
  const declared = s.providerAvailability;
  if (declared && declared.length > 0 && !declared.includes(entry.provider)) {
    return {
      available: false,
      requirements,
      reason: `Provider ${entry.provider} is not currently available.`,
    };
  }
  return { available: true, requirements, reason: null };
}

/**
 * Select the logical profile the evidence supports, before availability and
 * approval gates are applied.
 */
export function selectProfile(s: RoutingSignals): {
  profile: LogicalProfile;
  reasonCodes: ReasonCode[];
  approval: ApprovalState;
} {
  const codes: ReasonCode[] = [];

  // ── Explicit override ─────────────────────────────────────────────────────
  // Honoured for every tier EXCEPT frontier, which still needs the gate below.
  if (s.userOverride && s.userOverride !== 'frontier-long-horizon') {
    return { profile: s.userOverride, reasonCodes: ['user-override'], approval: 'not-required' };
  }

  // ── Frontier ──────────────────────────────────────────────────────────────
  // Reached only by explicit request. Never inferred, never a default.
  if (s.userOverride === 'frontier-long-horizon') {
    if (!isLongHorizon(s)) {
      // Denied on evidence. Fall back to deep reasoning, on the record.
      return {
        profile: 'deep-reasoning',
        reasonCodes: ['user-override', 'frontier-denied-not-long-horizon'],
        approval: 'required-but-missing',
      };
    }
    const approval = s.frontierApproval;
    const approved =
      !!approval &&
      approval.approvedBy.trim().length > 0 &&
      approval.reasonOpusInsufficient.trim().length > 0 &&
      approval.approvedAt.trim().length > 0;
    if (!approved) {
      return {
        profile: 'deep-reasoning',
        reasonCodes: ['user-override', 'frontier-denied-no-approval'],
        approval: 'required-but-missing',
      };
    }
    return {
      profile: 'frontier-long-horizon',
      reasonCodes: ['user-override', 'long-horizon', 'frontier-approved'],
      approval: 'granted',
    };
  }

  // ── Deep reasoning ────────────────────────────────────────────────────────
  const deep = warrantsDeepReasoning(s);
  if (deep.length > 0) {
    if (s.evidenceRequired) deep.push('evidence-required');
    return { profile: 'deep-reasoning', reasonCodes: deep, approval: 'not-required' };
  }

  // ── Fast mechanical ───────────────────────────────────────────────────────
  // Reached only AFTER the deep-reasoning check above, which is what enforces
  // "Haiku may never make an architectural, security, or release decision":
  // any such signal has already escalated and returned, so control cannot
  // arrive here carrying decision authority. Ordering is the guard — a second
  // explicit check here would be unreachable.
  //
  // `boundedMechanical` must still be asserted by the caller. Absent that
  // assertion we do not downgrade even when latency is preferred, because a
  // cheap wrong answer is not a saving.
  if (s.boundedMechanical) {
    const codesFast: ReasonCode[] = ['bounded-mechanical'];
    if (s.latencyPreference === 'fast') codesFast.push('latency-preferred-fast');
    return { profile: 'fast-mechanical', reasonCodes: codesFast, approval: 'not-required' };
  }

  // ── Agent baseline ────────────────────────────────────────────────────────
  // An agent's catalog baseline raises the floor but never reaches frontier.
  if (s.baselineProfile && s.baselineProfile !== 'frontier-long-horizon') {
    if (profileRank(s.baselineProfile) > profileRank('balanced-agentic')) {
      codes.push('agent-baseline');
      return { profile: s.baselineProfile, reasonCodes: codes, approval: 'not-required' };
    }
  }

  // ── Default ───────────────────────────────────────────────────────────────
  return { profile: 'balanced-agentic', reasonCodes: ['default-balanced'], approval: 'not-required' };
}

export interface RouteOptions {
  provider?: Provider;
  /** Effort override; must be one the resolved model actually accepts. */
  effort?: string;
}

/**
 * Route work to a concrete model, producing a complete decision record.
 *
 * Never throws for routing reasons: an unroutable request degrades down the
 * profile ladder and records why, because a council mid-execution needs a
 * usable answer plus an audit trail more than it needs an exception.
 */
export function routeModel(signals: RoutingSignals, options: RouteOptions = {}): ModelRouteDecision {
  const provider = options.provider ?? 'anthropic';
  const selection = selectProfile(signals);
  const reasonCodes: ReasonCode[] = [...selection.reasonCodes];

  let profile = selection.profile;
  let entry = resolveProfile(profile, provider);
  let fallback: RouteFallback | null = null;
  let availability: AvailabilityResult = entry
    ? availabilityFor(entry, signals)
    : { available: false, requirements: [], reason: `No ${provider} entry for profile ${profile}.` };

  // Walk down the fallback chain until something is available. Bounded by the
  // profile count so a malformed registry cycle cannot spin forever.
  let guard = PROFILE_ORDER.length + 1;
  while ((!entry || !availability.available) && guard-- > 0) {
    const from = profile;
    const next: LogicalProfile | null = entry?.fallbackProfile ?? 'balanced-agentic';
    if (!next || next === from) break;
    const reason = availability.reason ?? `Profile ${from} unavailable for ${provider}.`;
    profile = next;
    entry = resolveProfile(profile, provider);
    availability = entry
      ? availabilityFor(entry, signals)
      : { available: false, requirements: [], reason: `No ${provider} entry for profile ${profile}.` };
    fallback = { from, to: profile, reason };
    if (!reasonCodes.includes('provider-unavailable')) reasonCodes.push('provider-unavailable');
    if (!reasonCodes.includes('fallback-applied')) reasonCodes.push('fallback-applied');
  }

  if (!entry) {
    // Registry is malformed. Surface it rather than inventing an id.
    throw new Error(
      `Model registry has no entry for provider="${provider}" after fallback walk from profile="${selection.profile}".`,
    );
  }

  const effort =
    options.effort && entry.effortControls.includes(options.effort)
      ? options.effort
      : entry.defaultEffort;

  return {
    requestedProfile: selection.profile,
    resolvedProvider: entry.provider,
    resolvedModelId: entry.id,
    requestedModelId: entry.id,
    effectiveModelId: null,
    effort,
    reasonCodes,
    approval: selection.approval,
    availability,
    fallback,
    registryVersion: REGISTRY_VERSION,
    registryHash: registryHash(),
  };
}

/**
 * Record what the runtime actually answered with.
 *
 * Separate from `routeModel` on purpose: the effective model is an OBSERVATION,
 * not a prediction, and the type system should not let a caller pretend it knew
 * the answer before the runtime spoke.
 */
export function withEffectiveModel(
  decision: ModelRouteDecision,
  effectiveModelId: string,
): ModelRouteDecision {
  return { ...decision, effectiveModelId };
}

/** Human-readable one-line explanation, for receipts and chat cards. */
export function explainDecision(d: ModelRouteDecision): string {
  const parts = [`${d.requestedProfile} → ${d.resolvedModelId}`];
  if (d.effort) parts.push(`effort=${d.effort}`);
  if (d.fallback) parts.push(`fallback ${d.fallback.from}→${d.fallback.to} (${d.fallback.reason})`);
  if (hasModelMismatch(d)) parts.push(`MISMATCH: runtime reported ${d.effectiveModelId}`);
  if (d.approval === 'required-but-missing') parts.push('approval required but missing');
  parts.push(`[${d.reasonCodes.join(', ')}]`);
  return parts.join(' · ');
}
