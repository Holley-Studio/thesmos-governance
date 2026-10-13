// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos eval — governance + runtime observability report
 *
 * Primary: reads .thesmos/governance.log.jsonl (enforcement events).
 * Secondary: summarises execution receipts / agent-activity / metrics-export
 * when present. This is NOT a Pantheon behavioral test runner — those live
 * in Vitest (`thesmos/eval/suites.test.ts` and unit suites).
 *
 * Usage:
 *   thesmos eval                  Current session (last 24h)
 *   thesmos eval --since=30d      Last 30 days
 *   thesmos eval --since=7d       Last 7 days
 *   thesmos eval --json           Machine-readable JSON
 *   thesmos eval --markdown       Markdown (for PR comments, docs)
 *   thesmos eval --all            Full log — all recorded events
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  readGovernanceLogResult,
  summariseGovernanceLog,
  type GovernanceSummary,
} from '../../governance-log.ts';
import { readAgentActivityResult } from '../../agent-activity.ts';
import { readExecutionReceiptResult } from '../../execution-receipt.ts';
import { readMetricsExportResult } from '../../metrics-export.ts';

interface RuntimeObservability {
  receipts: number;
  activityEvents: number;
  metricsEvents: number;
  lastReceiptStatus?: string;
  evidenceIssues: string[];
}

function summariseRuntime(
  root: string,
  since: Date | undefined,
  until: Date
): RuntimeObservability {
  const receiptRead = readExecutionReceiptResult(root, undefined, Number.POSITIVE_INFINITY);
  const activityRead = readAgentActivityResult(root, Number.POSITIVE_INFINITY);
  const metricsRead = readMetricsExportResult(root, Number.POSITIVE_INFINITY);
  const inPeriod = (row: { ts: string }) =>
    !since || (Date.parse(row.ts) >= since.getTime() && Date.parse(row.ts) <= until.getTime());
  const receipts = receiptRead.records.filter(inPeriod);
  const activity = activityRead.records.filter(inPeriod);
  const metrics = metricsRead.records.filter(inPeriod);
  const evidenceIssues: string[] = [];
  if (receiptRead.invalidRecords)
    evidenceIssues.push(`Receipts: ${receiptRead.invalidRecords} invalid record(s)`);
  if (receiptRead.unreadableFiles.length)
    evidenceIssues.push(`Receipts: ${receiptRead.unreadableFiles.length} unreadable file(s)`);
  for (const [label, read] of [
    ['Agent activity', activityRead],
    ['Metrics', metricsRead],
  ] as const) {
    if (read.invalidLines.length)
      evidenceIssues.push(`${label}: ${read.invalidLines.length} invalid record(s)`);
    if (read.error) evidenceIssues.push(`${label}: evidence file unreadable`);
  }
  return {
    receipts: receipts.length,
    activityEvents: activity.length,
    metricsEvents: metrics.length,
    lastReceiptStatus: receipts.at(-1)?.terminalStatus,
    evidenceIssues,
  };
}

// ── Duration parser ───────────────────────────────────────────────────────────

function parseSince(val: string): Date {
  const m = /^(\d+)(d|h|m)$/.exec(val);
  if (!m) throw new Error(`Invalid --since value: ${val}. Use: 24h, 7d, 30d`);
  const n = parseInt(m[1]!, 10);
  const unit = m[2]!;
  const now = Date.now();
  const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000;
  const result = new Date(now - ms);
  if (!Number.isSafeInteger(n) || n <= 0 || !Number.isFinite(result.getTime()))
    throw new Error('Invalid --since duration: use a positive bounded duration such as 24h or 7d');
  return result;
}

// ── Formatters ────────────────────────────────────────────────────────────────

