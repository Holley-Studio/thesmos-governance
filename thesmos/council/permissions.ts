// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Permission resolution — pure, deterministic, order-independent.
 *
 * The binding rule (Olympus D3):
 *
 *   > **Most restrictive wins, independent of rule order.**
 *
 * Last-match-wins is explicitly rejected. Under last-match-wins, appending a
 * broad `allow **` to the end of a policy silently revokes every deny above it,
 * and a policy's meaning depends on how it was concatenated — which is exactly
 * how an agent quietly acquires write access nobody granted it.
 *
 * Precedence: `deny` > `ask` > `allow`. No match resolves to `ask`, never to
 * `allow`. Anything unparsable fails closed.
 */

import {
  type CouncilPermissionChannel,
  type CouncilPermissionDecision,
  type CouncilPermissionPolicy,
  type CouncilPermissionRule,
  COUNCIL_COMMAND_CHANNELS,
} from './contract.js';
import {
  matchesCommandPattern,
  matchesPattern,
  normalizeCommand,
  normalizeCommandPattern,
  normalizeMatchPath,
  normalizeMatchPattern,
} from './matching.js';

// ── Stable decision codes ─────────────────────────────────────────────────────

export const COUNCIL_PERMISSION_ALLOWED = 'COUNCIL_PERMISSION_ALLOWED';
export const COUNCIL_PERMISSION_DENIED = 'COUNCIL_PERMISSION_DENIED';
export const COUNCIL_PERMISSION_CONFIRMATION_REQUIRED =
  'COUNCIL_PERMISSION_CONFIRMATION_REQUIRED';
export const COUNCIL_PERMISSION_UNKNOWN = 'COUNCIL_PERMISSION_UNKNOWN';
export const COUNCIL_PERMISSION_INVALID_PATTERN = 'COUNCIL_PERMISSION_INVALID_PATTERN';
export const COUNCIL_PERMISSION_INVALID_TARGET = 'COUNCIL_PERMISSION_INVALID_TARGET';
export const COUNCIL_PERMISSION_BROAD_WRITE = 'COUNCIL_PERMISSION_BROAD_WRITE';
export const COUNCIL_PERMISSION_ESCALATION = 'COUNCIL_PERMISSION_ESCALATION';

export type CouncilPermissionCode =
  | typeof COUNCIL_PERMISSION_ALLOWED
  | typeof COUNCIL_PERMISSION_DENIED
  | typeof COUNCIL_PERMISSION_CONFIRMATION_REQUIRED
  | typeof COUNCIL_PERMISSION_UNKNOWN
  | typeof COUNCIL_PERMISSION_INVALID_PATTERN
  | typeof COUNCIL_PERMISSION_INVALID_TARGET
  | typeof COUNCIL_PERMISSION_BROAD_WRITE
  | typeof COUNCIL_PERMISSION_ESCALATION;

export interface CouncilPermissionResolution {
  decision: CouncilPermissionDecision;
  code: CouncilPermissionCode;
  /** Deterministic, redaction-safe explanation. Same inputs → same string. */
  reason: string;
  channel: CouncilPermissionChannel;
  /** Normalized target the decision was made about. */
  target: string;
  /** The pattern that decided it, when one did. */
  matchedPattern?: string;
}

// ── Precedence ────────────────────────────────────────────────────────────────

const DECISION_RANK: Record<CouncilPermissionDecision, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

/** `deny` > `ask` > `allow` — the only combinator used anywhere in this file. */
export function mostRestrictive(
  a: CouncilPermissionDecision,
  b: CouncilPermissionDecision
): CouncilPermissionDecision {
  return DECISION_RANK[a] >= DECISION_RANK[b] ? a : b;
}

export function isMorePermissive(
  candidate: CouncilPermissionDecision,
  reference: CouncilPermissionDecision
): boolean {
  return DECISION_RANK[candidate] < DECISION_RANK[reference];
}

function codeForDecision(decision: CouncilPermissionDecision): CouncilPermissionCode {
  if (decision === 'deny') return COUNCIL_PERMISSION_DENIED;
  if (decision === 'ask') return COUNCIL_PERMISSION_CONFIRMATION_REQUIRED;
  return COUNCIL_PERMISSION_ALLOWED;
}

// ── Resolution ────────────────────────────────────────────────────────────────

interface Match {
  decision: CouncilPermissionDecision;
  pattern: string;
}

