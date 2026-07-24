// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos review engine.
 * Pure functions: scan + config + changed files → Finding[].
 * No fs access — all data passed in as arguments.
 *
 * Detection logic lives in each rule's detect() method in rules/registry.ts.
 * runReview is a data-driven loop over the registry — adding a rule to the
 * registry automatically makes it run here.
 */

import type { Finding, ThesmosConfig, ScanResult, ThesmosRule, EngineError, ReviewResult } from './types';
import { THESMOS_RULES, activeRulesForTier } from './rules/registry';
import { applySuppressions, extractSuppressions, type Suppression } from './suppress.js';
import { sortFindings, SEVERITY_EMOJI } from './severity';
import { confidenceTag } from './gate.js';
import { toSarif } from './sarif.js';
import { makeLogger } from './logger.js';

const log = makeLogger('review');

/**
 * Grace margin (in lines) around changed hunks. Context-dependent findings
 * that sit just next to an edit (e.g. a hook moved by an inserted line above)
 * survive; findings deep in untouched code are dropped.
 */
const HUNK_GRACE_LINES = 3;

/**
 * When a ChangedFile carries changedRanges (populated only in --base mode),
 * drop line-numbered findings that fall outside every changed range ±grace.
 * Findings without a line number (file-level: missing lockfile, no-auth route)
 * are kept, as are findings in files without range data — so full-repo scans
 * and explicit-file reviews are unaffected.
 */
function scopeFindingsToChangedRanges(
  findings: Finding[],
  changedFiles: import('./types').ChangedFile[] | undefined
): Finding[] {
  const rangesByFile = new Map<string, Array<{ start: number; end: number }>>();
  for (const cf of changedFiles ?? []) {
    if (cf.changedRanges) rangesByFile.set(cf.path, cf.changedRanges);
  }
  if (rangesByFile.size === 0) return findings;

  return findings.filter((f) => {
    if (typeof f.line !== 'number') return true;
    const ranges = rangesByFile.get(f.file);
    if (!ranges) return true;
    return ranges.some(
      (r) => f.line! >= r.start - HUNK_GRACE_LINES && f.line! <= r.end + HUNK_GRACE_LINES
    );
  });
}

// ── Public input types ─────────────────────────────────────────────────────────

export type { ChangedFile, ReviewResult, EngineError } from './types';

export interface ReviewInput {
  scan: ScanResult;
  config: ThesmosConfig;
  changedFiles?: import('./types').ChangedFile[];
  /** Workspace root passed through to rules that need filesystem checks. */
  root?: string;
}

// ── Category list — derived from registry, never manually maintained ──────────

export const REVIEW_CATEGORIES = THESMOS_RULES.map((r) => r.category);
export type ReviewCategory = string;

// ── Review engine ──────────────────────────────────────────────────────────────

/**
 * Run all registry rules and return sorted findings.
 * Accepts an optional registry override — used in tests to inject mock rules
 * without mutating the global registry.
 */
