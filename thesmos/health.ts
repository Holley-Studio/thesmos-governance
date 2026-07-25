// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Health Score — a single 0-100 number that synthesises governance state.
 *
 * The score answers: "Is this repo's governance healthy right now?"
 *
 * Scoring model:
 *   Start at 100. Apply deductions for problems. Apply bonuses for good practices.
 *   Score = clamp(0, 100, 100 - deductions + bonuses)
 *
 * Deduction categories:
 *   Findings (only NEW findings, not baselined debt):
 *     BLOCKER:    -25 each (cap -75)
 *     HIGH:       -10 each (cap -40)
 *     MEDIUM:     -3  each (cap -15)
 *     LOW:        -1  each (cap -5)
 *     TECH_DEBT:  -0.5 each (cap -5)
 *
 *   Drift events:
 *     BLOCKER:    -15 each (cap -45)
 *     HIGH:       -8  each (cap -24)
 *     MEDIUM:     -3  each (cap -9)
 *     LOW:        -1  each (cap -3)
 *
 *   Bad suppressions:
 *     expired or blanket: -5 each (cap -20)
 *     missing-reason:     -2 each (cap -10)
 *
 * Bonus categories:
 *   +5   baseline in use and zero new findings
 *   +5   zero drift events
 *   +3   all suppressions valid (or no suppressions at all)
 *   +2   report is fresh (generatedAt within 24h of now)
 *
 * Grade scale:
 *   A+ = 95–100   (exceptional)
 *   A  = 90–94    (excellent)
 *   B  = 75–89    (good — some issues)
 *   C  = 60–74    (fair — attention needed)
 *   D  = 40–59    (poor — governance degrading)
 *   F  = 0–39     (critical — immediate action required)
 */

import type { Finding, ScanResult, ThesmosConfig } from './types.js';
import type { DriftFinding } from './drift.js';
import type { SuppressionAuditFinding } from './suppress.js';
import type { Baseline } from './baseline.js';
import { SEVERITY_ORDER } from './severity.js';
import { THESMOS_RULES } from './adapters.js';
import { partitionFindings, loadBaseline } from './baseline.js';
import { runDriftForRoot } from './drift.js';
import { runReview } from './review.js';
import { loadReport } from './report.js';
import { runScanner } from './scanner/index.js';
import { extractSuppressions, auditSuppressions } from './suppress.js';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ── Public types ──────────────────────────────────────────────────────────────

export type HealthGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface HealthDeduction {
  label: string;
  amount: number;
  detail?: string;
}

export interface HealthBonus {
  label: string;
  amount: number;
}

