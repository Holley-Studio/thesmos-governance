// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Evidence contracts — what an agent must produce for its work to count as done.
 *
 * "The agent said it was finished" is not evidence. Each role declares the
 * proof it owes, and a handoff that omits a required category is `partial`, not
 * `complete` (see `handoff.ts`).
 *
 * The baselines are deliberately *different* per role. A single shared list
 * would be easy to write and worth nothing: a security finding without a
 * reproduction and a design change without a before/after are not the same kind
 * of unproven.
 */

import type { CouncilPrimaryRole } from './contract.js';

// ── Categories ────────────────────────────────────────────────────────────────

export const COUNCIL_EVIDENCE_CATEGORIES = [
  'accessibility-evidence',
  'affected-surfaces',
  'after-state',
  'assumptions',
  'attack-paths',
  'before-state',
  'commands-run',
  'confidence',
  'files-changed',
  'files-reviewed',
  'findings',
  'measurement-plan',
  'mitigation',
  'recommendations',
  'recommended-next-actions',
  'reproduction',
  'residual-risk',
  'responsive-verification',
  'screenshots',
  'severity',
  'source-data',
  'test-results',
  'tests-run',
  'trust-boundaries',
  'unresolved-risks',
] as const;

export type CouncilEvidenceCategory = (typeof COUNCIL_EVIDENCE_CATEGORIES)[number];

export function isEvidenceCategory(value: unknown): value is CouncilEvidenceCategory {
  return (
    typeof value === 'string' &&
    (COUNCIL_EVIDENCE_CATEGORIES as readonly string[]).includes(value)
  );
}

// ── Role baselines ────────────────────────────────────────────────────────────

interface EvidenceBaseline {
  required: CouncilEvidenceCategory[];
  optional: CouncilEvidenceCategory[];
}

const ROLE_EVIDENCE: Readonly<Record<CouncilPrimaryRole, EvidenceBaseline>> = {
  build: {
    required: ['files-changed', 'commands-run', 'tests-run', 'test-results', 'unresolved-risks'],
    optional: ['files-reviewed', 'assumptions', 'recommended-next-actions'],
  },
  plan: {
    required: ['files-reviewed', 'assumptions', 'confidence', 'recommended-next-actions', 'unresolved-risks'],
    optional: ['source-data', 'findings'],
  },
  debug: {
    required: ['reproduction', 'findings', 'commands-run', 'test-results', 'unresolved-risks'],
    optional: ['files-reviewed', 'files-changed', 'confidence'],
  },
  review: {
    required: ['files-reviewed', 'findings', 'severity', 'unresolved-risks'],
    optional: ['commands-run', 'recommended-next-actions', 'confidence'],
  },
  security: {
    required: ['trust-boundaries', 'attack-paths', 'findings', 'reproduction', 'mitigation', 'residual-risk'],
    optional: ['files-reviewed', 'severity', 'commands-run'],
  },
  design: {
    required: ['affected-surfaces', 'before-state', 'after-state', 'responsive-verification', 'accessibility-evidence'],
    optional: ['screenshots', 'files-changed', 'unresolved-risks'],
  },
  growth: {
    required: ['source-data', 'assumptions', 'recommendations', 'confidence', 'measurement-plan'],
    optional: ['findings', 'unresolved-risks'],
  },
  operations: {
    required: ['source-data', 'assumptions', 'recommendations', 'unresolved-risks', 'recommended-next-actions'],
    optional: ['files-reviewed', 'confidence'],
  },
};

/** Role-aware baseline. Arrays are copies — callers may sort or extend freely. */
export function evidenceBaselineForRole(role: CouncilPrimaryRole): {
  required: string[];
  optional: string[];
} {
  const baseline = ROLE_EVIDENCE[role];
  return {
    required: [...baseline.required].sort(),
    optional: [...baseline.optional].sort(),
  };
}

/**
 * Proof that the baselines are not a copy-paste of one list. Guards the "do not
 * make these so generic that every role receives the same meaningless list"
 * requirement mechanically rather than by review discipline.
 */
export function evidenceBaselinesAreDistinct(): boolean {
  const seen = new Set<string>();
  for (const role of Object.keys(ROLE_EVIDENCE) as CouncilPrimaryRole[]) {
    const key = evidenceBaselineForRole(role).required.join('|');
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

// ── Evidence → handoff fields ─────────────────────────────────────────────────

/**
 * Which structured handoff field carries each evidence category. Categories
 * without a dedicated field are carried as `evidenceRefs` entries prefixed with
 * the category name.
 */
const EVIDENCE_FIELD_MAP: Readonly<Partial<Record<CouncilEvidenceCategory, string>>> = {
  'files-changed': 'changedFiles',
  'files-reviewed': 'evidenceRefs',
  'commands-run': 'commandsRun',
  'tests-run': 'testResults',
  'test-results': 'testResults',
  'unresolved-risks': 'unresolvedRisks',
  'recommended-next-actions': 'recommendedNextTasks',
};

/** Handoff fields that are mandatory regardless of role. */
export const HANDOFF_BASE_REQUIRED_FIELDS: readonly string[] = [
  'agentId',
  'missionId',
  'status',
  'summary',
  'taskId',
];

/** Required handoff fields for a role — base fields plus evidence-derived ones. */
export function handoffRequiredFieldsForRole(role: CouncilPrimaryRole): string[] {
  const fields = new Set<string>(HANDOFF_BASE_REQUIRED_FIELDS);
  for (const category of ROLE_EVIDENCE[role].required) {
    const mapped = EVIDENCE_FIELD_MAP[category];
    fields.add(mapped ?? 'evidenceRefs');
  }
  return [...fields].sort();
}