function scoreBar(score: number | null): string {
  if (score === null) return '░'.repeat(20);
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function scoreLabel(score: number | null, state: GovernanceSummary['assuranceState']): string {
  if (state === 'ERROR') return 'Error';
  if (state === 'INCOMPLETE' || score === null) return 'Incomplete';
  if (score >= 99) return 'Excellent';
  if (score >= 95) return 'Good';
  if (score >= 85) return 'Fair';
  if (score >= 70) return 'Needs attention';
  return 'Critical';
}

function formatConsole(summary: GovernanceSummary, projectName: string, period: string): string {
  const lines: string[] = [''];
  const SEP = '─'.repeat(64);

  lines.push(`  Thesmos Governance Report — ${projectName}`);
  lines.push(`  ${period}`);
  lines.push(`  ${SEP}`);
  lines.push('');

  const scoreStr =
    summary.complianceScore === null ? 'n/a' : `${summary.complianceScore.toFixed(1)}%`;
  lines.push(`  Assurance           ${summary.assuranceState.padStart(6)}`);
  lines.push(
    `  Compliance Score    ${scoreStr.padStart(6)}  [${scoreBar(summary.complianceScore)}]  ${scoreLabel(summary.complianceScore, summary.assuranceState)}`
  );
  lines.push('');
  lines.push(`  Events recorded     ${String(summary.total).padStart(6)}`);
  lines.push(
    `  Rules fired         ${String(summary.blocked + summary.warned + summary.passed).padStart(6)}`
  );
  lines.push(`  Blocked             ${String(summary.blocked).padStart(6)}`);
  lines.push(`  Warned              ${String(summary.warned).padStart(6)}`);
  lines.push(`  Bypassed            ${String(summary.bypassed).padStart(6)}`);
  lines.push('');

  if (summary.topCategory) {
    lines.push(
      `  Top category        ${summary.topCategory} (${summary.categoryHits[summary.topCategory]} events)`
    );
  }
  if (summary.topRule) {
    lines.push(
      `  Top rule            ${summary.topRule} (${summary.ruleHits[summary.topRule]} fires)`
    );
  }
  lines.push('');

  if (summary.blockedEvents.length > 0) {
    lines.push(`  Blocked actions (${summary.blockedEvents.length}):`);
    for (const e of summary.blockedEvents.slice(0, 10)) {
      const ts = e.ts.slice(0, 19).replace('T', ' ');
      const pathShort = e.path.length > 32 ? '...' + e.path.slice(-29) : e.path;
      lines.push(`    ✗  ${ts}  ${pathShort.padEnd(33)}  ${e.rule}`);
      if (e.message) lines.push(`       ${e.message}`);
    }
    if (summary.blockedEvents.length > 10) {
      lines.push(
        `    ... and ${summary.blockedEvents.length - 10} more. Use --all or --json for full list.`
      );
    }
    lines.push('');
  }

  if (summary.bypassedEvents.length > 0) {
    lines.push(`  ⚠  Bypassed governance checks (${summary.bypassedEvents.length}):`);
    for (const e of summary.bypassedEvents.slice(0, 5)) {
      lines.push(`    ⚠  ${e.path}  →  ${e.rule}  (override recorded)`);
    }
    lines.push('');
  }

  if (summary.evidenceIssues.length > 0) {
    lines.push('  Evidence integrity errors (assurance: ERROR):');
    for (const issue of summary.evidenceIssues) lines.push(`    ! ${issue}`);
    lines.push('  Preserve the original files and repair evidence before relying on this report.');
    lines.push('');
  } else if (summary.total === 0 || summary.assuranceState === 'INCOMPLETE') {
    lines.push('  No enforceable governance events in this period (assurance: INCOMPLETE).');
    lines.push('  Governance logging activates via the MCP server or CI scan hooks.');
    lines.push('  Run: thesmos mcp:install  to enable real-time enforcement logging.');
    lines.push('');
  }

  return lines.join('\n');
}

function formatRuntimeConsole(runtime: RuntimeObservability): string {
  const lines = [
    '  Runtime observability',
    `  ${'─'.repeat(64)}`,
    `  Execution receipts  ${String(runtime.receipts).padStart(6)}`,
    `  Agent activity      ${String(runtime.activityEvents).padStart(6)}`,
    `  Metrics export      ${String(runtime.metricsEvents).padStart(6)}`,
  ];
  if (runtime.lastReceiptStatus) {
    lines.push(`  Last receipt        ${runtime.lastReceiptStatus}`);
  }
  if (runtime.receipts === 0 && runtime.activityEvents === 0 && runtime.metricsEvents === 0) {
    lines.push('');
    lines.push(
      '  No runtime receipts yet. Run autopilot, agent:run, or pantheon:orchestrate --execute.'
    );
  }
  lines.push('');
  return lines.join('\n');
}

function formatMarkdown(summary: GovernanceSummary, projectName: string, period: string): string {
  const lines: string[] = [];

  lines.push(`## 🔱 Thesmos Governance Report — ${projectName}`);
  lines.push('');
  if (summary.evidenceIssues.length > 0) {
    lines.push('**Evidence integrity errors:**');
    lines.push('');
    for (const issue of summary.evidenceIssues) lines.push(`- ${issue}`);
    lines.push('');
  }
  const scoreDisplay =
    summary.complianceScore === null ? 'n/a' : `${summary.complianceScore.toFixed(1)}%`;
  lines.push(`**Period:** ${period}  `);
  lines.push(`**Assurance:** ${summary.assuranceState}  `);
  lines.push(
    `**Compliance Score:** ${scoreDisplay} — ${scoreLabel(summary.complianceScore, summary.assuranceState)}`
  );
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Events recorded | ${summary.total} |`);
  lines.push(`| Blocked | ${summary.blocked} |`);
  lines.push(`| Warned | ${summary.warned} |`);
  lines.push(`| Bypassed | ${summary.bypassed} |`);
  if (summary.topCategory) {
    lines.push(
      `| Top category | ${summary.topCategory} (${summary.categoryHits[summary.topCategory]}) |`
    );
  }
  lines.push('');

  if (summary.blockedEvents.length > 0) {
    lines.push(`### Blocked actions`);
    lines.push('');
    for (const e of summary.blockedEvents) {
      lines.push(`- ✗ \`${e.path}\` → rule \`${e.rule}\`${e.message ? ` — ${e.message}` : ''}`);
    }
    lines.push('');
  }

  if (summary.bypassedEvents.length > 0) {
    lines.push(`### ⚠ Bypassed checks`);
    lines.push('');
    for (const e of summary.bypassedEvents) {
      lines.push(`- ⚠ \`${e.path}\` → rule \`${e.rule}\` (override recorded at ${e.ts})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatJson(summary: GovernanceSummary, projectName: string, periodLabel: string): string {
  const { period, ...rest } = summary;
  return JSON.stringify(
    { project: projectName, period: periodLabel, summaryPeriod: period, ...rest },
    null,
    2
  );
}

// ── Scan findings summary (from report.json) ─────────────────────────────────

function loadScanSummary(root: string): { findings: number; categories: string[] } | null {
  const p = join(root, '.thesmos', 'report.json');
  if (!existsSync(p)) return null;
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as { findings?: unknown[] };
    const findings = Array.isArray(raw.findings) ? raw.findings : [];
    return { findings: findings.length, categories: [] };
  } catch {
    return null;
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdEval(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const all = flag(flags, 'all');
  if (flags.since !== undefined && flagVal(flags, 'since') === undefined)
    throw new Error('--since requires a duration such as 24h');
  const sinceFlag = flagVal(flags, 'since') ?? '24h';

  const root = process.cwd();

  const configPath = join(root, '.thesmos', 'config.json');
  let projectName = 'Project';
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { project?: string };
      if (typeof cfg?.project === 'string') projectName = cfg.project;
    } catch {
      /* ignore */
    }
  }

  const until = new Date();
  const since = all ? undefined : parseSince(sinceFlag);
  const log = readGovernanceLogResult(root, Number.POSITIVE_INFINITY);
  const events = log.records.filter(
    (e) => !since || (Date.parse(e.ts) >= since.getTime() && Date.parse(e.ts) <= until.getTime())
  );
  let period: string;

  if (all) {
    period = 'All recorded events';
  } else {
    period = `Last ${sinceFlag} (since ${since!.toISOString().slice(0, 19).replace('T', ' ')} UTC)`;
  }

  const runtime = summariseRuntime(root, since, until);
  // A corrupt row has no trustworthy date; do not discard it as outside the window.
  const issues = [...runtime.evidenceIssues];
  if (log.invalidLines.length)
    issues.push(`Governance log: ${log.invalidLines.length} invalid record(s)`);
  if (log.error) issues.push('Governance log: evidence file unreadable');
  const summary = summariseGovernanceLog(events, issues);

  if (json) {
    const payload = JSON.parse(formatJson(summary, projectName, period)) as Record<string, unknown>;
    payload.runtime = runtime;
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else if (markdown) {
    process.stdout.write(formatMarkdown(summary, projectName, period) + '\n');
    process.stdout.write(`### Runtime observability\n\n`);
    process.stdout.write(`| Metric | Value |\n|---|---|\n`);
    process.stdout.write(`| Execution receipts | ${runtime.receipts} |\n`);
    process.stdout.write(`| Agent activity | ${runtime.activityEvents} |\n`);
    process.stdout.write(`| Metrics export | ${runtime.metricsEvents} |\n\n`);
  } else {
    process.stdout.write(formatConsole(summary, projectName, period) + '\n');
    process.stdout.write(formatRuntimeConsole(runtime) + '\n');
  }

  process.exitCode =
    summary.assuranceState === 'FAIL' ||
    summary.assuranceState === 'ERROR' ||
    summary.assuranceState === 'INCOMPLETE' ||
    summary.blocked > 0 ||
    summary.bypassed > 0
      ? 1
      : 0;
}
