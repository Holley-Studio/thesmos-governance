// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos compliance:report --standard gdpr
 *
 * Generates an audit-ready Markdown evidence report for GDPR compliance
 * based on the current scan findings. The report documents which rules
 * passed, which had findings, and what remediation is required.
 *
 * Usage:
 *   thesmos compliance:report --standard gdpr [--output FILE] [--write]
 */

import { join, basename } from 'node:path';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { THESMOS_RULES } from '../../rules/registry.js';
import { runReview } from '../../review.js';
import { loadConfig } from '../../config.js';
import type { ScanResult } from '../../types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_STANDARDS = ['gdpr', 'eu-ai-act', 'hipaa', 'dora', 'soc2', 'nist-ai-rmf'] as const;
type Standard = (typeof SUPPORTED_STANDARDS)[number];

const STANDARD_LABELS: Record<Standard, string> = {
  gdpr: 'GDPR (General Data Protection Regulation — EU 2016/679)',
  'eu-ai-act': 'EU AI Act (Regulation (EU) 2024/1689)',
  hipaa: 'HIPAA (Health Insurance Portability and Accountability Act)',
  dora: 'DORA (Digital Operational Resilience Act — EU 2022/2554)',
  soc2: 'SOC 2 (Service Organization Control 2 — AICPA)',
  'nist-ai-rmf': 'NIST AI RMF (AI Risk Management Framework 1.0)',
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
  gdpr_consent_revocation_missing: 'Article 7(3) — Conditions for consent: right to withdraw',
  gdpr_data_portability_missing: 'Article 20 — Right to data portability',
  gdpr_lawful_basis_undeclared: 'Article 6 — Lawfulness of processing',
  gdpr_cross_border_transfer_no_safeguard: 'Article 44–49 — Transfers to third countries',
  gdpr_dpia_missing_high_risk: 'Article 35 — Data protection impact assessment',
};

const EU_AI_ARTICLE_MAP: Record<string, string> = {
  eu_ai_high_risk_no_conformity: 'Art. 43 — Conformity assessment',
  eu_ai_prohibited_biometric: 'Art. 5 — Prohibited AI practices',
  eu_ai_no_risk_management_system: 'Art. 9 — Risk management system',
  eu_ai_training_data_governance_missing: 'Art. 10 — Data and data governance',
  eu_ai_no_technical_documentation: 'Art. 11 — Technical documentation',
  eu_ai_no_decision_audit_log: 'Art. 12 — Record-keeping and logging',
  eu_ai_no_human_oversight: 'Art. 14 — Human oversight',
  eu_ai_gpai_no_capability_eval: 'Art. 51 — Classification of GPAI models',
};

const HIPAA_ARTICLE_MAP: Record<string, string> = {
  hipaa_phi_unencrypted_at_rest: '§164.312(a)(2)(iv) — Encryption and decryption',
  hipaa_phi_no_tls: '§164.312(e)(2)(ii) — Encryption in transit',
  hipaa_phi_no_access_control: '§164.312(a)(1) — Access control',
  hipaa_phi_no_audit_log: '§164.312(b) — Audit controls',
  hipaa_phi_minimum_necessary_missing: '§164.502(b) — Minimum necessary',
  hipaa_phi_to_llm_no_baa: '§164.308(b) — Business associate contracts',
  hipaa_phi_session_no_timeout: '§164.312(a)(2)(iii) — Automatic logoff',
  hipaa_phi_backup_undocumented: '§164.308(a)(7) — Contingency plan',
};

const DORA_ARTICLE_MAP: Record<string, string> = {
  dora_incident_classification_missing: 'Art. 18 — Classification of ICT-related incidents',
  dora_third_party_ict_no_register: 'Art. 28 — Third-party ICT risk management',
  dora_resilience_testing_missing: 'Art. 25 — Testing of ICT tools and systems',
  dora_rto_undocumented: 'Art. 11 — Response and recovery',
  dora_threat_intel_sharing_missing: 'Art. 45 — Threat intelligence sharing',
  dora_change_management_missing: 'Art. 9 — Protection and prevention',
};

