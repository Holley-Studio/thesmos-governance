// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos diff — compare stored findings baseline against current scan.
 *
 * Loads findings from a previous scan (stored as a JSON file) and diffs them
 * against the current review output to show what's new vs. resolved.
 *
 * Flags:
 *   --baseline=<path>   Path to the baseline findings JSON (default: .thesmos/findings.json)
 *   --all               Review all files, not just changed ones
 *   --base=<branch>     Only check files changed vs. <branch> (overrides --all)
 *   --fail-on=<sev>     Exit 1 if any new findings match this severity (default: BLOCKER)
 *   --json              Machine-readable JSON output
 *   --save              Write current findings to baseline file after diffing
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { getChangedFiles } from '../lib/git.ts';
import { loadReport } from '../lib/report.ts';
import { runReview } from '../../review.ts';
import { diffFindings, fingerprintFinding } from '../../watcher.ts';
import { getActiveRules } from '../../packs.ts';
import type { Finding, Severity } from '../../types.ts';

// ── ANSI colour helpers ────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

const SEVERITY_EMOJI: Record<string, string> = {
  BLOCKER:   '🔴',
  HIGH:      '🟠',
  MEDIUM:    '🟡',
  LOW:       '🔵',
  TECH_DEBT: '⚪',
};

// ── Pure formatters (exported for tests) ─────────────────────────────────────

export interface DiffResult {
  newFindings: Finding[];
  resolvedFindings: Finding[];
  unchanged: Finding[];
}

/** Load baseline findings from a JSON file. Returns [] if the file is absent or unreadable. */
export function loadBaselineFindings(path: string): Finding[] {
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    // Accept either { findings: Finding[] } envelope or Finding[] directly
    if (Array.isArray(raw)) return raw as Finding[];
    if (
      raw !== null &&
      typeof raw === 'object' &&
      Array.isArray((raw as Record<string, unknown>)['findings'])
    ) {
      return (raw as { findings: Finding[] }).findings;
    }
    return [];
  } catch {
    return [];
  }
}

/** Format a single finding for diff output. */
export function formatDiffFinding(f: Finding, prefix: string, color: string): string {
  const emoji = SEVERITY_EMOJI[f.severity] ?? '•';
  const loc   = f.line ? `:${f.line}` : '';
  const lines = [
    `  ${color}${BOLD}${prefix}${RESET} ${emoji} ${color}${f.severity}${RESET}  ${f.file}${loc}`,
    `       ${f.message}`,
  ];
  if (f.suggestion) lines.push(`       ${DIM}→ ${f.suggestion}${RESET}`);
  return lines.join('\n');
}

/** Render the full diff as a human-readable console string. */
export function formatDiffConsole(
  diff: DiffResult,
  baselinePath: string,
): string {
  const lines: string[] = [];

  lines.push(`\n${BOLD}Thesmos Diff${RESET}  ${DIM}(baseline: ${baselinePath})${RESET}\n`);

  if (diff.newFindings.length === 0 && diff.resolvedFindings.length === 0) {
    lines.push(`${GREEN}${BOLD}✓ No changes${RESET}  ${diff.unchanged.length} finding${diff.unchanged.length === 1 ? '' : 's'} unchanged`);
    return lines.join('\n');
  }

  if (diff.newFindings.length > 0) {
    lines.push(`${RED}${BOLD}+ ${diff.newFindings.length} new finding${diff.newFindings.length === 1 ? '' : 's'}${RESET}`);
    for (const f of diff.newFindings) {
      lines.push(formatDiffFinding(f, 'NEW', RED));
    }
    lines.push('');
  }

  if (diff.resolvedFindings.length > 0) {
    lines.push(`${GREEN}${BOLD}− ${diff.resolvedFindings.length} resolved${RESET}`);
    for (const f of diff.resolvedFindings) {
      lines.push(formatDiffFinding(f, 'FIX', GREEN));
    }
    lines.push('');
  }

  const newBlockers = diff.newFindings.filter((f) => f.severity === 'BLOCKER').length;
  const newHigh     = diff.newFindings.filter((f) => f.severity === 'HIGH').length;

  const parts = [
    `${RED}${diff.newFindings.length} new${RESET}`,
    `${GREEN}${diff.resolvedFindings.length} resolved${RESET}`,
    diff.unchanged.length > 0 ? `${DIM}${diff.unchanged.length} unchanged${RESET}` : '',
  ].filter(Boolean);
  lines.push(`${DIM}─────${RESET}  ` + parts.join('  '));

  if (newBlockers > 0) {
    lines.push(`${RED}${BOLD}  ${newBlockers} BLOCKER${newBlockers === 1 ? '' : 'S'} introduced${RESET}`);
  } else if (newHigh > 0) {
    lines.push(`${YELLOW}  ${newHigh} HIGH finding${newHigh === 1 ? '' : 's'} introduced${RESET}`);
  }

  return lines.join('\n');
}

