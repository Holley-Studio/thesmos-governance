// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos health — governance health score (0–100).
 *
 * Synthesises findings, drift, suppressions, and report freshness
 * into a single score and grade so teams can track governance health at a glance.
 *
 * Flags:
 *   --json       machine-readable JSON
 *   --markdown   markdown output
 *   --fail       exit 1 if score drops below --threshold (default 60)
 *   --threshold=<n>  score threshold for --fail (default 60)
 *   --trend      show PR score trend from .thesmos/pr-history.jsonl
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  computeHealthForRoot,
  formatHealthConsole,
  formatHealthMarkdown,
  formatHealthJson,
} from '../../health.ts';

interface PrHistoryEntry {
  ts: string;
  repo: string;
  pr: number;
  sha: string;
  score: number;
  findings: number;
  blockers: number;
  highs: number;
}

function loadPrHistory(root: string): PrHistoryEntry[] {
  const historyPath = join(root, '.thesmos', 'pr-history.jsonl');
  if (!existsSync(historyPath)) return [];
  return readFileSync(historyPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as PrHistoryEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is PrHistoryEntry => e !== null);
}

function scoreEmoji(score: number): string {
  if (score >= 90) return '🟢';
  if (score >= 70) return '🟡';
  if (score >= 50) return '🟠';
  return '🔴';
}

function formatTrend(entries: PrHistoryEntry[]): string {
  if (entries.length === 0) {
    return 'No PR history found. Run the Thesmos PR Review Action to start tracking.';
  }

  const last10 = entries.slice(-10).reverse();
  const lines: string[] = ['── PR Score Trend (last 10 PRs) ─────────────────────'];

  for (const e of last10) {
    const date = new Date(e.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const bar = '█'.repeat(Math.floor(e.score / 10)) + '░'.repeat(10 - Math.floor(e.score / 10));
    lines.push(`  PR #${e.pr}  ${scoreEmoji(e.score)} ${String(e.score).padStart(3)}/100  ${bar}  ${date}`);
  }

  if (last10.length >= 2) {
    const newest = last10[0]!.score;
    const oldest = last10[last10.length - 1]!.score;
    const delta = newest - oldest;
    const direction = delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : '→ no change';
    lines.push('');
    lines.push(`  Trend over ${last10.length} PRs: ${direction} pts`);
  }

  return lines.join('\n');
}

function badgeColor(score: number): string {
  if (score >= 90) return 'brightgreen';
  if (score >= 75) return 'green';
  if (score >= 60) return 'yellow';
  if (score >= 40) return 'orange';
  return 'red';
}

export async function cmdHealth(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const badge = flag(flags, 'badge');
  const trend = flag(flags, 'trend');
  const fail = flag(flags, 'fail');
  const thresholdStr = flagVal(flags, 'threshold');
  const threshold = thresholdStr ? parseInt(thresholdStr, 10) : 60;

  if (trend) {
    const entries = loadPrHistory(root);
    if (json) {
      process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    } else {
      console.log(formatTrend(entries));
    }
    return;
  }

  const health = computeHealthForRoot(root, config);

  if (badge) {
    const color = badgeColor(health.score);
    const label = encodeURIComponent(`thesmos score`);
    const value = encodeURIComponent(`${health.score}%2F100`);
    process.stdout.write(`![Thesmos Score](https://img.shields.io/badge/${label}-${value}-${color})\n`);
    return;
  }

  if (json) {
    process.stdout.write(formatHealthJson(health) + '\n');
  } else if (markdown) {
    process.stdout.write(formatHealthMarkdown(health, config.project) + '\n');
  } else {
    console.log(formatHealthConsole(health, config.project));
  }

  if (fail && health.score < threshold) {
    if (!json && !markdown) {
      process.stderr.write(`\nHealth score ${health.score} is below threshold ${threshold} — failing CI\n`);
    }
    process.exit(1);
  }
}