const SOC2_CRITERIA_MAP: Record<string, string> = {
  // Security (CC)
  admin_client_in_browser: 'CC6 — Logical and Physical Access Controls',
  rls_disabled: 'CC6 — Logical and Physical Access Controls',
  missing_api_auth: 'CC6 — Logical and Physical Access Controls',
  localstorage_token: 'CC6 — Logical and Physical Access Controls',
  missing_rate_limit: 'CC6 — Logical and Physical Access Controls',
  cookie_no_flags: 'CC6 — Logical and Physical Access Controls',
  cors_wildcard: 'CC6 — Logical and Physical Access Controls',
  // Availability (A)
  n_plus_one_query: 'A1 — Availability',
  sync_fs_in_handler: 'A1 — Availability',
  connection_pool_exhaust: 'A1 — Availability',
  // Confidentiality (C)
  secret_in_diff: 'C1 — Confidentiality',
  pii_in_logs: 'C1 — Confidentiality',
  password_in_api_response: 'C1 — Confidentiality',
  // Processing Integrity (PI)
  sql_injection: 'PI1 — Processing Integrity',
  mass_assignment: 'PI1 — Processing Integrity',
  // Change Management (CC8)
  merge_conflict_markers: 'CC8 — Change Management',
  env_file_committed: 'CC8 — Change Management',
};

const NIST_FUNCTION_MAP: Record<string, string> = {
  // GOVERN
  ai_key_in_client: 'GOVERN 1.1 — Policies and processes for AI risk management',
  ai_no_rate_limit: 'GOVERN 1.1 — Policies and processes for AI risk management',
  ai_cost_no_budget: 'GOVERN 1.1 — Policies and processes for AI risk management',
  // MAP
  prompt_injection_risk: 'MAP 1.1 — AI risk identification',
  llm_response_as_html: 'MAP 1.1 — AI risk identification',
  ai_output_unvalidated: 'MAP 1.1 — AI risk identification',
  prompt_injection_user_input: 'MAP 1.1 — AI risk identification',
  // MEASURE
  ai_high_risk_no_human_oversight: 'MEASURE 2.5 — AI system performance and risk testing',
  ai_bias_check_missing: 'MEASURE 2.5 — AI system performance and risk testing',
  ai_immutable_audit_log_missing: 'MEASURE 2.8 — Risk evaluation and measurement',
  ai_output_schema_missing: 'MEASURE 2.5 — AI system performance and risk testing',
  // MANAGE
  ai_tool_no_validation: 'MANAGE 2.2 — Mechanisms to respond to AI system failures',
  agent_loop_no_max_iterations: 'MANAGE 2.4 — Mechanisms to contain AI risks',
  ai_generated_code_auto_executed: 'MANAGE 2.2 — Mechanisms to respond to AI system failures',
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
  const cachePath = join(root, '.thesmos', 'scan-cache.json');
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

  const gdprRules = THESMOS_RULES.filter((r) => r.id.startsWith('GDPR_'));
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
    `**Tool:** thesmos-governance v${config.version ?? '2.0.0'}`,
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
    `*Generated by [thesmos-governance](https://github.com/Holley-Studio/thesmos-governance) v3.6.0*`,
    ``,
  );

  return lines.join('\n');
}

// ── Generic report helper ─────────────────────────────────────────────────────

