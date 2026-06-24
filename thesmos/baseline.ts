/**
 * Thesmos Baseline System — lets large existing repos adopt governance gradually.
 *
 * Workflow:
 *   1. thesmos baseline:create  → snapshot all current findings as known debt
 *   2. CI runs thesmos validate  → only NEW findings (not in baseline) fail the build
 *   3. thesmos baseline:update  → add newly accepted debt; remove fixed findings
 *   4. thesmos baseline:report  → show debt, new violations, and resolved entries
 *
 * Fingerprinting:
 *   Each finding is hashed by (category, file, normalizedMessage). Line numbers are
 *   stripped from the message before hashing so the fingerprint survives refactors
 *   that shift line offsets without changing the violation itself.
 *
 * Duplicate handling:
 *   When the same rule fires N times in the same file and their normalized messages
 *   are identical, entries are disambiguated by appending a `:N` suffix so that
 *   count-aware matching works correctly.
 *
 * All functions that compute or compare baseline state are pure — disk I/O is
 * isolated to loadBaseline / saveBaseline so the entire engine is testable without
 * touching the filesystem.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Finding, Severity } from './types';
import { SEVERITY_ORDER } from './severity';

// ── Public constants ──────────────────────────────────────────────────────────

export const BASELINE_PATH = '.thesmos/baseline.json';
export const BASELINE_VERSION = '1' as const;

// ── Public types ──────────────────────────────────────────────────────────────

export interface BaselineEntry {
  /** 16-hex content fingerprint, optionally suffixed `:N` to disambiguate dupes. */
  fingerprint: string;
  ruleCategory: string;
  severity: Severity;
  file: string;
  /** Human-readable message stored for reporting. Not used in fingerprint matching. */
  message: string;
  /** ISO 8601 timestamp when this entry was first recorded. */
  recordedAt: string;
}

export interface Baseline {
  version: typeof BASELINE_VERSION;
  /** ISO 8601 timestamp when the baseline was first created. */
  createdAt: string;
  /** ISO 8601 timestamp when the baseline was last written. */
  updatedAt: string;
  entries: BaselineEntry[];
}

export interface BaselinePartition {
  /** Findings that have NO matching baseline entry — CI gates on these. */
  newFindings: Finding[];
  /** Findings that matched a baseline entry — suppressed from CI exit-code. */
  baselineFindings: Finding[];
  /** Baseline entries with no matching current finding — the team fixed these. */
  resolvedEntries: BaselineEntry[];
}

export interface BaselineUpdateResult {
  updated: Baseline;
  /** Newly added entries (findings that were not in the previous baseline). */
  added: BaselineEntry[];
  /** Entries that were in the baseline but whose finding no longer appears. */
  resolved: BaselineEntry[];
}

// ── Fingerprinting ────────────────────────────────────────────────────────────

/**
 * Normalize a finding message to a stable form that survives line movement.
 * Strips line offsets and counters so the fingerprint doesn't change when
 * surrounding code is added/removed.
 */
function normalizeMessage(message: string): string {
  return message
    .replace(/\bline\s+\d+\b/gi, 'line N')    // "at line 42" → "at line N"
    .replace(/:\s*\d+(?=[^a-z]|$)/g, ': N')   // ":42" suffix → ": N"
    .replace(/\b\d{2,}\b/g, 'N')              // multi-digit numbers → N (keeps single digits)
    .trim()
    .slice(0, 150);
}

/**
 * Compute the 16-hex content fingerprint for a finding.
 * The fingerprint is a function of (category, file, normalizedMessage) only —
 * severity and line number are deliberately excluded for stability.
 */
