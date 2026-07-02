// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Pure severity-filtering logic backing the `thesmos.minSeverity` setting.
 *
 * Extracted from extension.ts so it is testable without the vscode API —
 * no vscode import here, ever.
 */

import type { Finding, Severity } from './types.js';

/** Descending severity order: most severe first. */
export const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];

/** Valid values for the `thesmos.minSeverity` setting. */
export type MinSeverity = 'ALL' | Severity;

/**
 * Filters findings to only those at or above `minSeverity` in the ordering
 * BLOCKER > HIGH > MEDIUM > LOW > TECH_DEBT.
 *
 * 'ALL' (or any value not recognised as a Severity) disables filtering —
 * fails open so a typo'd setting never silently hides findings.
 */
export function filterBySeverity(findings: Finding[], minSeverity: string): Finding[] {
  if (minSeverity === 'ALL') return findings;

  const thresholdIdx = SEVERITY_ORDER.indexOf(minSeverity as Severity);
  if (thresholdIdx === -1) return findings;

  return findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= thresholdIdx);
}