/** Render the diff as machine-readable JSON. */
export function formatDiffJson(diff: DiffResult): string {
  return JSON.stringify(
    {
      newFindings:      diff.newFindings,
      resolvedFindings: diff.resolvedFindings,
      unchanged:        diff.unchanged.length,
      summary: {
        new:      diff.newFindings.length,
        resolved: diff.resolvedFindings.length,
        unchanged: diff.unchanged.length,
      },
    },
    null,
    2,
  ) + '\n';
}

/**
 * Determine whether any new finding matches the fail-on severity threshold.
 * `failOn` is a single severity label, e.g. "BLOCKER" or "HIGH".
 * Returns true when a new finding is AT LEAST as severe as `failOn`.
 */
export function shouldFailDiff(newFindings: Finding[], failOn: string): boolean {
  const SEVERITY_ORDER: Severity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];
  const threshold = SEVERITY_ORDER.indexOf(failOn as Severity);
  if (threshold === -1) return false; // unknown level → never fail
  return newFindings.some((f) => {
    const idx = SEVERITY_ORDER.indexOf(f.severity);
    return idx !== -1 && idx <= threshold;
  });
}

// ── Default baseline path ────────────────────────────────────────────────────

export const DEFAULT_BASELINE_FILENAME = '.thesmos/findings.json';

// ── I/O command ───────────────────────────────────────────────────────────────

export async function cmdDiff(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags, positionals } = parseArgs(argv);

  const json      = flag(flags, 'json');
  const saveFlag  = flag(flags, 'save');
  const allFiles  = flag(flags, 'all');
  const base      = flagVal(flags, 'base');
  const failOn    = (flagVal(flags, 'fail-on') ?? 'BLOCKER').toUpperCase();
  const baselinePath = join(
    root,
    flagVal(flags, 'baseline') ?? DEFAULT_BASELINE_FILENAME,
  );

  // ── Load baseline findings ───────────────────────────────────────────────

  const baselineExists = existsSync(baselinePath);
  const baselineFindings = loadBaselineFindings(baselinePath);

  if (!baselineExists) {
    process.stdout.write(
      `No baseline file found at ${baselinePath}\n` +
      `Run 'thesmos scan' then 'thesmos diff --save' to create a baseline.\n`,
    );
    process.exit(0);
    return;
  }

  // ── Run current review ───────────────────────────────────────────────────

  const scan = loadReport(root);
  if (!scan) {
    process.stderr.write(
      'thesmos diff: .thesmos/report.json not found — run thesmos scan first\n',
    );
    process.exit(1);
    return;
  }

  let changedFiles;
  if (positionals.length > 0) {
    // Explicit file list supplied on command line — not imported here to keep
    // the command file lean; we delegate to the same helper validate uses.
    const { readFilesFromPaths } = await import('../lib/git.ts');
    changedFiles = readFilesFromPaths(root, positionals, config.reviewIgnorePaths ?? []);
  } else if (base) {
    changedFiles = getChangedFiles(root, base, config.ignoredFolders ?? [], config.reviewIgnorePaths ?? []);
  } else if (!allFiles) {
    // Default: scan-based checks only (no per-file content)
    changedFiles = undefined;
  }

  const registry = await getActiveRules(root);
  const { findings: currentFindings } = runReview({ scan, config, changedFiles }, registry);

  // ── Diff ─────────────────────────────────────────────────────────────────

  const diff = diffFindings(baselineFindings, currentFindings);

  // ── Optionally save new baseline ─────────────────────────────────────────

  if (saveFlag) {
    const dir = dirname(baselinePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(
      baselinePath,
      JSON.stringify({ findings: currentFindings }, null, 2) + '\n',
      'utf8',
    );
    if (!json) {
      process.stdout.write(`Baseline updated: ${baselinePath}\n`);
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────

  if (json) {
    process.stdout.write(formatDiffJson(diff));
    process.exit(shouldFailDiff(diff.newFindings, failOn) ? 1 : 0);
    return;
  }

  console.log(formatDiffConsole(diff, baselinePath));

  const exitCode = shouldFailDiff(diff.newFindings, failOn) ? 1 : 0;
  if (exitCode === 1) {
    process.stderr.write(
      `\nerror: new ${failOn} findings detected — resolve before merging\n`,
    );
  }
  process.exit(exitCode);
}

// Re-export fingerprintFinding so tests can verify identity logic without
// importing watcher.ts separately.
export { fingerprintFinding };