export function fingerprintFinding(finding: Finding): string {
  const raw = `${finding.category}::${finding.file}::${normalizeMessage(finding.message)}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
}

// ── Entry creation ────────────────────────────────────────────────────────────

/**
 * Build a fingerprint-to-count map from a list of entries.
 * Used internally for count-aware matching.
 */
function countFingerprints(entries: BaselineEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of entries) {
    // Strip any `:N` disambiguation suffix before counting base fingerprints
    const base = e.fingerprint.split(':')[0]!;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return counts;
}

/**
 * Convert a list of findings into baseline entries, ready to be stored.
 * Entries within the same (category, file, normalizedMessage) group are
 * disambiguated by appending `:1`, `:2`, … so the fingerprint remains unique
 * and count-aware matching can round-trip correctly.
 */
export function createBaselineEntries(findings: Finding[], now: Date): BaselineEntry[] {
  const recordedAt = now.toISOString();
  // Count how many times each base fingerprint appears so far
  const seen = new Map<string, number>();
  return findings.map((finding) => {
    const base = fingerprintFinding(finding);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const fingerprint = count === 0 ? base : `${base}:${count}`;
    return {
      fingerprint,
      ruleCategory: finding.category,
      severity: finding.severity,
      file: finding.file,
      message: finding.message,
      recordedAt,
    };
  });
}

// ── Core matching ─────────────────────────────────────────────────────────────

/**
 * Partition current findings into new (not in baseline) and known (in baseline).
 * Also identifies which baseline entries are no longer firing — these are resolved.
 *
 * Matching is count-aware: if the baseline has 3 entries for fingerprint X but
 * the current run produces only 1, 2 entries are considered resolved and 1 is
 * treated as an ongoing baseline finding.
 */
export function partitionFindings(
  currentFindings: Finding[],
  baseline: Baseline
): BaselinePartition {
  // Build a map of base-fingerprint → available count from baseline
  const available = new Map<string, number>();
  for (const entry of baseline.entries) {
    const base = entry.fingerprint.split(':')[0]!;
    available.set(base, (available.get(base) ?? 0) + 1);
  }

  // Count base fingerprints in current findings
  const currentCount = new Map<string, number>();
  for (const finding of currentFindings) {
    const fp = fingerprintFinding(finding);
    currentCount.set(fp, (currentCount.get(fp) ?? 0) + 1);
  }

  // Partition findings
  const consumed = new Map<string, number>();
  const newFindings: Finding[] = [];
  const baselineFindings: Finding[] = [];

  for (const finding of currentFindings) {
    const fp = fingerprintFinding(finding);
    const avail = (available.get(fp) ?? 0) - (consumed.get(fp) ?? 0);
    if (avail > 0) {
      consumed.set(fp, (consumed.get(fp) ?? 0) + 1);
      baselineFindings.push(finding);
    } else {
      newFindings.push(finding);
    }
  }

  // Resolved entries: baseline entries whose fingerprint has fewer current occurrences
  const resolvedEntries: BaselineEntry[] = [];
  const resolvedCounts = new Map<string, number>();
  for (const [fp, baseCount] of available) {
    const curCount = currentCount.get(fp) ?? 0;
    const resolved = Math.max(0, baseCount - curCount);
    if (resolved > 0) resolvedCounts.set(fp, resolved);
  }
  const pickedResolved = new Map<string, number>();
  for (const entry of baseline.entries) {
    const base = entry.fingerprint.split(':')[0]!;
    const need = resolvedCounts.get(base) ?? 0;
    const picked = pickedResolved.get(base) ?? 0;
    if (picked < need) {
      resolvedEntries.push(entry);
      pickedResolved.set(base, picked + 1);
    }
  }

  return { newFindings, baselineFindings, resolvedEntries };
}

// ── Baseline mutation ─────────────────────────────────────────────────────────

/**
 * Create a new baseline from scratch.
 * All current findings are recorded as known debt.
 */
export function createBaseline(findings: Finding[], now: Date): Baseline {
  const ts = now.toISOString();
  return {
    version: BASELINE_VERSION,
    createdAt: ts,
    updatedAt: ts,
    entries: createBaselineEntries(findings, now),
  };
}

/**
 * Update an existing baseline:
 *   - Add entries for findings not already in the baseline (new debt accepted).
 *   - Remove entries for findings that no longer appear (fixed violations).
 *
 * Returns the updated Baseline plus lists of what changed for reporting.
 */
export function updateBaseline(
  existing: Baseline,
  currentFindings: Finding[],
  now: Date
): BaselineUpdateResult {
  const { newFindings, resolvedEntries } = partitionFindings(currentFindings, existing);

  const added = createBaselineEntries(newFindings, now);

  // Remove resolved entries from the existing list (count-aware)
  const toRemoveCounts = new Map<string, number>();
  for (const e of resolvedEntries) {
    const base = e.fingerprint.split(':')[0]!;
    toRemoveCounts.set(base, (toRemoveCounts.get(base) ?? 0) + 1);
  }
  const removedCounts = new Map<string, number>();
  const kept: BaselineEntry[] = [];
  for (const entry of existing.entries) {
    const base = entry.fingerprint.split(':')[0]!;
    const need = toRemoveCounts.get(base) ?? 0;
    const done = removedCounts.get(base) ?? 0;
    if (done < need) {
      removedCounts.set(base, done + 1);
      // skip — this entry is resolved
    } else {
      kept.push(entry);
    }
  }

  const updated: Baseline = {
    ...existing,
    updatedAt: now.toISOString(),
    entries: [...kept, ...added],
  };

  return { updated, added, resolved: resolvedEntries };
}

// ── Serialization ─────────────────────────────────────────────────────────────

/** Sort entries for deterministic output: severity desc, file asc, message asc. */
function sortEntries(entries: BaselineEntry[]): BaselineEntry[] {
  return [...entries].sort((a, b) => {
    const sevA = SEVERITY_ORDER.indexOf(a.severity);
    const sevB = SEVERITY_ORDER.indexOf(b.severity);
    if (sevA !== sevB) return sevA - sevB;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.message.localeCompare(b.message);
  });
}

export function serializeBaseline(baseline: Baseline): string {
  return (
    JSON.stringify(
      { ...baseline, entries: sortEntries(baseline.entries) },
      null,
      2
    ) + '\n'
  );
}

export function parseBaseline(raw: string): Baseline | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed['version'] !== 'string' ||
      !Array.isArray(parsed['entries'])
    ) {
      return null;
    }
    return parsed as unknown as Baseline;
  } catch {
    return null;
  }
}

// ── I/O entry points ──────────────────────────────────────────────────────────

export function loadBaseline(root: string): Baseline | null {
  const absPath = join(root, BASELINE_PATH);
  if (!existsSync(absPath)) return null;
  try {
    return parseBaseline(readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

export function saveBaseline(root: string, baseline: Baseline): void {
  const absPath = join(root, BASELINE_PATH);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, serializeBaseline(baseline), 'utf8');
}

// ── Output formatters ─────────────────────────────────────────────────────────

const SEVERITY_EMOJI: Record<Severity, string> = {
  BLOCKER: '🔴',
  HIGH: '🟠',
  MEDIUM: '🟡',
  LOW: '🔵',
  TECH_DEBT: '⚪',
};

function severityCounts(entries: BaselineEntry[]): string {
  const counts = new Map<Severity, number>();
  for (const e of entries) {
    counts.set(e.severity, (counts.get(e.severity) ?? 0) + 1);
  }
  return SEVERITY_ORDER
    .filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)} ${s}`)
    .join(', ');
}

