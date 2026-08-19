// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — write governance.
 *
 * Nothing reaches the store without passing here. The alternative — an agent
 * says something and it is remembered forever — is how a memory system becomes
 * an unaccountable oracle.
 *
 * Pure: proposals and policy in, a decision out. No fs, no network.
 */

import { matchesSecretPattern } from '../secrets.js';
import {
  MAX_MEMORY_CONTENT_CHARS,
  MEMORY_SCOPE_ORDER,
  type MemoryProposal,
  type MemoryScope,
  type SensitivityClass,
} from './types.js';

export type MemoryWriteDecision = 'accept' | 'ask' | 'reject';

export interface MemoryValidationIssue {
  code: string;
  message: string;
  /** `reject` is fatal; `ask` needs a human; `warn` annotates but permits. */
  severity: 'reject' | 'ask' | 'warn';
}

export interface MemoryValidationResult {
  decision: MemoryWriteDecision;
  issues: MemoryValidationIssue[];
  /** Sensitivity after evaluation — may be raised above what was proposed. */
  effectiveSensitivity: SensitivityClass;
  /** False when the content must never be sent to an embedding provider. */
  embeddable: boolean;
}

export interface MemoryWriteContext {
  /** Secret regex patterns from config (`config.secretPatterns`). */
  secretPatterns: string[];
  /** Repo the write is being made against; guards cross-project writes. */
  repoId?: string;
  /**
   * Scope ceiling from mission authority. A task may never write wider than
   * the mission that dispatched it.
   */
  maxScope?: MemoryScope;
}

function issue(
  code: string,
  message: string,
  severity: MemoryValidationIssue['severity'],
): MemoryValidationIssue {
  return { code, message, severity };
}

function isIsoTimestamp(value: string | undefined): boolean {
  if (!value) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value.slice(0, 10);
}

/** Index in the widest-to-narrowest ordering; -1 when unknown. */
function scopeRank(scope: MemoryScope): number {
  return MEMORY_SCOPE_ORDER.indexOf(scope);
}

/**
 * Does `scope` sit at or inside `ceiling`?
 *
 * Narrower is allowed, wider is not. A session-scoped task writing a `global`
 * memory would let one conversation rewrite project-wide truth.
 */
export function scopeWithin(scope: MemoryScope, ceiling: MemoryScope): boolean {
  const s = scopeRank(scope);
  const c = scopeRank(ceiling);
  if (s === -1 || c === -1) return false;
  return s >= c;
}

/**
 * Scan content for credentials.
 *
 * Runs line by line because the configured patterns are line-oriented, and a
 * whole-blob test would miss an assignment sitting mid-document.
 *
 * Deliberately stricter than the shared scanner: `matchesSecretPattern`
 * compiles patterns case-sensitively, so a default pattern like
 * `secret_access_key\s*[:=]...` never fires on `AWS_SECRET_ACCESS_KEY=...` —
 * which is the spelling AWS actually uses. Missing that in a lint pass produces
 * a stale finding; missing it here writes a live credential into permanent
 * memory and then embeds it. So a case-insensitive second pass runs for
 * memory writes only. The shared scanner is left alone on purpose — widening it
 * would change findings across every repo Thesmos scans, which is not this
 * subsystem's call to make.
 */
export function detectSecret(content: string, patterns: string[]): string | null {
  for (const line of content.split(/\r?\n/)) {
    const hit = matchesSecretPattern(line, patterns);
    if (hit) return hit;

    for (const pattern of patterns) {
      try {
        if (new RegExp(pattern, 'i').test(line)) return pattern;
      } catch {
        // An unparsable configured pattern is the shared scanner's problem to
        // report; here it simply cannot match.
      }
    }
  }
  return null;
}

/**
 * Validate a proposal.
 *
 * Fails closed: anything malformed is rejected rather than stored in a
 * degraded form, because a record missing provenance is indistinguishable
 * later from one that never had any.
 */
