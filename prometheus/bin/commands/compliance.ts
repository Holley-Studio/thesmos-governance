/**
 * prometheus compliance:report --standard gdpr
 *
 * Generates an audit-ready Markdown evidence report for GDPR compliance
 * based on the current scan findings. The report documents which rules
 * passed, which had findings, and what remediation is required.
 *
 * Usage:
 *   prometheus compliance:report --standard gdpr [--output FILE] [--write]
 */

import { join, basename } from 'node:path';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { PROMETHEUS_RULES } from '../../rules/registry.js';
import { runReview } from '../../review.js';
import { loadConfig } from '../../config.js';
import type { ScanResult } from '../../types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_STANDARDS = ['gdpr'] as const;
type Standard = (typeof SUPPORTED_STANDARDS)[number];

const STANDARD_LABELS: Record<Standard, string> = {
  gdpr: 'GDPR (General Data Protection Regulation — EU 2016/679)',
};

const GDPR_ARTICLE_MAP: Record<string, string> = {
  gdpr_pii_in_console_log: 'Article 5(1)(f) — Integrity and confidentiality',
  gdpr_analytics_no_consent: 'Article 6 — Lawfulness of processing; Article 7 — Conditions for consent',
  gdpr_cookie_no_banner: 'ePrivacy Directive Art. 5(3); Article 6 — Lawfulness of processing',
  gdpr_pii_in_url_params: 'Article 5(1)(f) — Integrity and confidentiality; Article 32 — Security',
  gdpr_pii_in_localStorage: 'Article 32 — Security of processing',
  gdpr_no_data_deletion_endpoint: 'Article 17 — Right to erasure ("right to be forgotten")',
  gdpr_pii_in_logs_external: 'Article 44 — General principle for transfers; Article 28 — Processor',
  gdpr_pii_unencrypted_db_column: 'Article 32 — Security of processing',
  gdpr_no_privacy_policy_link: 'Article 13 — Information to be provided at time of collection',
  gdpr_third_party_no_consent: 'Article 6 — Lawfulness of processing; Article 7 — Consent',
  gdpr_pii_in_error_response: 'Article 5(1)(f) — Integrity and confidentiality',
  gdpr_no_retention_policy: 'Article 5(1)(e) — Storage limitation',
  gdpr_session_no_expiry: 'Article 5(1)(e) — Storage limitation; Article 32 — Security',
  gdpr_pii_in_test_fixtures: 'Article 5 — Principles; Article 25 — Data protection by design',
  gdpr_ip_stored_without_consent: 'Article 6 — Lawfulness of processing (IP = personal data per CJEU)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { standard: string; output: string | null; write: boolean } {
  let standard = '';
  let output: string | null = null;
  let write = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--standard' && argv[i + 1]) {
      standard = argv[++i]!;
    } else if (argv[i]?.startsWith('--standard=')) {
      standard = argv[i]!.slice('--standard='.length);
    } else if (argv[i] === '--output' && argv[i + 1]) {
      output = argv[++i]!;
    } else if (argv[i]?.startsWith('--output=')) {
      output = argv[i]!.slice('--output='.length);
    } else if (argv[i] === '--write') {
      write = true;
    }
  }

  return { standard, output, write };
}

function loadScanResult(root: string): ScanResult {
  const cachePath = join(root, '.prometheus', 'scan-cache.json');
  if (existsSync(cachePath)) {
    try {
      return JSON.parse(readFileSync(cachePath, 'utf8')) as ScanResult;
    } catch {
      // fall through to empty scan
    }
  }
  return makeEmptyScanResult();
}

function makeEmptyScanResult(): ScanResult {
  return {
    _generatedSections: [],
    generatedAt: new Date().toISOString(),
    scanVersion: '2.0.0',
    pages: [],
    apiRoutes: [],
    componentCount: 0,
    sharedUiFiles: [],
    designSystemFiles: [],
    storeFiles: [],
    testFiles: [],
    largeFiles: [],
    riskyFiles: [],
    scriptFiles: [],
    envFiles: [],
    clientBoundaryRisks: [],
  };
}