function generateFrameworkReport(
  root: string,
  standard: Standard,
  idPrefix: string,
  categoryPrefix: string,
  articleMap: Record<string, string>,
): string {
  const config = loadConfig(root);
  const scan = loadScanResult(root);
  const allFindings = runReview({ scan, config, changedFiles: undefined });
  const findings = allFindings.filter((f) => f.category.startsWith(categoryPrefix));
  const rules = THESMOS_RULES.filter((r) => r.id.startsWith(idPrefix));
  const passedRules = rules.filter((r) => !findings.some((f) => f.category === r.category));
  const failedRules = rules.filter((r) => findings.some((f) => f.category === r.category));
  const blockers = findings.filter((f) => f.severity === 'BLOCKER');
  const highs = findings.filter((f) => f.severity === 'HIGH');
  const mediums = findings.filter((f) => f.severity === 'MEDIUM');
  const lows = findings.filter((f) => f.severity === 'LOW');

  const now = new Date().toISOString();
  const projectName = basename(root);
  const totalRules = rules.length;
  const passed = passedRules.length;
  const complianceScore = totalRules > 0 ? Math.round((passed / totalRules) * 100) : 100;
  const label = STANDARD_LABELS[standard];

  const lines: string[] = [
    `# ${label} Compliance Evidence Report`,
    ``,
    `**Standard:** ${label}`,
    `**Project:** ${projectName}`,
    `**Generated:** ${now}`,
    `**Tool:** thesmos-governance v${config.version ?? '2.0.0'}`,
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
    `| Total Findings | ${findings.length} |`,
    ``,
  ];

  if (findings.length === 0) {
    lines.push(
      `> ✅ **No ${standard.toUpperCase()} violations detected.** All ${totalRules} rules passed.`,
      ``,
      `> *Note: This report identifies common patterns. It is not a substitute for a formal compliance audit.*`,
      ``,
    );
  } else {
    lines.push(
      `> ⚠️ **${findings.length} violation(s) detected.** Remediation required before this project can be considered compliant.`,
      ``,
    );
  }

  lines.push(`---`, ``, `## Findings by Requirement`, ``);

  if (findings.length === 0) {
    lines.push(`*No findings.*`, ``);
  } else {
    const byArticle = new Map<string, typeof findings>();
    for (const finding of findings) {
      const article = articleMap[finding.category] ?? 'General';
      if (!byArticle.has(article)) byArticle.set(article, []);
      byArticle.get(article)!.push(finding);
    }
    for (const [article, fs] of byArticle) {
      lines.push(`### ${article}`, ``);
      for (const f of fs) {
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
    `| Rule | Category | Requirement | Status |`,
    `|------|----------|-------------|--------|`,
  );

  for (const rule of rules) {
    const article = articleMap[rule.category] ?? '—';
    const hasFinding = findings.some((f) => f.category === rule.category);
    const status = hasFinding ? '❌ Failed' : '✅ Passed';
    lines.push(`| ${rule.id} | \`${rule.category}\` | ${article} | ${status} |`);
  }

  lines.push(``, `---`, ``, `## Passed Rules (${passed})`, ``);
  if (passedRules.length === 0) {
    lines.push(`*No rules passed.*`, ``);
  } else {
    for (const rule of passedRules) {
      lines.push(`- ✅ **${rule.id}** — ${rule.description}`);
    }
    lines.push(``);
  }

  lines.push(`---`, ``, `## Remediation Priority`, ``);
  const ordered = [...findings].sort((a, b) => {
    const order: Record<string, number> = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });

  if (ordered.length === 0) {
    lines.push(`*No remediation required.*`, ``);
  } else {
    lines.push(`| Priority | Rule | File | Action |`, `|----------|------|------|--------|`);
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
    `> This report identifies common patterns associated with ${label} compliance requirements.`,
    `> It is generated by static analysis and **is not a substitute for a formal compliance audit`,
    `> or legal advice from a qualified attorney.** Use this report as one input in your compliance`,
    `> process, not as the sole basis for compliance claims.`,
    ``,
    `---`,
    ``,
    `*Generated by [thesmos-governance](https://github.com/Holley-Studio/thesmos-governance) v3.6.0*`,
    ``,
  );

  return lines.join('\n');
}

function generateEuAiActReport(root: string): string {
  return generateFrameworkReport(root, 'eu-ai-act', 'EU_AI_', 'eu_ai_', EU_AI_ARTICLE_MAP);
}

function generateHipaaReport(root: string): string {
  return generateFrameworkReport(root, 'hipaa', 'HIPAA_', 'hipaa_', HIPAA_ARTICLE_MAP);
}

function generateDoraReport(root: string): string {
  return generateFrameworkReport(root, 'dora', 'DORA_', 'dora_', DORA_ARTICLE_MAP);
}

function generateSoc2Report(root: string): string {
  // SOC 2 maps relevant existing rules (SEC_, AUTH_, LOG_) to Trust Criteria
  const config = loadConfig(root);
  const scan = loadScanResult(root);
  const allFindings = runReview({ scan, config, changedFiles: undefined });
  const soc2Findings = allFindings.filter((f) => Object.hasOwn(SOC2_CRITERIA_MAP, f.category));
  const soc2Rules = THESMOS_RULES.filter((r) => Object.hasOwn(SOC2_CRITERIA_MAP, r.category));
  return buildSoc2NistReport(root, 'soc2', soc2Rules, soc2Findings, SOC2_CRITERIA_MAP);
}

function generateNistAiRmfReport(root: string): string {
  const config = loadConfig(root);
  const scan = loadScanResult(root);
  const allFindings = runReview({ scan, config, changedFiles: undefined });
  const nistFindings = allFindings.filter((f) => Object.hasOwn(NIST_FUNCTION_MAP, f.category));
  const nistRules = THESMOS_RULES.filter((r) => Object.hasOwn(NIST_FUNCTION_MAP, r.category));
  return buildSoc2NistReport(root, 'nist-ai-rmf', nistRules, nistFindings, NIST_FUNCTION_MAP);
}

function buildSoc2NistReport(
  root: string,
  standard: Standard,
  rules: typeof THESMOS_RULES,
  findings: ReturnType<typeof runReview>,
  articleMap: Record<string, string>,
): string {
  const config = loadConfig(root);
  const passed = rules.filter((r) => !findings.some((f) => f.category === r.category)).length;
  const total = rules.length;
  const score = total > 0 ? Math.round((passed / total) * 100) : 100;
  const label = STANDARD_LABELS[standard];
  const now = new Date().toISOString();
  const projectName = basename(root);

  const lines: string[] = [
    `# ${label} Compliance Evidence Report`,
    ``,
    `**Standard:** ${label}`,
    `**Project:** ${projectName}`,
    `**Generated:** ${now}`,
    `**Tool:** thesmos-governance v${config.version ?? '2.0.0'}`,
    `**Mapped Rules:** ${total}`,
    ``,
    `---`,
    ``,
    `## Executive Summary`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Coverage Score | ${score}% (${passed}/${total} rules passed) |`,
    `| Total Findings | ${findings.length} |`,
    ``,
    findings.length === 0
      ? `> ✅ **No violations detected in mapped rules.**`
      : `> ⚠️ **${findings.length} violation(s) detected.**`,
    ``,
    `---`,
    ``,
    `## Findings by Control Area`,
    ``,
  ];

  if (findings.length === 0) {
    lines.push(`*No findings.*`, ``);
  } else {
    const byArea = new Map<string, typeof findings>();
    for (const f of findings) {
      const area = articleMap[f.category] ?? 'General';
      if (!byArea.has(area)) byArea.set(area, []);
      byArea.get(area)!.push(f);
    }
    for (const [area, fs] of byArea) {
      lines.push(`### ${area}`, ``);
      for (const f of fs) {
        lines.push(
          `**${severityEmoji(f.severity)} [${severityToRisk(f.severity)}]** \`${f.category}\``,
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
    `## Rule–Control Mapping`,
    ``,
    `| Rule | Control Area | Status |`,
    `|------|-------------|--------|`,
  );
  for (const rule of rules) {
    const area = articleMap[rule.category] ?? '—';
    const hasFinding = findings.some((f) => f.category === rule.category);
    lines.push(`| ${rule.id} | ${area} | ${hasFinding ? '❌ Failed' : '✅ Passed'} |`);
  }

  lines.push(
    ``,
    `---`,
    ``,
    `> *Generated by [thesmos-governance](https://github.com/Holley-Studio/thesmos-governance) v3.6.0*`,
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
      `Error: --standard is required.\n\nSupported standards:\n${SUPPORTED_STANDARDS.map((s) => `  ${s}`).join('\n')}\n\nExample:\n  thesmos compliance:report --standard gdpr\n`,
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
    case 'eu-ai-act':
      report = generateEuAiActReport(root);
      break;
    case 'hipaa':
      report = generateHipaaReport(root);
      break;
    case 'dora':
      report = generateDoraReport(root);
      break;
    case 'soc2':
      report = generateSoc2Report(root);
      break;
    case 'nist-ai-rmf':
      report = generateNistAiRmfReport(root);
      break;
  }

  if (write || output) {
    const outPath = output ?? join(root, '.thesmos', `compliance-${standard}.md`);
    writeFileSync(outPath, report, 'utf8');
    process.stdout.write(`Compliance report written to ${outPath}\n`);
  } else {
    process.stdout.write(report);
  }
}