function isCommandChannel(channel: CouncilPermissionChannel): boolean {
  return (COUNCIL_COMMAND_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Resolve one (channel, target) pair against a policy.
 *
 * Every rule is evaluated; the winner is the most restrictive match, and ties
 * are broken by lexicographic pattern order so the returned `matchedPattern` is
 * stable no matter how the rules were ordered or merged.
 */
export function resolvePermission(
  policy: CouncilPermissionPolicy,
  channel: CouncilPermissionChannel,
  rawTarget: string
): CouncilPermissionResolution {
  const rules: CouncilPermissionRule[] = policy?.[channel] ?? [];
  const commandChannel = isCommandChannel(channel);

  const normalizedTarget = commandChannel
    ? normalizeCommand(rawTarget)
    : normalizeMatchPath(rawTarget);

  if (!normalizedTarget.ok) {
    return {
      decision: 'deny',
      code: COUNCIL_PERMISSION_INVALID_TARGET,
      reason: `target rejected (${normalizedTarget.reason}) — failing closed`,
      channel,
      target: '',
    };
  }

  const targetText = commandChannel
    ? (normalizedTarget.value as { command: string }).command
    : (normalizedTarget.value as { path: string }).path;

  const matches: Match[] = [];
  const invalidDenyPatterns: string[] = [];

  for (const rule of rules) {
    if (!rule || !Array.isArray(rule.patterns)) continue;
    const decision = rule.decision;
    if (decision !== 'allow' && decision !== 'ask' && decision !== 'deny') continue;
    // Restrictive rules match case-insensitively so a case-only variation of a
    // path cannot walk past them on a case-insensitive filesystem. Permissive
    // rules match exactly — case folding must never widen a grant.
    const caseInsensitive = decision !== 'allow';

    for (const rawPattern of rule.patterns) {
      const pattern = commandChannel
        ? normalizeCommandPattern(rawPattern)
        : normalizeMatchPattern(rawPattern);

      if (!pattern.ok) {
        // An unparsable pattern can never grant anything. In a restriction it
        // must not silently disappear either — an unreadable deny fails closed.
        if (decision !== 'allow') invalidDenyPatterns.push(String(rawPattern));
        continue;
      }

      const hit = commandChannel
        ? matchesCommandPattern(
            normalizedTarget.value as never,
            pattern.value as never,
            caseInsensitive
          )
        : matchesPattern(normalizedTarget.value as never, pattern.value as never, caseInsensitive);

      if (hit) {
        matches.push({
          decision,
          pattern: commandChannel
            ? (pattern.value as { command: string }).command
            : (pattern.value as { path: string }).path,
        });
      }
    }
  }

  if (invalidDenyPatterns.length > 0) {
    const worst = [...invalidDenyPatterns].sort()[0]!;
    return {
      decision: 'deny',
      code: COUNCIL_PERMISSION_INVALID_PATTERN,
      reason: `restriction pattern could not be parsed ("${worst}") — failing closed`,
      channel,
      target: targetText,
      matchedPattern: worst,
    };
  }

  if (matches.length === 0) {
    return {
      decision: 'ask',
      code: COUNCIL_PERMISSION_UNKNOWN,
      reason: `no ${channel} rule matches — unknown state resolves to ask, never allow`,
      channel,
      target: targetText,
    };
  }

  const winningDecision = matches.reduce<CouncilPermissionDecision>(
    (acc, m) => mostRestrictive(acc, m.decision),
    'allow'
  );
  const winningPattern = matches
    .filter((m) => m.decision === winningDecision)
    .map((m) => m.pattern)
    .sort()[0]!;

  return {
    decision: winningDecision,
    code: codeForDecision(winningDecision),
    reason: `${channel} ${winningDecision} by pattern "${winningPattern}" (most restrictive of ${matches.length} match(es))`,
    channel,
    target: targetText,
    matchedPattern: winningPattern,
  };
}

// ── Inheritance ───────────────────────────────────────────────────────────────

/**
 * Resolve against a parent mission policy and a child agent policy together.
 *
 * A child may narrow what it inherits; it can never widen it. Because the
 * combinator is `mostRestrictive`, that property holds structurally — there is
 * no rule shape a child can write that produces a laxer result than the parent.
 */
export function resolveInheritedPermission(
  parent: CouncilPermissionPolicy,
  child: CouncilPermissionPolicy,
  channel: CouncilPermissionChannel,
  target: string
): CouncilPermissionResolution {
  const parentResult = resolvePermission(parent, channel, target);
  const childResult = resolvePermission(child, channel, target);
  const decision = mostRestrictive(parentResult.decision, childResult.decision);
  const source = decision === parentResult.decision ? parentResult : childResult;
  const boundedByParent = decision === parentResult.decision && decision !== childResult.decision;

  return {
    decision,
    code: source.code,
    reason: boundedByParent
      ? `bounded by parent mission: ${parentResult.reason}`
      : source.reason,
    channel,
    target: source.target,
    matchedPattern: source.matchedPattern,
  };
}

/**
 * Build a concrete probe target that a pattern would match, so a pattern can be
 * tested against another *policy* rather than another pattern.
 *
 * Wildcards become sentinel segments. Two probes are produced for `**` (the
 * zero-segment and multi-segment readings) so a child pattern only counts as
 * covered when the parent covers both.
 */
export function probeTargetsForPattern(pattern: string, commandChannel: boolean): string[] {
  if (commandChannel) {
    return [pattern.replace(/\*/g, 'x').trim() || 'x'];
  }
  const wide = pattern
    .replace(/\\/g, '/')
    .split('/')
    .flatMap((seg) => (seg === '**' ? ['probe-a', 'probe-b'] : [seg.replace(/[*?]/g, 'x')]))
    .filter((s) => s !== '' && s !== '.')
    .join('/');
  const narrow = pattern
    .replace(/\\/g, '/')
    .split('/')
    .flatMap((seg) => (seg === '**' ? [] : [seg.replace(/[*?]/g, 'x')]))
    .filter((s) => s !== '' && s !== '.')
    .join('/');
  const probes = [wide, narrow].filter((p) => p !== '');
  return probes.length > 0 ? probes : ['probe-a'];
}

export interface PermissionEscalation {
  code: typeof COUNCIL_PERMISSION_ESCALATION;
  channel: CouncilPermissionChannel;
  pattern: string;
  childDecision: CouncilPermissionDecision;
  parentDecision: CouncilPermissionDecision;
  message: string;
}

/**
 * Report every place a child policy claims more than its parent allows.
 *
 * Deliberately conservative: when a child pattern's coverage cannot be proven
 * to sit inside the parent's, it is reported. A false report costs an author
 * one explicit rule; a missed one costs a silent privilege gain.
 */
export function detectPermissionEscalation(
  parent: CouncilPermissionPolicy,
  child: CouncilPermissionPolicy
): PermissionEscalation[] {
  const out: PermissionEscalation[] = [];
  const channels = Object.keys(child ?? {}) as CouncilPermissionChannel[];

  for (const channel of channels.sort()) {
    const commandChannel = isCommandChannel(channel);
    for (const rule of child[channel] ?? []) {
      if (!rule || rule.decision === 'deny') continue; // narrowing is always fine
      for (const pattern of rule.patterns ?? []) {
        for (const probe of probeTargetsForPattern(String(pattern), commandChannel)) {
          const parentDecision = resolvePermission(parent, channel, probe).decision;
          if (isMorePermissive(rule.decision, parentDecision)) {
            out.push({
              code: COUNCIL_PERMISSION_ESCALATION,
              channel,
              pattern: String(pattern),
              childDecision: rule.decision,
              parentDecision,
              message: `child claims ${channel}:${rule.decision} for "${String(pattern)}" but the parent mission resolves that to ${parentDecision}`,
            });
            break;
          }
        }
      }
    }
  }

  return out.sort((a, b) =>
    a.channel === b.channel ? a.pattern.localeCompare(b.pattern) : a.channel.localeCompare(b.channel)
  );
}

// ── Summaries ─────────────────────────────────────────────────────────────────

/** One compact line per channel, for `agent:show`. Never prints full prompts. */
export function summarizePolicy(policy: CouncilPermissionPolicy): Array<{
  channel: CouncilPermissionChannel;
  allow: number;
  ask: number;
  deny: number;
  /** Effective decision for an unlisted target — always `ask`. */
  fallback: CouncilPermissionDecision;
}> {
  const channels = Object.keys(policy ?? {}).sort() as CouncilPermissionChannel[];
  return channels.map((channel) => {
    const rules = policy[channel] ?? [];
    const count = (d: CouncilPermissionDecision) =>
      rules.filter((r) => r?.decision === d).reduce((n, r) => n + (r.patterns?.length ?? 0), 0);
    return {
      channel,
      allow: count('allow'),
      ask: count('ask'),
      deny: count('deny'),
      fallback: 'ask',
    };
  });
}
