/**
 * Thesmos Metrics Engine — local-first, privacy-safe governance analytics.
 *
 * All metrics are derived from existing Thesmos artifacts:
 *   - .thesmos/report.json   (scan results)
 *   - .thesmos/baseline.json (known debt)
 *   - current findings (from runReview)
 *   - drift findings (from runDriftForRoot)
 *   - registry config (agent/skill usage)
 *
 * No telemetry. No network. Fully deterministic.
 * All computation is pure — I/O is isolated to collectMetricsForRoot().
 *
 * Trend history (future-compatible):
 *   .thesmos/metrics-history.jsonl — one JSON line per CI run.
 *   Call appendMetricsSnapshot() in CI to build a local trend log.
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Finding, ScanResult, ThesmosConfig } from './types.js';
import type { Baseline, BaselinePartition } from './baseline.js';
import type { DriftFinding } from './drift.js';
import type { ResolvedRegistry } from './registry.js';
import { SEVERITY_ORDER } from './severity.js';
import { THESMOS_RULES } from './adapters.js';
import { partitionFindings, loadBaseline } from './baseline.js';
import { runDriftForRoot } from './drift.js';
import { loadAndResolveRegistry } from './registry.js';
import { runReview } from './review.js';
import { loadReport } from './report.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface MetricsBySeverity {
  BLOCKER: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  TECH_DEBT: number;
}

export interface MetricsByRule {
  ruleId: string;
  category: string;
  count: number;
}

export interface RiskyFile {
  file: string;
  findingCount: number;
  severities: string[];
}

export interface AgentUsage {
  agentId: string;
}

export interface SkillUsage {
  skillId: string;
}

export interface ThesmosMetrics {
  /** ISO timestamp of when metrics were computed. */
  computedAt: string;
  /** Total findings from current scan + review. */
  totalFindings: number;
  /** Breakdown of all findings by severity. */
  findingsBySeverity: MetricsBySeverity;
  /** Finding counts per rule, sorted descending by count. */
  findingsByRule: MetricsByRule[];
  /** Findings matched by baseline (suppressed from CI). */
  baselineFindings: number;
  /** Findings NOT in baseline (will fail CI). */
  newFindings: number;
  /** Number of resolved baseline entries (debt fixed since baseline was created). */
  resolvedBaselineEntries: number;
  /** Top files by finding count (up to 10). */
  topRiskyFiles: RiskyFile[];
  /** Number of drift findings detected. */
  driftEvents: number;
  /** Breakdown of drift findings by type. */
  driftByType: Record<string, number>;
  /** Rules with at least one finding — gauge for rule utilisation. */
  activeRuleCount: number;
  /** Total rules registered. */
  totalRuleCount: number;
  /** Enabled agents from registry. */
  agentUsage: AgentUsage[];
  /** Enabled skills from registry. */
  skillUsage: SkillUsage[];
  /** Number of baseline entries (current total debt). */
  baselineEntryCount: number;
  /** ISO timestamp of the scan report, or null if no report. */
  lastScanAt: string | null;
}

export interface MetricsInput {
  findings: Finding[];
  scan: ScanResult | null;
  baseline: Baseline | null;
  driftFindings: DriftFinding[];
  registry: ResolvedRegistry | null;
  now: Date;
}

/** Appended to .thesmos/metrics-history.jsonl for trend tracking. */
export interface MetricsSnapshot {
  recordedAt: string;
  totalFindings: number;
  newFindings: number;
  baselineFindings: number;
  driftEvents: number;
  findingsBySeverity: MetricsBySeverity;
  agentCount?: number;
  skillCount?: number;
}

// ── Pure computation ──────────────────────────────────────────────────────────

function zeroSeverity(): MetricsBySeverity {
  return { BLOCKER: 0, HIGH: 0, MEDIUM: 0, LOW: 0, TECH_DEBT: 0 };
}

/**
 * Compute metrics from injected data.
 * Pure — no filesystem access.
 */
