// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Shared assurance model — honest PASS / FAIL / INCOMPLETE / ERROR states.
 *
 * Empty evidence, missing scans, and zero evaluated rules must never report
 * as 100% / PASS. Callers use this for compliance CLI, MCP, eval, and score.
 */

export type AssuranceState = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'ERROR';

export interface AssuranceResult {
  state: AssuranceState;
  /** 0–100 when PASS or FAIL; null when INCOMPLETE or ERROR. */
  score: number | null;
  rulesEvaluated: number;
  rulesPassed: number;
  rulesFailed: number;
  reason: string;
  evidenceSource: string | null;
}

export interface AssuranceFromCountsOpts {
  /** When true, ignore counts and return INCOMPLETE (missing/unusable scan). */
  evidenceMissing?: boolean;
  evidenceSource?: string | null;
  reason?: string;
}

/**
 * Derive an AssuranceResult from passed/total rule counts.
 * Zero rules or missing evidence → INCOMPLETE with score null (never 100).
 */
export function assuranceFromRuleCounts(
  passed: number,
  total: number,
  opts: AssuranceFromCountsOpts = {},
): AssuranceResult {
  if (opts.evidenceMissing) {
    return {
      state: 'INCOMPLETE',
      score: null,
      rulesEvaluated: 0,
      rulesPassed: 0,
      rulesFailed: 0,
      reason: opts.reason ?? 'No scan evidence available — run `thesmos scan` first',
      evidenceSource: null,
    };
  }

  if (!Number.isFinite(passed) || !Number.isFinite(total) || passed < 0 || total < 0) {
    return {
      state: 'ERROR',
      score: null,
      rulesEvaluated: 0,
      rulesPassed: 0,
      rulesFailed: 0,
      reason: opts.reason ?? 'Invalid rule counts',
      evidenceSource: opts.evidenceSource ?? null,
    };
  }

  if (total === 0) {
    return {
      state: 'INCOMPLETE',
      score: null,
      rulesEvaluated: 0,
      rulesPassed: 0,
      rulesFailed: 0,
      reason: opts.reason ?? 'Zero rules evaluated — cannot claim compliance',
      evidenceSource: opts.evidenceSource ?? null,
    };
  }

  const safePassed = Math.min(passed, total);
  const score = Math.round((safePassed / total) * 100);
  const failed = total - safePassed;

  return {
    state: failed === 0 ? 'PASS' : 'FAIL',
    score,
    rulesEvaluated: total,
    rulesPassed: safePassed,
    rulesFailed: failed,
    reason:
      opts.reason ??
      (failed === 0 ? `All ${total} rules passed` : `${failed} of ${total} rules failed`),
    evidenceSource: opts.evidenceSource ?? null,
  };
}

/** CI / --strict exit: only PASS is success. */
export function exitCodeForAssurance(state: AssuranceState): number {
  return state === 'PASS' ? 0 : 1;
}

/** Display helper — never invent a percentage for incomplete evidence. */
export function formatAssuranceScore(score: number | null): string {
  return score === null ? 'n/a' : `${score}%`;
}

/**
 * Compliance contribution for maturity score when log has no enforced events.
 * Returns null score + INCOMPLETE — callers must not treat as 100.
 */
export function assuranceFromEnforcedEvents(
  compliant: number,
  enforced: number,
): AssuranceResult {
  if (enforced === 0) {
    return assuranceFromRuleCounts(0, 0, {
      reason: 'No enforced governance events — compliance score incomplete',
      evidenceSource: 'governance.log.jsonl',
    });
  }
  // Use tenth-percent precision via round after *10 in callers historically;
  // here we keep integer percent for AssuranceResult.score consistency.
  const score = Math.round((compliant / enforced) * 100);
  const passed = compliant;
  const failed = enforced - compliant;
  return {
    state: failed === 0 ? 'PASS' : 'FAIL',
    score,
    rulesEvaluated: enforced,
    rulesPassed: passed,
    rulesFailed: failed,
    reason:
      failed === 0
        ? `All ${enforced} enforced events compliant`
        : `${failed} of ${enforced} enforced events non-compliant`,
    evidenceSource: 'governance.log.jsonl',
  };
}
