/**
 * Prometheus review engine.
 * Pure functions: scan + config + changed files → Finding[].
 * No fs access — all data passed in as arguments.
 *
 * Detection logic lives in each rule's detect() method in rules/registry.ts.
 * runReview is a data-driven loop over the registry — adding a rule to the
 * registry automatically makes it run here.
 */

import type { Finding, ThesmosConfig, ScanResult } from './types';
import { PROMETHEUS_RULES } from './rules/registry';
import { sortFindings, SEVERITY_EMOJI } from './severity';
import { toSarif } from './sarif.js';
import { makeLogger } from './logger.js';

const log = makeLogger('review');

// ── Public input types ─────────────────────────────────────────────────────────

export type { ChangedFile } from './types';

export interface ReviewInput {
  scan: ScanResult;
  config: ThesmosConfig;
  changedFiles?: import('./types').ChangedFile[];
}

// ── Category list — derived from registry, never manually maintained ──────────

export const REVIEW_CATEGORIES = PROMETHEUS_RULES.map((r) => r.category);
export type ReviewCategory = string;

// ── Review engine ──────────────────────────────────────────────────────────────

/**
 * Run all registry rules and return sorted findings.
 * Accepts an optional registry override — used in tests to inject mock rules
 * without mutating the global registry.
 */
export function runReview(
  input: ReviewInput,
  registry = PROMETHEUS_RULES
): Finding[] {
  const disabled = new Set(
    (input.config.disabledRules ?? []).map((s) => s.toLowerCase())
  );
  const activeRules = disabled.size === 0
    ? registry
    : registry.filter(
        (r) => !disabled.has(r.id.toLowerCase()) && !disabled.has(r.category.toLowerCase())
      );

  const findings: Finding[] = [];
  let rulesSkipped = 0;
  const scanStart = Date.now();

  for (const rule of activeRules) {
    const t0 = Date.now();
    try {
      findings.push(...rule.detect(input));
      const elapsed = Date.now() - t0;
      if (elapsed > 100) log.warn('slow rule', { rule: rule.id, durationMs: elapsed });
    } catch (e) {
      rulesSkipped++;
      log.error('rule detect() threw', {
        rule: rule.id,
        error: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      });
    }
  }

  log.info('scan complete', {
    files: input.changedFiles?.length ?? 0,
    findings: findings.length,
    rulesSkipped,
    durationMs: Date.now() - scanStart,
  });

  return sortFindings(findings);
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
    lines.push(`  ${emoji} ${f.severity.padEnd(10)}  ${f.category}`);
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
  return JSON.stringify(toSarif(PROMETHEUS_RULES, findings, version), null, 2) + '\n';
}
