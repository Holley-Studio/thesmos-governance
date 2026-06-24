/**
 * thesmos eval — governance visibility report
 *
 * Reads .thesmos/governance.log.jsonl + .thesmos/report.json and produces
 * a human-readable (or machine-readable) governance evaluation report.
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
  readGovernanceLog,
  readGovernanceLogSince,
  summariseGovernanceLog,
  type GovernanceSummary,
} from '../../governance-log.ts';

// ── Duration parser ───────────────────────────────────────────────────────────

function parseSince(val: string): Date {
  const m = /^(\d+)(d|h|m)$/.exec(val);
  if (!m) throw new Error(`Invalid --since value: ${val}. Use: 24h, 7d, 30d`);
  const n = parseInt(m[1]!, 10);
  const unit = m[2]!;
  const now = Date.now();
  const ms =
    unit === 'd' ? n * 86400000 :
    unit === 'h' ? n * 3600000  :
    n * 60000;
  return new Date(now - ms);
}

// ── Formatters ────────────────────────────────────────────────────────────────

function scoreBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function scoreLabel(score: number): string {
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

  const scoreStr = summary.complianceScore.toFixed(1) + '%';
  lines.push(`  Compliance Score    ${scoreStr.padStart(6)}  [${scoreBar(summary.complianceScore)}]  ${scoreLabel(summary.complianceScore)}`);
  lines.push('');
  lines.push(`  Events recorded     ${String(summary.total).padStart(6)}`);
  lines.push(`  Rules fired         ${String(summary.blocked + summary.warned + summary.passed).padStart(6)}`);
  lines.push(`  Blocked             ${String(summary.blocked).padStart(6)}`);
  lines.push(`  Warned              ${String(summary.warned).padStart(6)}`);
  lines.push(`  Bypassed            ${String(summary.bypassed).padStart(6)}`);
  lines.push('');

  if (summary.topCategory) {
    lines.push(`  Top category        ${summary.topCategory} (${summary.categoryHits[summary.topCategory]} events)`);
  }
  if (summary.topRule) {
    lines.push(`  Top rule            ${summary.topRule} (${summary.ruleHits[summary.topRule]} fires)`);
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
      lines.push(`    ... and ${summary.blockedEvents.length - 10} more. Use --all or --json for full list.`);
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

  if (summary.total === 0) {
    lines.push('  No governance events recorded in this period.');
    lines.push('  Governance logging activates via the MCP server or CI scan hooks.');
    lines.push('  Run: thesmos mcp:install  to enable real-time enforcement logging.');
    lines.push('');
  }

  return lines.join('\n');
}

function formatMarkdown(summary: GovernanceSummary, projectName: string, period: string): string {
  const lines: string[] = [];

  lines.push(`## 🔱 Thesmos Governance Report — ${projectName}`);
  lines.push('');
  lines.push(`**Period:** ${period}  `);
  lines.push(`**Compliance Score:** ${summary.complianceScore.toFixed(1)}% — ${scoreLabel(summary.complianceScore)}`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Events recorded | ${summary.total} |`);
  lines.push(`| Blocked | ${summary.blocked} |`);
  lines.push(`| Warned | ${summary.warned} |`);
  lines.push(`| Bypassed | ${summary.bypassed} |`);
  if (summary.topCategory) {
    lines.push(`| Top category | ${summary.topCategory} (${summary.categoryHits[summary.topCategory]}) |`);
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

function formatJson(summary: GovernanceSummary, projectName: string, period: string): string {
  return JSON.stringify({ project: projectName, period, ...summary }, null, 2);
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
  const sinceFlag = flagVal(flags, 'since') ?? '24h';

  const root = process.cwd();

  const configPath = join(root, '.thesmos', 'config.json');
  let projectName = 'Project';
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8')) as { project?: string };
      projectName = cfg.project ?? projectName;
    } catch { /* ignore */ }
  }

  let events;
  let period: string;

  if (all) {
    events = readGovernanceLog(root, 100000);
    period = 'All recorded events';
  } else {
    const since = parseSince(sinceFlag);
    events = readGovernanceLogSince(root, since);
    period = `Last ${sinceFlag} (since ${since.toISOString().slice(0, 19).replace('T', ' ')} UTC)`;
  }

  const summary = summariseGovernanceLog(events);

  if (json) {
    process.stdout.write(formatJson(summary, projectName, period) + '\n');
  } else if (markdown) {
    process.stdout.write(formatMarkdown(summary, projectName, period) + '\n');
  } else {
    process.stdout.write(formatConsole(summary, projectName, period) + '\n');
  }

  if (summary.blocked > 0 || summary.bypassed > 0) {
    process.exitCode = 1;
  }
}