function severityToRisk(severity: string): string {
  switch (severity) {
    case 'BLOCKER': return 'Critical';
    case 'HIGH': return 'High';
    case 'MEDIUM': return 'Medium';
    case 'LOW': return 'Low';
    default: return severity;
  }
}

function severityEmoji(severity: string): string {
  switch (severity) {
    case 'BLOCKER': return '🔴';
    case 'HIGH': return '🟠';
    case 'MEDIUM': return '🟡';
    case 'LOW': return '🔵';
    default: return '⚪';
  }
}

// ── Report generator ──────────────────────────────────────────────────────────

function generateGdprReport(root: string): string {
  const config = loadConfig(root);
  const scan = loadScanResult(root);

  const allFindings = runReview({ scan, config, changedFiles: undefined });
  const gdprFindings = allFindings.filter((f) => f.category.startsWith('gdpr_'));

  const gdprRules = PROMETHEUS_RULES.filter((r) => r.id.startsWith('GDPR_'));
  const passedRules = gdprRules.filter((r) => !gdprFindings.some((f) => f.category === r.category));
  const failedRules = gdprRules.filter((r) => gdprFindings.some((f) => f.category === r.category));

  const blockers = gdprFindings.filter((f) => f.severity === 'BLOCKER');
  const highs = gdprFindings.filter((f) => f.severity === 'HIGH');
  const mediums = gdprFindings.filter((f) => f.severity === 'MEDIUM');
  const lows = gdprFindings.filter((f) => f.severity === 'LOW');

  const now = new Date().toISOString();
  const projectName = basename(root);
  const totalRules = gdprRules.length;
  const passed = passedRules.length;
  const failed = failedRules.length;
  const complianceScore = Math.round((passed / totalRules) * 100);

  const lines: string[] = [
    `# GDPR Compliance Evidence Report`,
    ``,
    `**Standard:** ${STANDARD_LABELS.gdpr}`,
    `**Project:** ${projectName}`,
    `**Generated:** ${now}`,
    `**Tool:** prometheus-governance v${config.version ?? '2.0.0'}`,
    `**Rules Evaluated:** ${totalRules}`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Compliance Score | ${complianceScore}% (${passed}/${totalRules} rules passed) |`,
    `| Critical (Blockers) | ${blockers.length} |`,
    `| High Risk | ${highs.length} |`,
    `| Medium Risk | ${mediums.length} |`,
    `| Low Risk | ${lows.length} |`,
    `| Total Findings | ${gdprFindings.length} |`,
    ``,
  ];

  if (gdprFindings.length === 0) {
    lines.push(
      `> ✅ **No GDPR violations detected.** All ${totalRules} rules passed.`,
      ``,
      `> *Note: This report identifies common patterns associated with GDPR compliance requirements.`,
      `> It is not a substitute for a formal compliance audit or legal advice from a qualified attorney.*`,
      ``,
    );
  } else {
    lines.push(
      `> ⚠️ **${gdprFindings.length} GDPR violation(s) detected.** Remediation required before this project can be considered compliant.`,
      ``,
    );
  }

  lines.push(
    `---`,
    ``,
    `## Findings by GDPR Article`,
    ``,
  );

  if (gdprFindings.length === 0) {
    lines.push(`*No findings.*`, ``);
  } else {
    // Group findings by article
    const byArticle = new Map<string, typeof gdprFindings>();
    for (const finding of gdprFindings) {
      const article = GDPR_ARTICLE_MAP[finding.category] ?? 'General';
      if (!byArticle.has(article)) byArticle.set(article, []);
      byArticle.get(article)!.push(finding);
    }

    for (const [article, findings] of byArticle) {
      lines.push(`### ${article}`, ``);
      for (const f of findings) {
        const emoji = severityEmoji(f.severity);
        const risk = severityToRisk(f.severity);
        lines.push(
          `**${emoji} [${risk}]** \`${f.category}\``,
          ``,
          `- **File:** \`${f.file}${f.line ? `:${f.line}` : ''}\``,
          `- **Finding:** ${f.message}`,
          `- **Remediation:** ${f.suggestion ?? 'See rule documentation.'}`,
          ``,
        );
      }
    }
  }

  lines.push(
    `---`,
    ``,
    `## Rule Coverage Matrix`,
    ``,
    `| Rule | Category | GDPR Article | Status |`,
    `|------|----------|--------------|--------|`,
  );

  for (const rule of gdprRules) {
    const article = GDPR_ARTICLE_MAP[rule.category] ?? '—';
    const hasFinding = gdprFindings.some((f) => f.category === rule.category);
    const status = hasFinding ? '❌ Failed' : '✅ Passed';
    lines.push(`| ${rule.id} | \`${rule.category}\` | ${article} | ${status} |`);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `## Passed Rules (${passed})`,
    ``,
  );

  if (passedRules.length === 0) {
    lines.push(`*No rules passed.*`, ``);
  } else {
    for (const rule of passedRules) {
      lines.push(`- ✅ **${rule.id}** — ${rule.description}`);
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `## Remediation Priority`,
    ``,
  );

  const ordered = [...gdprFindings].sort((a, b) => {
    const order: Record<string, number> = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });

  if (ordered.length === 0) {
    lines.push(`*No remediation required.*`, ``);
  } else {
    lines.push(`| Priority | Rule | File | Action |`);
    lines.push(`|----------|------|------|--------|`);
    for (let i = 0; i < ordered.length; i++) {
      const f = ordered[i]!;
      const emoji = severityEmoji(f.severity);
      const fileRef = `${f.file}${f.line ? `:${f.line}` : ''}`;
      lines.push(`| ${i + 1} ${emoji} | \`${f.category}\` | \`${fileRef}\` | ${f.suggestion ?? '—'} |`);
    }
    lines.push(``);
  }

  lines.push(
    `---`,
    ``,
    `## Legal Disclaimer`,
    ``,
    `> This report identifies common patterns associated with GDPR compliance requirements.`,
    `> It is generated by static analysis and **is not a substitute for a formal compliance audit`,
    `> or legal advice from a qualified attorney.** Use this report as one input in your compliance`,
    `> process, not as the sole basis for compliance claims.`,
    ``,
    `---`,
    ``,
    `*Generated by [prometheus-governance](https://github.com/Holley-Studio/prometheus-governance) v3.6.0*`,
    ``,
  );

  return lines.join('\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdCompliance(argv: string[]): Promise<void> {
  const { standard, output, write } = parseArgs(argv);
  const root = process.cwd();

  if (!standard) {
    process.stderr.write(
      `Error: --standard is required.\n\nSupported standards:\n${SUPPORTED_STANDARDS.map((s) => `  ${s}`).join('\n')}\n\nExample:\n  prometheus compliance:report --standard gdpr\n`,
    );
    process.exit(1);
  }

  if (!SUPPORTED_STANDARDS.includes(standard as Standard)) {
    process.stderr.write(
      `Error: Unknown standard "${standard}".\n\nSupported: ${SUPPORTED_STANDARDS.join(', ')}\n`,
    );
    process.exit(1);
  }

  let report: string;

  switch (standard as Standard) {
    case 'gdpr':
      report = generateGdprReport(root);
      break;
  }

  if (write || output) {
    const outPath = output ?? join(root, '.prometheus', `compliance-${standard}.md`);
    writeFileSync(outPath, report, 'utf8');
    process.stdout.write(`Compliance report written to ${outPath}\n`);
  } else {
    process.stdout.write(report);
  }
}
