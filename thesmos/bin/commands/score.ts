// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos score — governance maturity badge
 *
 * Produces a numeric score (0–100) representing governance coverage:
 *   - Health score (from existing health engine)    weight 40%
 *   - Compliance score (from governance.log.jsonl)  weight 40%
 *   - Eval coverage (log non-empty)                 weight 20%
 *
 * Generates a shields.io badge URL for README embedding.
 *
 * Usage:
 *   thesmos score                 Print score + badge URL to stdout
 *   thesmos score --json          Machine-readable JSON
 *   thesmos score --badge         Print only the Markdown badge snippet
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, flag } from '../lib/args.ts';
import { loadConfig, CONFIG_DEFAULTS } from '../../config.js';
import { computeHealthForRoot } from '../../health.js';
import { readGovernanceLog, summariseGovernanceLog } from '../../governance-log.js';

// ── Score computation ──────────────────────────────────────────────────────────

interface ThesmosScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  components: {
    health: number;
    compliance: number;
    coverage: number;
    assuranceState: 'PASS' | 'FAIL' | 'INCOMPLETE' | 'ERROR';
  };
  badgeUrl: string;
  badgeMarkdown: string;
}

function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function badgeColor(score: number): string {
  if (score >= 90) return 'brightgreen';
  if (score >= 80) return 'green';
  if (score >= 70) return 'yellow';
  if (score >= 60) return 'orange';
  return 'red';
}

function computeScore(root: string): ThesmosScore {
  const config = (() => { try { return loadConfig(root); } catch { return CONFIG_DEFAULTS; } })();

  const health = computeHealthForRoot(root, config);
  const healthScore = health.score;

  const events = readGovernanceLog(root, 10000);
  const summary = summariseGovernanceLog(events);
  // Empty governance log → 0 contribution (not a fake 100%).
  const complianceScore = summary.complianceScore ?? 0;

  const coverageScore = events.length > 0 ? 100 : 0;

  const score = Math.round(
    healthScore * 0.4 +
    complianceScore * 0.4 +
    coverageScore * 0.2,
  );

  const grade = gradeFromScore(score);
  const color = badgeColor(score);

  const label = encodeURIComponent('thesmos score');
  const value = encodeURIComponent(`${score}%`);
  const badgeUrl = `https://img.shields.io/badge/${label}-${value}-${color}`;
  const badgeMarkdown = `[![Thesmos Score](${badgeUrl})](https://holley.studio/thesmos)`;

  return {
    score,
    grade,
    components: {
      health: healthScore,
      compliance: complianceScore,
      coverage: coverageScore,
      assuranceState: summary.assuranceState,
    },
    badgeUrl,
    badgeMarkdown,
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdScore(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const badgeOnly = flag(flags, 'badge');

  const root = process.cwd();
  const result = computeScore(root);

  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  if (badgeOnly) {
    process.stdout.write(result.badgeMarkdown + '\n');
    return;
  }

  const SEP = '─'.repeat(56);
  const lines = [
    '',
    `  Thesmos Governance Score`,
    `  ${SEP}`,
    '',
    `  Overall score       ${String(result.score).padStart(4)}%  (${result.grade})`,
    '',
    `  Health coverage     ${String(result.components.health).padStart(4)}%  (governance scan quality)`,
    `  Compliance          ${String(Math.round(result.components.compliance)).padStart(4)}%  (MCP + scan enforcement)`,
    `  Eval coverage       ${String(result.components.coverage).padStart(4)}%  (governance log active)`,
    '',
    `  Badge (paste into README.md):`,
    `  ${result.badgeMarkdown}`,
    '',
  ];

  if (result.components.coverage === 0) {
    lines.splice(-1, 0,
      `  Tip: Run thesmos mcp:install to enable real-time enforcement logging`,
      `       and unlock the full compliance score component.`,
      '',
    );
  }

  process.stdout.write(lines.join('\n') + '\n');
}