export interface HealthScore {
  score: number;        // 0–100
  grade: HealthGrade;
  deductions: HealthDeduction[];
  bonuses: HealthBonus[];
  /** Ordered list of the most impactful actions to take next. */
  priorityActions: string[];
  /** Raw input totals for display. */
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

export interface HealthInput {
  findings: Finding[];         // all current findings
  baseline: Baseline | null;
  driftFindings: DriftFinding[];
  suppressionAuditFindings: SuppressionAuditFinding[];
  scan: ScanResult | null;
  now: Date;
}

// ── Pure computation ──────────────────────────────────────────────────────────

const FINDING_DEDUCTIONS: Record<string, { per: number; cap: number }> = {
  BLOCKER:   { per: 25, cap: 75 },
  HIGH:      { per: 10, cap: 40 },
  MEDIUM:    { per: 3,  cap: 15 },
  LOW:       { per: 1,  cap: 5  },
  TECH_DEBT: { per: 0.5, cap: 5 },
};

const DRIFT_DEDUCTIONS: Record<string, { per: number; cap: number }> = {
  BLOCKER: { per: 15, cap: 45 },
  HIGH:    { per: 8,  cap: 24 },
  MEDIUM:  { per: 3,  cap: 9  },
  LOW:     { per: 1,  cap: 3  },
};

export function computeHealthScore(input: HealthInput): HealthScore {
  const { findings, baseline, driftFindings, suppressionAuditFindings, scan, now } = input;

  // Partition findings against baseline
  let newFindings = findings;
  let baselineFindings: Finding[] = [];

  if (baseline) {
    const partition = partitionFindings(findings, baseline);
    newFindings = partition.newFindings;
    baselineFindings = partition.baselineFindings;
  }

  const deductions: HealthDeduction[] = [];
  const bonuses: HealthBonus[] = [];
  let total = 100;

  // ── Finding deductions ────────────────────────────────────────────────────

  const findingsBySev = new Map<string, number>();
  for (const f of newFindings) {
    findingsBySev.set(f.severity, (findingsBySev.get(f.severity) ?? 0) + 1);
  }

  for (const sev of SEVERITY_ORDER) {
    const count = findingsBySev.get(sev) ?? 0;
    if (count === 0) continue;
    const { per, cap } = FINDING_DEDUCTIONS[sev] ?? { per: 1, cap: 10 };
    const raw = count * per;
    const capped = Math.min(raw, cap);
    deductions.push({
      label: `${sev} finding${count === 1 ? '' : 's'}`,
      amount: capped,
      detail: count > 1 ? `${count} × ${per} (capped at ${cap})` : undefined,
    });
    total -= capped;
  }

  // ── Drift deductions ──────────────────────────────────────────────────────

  const driftBySev = new Map<string, number>();
  for (const d of driftFindings) {
    driftBySev.set(d.severity, (driftBySev.get(d.severity) ?? 0) + 1);
  }

  for (const sev of ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']) {
    const count = driftBySev.get(sev) ?? 0;
    if (count === 0) continue;
    const { per, cap } = DRIFT_DEDUCTIONS[sev] ?? { per: 1, cap: 3 };
    const raw = count * per;
    const capped = Math.min(raw, cap);
    deductions.push({
      label: `drift: ${sev}`,
      amount: capped,
      detail: count > 1 ? `${count} events` : undefined,
    });
    total -= capped;
  }

  // ── Suppression deductions ────────────────────────────────────────────────

  const severeSupIssues = suppressionAuditFindings.filter(
    (f) => f.type === 'expired' || f.type === 'blanket'
  );
  const medSupIssues = suppressionAuditFindings.filter((f) => f.type === 'missing-reason');

  if (severeSupIssues.length > 0) {
    const cap = 20;
    const raw = severeSupIssues.length * 5;
    const capped = Math.min(raw, cap);
    deductions.push({ label: 'expired/blanket suppressions', amount: capped });
    total -= capped;
  }
  if (medSupIssues.length > 0) {
    const cap = 10;
    const raw = medSupIssues.length * 2;
    const capped = Math.min(raw, cap);
    deductions.push({ label: 'suppressions missing reason', amount: capped });
    total -= capped;
  }

  // ── Bonuses ───────────────────────────────────────────────────────────────

  if (baseline && newFindings.length === 0) {
    bonuses.push({ label: 'baseline active, 0 new findings', amount: 5 });
    total += 5;
  }

  if (driftFindings.length === 0) {
    bonuses.push({ label: 'zero drift events', amount: 5 });
    total += 5;
  }

  const hasSupIssues = suppressionAuditFindings.some(
    (f) => f.type !== 'unused' // unused is LOW and not penalised above
  );
  if (!hasSupIssues) {
    bonuses.push({ label: 'all suppressions valid', amount: 3 });
    total += 3;
  }

  const reportFresh = (() => {
    if (!scan?.generatedAt) return false;
    const age = now.getTime() - new Date(scan.generatedAt).getTime();
    return age < 24 * 60 * 60 * 1000;
  })();

  if (reportFresh) {
    bonuses.push({ label: 'report is fresh', amount: 2 });
    total += 2;
  }

  const score = Math.round(Math.max(0, Math.min(100, total)));
  const grade = gradeFor(score);

  // ── Priority actions ──────────────────────────────────────────────────────

  const priorityActions: string[] = [];

  // Most severe finding first
  const worstFinding = newFindings[0]; // already sorted by severity
  if (worstFinding) {
    const loc = worstFinding.line ? `:${worstFinding.line}` : '';
    priorityActions.push(
      `Fix ${worstFinding.severity} [${worstFinding.category}] in ${worstFinding.file}${loc}`
    );
  }

  // Drift
  const blockerDrift = driftFindings.filter((d) => d.severity === 'BLOCKER');
  if (blockerDrift.length > 0) {
    const types = [...new Set(blockerDrift.map((d) => d.type))].join(', ');
    priorityActions.push(`Fix BLOCKER drift: ${types}  (run: thesmos drift)`);
  } else if (driftFindings.length > 0) {
    priorityActions.push(`Resolve ${driftFindings.length} drift event${driftFindings.length === 1 ? '' : 's'}  (run: thesmos drift)`);
  }

  // Suppressions
  if (severeSupIssues.length > 0) {
    priorityActions.push(`Remove ${severeSupIssues.length} expired/blanket suppression${severeSupIssues.length === 1 ? '' : 's'}  (run: thesmos suppressions:audit)`);
  }

  // Baseline suggestion
  if (!baseline && findings.length > 0) {
    priorityActions.push(`Create a baseline to track debt separately  (run: thesmos baseline:create)`);
  }

  // Stale report
  if (scan && !reportFresh) {
    priorityActions.push(`Refresh the scan report  (run: thesmos scan)`);
  } else if (!scan) {
    priorityActions.push(`Run a scan first  (run: thesmos scan)`);
  }

  // Remaining HIGH new findings
  const highFindings = newFindings.filter((f) => f.severity === 'HIGH');
  if (highFindings.length > 1) {
    priorityActions.push(`Fix ${highFindings.length - (worstFinding?.severity === 'HIGH' ? 1 : 0)} more HIGH finding${highFindings.length > 2 ? 's' : ''}  (run: thesmos review)`);
  }

  return {
    score,
    grade,
    deductions,
    bonuses,
    priorityActions: priorityActions.slice(0, 5), // top 5 only
    totals: {
      newFindings: newFindings.length,
      baselineFindings: baselineFindings.length,
      driftEvents: driftFindings.length,
      suppressionIssues: suppressionAuditFindings.length,
      hasBaseline: baseline !== null,
      hasReport: scan !== null,
      reportFresh,
    },
  };
}

function gradeFor(score: number): HealthGrade {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ── I/O entry point ───────────────────────────────────────────────────────────

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage']);

function walkSourceFiles(dir: string): string[] {
  const files: string[] = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return files; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = join(dir, entry);
    let stat;
    try { stat = statSync(abs); } catch { continue; }
    if (stat.isDirectory()) {
      files.push(...walkSourceFiles(abs));
    } else if (SOURCE_EXTENSIONS.test(entry)) {
      files.push(abs);
    }
  }
  return files;
}

export function computeHealthForRoot(root: string, config: ThesmosConfig): HealthScore {
  // Scan fresh so the score reflects the repo AS IT IS NOW — a score derived
  // only from the last saved report.json silently freezes until someone
  // remembers to re-run `thesmos scan` (the #1 "health never updates" report).
  // Fall back to the stored report if scanning fails (e.g. permissions).
  let scan: ScanResult | null = null;
  try {
    scan = runScanner(root, config);
  } catch {
    scan = loadReport(root);
  }
  const findings = scan ? runReview({ scan, config }).findings : [];
  const baseline = loadBaseline(root);
  const driftFindings = runDriftForRoot(root, config);

  // Collect suppressions for audit
  const sourceFiles = walkSourceFiles(root);
  const allSuppressions = sourceFiles.flatMap((absPath) => {
    try {
      const content = readFileSync(absPath, 'utf8');
      return extractSuppressions(content, relative(root, absPath));
    } catch {
      return [];
    }
  });

  const suppressionAuditFindings = auditSuppressions({
    suppressions: allSuppressions,
    findings,
    now: new Date(),
  });

  return computeHealthScore({
    findings,
    baseline,
    driftFindings,
    suppressionAuditFindings,
    scan,
    now: new Date(),
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

const GRADE_COLOR: Record<HealthGrade, string> = {
  'A+': '🟢',
  'A':  '🟢',
  'B':  '🟡',
  'C':  '🟠',
  'D':  '🔴',
  'F':  '🔴',
};

export function formatHealthConsole(health: HealthScore, projectName = 'Repo'): string {
  const lines: string[] = [];
  const SEP = '─'.repeat(56);
  const WIDE = '═'.repeat(56);

  lines.push('');
  lines.push(`  Thesmos Health — ${projectName}`);
  lines.push(WIDE);
  lines.push('');
  lines.push(`  ${GRADE_COLOR[health.grade]}  Score: ${health.score} / 100    Grade: ${health.grade}`);
  lines.push('');
  lines.push(SEP);
  lines.push('');

  // Deductions
  if (health.deductions.length > 0) {
    lines.push('  Deductions');
    for (const d of health.deductions) {
      const detail = d.detail ? `  (${d.detail})` : '';
      lines.push(`    −${String(d.amount).padStart(3)}  ${d.label}${detail}`);
    }
    lines.push('');
  }

  // Bonuses
  if (health.bonuses.length > 0) {
    lines.push('  Bonuses');
    for (const b of health.bonuses) {
      lines.push(`    +${String(b.amount).padStart(3)}  ${b.label}`);
    }
    lines.push('');
  }

  // Totals summary
  lines.push(SEP);
  lines.push('');
  lines.push(`  ${health.totals.newFindings} new findings  ·  ${health.totals.baselineFindings} baselined  ·  ${health.totals.driftEvents} drift events`);
  lines.push('');

  // Priority actions
  if (health.priorityActions.length > 0) {
    lines.push('  Priority actions:');
    health.priorityActions.forEach((a, i) => {
      lines.push(`    ${i + 1}. ${a}`);
    });
    lines.push('');
  }

  lines.push(WIDE);

  return lines.join('\n');
}

export function formatHealthMarkdown(health: HealthScore, projectName = 'Repo'): string {
  const lines: string[] = [];

  lines.push(`## Thesmos Health — ${projectName}`);
  lines.push('');
  lines.push(`### ${GRADE_COLOR[health.grade]} Score: **${health.score} / 100** — Grade **${health.grade}**`);
  lines.push('');
  lines.push(`> ${health.totals.newFindings} new findings · ${health.totals.baselineFindings} baselined · ${health.totals.driftEvents} drift events`);
  lines.push('');

  if (health.deductions.length > 0) {
    lines.push('| Deduction | Points |');
    lines.push('|---|---|');
    for (const d of health.deductions) {
      lines.push(`| ${d.label} | −${d.amount} |`);
    }
    lines.push('');
  }

  if (health.bonuses.length > 0) {
    lines.push('| Bonus | Points |');
    lines.push('|---|---|');
    for (const b of health.bonuses) {
      lines.push(`| ${b.label} | +${b.amount} |`);
    }
    lines.push('');
  }

  if (health.priorityActions.length > 0) {
    lines.push('### Priority Actions');
    lines.push('');
    health.priorityActions.forEach((a, i) => {
      lines.push(`${i + 1}. ${a}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function formatHealthJson(health: HealthScore): string {
  return JSON.stringify(health, null, 2);
}
