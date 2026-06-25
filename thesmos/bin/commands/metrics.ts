// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos metrics — local-first governance analytics.
 *
 * Computes and displays governance metrics from existing Thesmos artifacts.
 * No telemetry. No network. All data stays local.
 *
 * Flags:
 *   --json            machine-readable JSON
 *   --markdown        markdown output
 *   --record          append a snapshot to .thesmos/metrics-history.jsonl
 *   --history         show trend from metrics-history.jsonl
 *   --history=<n>     show last n snapshots (default: 10)
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  collectMetricsForRoot,
  toMetricsSnapshot,
  appendMetricsSnapshot,
  loadMetricsHistory,
  formatMetricsConsole,
  formatMetricsMarkdown,
  formatMetricsJson,
} from '../../metrics.ts';
import type { MetricsSnapshot } from '../../metrics.ts';

function formatHistoryConsole(history: MetricsSnapshot[], projectName: string): string {
  const lines: string[] = [''];
  const SEP = '─'.repeat(72);
  lines.push(`  Thesmos Metrics History — ${projectName}`);
  lines.push(SEP);
  if (history.length === 0) {
    lines.push('  No snapshots yet. Run: thesmos metrics --record');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`  ${'Date'.padEnd(24)} ${'New'.padStart(4)} ${'Base'.padStart(5)} ${'Drift'.padStart(6)} ${'Agents'.padStart(7)} ${'Skills'.padStart(7)}`);
  lines.push(`  ${'─'.repeat(24)} ${'─'.repeat(4)} ${'─'.repeat(5)} ${'─'.repeat(6)} ${'─'.repeat(7)} ${'─'.repeat(7)}`);
  for (const snap of history) {
    const date = snap.recordedAt.slice(0, 19).replace('T', ' ');
    const newF = String(snap.newFindings).padStart(4);
    const base = String(snap.baselineFindings).padStart(5);
    const drift = String(snap.driftEvents).padStart(6);
    const agents = String(snap.agentCount).padStart(7);
    const skills = String(snap.skillCount).padStart(7);
    lines.push(`  ${date.padEnd(24)} ${newF} ${base} ${drift} ${agents} ${skills}`);
  }
  lines.push('');
  // Trend summary
  if (history.length >= 2) {
    const first = history[0]!;
    const last = history[history.length - 1]!;
    const delta = last.newFindings - first.newFindings;
    const arrow = delta < 0 ? '↓' : delta > 0 ? '↑' : '→';
    lines.push(`  Trend: new findings ${arrow} ${Math.abs(delta)} over ${history.length} snapshots`);
  }
  lines.push('');
  return lines.join('\n');
}

function formatHistoryJson(history: MetricsSnapshot[]): string {
  return JSON.stringify({ count: history.length, history }, null, 2);
}

export async function cmdMetrics(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const record = flag(flags, 'record');
  const historyFlag = flagVal(flags, 'history');
  const showHistory = historyFlag !== undefined || flags['history'] === true;
  const historyLimit = historyFlag ? parseInt(historyFlag, 10) : 10;

  if (showHistory) {
    const rawHistory = loadMetricsHistory(root);
    const history = rawHistory.slice(-historyLimit);
    if (json) {
      process.stdout.write(formatHistoryJson(history) + '\n');
    } else {
      console.log(formatHistoryConsole(history, config.project));
    }
    return;
  }

  const metrics = collectMetricsForRoot(root, config);

  if (record) {
    const snapshot = toMetricsSnapshot(metrics);
    appendMetricsSnapshot(root, snapshot);
    process.stderr.write(`Snapshot recorded to .thesmos/metrics-history.jsonl\n`);
  }

  if (json) {
    process.stdout.write(formatMetricsJson(metrics) + '\n');
    return;
  }

  if (markdown) {
    process.stdout.write(formatMetricsMarkdown(metrics, config.project) + '\n');
    return;
  }

  console.log(formatMetricsConsole(metrics, config.project));
}