/**
 * Console-formatted baseline report.
 * Shows: current debt, new violations, and resolved entries.
 */
export function formatBaselineConsole(
  partition: BaselinePartition,
  baseline: Baseline,
  projectName = 'Repo'
): string {
  const lines: string[] = [];
  const SEP = '─'.repeat(56);
  lines.push(`Thesmos Baseline — ${projectName}`);
  lines.push(SEP);

  // ── Baseline debt ────────────────────────────────────────────────────────
  const debtEntries = baseline.entries.filter(
    (e) => !partition.resolvedEntries.includes(e)
  );
  lines.push('');
  lines.push(
    debtEntries.length === 0
      ? '  Baseline Debt  (0 entries — baseline is clean)'
      : `  Baseline Debt  (${debtEntries.length} entr${debtEntries.length === 1 ? 'y' : 'ies'} — ${severityCounts(debtEntries)})`
  );
  lines.push('');

  if (debtEntries.length > 0) {
    const sorted = sortEntries(debtEntries);
    for (const e of sorted) {
      lines.push(
        `  ${SEVERITY_EMOJI[e.severity]}  [${e.ruleCategory}]  ${e.file}`
      );
      lines.push(`       ${e.message.slice(0, 90)}`);
    }
    lines.push('');
  }

  // ── New violations ───────────────────────────────────────────────────────
  lines.push(SEP);
  lines.push('');
  if (partition.newFindings.length === 0) {
    lines.push('  ✅  No new violations — CI will pass.');
  } else {
    lines.push(
      `  🚨  ${partition.newFindings.length} new violation${partition.newFindings.length === 1 ? '' : 's'} (not in baseline) — CI will fail on these:`
    );
    lines.push('');
    for (const f of partition.newFindings) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(`  ${SEVERITY_EMOJI[f.severity]}  [${f.category}]  ${f.file}${loc}`);
      lines.push(`       ${f.message.slice(0, 90)}`);
    }
  }
  lines.push('');

  // ── Resolved ─────────────────────────────────────────────────────────────
  if (partition.resolvedEntries.length > 0) {
    lines.push(SEP);
    lines.push('');
    lines.push(`  ✓  ${partition.resolvedEntries.length} resolved since baseline (no longer detected):`);
    lines.push('');
    for (const e of partition.resolvedEntries) {
      lines.push(`  ✓  [${e.ruleCategory}]  ${e.file}`);
      lines.push(`       ${e.message.slice(0, 90)}`);
    }
    lines.push('');
  }

  lines.push(SEP);
  lines.push(
    `  ${debtEntries.length} baseline  ·  ${partition.newFindings.length} new  ·  ${partition.resolvedEntries.length} resolved`
  );

  return lines.join('\n');
}