export function runReview(
  input: ReviewInput,
  registry?: ThesmosRule[]
): ReviewResult {
  // Tier gate: when no explicit registry is injected (tests), the free tier runs
  // only the Essentials set. loadConfig has already resolved input.config.tier.
  const tierRegistry = registry ?? activeRulesForTier(input.config);
  const disabled = new Set(
    (input.config.disabledRules ?? []).map((s) => s.toLowerCase())
  );
  const activeRules = disabled.size === 0
    ? tierRegistry
    : tierRegistry.filter(
        (r) => !disabled.has(r.id.toLowerCase()) && !disabled.has(r.category.toLowerCase())
      );

  const findings: Finding[] = [];
  const engineErrors: EngineError[] = [];
  const scanStart = Date.now();

  for (const rule of activeRules) {
    const t0 = Date.now();
    try {
      // Stamp each finding with its rule's confidence tier so gates and
      // formatters downstream can distinguish proof from heuristic.
      const ruleConfidence = rule.confidence ?? 'high';
      for (const f of rule.detect(input)) {
        findings.push(f.confidence ? f : { ...f, confidence: ruleConfidence });
      }
      const elapsed = Date.now() - t0;
      if (elapsed > 100) log.warn('slow rule', { rule: rule.id, durationMs: elapsed });
    } catch (e) {
      engineErrors.push({
        ruleId: rule.id,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
      log.error('rule detect() threw', {
        rule: rule.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // --base mode: findings must land on (or near) the changed hunks — a 2-line
  // diff must not report the whole file. No-op when no changedRanges present.
  const scoped = scopeFindingsToChangedRanges(findings, input.changedFiles);

  // Inline suppressions: thesmos-disable-next-line comments in changed files
  // remove matching findings. Expired suppressions are ignored by
  // applySuppressions and the finding stays active.
  const suppressions: Suppression[] = (input.changedFiles ?? []).flatMap((cf) =>
    extractSuppressions(cf.content, cf.path)
  );
  const active = suppressions.length > 0
    ? applySuppressions(scoped, suppressions, new Date()).activeFindings
    : scoped;

  log.info('scan complete', {
    files: input.changedFiles?.length ?? 0,
    findings: active.length,
    engineErrors: engineErrors.length,
    outsideHunks: findings.length - scoped.length,
    suppressed: scoped.length - active.length,
    rulesSkipped: engineErrors.length,
    durationMs: Date.now() - scanStart,
  });

  return {
    findings: sortFindings(active),
    engineErrors,
    skippedRuleIds: engineErrors.map((e) => e.ruleId),
  };
}

// ── Output formatters ──────────────────────────────────────────────────────────

/** Render findings as a human-readable console summary. */
export function formatFindingsConsole(
  findings: Finding[],
  projectName = 'Repo',
  title = 'Review'
): string {
  const lines: string[] = [];
  lines.push(`Thesmos ${title} — ${projectName}`);

  if (findings.length === 0) {
    lines.push('');
    lines.push('  ✅  No findings — all checks passed.');
    return lines.join('\n');
  }

  lines.push('');
  for (const f of findings) {
    const emoji = SEVERITY_EMOJI[f.severity];
    const loc = f.line ? `:${f.line}` : '';
    const tag = confidenceTag(f);
    lines.push(`  ${emoji} ${f.severity.padEnd(10)}  ${f.category}${tag ? ` ${tag}` : ''}`);
    lines.push(`     ${f.file}${loc}`);
    lines.push(`     ${f.message}`);
    if (f.suggestion) lines.push(`     → ${f.suggestion}`);
    lines.push('');
  }

  const bySeverity = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(bySeverity)
    .map(([sev, n]) => `${n} ${sev}`)
    .join(', ');
  lines.push(`${findings.length} finding${findings.length === 1 ? '' : 's'} (${summary})`);

  return lines.join('\n');
}

/** Render findings as a Markdown table. */
export function formatFindingsMarkdown(findings: Finding[], projectName = 'Repo'): string {
  if (findings.length === 0) {
    return '## ✅ Thesmos Review — No Findings\n\nAll checks passed.\n';
  }

  const lines: string[] = [
    `## Thesmos Review — ${projectName}`,
    '',
    `| Severity | Category | File | Message |`,
    `|---|---|---|---|`,
  ];

  for (const f of findings) {
    const emoji = SEVERITY_EMOJI[f.severity];
    const loc = f.line ? `:${f.line}` : '';
    const file = `\`${f.file}${loc}\``;
    lines.push(
      `| ${emoji} **${f.severity}** | \`${f.category}\` | ${file} | ${f.message} |`
    );
  }

  lines.push('');
  lines.push(`**${findings.length} finding${findings.length === 1 ? '' : 's'}**`);
  if (findings.some((f) => f.suggestion)) {
    lines.push('');
    lines.push('### Suggestions');
    for (const f of findings.filter((f) => f.suggestion)) {
      lines.push(`- **${f.file}**: ${f.suggestion}`);
    }
  }

  return lines.join('\n') + '\n';
}

/** Render findings as formatted JSON. */
export function formatFindingsJson(findings: Finding[]): string {
  return JSON.stringify({ total: findings.length, findings }, null, 2);
}

/**
 * Render findings as SARIF 2.1.0 — compatible with GitHub Code Scanning,
 * VS Code, JetBrains, and every enterprise SAST dashboard.
 *
 * Delegates to sarif.ts which includes full rule metadata (descriptions, tags,
 * severity) for all rules — not just those that produced findings.
 *
 * Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
 */
export function formatFindingsSarif(findings: Finding[], version = '1.0.0'): string {
  return JSON.stringify(toSarif(THESMOS_RULES, findings, version), null, 2) + '\n';
}