export function validateMemoryProposal(
  proposal: MemoryProposal,
  context: MemoryWriteContext,
): MemoryValidationResult {
  const issues: MemoryValidationIssue[] = [];

  const content = typeof proposal.content === 'string' ? proposal.content.trim() : '';
  if (!content) {
    issues.push(issue('memory.empty', 'memory content is empty', 'reject'));
  }
  if (content.length > MAX_MEMORY_CONTENT_CHARS) {
    issues.push(
      issue(
        'memory.too-large',
        `content is ${content.length} chars — the bound is ${MAX_MEMORY_CONTENT_CHARS}; summarize or split it`,
        'reject',
      ),
    );
  }

  if (scopeRank(proposal.scope) === -1) {
    issues.push(issue('memory.scope-unknown', `unknown scope "${proposal.scope}"`, 'reject'));
  } else if (context.maxScope && !scopeWithin(proposal.scope, context.maxScope)) {
    // The containment rule that keeps a child from outranking its parent.
    issues.push(
      issue(
        'memory.scope-escalation',
        `scope "${proposal.scope}" is wider than the authorized ceiling "${context.maxScope}"`,
        'reject',
      ),
    );
  }

  const provenance = proposal.provenance;
  if (!provenance || typeof provenance !== 'object') {
    issues.push(issue('memory.provenance-missing', 'provenance is required', 'reject'));
  } else {
    if (!provenance.creator?.trim()) {
      issues.push(issue('memory.provenance-creator', 'provenance.creator is required', 'reject'));
    }
    if (!provenance.sourceKind) {
      issues.push(issue('memory.provenance-source', 'provenance.sourceKind is required', 'reject'));
    }
    if (!provenance.derivation) {
      issues.push(issue('memory.provenance-derivation', 'provenance.derivation is required', 'reject'));
    }
    // An observation asserts something happened, so it must point at evidence.
    // Without this, "observed" degrades into an unfalsifiable confidence boost.
    if (provenance.derivation === 'observed' && !provenance.evidenceRef && !provenance.sourceId) {
      issues.push(
        issue(
          'memory.observation-unbacked',
          'an observed memory needs evidenceRef or sourceId — otherwise it is a hypothesis',
          'reject',
        ),
      );
    }
    if (provenance.derivation === 'consolidated' && (provenance.derivedFrom ?? []).length === 0) {
      issues.push(
        issue(
          'memory.consolidation-unlinked',
          'a consolidated memory must reference the records it summarizes',
          'reject',
        ),
      );
    }
  }

  // An inference must not be storable as verified fact.
  if (proposal.type === 'hypothesis' && proposal.confidence === 'verified') {
    issues.push(
      issue(
        'memory.hypothesis-verified',
        'a hypothesis cannot be stored with verified confidence',
        'reject',
      ),
    );
  }

  if (proposal.retention?.expiresAt && !isIsoTimestamp(proposal.retention.expiresAt)) {
    issues.push(issue('memory.retention-malformed', 'retention.expiresAt is not an ISO timestamp', 'reject'));
  }

  const supersedes = proposal.supersedes ?? [];
  if (supersedes.some((id) => typeof id !== 'string' || !id.trim())) {
    issues.push(issue('memory.supersedes-malformed', 'supersedes contains an empty id', 'reject'));
  }

  // Cross-project writes must be deliberate, never a side effect of a stale id.
  if (context.repoId && proposal.repoId && proposal.repoId !== context.repoId) {
    issues.push(
      issue(
        'memory.cross-project',
        `memory targets repo "${proposal.repoId}" but the write is against "${context.repoId}"`,
        'reject',
      ),
    );
  }

  // Secret detection raises sensitivity rather than trusting the proposer's label.
  let effectiveSensitivity: SensitivityClass = proposal.sensitivity ?? 'project';
  const secretPattern = detectSecret(content, context.secretPatterns);
  if (secretPattern) {
    effectiveSensitivity = 'secret';
    issues.push(
      issue(
        'memory.secret-detected',
        'content matches a secret pattern — credentials are never stored as semantic memory',
        'reject',
      ),
    );
  }

  const embeddable = effectiveSensitivity !== 'secret' && effectiveSensitivity !== 'sensitive';
  if (!embeddable && !secretPattern) {
    issues.push(
      issue(
        'memory.not-embeddable',
        `sensitivity "${effectiveSensitivity}" is stored but never embedded`,
        'warn',
      ),
    );
  }

  const decision: MemoryWriteDecision = issues.some((i) => i.severity === 'reject')
    ? 'reject'
    : issues.some((i) => i.severity === 'ask')
      ? 'ask'
      : 'accept';

  return { decision, issues, effectiveSensitivity, embeddable };
}