/**
 * Markdown baseline report table.
 */
export function formatBaselineMarkdown(
  partition: BaselinePartition,
  baseline: Baseline,
  projectName = 'Repo'
): string {
  const lines: string[] = [];
  lines.push(`## Thesmos Baseline — ${projectName}`);
  lines.push('');

  const newCount = partition.newFindings.length;
  const debtCount = baseline.entries.length - partition.resolvedEntries.length;
  const resolvedCount = partition.resolvedEntries.length;

  if (newCount === 0) {
    lines.push('**✅ No new violations — CI will pass.**');
  } else {
    lines.push(`**🚨 ${newCount} new violation${newCount === 1 ? '' : 's'} — CI will fail.**`);
  }
  lines.push(`> ${debtCount} baseline entries · ${newCount} new · ${resolvedCount} resolved`);
  lines.push('');

  if (newCount > 0) {
    lines.push('### 🚨 New Violations (will fail CI)');
    lines.push('');
    lines.push('| Severity | Category | File | Message |');
    lines.push('|---|---|---|---|');
    for (const f of partition.newFindings) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(
        `| ${SEVERITY_EMOJI[f.severity]} **${f.severity}** | \`${f.category}\` | \`${f.file}${loc}\` | ${f.message} |`
      );
    }
    lines.push('');
  }

  if (debtCount > 0) {
    lines.push('### 📋 Baseline Debt (suppressed from CI)');
    lines.push('');
    lines.push('| Severity | Category | File | Recorded |');
    lines.push('|---|---|---|---|');
    const sorted = sortEntries(
      baseline.entries.filter((e) => !partition.resolvedEntries.includes(e))
    );
    for (const e of sorted) {
      const date = e.recordedAt.split('T')[0];
      lines.push(
        `| ${SEVERITY_EMOJI[e.severity]} ${e.severity} | \`${e.ruleCategory}\` | \`${e.file}\` | ${date} |`
      );
    }
    lines.push('');
  }

  if (resolvedCount > 0) {
    lines.push('### ✅ Resolved Since Baseline');
    lines.push('');
    for (const e of partition.resolvedEntries) {
      lines.push(`- ~~\`[${e.ruleCategory}]\` ${e.file}~~ — fixed`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Machine-readable JSON report.
 */
export function formatBaselineJson(
  partition: BaselinePartition,
  baseline: Baseline
): string {
  return JSON.stringify(
    {
      clean: partition.newFindings.length === 0,
      baselineEntries: baseline.entries.length,
      newViolations: partition.newFindings.length,
      resolved: partition.resolvedEntries.length,
      newFindings: partition.newFindings,
      baselineFindings: partition.baselineFindings,
      resolvedEntries: partition.resolvedEntries,
    },
    null,
    2
  );
}
