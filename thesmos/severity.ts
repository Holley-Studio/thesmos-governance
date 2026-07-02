// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import type { Finding, ThesmosConfig, Severity, SeverityRule } from './types';
import { partitionByConfidence } from './gate';

const SEVERITY_DEFAULT: Severity = 'MEDIUM';

/**
 * Look up the severity for a category in the config's severityRules.
 * Falls back to SEVERITY_DEFAULT if the category is not found.
 */
export function classifySeverity(
  category: string,
  rules: SeverityRule[]
): Severity {
  const rule = rules.find((r) => r.category === category);
  return rule?.severity ?? SEVERITY_DEFAULT;
}

/**
 * Returns true if any finding's severity is in `config.failOnSeverity`.
 * This drives CI exit(1).
 *
 * Findings below `config.gate.minConfidence` never fail a gate — a heuristic
 * smell may warn and report, but only sufficiently confident detections can
 * block a merge (see thesmos/gate.ts for the tier semantics).
 */
export function shouldFail(findings: Finding[], config: ThesmosConfig): boolean {
  const { gating } = partitionByConfidence(findings, config.gate?.minConfidence ?? 'medium');
  return gating.some((f) => config.failOnSeverity.includes(f.severity));
}

/**
 * Returns true if any finding's severity is in `config.warnOnSeverity`
 * AND none are in `failOnSeverity` (warnings are advisory when blockers are present).
 */
export function shouldWarn(findings: Finding[], config: ThesmosConfig): boolean {
  return (
    !shouldFail(findings, config) &&
    findings.some((f) => config.warnOnSeverity.includes(f.severity))
  );
}

/**
 * Compute the process exit code for a set of findings.
 * Returns 1 if any finding severity is in failOnSeverity; 0 otherwise.
 */
export function exitCodeFor(findings: Finding[], config: ThesmosConfig): 0 | 1 {
  return shouldFail(findings, config) ? 1 : 0;
}

/** Ordered for display: worst first */
export const SEVERITY_ORDER: Severity[] = [
  'BLOCKER',
  'HIGH',
  'MEDIUM',
  'LOW',
  'TECH_DEBT',
];

export const SEVERITY_EMOJI: Record<Severity, string> = {
  BLOCKER: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
  TECH_DEBT: '⚪',
};

/** Sort findings by severity (worst first), then file name. */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const severityDiff =
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
    if (severityDiff !== 0) return severityDiff;
    return a.file.localeCompare(b.file);
  });
}
