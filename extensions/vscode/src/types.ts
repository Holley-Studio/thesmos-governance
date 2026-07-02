// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Type declarations mirroring the JSON output of the thesmos-governance CLI.
 *
 * These are intentionally standalone — the extension does not depend on the
 * thesmos-governance package at runtime. All data arrives via CLI + JSON.
 */

export type Severity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW' | 'TECH_DEBT';

export type HealthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

/** Shape of a single finding from `thesmos review --json`. */
export interface Finding {
  severity: Severity;
  file: string;
  line?: number;
  category: string;
  message: string;
  suggestion?: string;
}

/** Shape of `thesmos review --json` stdout. */
export interface ReviewOutput {
  total: number;
  findings: Finding[];
  /** Count of findings suppressed because they matched a .thesmos/baseline.json entry. */
  baselinedCount?: number;
}

/** Shape of `thesmos health --json` stdout. */
export interface HealthScore {
  score: number;
  grade: HealthGrade;
  priorityActions: string[];
  deductions: Array<{ label: string; amount: number; detail?: string }>;
  bonuses: Array<{ label: string; amount: number }>;
  totals: {
    newFindings: number;
    baselineFindings: number;
    driftEvents: number;
    suppressionIssues: number;
    hasBaseline: boolean;
    hasReport: boolean;
    reportFresh: boolean;
  };
}

/** Resolved configuration for this extension run. */
export interface ExtensionConfig {
  enable: boolean;
  runOnSave: boolean;
  debounceMs: number;
  showStatusBar: boolean;
  binaryPath: string;
  autoScan: boolean;
  minSeverity: string;
}