export function computeMetrics(input: MetricsInput): ThesmosMetrics {
  const { findings, scan, baseline, driftFindings, registry, now } = input;

  // Findings by severity
  const findingsBySeverity = zeroSeverity();
  for (const f of findings) {
    findingsBySeverity[f.severity] = (findingsBySeverity[f.severity] ?? 0) + 1;
  }

  // Findings by rule (sorted descending by count)
  const countByCategory = new Map<string, number>();
  for (const f of findings) {
    countByCategory.set(f.category, (countByCategory.get(f.category) ?? 0) + 1);
  }
  const findingsByRule: MetricsByRule[] = THESMOS_RULES.map((r) => ({
    ruleId: r.id,
    category: r.category,
    count: countByCategory.get(r.category) ?? 0,
  }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  // Baseline partition
  let baselineCount = 0;
  let newCount = findings.length;
  let resolvedCount = 0;
  let baselineEntryCount = 0;

  if (baseline) {
    baselineEntryCount = baseline.entries.length;
    const partition: BaselinePartition = partitionFindings(findings, baseline);
    baselineCount = partition.baselineFindings.length;
    newCount = partition.newFindings.length;
    resolvedCount = partition.resolvedEntries.length;
  }

  // Top risky files (up to 10)
  const fileFindings = new Map<string, Finding[]>();
  for (const f of findings) {
    const arr = fileFindings.get(f.file) ?? [];
    arr.push(f);
    fileFindings.set(f.file, arr);
  }
  const topRiskyFiles: RiskyFile[] = [...fileFindings.entries()]
    .map(([file, ff]) => ({
      file,
      findingCount: ff.length,
      severities: [...new Set(ff.map((f) => f.severity))].sort(
        (a, b) => SEVERITY_ORDER.indexOf(a as never) - SEVERITY_ORDER.indexOf(b as never)
      ),
    }))
    .sort((a, b) => b.findingCount - a.findingCount)
    .slice(0, 10);

  // Drift breakdown
  const driftByTypeMap = new Map<string, number>();
  for (const d of driftFindings) {
    driftByTypeMap.set(d.type, (driftByTypeMap.get(d.type) ?? 0) + 1);
  }
  const driftByType = Object.fromEntries([...driftByTypeMap.entries()].sort());

  // Agent and skill usage
  const agentUsage: AgentUsage[] = (registry?.agents ?? []).map((a) => ({ agentId: a.id }));
  const skillUsage: SkillUsage[] = (registry?.skills ?? []).map((s) => ({ skillId: s.id }));

  return {
    computedAt: now.toISOString(),
    totalFindings: findings.length,
    findingsBySeverity,
    findingsByRule,
    baselineFindings: baselineCount,
    newFindings: newCount,
    resolvedBaselineEntries: resolvedCount,
    topRiskyFiles,
    driftEvents: driftFindings.length,
    driftByType,
    activeRuleCount: findingsByRule.length,
    totalRuleCount: THESMOS_RULES.length,
    agentUsage,
    skillUsage,
    baselineEntryCount,
    lastScanAt: scan?.generatedAt ?? null,
  };
}

// ── I/O entry point ───────────────────────────────────────────────────────────

export function collectMetricsForRoot(root: string, config: ThesmosConfig): ThesmosMetrics {
  const scan = loadReport(root);
  const findings = scan ? runReview({ scan, config }) : [];
  const baseline = loadBaseline(root);
  const driftFindings = runDriftForRoot(root, config);
  let registry: ResolvedRegistry | null = null;
  try {
    registry = loadAndResolveRegistry(root);
  } catch {
    registry = null;
  }

  return computeMetrics({
    findings,
    scan,
    baseline,
    driftFindings,
    registry,
    now: new Date(),
  });
}

// ── Trend history ─────────────────────────────────────────────────────────────

export const METRICS_HISTORY_PATH = '.thesmos/metrics-history.jsonl';

/** Convert a full metrics object to the compact snapshot written to history. */
export function toMetricsSnapshot(metrics: ThesmosMetrics): MetricsSnapshot {
  return {
    recordedAt: metrics.computedAt,
    totalFindings: metrics.totalFindings,
    newFindings: metrics.newFindings,
    baselineFindings: metrics.baselineFindings,
    driftEvents: metrics.driftEvents,
    findingsBySeverity: metrics.findingsBySeverity,
  };
}

/** Append a snapshot to the local history file (for CI trend tracking). */
export function appendMetricsSnapshot(root: string, snapshot: MetricsSnapshot): void {
  const absPath = join(root, METRICS_HISTORY_PATH);
  mkdirSync(dirname(absPath), { recursive: true });
  appendFileSync(absPath, JSON.stringify(snapshot) + '\n', 'utf8');
}

/** Load all historical snapshots from the history file. */
export function loadMetricsHistory(root: string): MetricsSnapshot[] {
  const absPath = join(root, METRICS_HISTORY_PATH);
  if (!existsSync(absPath)) return [];
  try {
    return readFileSync(absPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MetricsSnapshot);
  } catch {
    return [];
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

const SEV_EMOJI: Record<string, string> = {
  BLOCKER: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🔵', TECH_DEBT: '⚪',
};

export function formatMetricsConsole(metrics: ThesmosMetrics, projectName = 'Repo'): string {
  const lines: string[] = [];
  const SEP = '─'.repeat(56);

  lines.push(`Thesmos Metrics — ${projectName}`);
  lines.push(SEP);
  lines.push('');

  lines.push(`  Findings`);
  lines.push(`    Total:     ${metrics.totalFindings}`);
  lines.push(`    New:       ${metrics.newFindings}  (will fail CI)`);
  lines.push(`    Baseline:  ${metrics.baselineFindings}  (suppressed)`);
  lines.push(`    Resolved:  ${metrics.resolvedBaselineEntries}  (fixed since baseline)`);
  lines.push('');

  lines.push(`  By Severity`);
  for (const sev of SEVERITY_ORDER) {
    const count = metrics.findingsBySeverity[sev as keyof MetricsBySeverity];
    if (count > 0) {
      lines.push(`    ${SEV_EMOJI[sev] ?? ''} ${sev.padEnd(10)}  ${count}`);
    }
  }
  if (Object.values(metrics.findingsBySeverity).every((v) => v === 0)) {
    lines.push('    (none)');
  }
  lines.push('');

  if (metrics.findingsByRule.length > 0) {
    lines.push(`  By Rule  (${metrics.activeRuleCount} of ${metrics.totalRuleCount} active)`);
    for (const r of metrics.findingsByRule) {
      lines.push(`    ${r.ruleId.padEnd(12)}  ${r.category.padEnd(30)}  ${r.count}`);
    }
    lines.push('');
  } else {
    lines.push(`  By Rule  (0 of ${metrics.totalRuleCount} active)`);
    lines.push('');
  }

  if (metrics.topRiskyFiles.length > 0) {
    lines.push(`  Top Risky Files`);
    for (const f of metrics.topRiskyFiles.slice(0, 5)) {
      lines.push(`    ${f.findingCount.toString().padStart(3)} finding${f.findingCount === 1 ? '' : 's'}  ${f.file}`);
    }
    lines.push('');
  }

  lines.push(`  Drift Events: ${metrics.driftEvents}`);
  for (const [type, count] of Object.entries(metrics.driftByType)) {
    lines.push(`    ${type.padEnd(35)}  ${count}`);
  }
  lines.push('');

  if (metrics.agentUsage.length > 0) {
    lines.push(`  Agents: ${metrics.agentUsage.length} enabled`);
    for (const a of metrics.agentUsage) lines.push(`    ${a.agentId}`);
    lines.push('');
  }
  if (metrics.skillUsage.length > 0) {
    lines.push(`  Skills: ${metrics.skillUsage.length} enabled`);
    for (const s of metrics.skillUsage) lines.push(`    ${s.skillId}`);
    lines.push('');
  }

  lines.push(`  Baseline debt: ${metrics.baselineEntryCount} entries`);
  if (metrics.lastScanAt) lines.push(`  Last scan: ${metrics.lastScanAt}`);
  lines.push('');
  lines.push(SEP);

  return lines.join('\n');
}

export function formatMetricsMarkdown(metrics: ThesmosMetrics, projectName = 'Repo'): string {
  const lines: string[] = [];

  lines.push(`## Thesmos Metrics — ${projectName}`);
  lines.push('');
  lines.push(`> Computed at: ${metrics.computedAt}`);
  lines.push('');

  lines.push('### Findings Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Total findings | ${metrics.totalFindings} |`);
  lines.push(`| New (will fail CI) | ${metrics.newFindings} |`);
  lines.push(`| Baseline (suppressed) | ${metrics.baselineFindings} |`);
  lines.push(`| Resolved since baseline | ${metrics.resolvedBaselineEntries} |`);
  lines.push(`| Baseline debt entries | ${metrics.baselineEntryCount} |`);
  lines.push('');

  if (metrics.totalFindings > 0) {
    lines.push('### Findings by Severity');
    lines.push('');
    lines.push('| Severity | Count |');
    lines.push('|---|---|');
    for (const sev of SEVERITY_ORDER) {
      const count = metrics.findingsBySeverity[sev as keyof MetricsBySeverity];
      if (count > 0) lines.push(`| ${SEV_EMOJI[sev] ?? ''} ${sev} | ${count} |`);
    }
    lines.push('');

    lines.push('### Findings by Rule');
    lines.push('');
    lines.push('| Rule | Category | Count |');
    lines.push('|---|---|---|');
    for (const r of metrics.findingsByRule) {
      lines.push(`| \`${r.ruleId}\` | \`${r.category}\` | ${r.count} |`);
    }
    lines.push('');
  }

  if (metrics.topRiskyFiles.length > 0) {
    lines.push('### Top Risky Files');
    lines.push('');
    lines.push('| File | Findings | Severities |');
    lines.push('|---|---|---|');
    for (const f of metrics.topRiskyFiles) {
      lines.push(`| \`${f.file}\` | ${f.findingCount} | ${f.severities.join(', ')} |`);
    }
    lines.push('');
  }

  if (metrics.driftEvents > 0) {
    lines.push('### Drift Events');
    lines.push('');
    for (const [type, count] of Object.entries(metrics.driftByType)) {
      lines.push(`- \`${type}\`: ${count}`);
    }
    lines.push('');
  }

  if (metrics.agentUsage.length > 0 || metrics.skillUsage.length > 0) {
    lines.push('### Agent & Skill Usage');
    lines.push('');
    if (metrics.agentUsage.length > 0) {
      lines.push(`**Agents enabled:** ${metrics.agentUsage.map((a) => `\`${a.agentId}\``).join(', ')}`);
    }
    if (metrics.skillUsage.length > 0) {
      lines.push(`**Skills enabled:** ${metrics.skillUsage.map((s) => `\`${s.skillId}\``).join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatMetricsJson(metrics: ThesmosMetrics): string {
  return JSON.stringify(metrics, null, 2);
}
