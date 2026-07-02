// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Watch Mode — real-time governance feedback during development.
 *
 * Uses Node.js native fs.watch (no external dependencies).
 * Debounces rapid file changes (default 400ms) then re-runs review on changed files.
 * Prints a diff of new vs. resolved findings on each update.
 *
 * Design:
 * - Pure helpers for diff computation and output formatting
 * - I/O isolated to startWatcher()
 * - Returns a stop() function (no global state)
 */

import { watch, readFileSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { ThesmosConfig, Finding, ScanResult } from './types.js';
import { runReview } from './review.js';
import { loadReport } from './report.js';
import { SEVERITY_ORDER, SEVERITY_EMOJI } from './severity.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WatchOptions {
  /** File extensions to watch (default: .ts .tsx .js .jsx .mjs .cjs). */
  extensions?: string[];
  /** Debounce delay in ms (default: 400). */
  debounceMs?: number;
  /** Only show findings at or above this severity (default: all). */
  minSeverity?: string;
  /** Clear the terminal on each update (default: false). */
  clearOnUpdate?: boolean;
  /** Called with findings after each update (for testing). */
  onUpdate?: (findings: Finding[], changed: string[]) => void;
}

export interface WatchFindingDiff {
  newFindings: Finding[];
  resolvedFindings: Finding[];
  unchanged: Finding[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

const WATCHED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']);

/** Returns true if a file path should trigger a review. */
export function shouldWatchFile(filePath: string, extensions: Set<string>): boolean {
  return extensions.has(extname(filePath));
}

/** Fingerprint a finding for change detection (category + file + message). */
export function fingerprintFinding(f: Finding): string {
  return `${f.category}|${f.file}|${f.message}`;
}

/** Diff two finding sets: what's new, what's resolved, what's unchanged. */
export function diffFindings(prev: Finding[], next: Finding[]): WatchFindingDiff {
  const prevSet = new Map(prev.map((f) => [fingerprintFinding(f), f]));
  const nextSet = new Map(next.map((f) => [fingerprintFinding(f), f]));

  const newFindings      = next.filter((f) => !prevSet.has(fingerprintFinding(f)));
  const resolvedFindings = prev.filter((f) => !nextSet.has(fingerprintFinding(f)));
  const unchanged        = next.filter((f) =>  prevSet.has(fingerprintFinding(f)));

  return { newFindings, resolvedFindings, unchanged };
}

/** Sort findings worst-first using SEVERITY_ORDER. */
export function sortFindingsByWorst(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

// ── Formatting ────────────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';

function formatFinding(f: Finding, prefix: string, color: string): string {
  const emoji = SEVERITY_EMOJI[f.severity] ?? '•';
  const loc   = f.line ? `:${f.line}` : '';
  const lines = [
    `${color}${prefix} ${emoji} ${f.severity}${RESET}  ${f.file}${loc}`,
    `     ${f.message}`,
  ];
  if (f.suggestion) lines.push(`     ${DIM}→ ${f.suggestion}${RESET}`);
  return lines.join('\n');
}

/** Format the watch update output for console display. */
export function formatWatchUpdate(
  diff: WatchFindingDiff,
  allFindings: Finding[],
  changedFiles: string[],
  timestamp: string,
): string {
  const lines: string[] = [];

  lines.push(`\n${DIM}─────────────────────────────────────── ${timestamp} ───${RESET}`);

  if (changedFiles.length) {
    lines.push(`${DIM}Changed: ${changedFiles.join(', ')}${RESET}`);
  }

  if (diff.newFindings.length === 0 && diff.resolvedFindings.length === 0) {
    lines.push(`${GREEN}${BOLD}✓ No new findings${RESET}  ${allFindings.length} total`);
    return lines.join('\n');
  }

  if (diff.newFindings.length) {
    lines.push(`\n${RED}${BOLD}+ ${diff.newFindings.length} new finding${diff.newFindings.length === 1 ? '' : 's'}${RESET}`);
    for (const f of sortFindingsByWorst(diff.newFindings)) {
      lines.push(formatFinding(f, '+', RED));
    }
  }

  if (diff.resolvedFindings.length) {
    lines.push(`\n${GREEN}${BOLD}− ${diff.resolvedFindings.length} resolved${RESET}`);
    for (const f of diff.resolvedFindings) {
      lines.push(formatFinding(f, '−', GREEN));
    }
  }

  const total = allFindings.length;
  const blockers = allFindings.filter((f) => f.severity === 'BLOCKER').length;
  const high     = allFindings.filter((f) => f.severity === 'HIGH').length;

  const summary = [
    `${total} total`,
    blockers ? `${RED}${blockers} BLOCKER${RESET}` : '',
    high     ? `${YELLOW}${high} HIGH${RESET}` : '',
  ].filter(Boolean).join('  ');

  lines.push(`\n${DIM}─── ${summary} ${'─'.repeat(Math.max(0, 40 - summary.replace(/\x1b\[[0-9;]*m/g, '').length))}${RESET}`);

  return lines.join('\n');
}

// ── I/O entry point ───────────────────────────────────────────────────────────

/**
 * Start watching a directory for changes and re-running review.
 * Returns a stop() function that terminates the watcher.
 */
export function startWatcher(
  root: string,
  config: ThesmosConfig,
  opts: WatchOptions = {},
): () => void {
  const extensions  = new Set(opts.extensions ?? [...WATCHED_EXTENSIONS]);
  const debounceMs  = opts.debounceMs  ?? 400;
  const clearOnUpdate = opts.clearOnUpdate ?? false;

  let prevFindings: Finding[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const changedPaths = new Set<string>();

  function runUpdate(): void {
    const changedList = [...changedPaths];
    changedPaths.clear();

    // Load the latest scan (may have been updated by thesmos scan)
    const scan: ScanResult | null = loadReport(root);
    if (!scan) {
      process.stdout.write(
        `${YELLOW}No .thesmos/report.json found. Run: thesmos scan${RESET}\n`,
      );
      return;
    }

    // Build ChangedFile list from disk
    const changedFiles = changedList
      .map((p) => {
        const absPath = join(root, p);
        if (!existsSync(absPath)) return null;
        try {
          return { path: p, content: readFileSync(absPath, 'utf8') };
        } catch {
          return null;
        }
      })
      .filter((f): f is { path: string; content: string } => f !== null);

    if (changedFiles.length === 0) return;

    const allFindings = runReview({ scan, config, changedFiles });
    const diff = diffFindings(prevFindings, allFindings);
    prevFindings = allFindings;

    if (clearOnUpdate) process.stdout.write('\x1Bc');

    const ts = new Date().toLocaleTimeString();
    process.stdout.write(formatWatchUpdate(diff, allFindings, changedList, ts) + '\n');

    opts.onUpdate?.(allFindings, changedList);
  }

  function handleChange(filename: string | null): void {
    if (!filename) return;
    const rel = relative(root, join(root, filename));
    if (!shouldWatchFile(rel, extensions)) return;
    // Skip .thesmos/ and node_modules
    if (rel.startsWith('.thesmos') || rel.includes('node_modules') || rel.startsWith('dist')) return;

    changedPaths.add(rel);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runUpdate, debounceMs);
  }

  process.stdout.write(`${BOLD}Thesmos watch${RESET} — watching ${root}\n`);
  process.stdout.write(`${DIM}Ctrl+C to stop${RESET}\n\n`);

  const watcher = watch(root, { recursive: true }, (_, filename) => {
    handleChange(filename);
  });

  watcher.on('error', (err) => {
    process.stderr.write(`[thesmos watch] error: ${err.message}\n`);
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}
