// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * DORA (Digital Operational Resilience Act) rules — DORA_001–006
 * Covers ICT incident classification (Art. 18), third-party risk (Art. 28),
 * resilience testing (Art. 25), RTO (Art. 11), threat intelligence (Art. 45),
 * and change management (Art. 9).
 *
 * Primarily applies to EU financial entities and their ICT service providers.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function f(
  category: string,
  severity: Finding['severity'],
  message: string,
  suggestion: string,
  file: string,
  line?: number,
): Finding {
  return { severity, file, line, category, message, suggestion };
}

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|rs)$/.test(path) && !path.endsWith('.d.ts');
}

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx|py)$|__tests__|fixtures|__mocks__/.test(path);
}

function isConfigFile(path: string): boolean {
  return /\.(json|yaml|yml|toml)$/.test(path) || path.endsWith('.env.example');
}

// Financial / ICT service patterns that trigger DORA applicability.
// Strong terms are unambiguous finance; weak terms (ledger, transaction,
// portfolio…) appear constantly in ordinary software (audit ledgers, DB
// transactions, design portfolios) — a single weak hit must never classify a
// repo as an EU financial entity. Require one strong hit or two distinct weak
// hits in the same file.
const STRONG_FINANCIAL_RE = /payment|trading|settlement|clearing|custody|wire.?transfer/i;
const WEAK_FINANCIAL_TERMS: RegExp[] = [
  /transaction/i,
  /order.?book/i,
  /portfolio/i,
  /account.?balance/i,
  /ledger/i,
];

function looksFinancial(content: string): boolean {
  if (STRONG_FINANCIAL_RE.test(content)) return true;
  let weakHits = 0;
  for (const re of WEAK_FINANCIAL_TERMS) {
    if (re.test(content) && ++weakHits >= 2) return true;
  }
  return false;
}
const THIRD_PARTY_ICT_RE = /(?:import|require|fetch|axios|got|sdk)\s*.*(?:stripe|twilio|sendgrid|datadog|cloudflare|aws|azure|gcp|snowflake|databricks|kafka|rabbitmq)/i;
const CHANGE_DEPLOY_RE = /deploy|release|migration|rollout|upgrade|patch|hotfix/i;

// ── Rule: DORA_001 — No ICT incident classification policy ───────────────────

const DORA_001: ThesmosRule = {
  id: 'DORA_001',
  category: 'dora_incident_classification_missing',
  severity: 'BLOCKER',
  description: 'No ICT incident classification policy found — DORA Art. 18 requires a documented classification scheme.',
  tags: ['dora', 'incident', 'resilience'],
  frameworks: ['dora'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'DORA Art. 18 requires EU financial entities to classify ICT incidents by impact severity. Without a documented classification scheme, you cannot determine which incidents require regulatory reporting (Art. 19) within the 4-hour initial notification window. Fines can reach €10M or 5% of total annual worldwide turnover.',
    commonViolations: ['Payment processing service with no .thesmos/incident-classification.md', 'Financial API with no severity matrix or escalation paths documented'],
    goodExample: '// .thesmos/incident-classification.md\n// P1 (Major): >€5M impact, user data breach, service unavailable > 15min → report to NCA in 4h\n// P2 (Significant): degraded performance, partial outage → internal escalation, report if 24h+',
    badExample: '// Financial trading service in production, no incident classification doc — Art. 18/19 non-compliant',
    relatedPlaybooks: ['dora.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => looksFinancial(cf.content));
    if (!hasFinancialService) return [];
    const hasPolicy = existsSync(join(root, '.thesmos', 'incident-classification.md'))
      || existsSync(join(root, 'docs', 'incident-classification.md'))
      || existsSync(join(root, 'compliance', 'dora', 'incident-classification.md'))
      || existsSync(join(root, '.thesmos', 'playbooks', 'incident-response.md'));
    if (hasPolicy) return [];
    return [f('dora_incident_classification_missing', 'BLOCKER',
      'Financial ICT service with no incident classification policy — DORA Art. 18 mandates a documented scheme.',
      'Create .thesmos/incident-classification.md defining P1–P4 severity, escalation paths, and Art. 19 reporting thresholds.',
      '.thesmos/incident-classification.md')];
  },
};

// ── Rule: DORA_002 — Third-party ICT provider used with no contract register ─

const DORA_002: ThesmosRule = {
  id: 'DORA_002',
  category: 'dora_third_party_ict_no_register',
  severity: 'HIGH',
  description: 'Third-party ICT provider dependency found with no contract/register maintained — DORA Art. 28.',
  tags: ['dora', 'third-party', 'supply-chain'],
  frameworks: ['dora'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'DORA Art. 28 requires financial entities to maintain a comprehensive register of all contractual arrangements with third-party ICT providers. Regulators can request this register at any time — missing entries mean you cannot demonstrate supply chain risk oversight.',
    commonViolations: ['Using Stripe, Twilio, or Datadog in a financial service with no .thesmos/third-party-ict-register.md', 'AWS/Azure dependencies with no documented SLA, exit strategy, or concentration risk assessment'],
    goodExample: '// .thesmos/third-party-ict-register.md\n// | Provider | Service | Criticality | Contract Exp | SLA | Exit Plan |\n// | Stripe | Payments | Critical | 2026-12 | 99.99% | documented |',
    badExample: '// import { stripe } from "@stripe/stripe-js"  // in payment service, no ICT register maintained',
    relatedPlaybooks: ['dora.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasThirdPartyIct = files.some((cf) => THIRD_PARTY_ICT_RE.test(cf.content));
    if (!hasThirdPartyIct) return [];
    const hasRegister = existsSync(join(root, '.thesmos', 'third-party-ict-register.md'))
      || existsSync(join(root, 'docs', 'third-party-ict-register.md'))
      || existsSync(join(root, 'compliance', 'dora', 'ict-register.md'));
    if (hasRegister) return [];
    return [f('dora_third_party_ict_no_register', 'HIGH',
      'Third-party ICT provider used with no register maintained — DORA Art. 28 requires a comprehensive register.',
      'Create .thesmos/third-party-ict-register.md listing all critical ICT providers, contract dates, and SLAs.',
      '.thesmos/third-party-ict-register.md')];
  },
};

// ── Rule: DORA_003 — No resilience testing plan ───────────────────────────────

const DORA_003: ThesmosRule = {
  id: 'DORA_003',
  category: 'dora_resilience_testing_missing',
  severity: 'HIGH',
  description: 'No digital operational resilience testing plan — DORA Art. 25 requires annual resilience testing.',
  tags: ['dora', 'resilience', 'testing'],
  frameworks: ['dora'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'DORA Art. 25 requires financial entities to conduct digital operational resilience testing at least annually, including vulnerability assessments and penetration testing. Significant institutions must additionally perform threat-led penetration testing (TLPT) every 3 years. Missing this documentation blocks supervisory review.',
    commonViolations: ['Financial service with no .thesmos/resilience-testing.md defining test scope and schedule', 'Payment processing system with no documented BCP test or DR drill results'],
    goodExample: '// .thesmos/resilience-testing.md\n// Annual: vulnerability scan, BCP tabletop, failover drill\n// Every 3 years: TLPT by approved provider\n// Last test: 2025-Q4, next: 2026-Q4',
    badExample: '// Payment API deployed to production, no resilience test plan or DR drill documented — Art. 25 gap',
    relatedPlaybooks: ['dora.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => looksFinancial(cf.content));
    if (!hasFinancialService) return [];
    const hasPlan = existsSync(join(root, '.thesmos', 'resilience-testing.md'))
      || existsSync(join(root, 'docs', 'resilience-testing.md'))
      || existsSync(join(root, 'compliance', 'dora', 'resilience-testing.md'));
    if (hasPlan) return [];
    return [f('dora_resilience_testing_missing', 'HIGH',
      'Financial ICT system with no resilience testing plan — DORA Art. 25 requires vulnerability and penetration testing.',
      'Create .thesmos/resilience-testing.md covering BCP tests, DR drills, TLPT scope, and annual schedule.',
      '.thesmos/resilience-testing.md')];
  },
};

// ── Rule: DORA_004 — RTO undocumented ────────────────────────────────────────

const DORA_004: ThesmosRule = {
  id: 'DORA_004',
  category: 'dora_rto_undocumented',
  severity: 'HIGH',
  description: 'ICT business continuity policy has no documented RTO/RPO — DORA Art. 11 requirement.',
  tags: ['dora', 'rto', 'rpo', 'continuity'],
  frameworks: ['dora'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'DORA Art. 11 requires financial entities to have ICT business continuity policies with defined recovery time objectives (RTO) and recovery point objectives (RPO). Without documented RTO/RPO, there is no measurable target for incident recovery and no basis for compliance audits.',
    commonViolations: ['Payment service with no .thesmos/business-continuity.md or docs/business-continuity.md', 'Financial API deployed with no defined maximum acceptable downtime or data loss targets'],
    goodExample: '// .thesmos/business-continuity.md\n// RTO: 2 hours for payment processing (critical), 24 hours for reporting (non-critical)\n// RPO: 15 minutes (transaction data), 1 hour (audit logs)',
    badExample: '// Trading platform live, no BCP doc, no RTO/RPO defined — Art. 11 violation, supervisory finding likely',
    relatedPlaybooks: ['dora.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => looksFinancial(cf.content));
    if (!hasFinancialService) return [];
    // Check for any BCP/DR document that contains RTO/RPO
    const bcpPaths = [
      join(root, '.thesmos', 'business-continuity.md'),
      join(root, 'docs', 'business-continuity.md'),
      join(root, 'compliance', 'dora', 'bcp.md'),
      join(root, '.thesmos', 'backup-plan.md'),
    ];
    const hasBcp = bcpPaths.some(existsSync);
    if (hasBcp) return [];
    return [f('dora_rto_undocumented', 'HIGH',
      'Financial ICT system without RTO/RPO documentation — DORA Art. 11 requires a tested continuity plan.',
      'Create .thesmos/business-continuity.md specifying RTO (max downtime) and RPO (max data loss) per service tier.',
      '.thesmos/business-continuity.md')];
  },
};

// ── Rule: DORA_005 — No threat intelligence sharing ──────────────────────────

const DORA_005: ThesmosRule = {
  id: 'DORA_005',
  category: 'dora_threat_intel_sharing_missing',
  severity: 'HIGH',
  description: 'No threat intelligence sharing framework configured — DORA Art. 45 encourages voluntary sharing.',
  tags: ['dora', 'threat-intelligence', 'sharing'],
  frameworks: ['dora'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'DORA Art. 45 encourages financial entities to voluntarily share cyber threat intelligence and information within the financial sector to strengthen collective defenses. While voluntary, regulators view participation in ISAC/ISAO frameworks as a signal of mature operational resilience posture.',
    commonViolations: ['Large financial ICT footprint with no .thesmos/threat-intelligence.md', 'Multiple payment and trading services with no documented threat-sharing membership or procedures'],
    goodExample: '// .thesmos/threat-intelligence.md\n// Member: FS-ISAC (Financial Services ISAC)\n// Feeds: FS-ISAC TLP:GREEN alerts, ENISA threat landscape reports\n// Sharing: anonymized IOCs shared monthly via FS-ISAC portal',
    badExample: '// Substantial financial services code base, no threat intel sharing framework documented — Art. 45 gap',
    relatedPlaybooks: ['dora.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => looksFinancial(cf.content));
    if (!hasFinancialService) return [];
    const hasThreatConfig = existsSync(join(root, '.thesmos', 'threat-intelligence.md'))
      || existsSync(join(root, 'docs', 'threat-intelligence.md'))
      || existsSync(join(root, 'compliance', 'dora', 'threat-intel.md'));
    if (hasThreatConfig) return [];
    // Only flag if there are multiple financial-service files (suggests a significant ICT footprint)
    const count = files.filter((cf) => looksFinancial(cf.content)).length;
    if (count < 2) return [];
    return [f('dora_threat_intel_sharing_missing', 'HIGH',
      'No threat intelligence sharing framework found — DORA Art. 45 encourages ISAC/ISAO participation.',
      'Document threat intelligence sources and sharing agreements in .thesmos/threat-intelligence.md.',
      '.thesmos/threat-intelligence.md')];
  },
};

// ── Rule: DORA_006 — Change management procedure missing ─────────────────────

const DORA_006: ThesmosRule = {
  id: 'DORA_006',
  category: 'dora_change_management_missing',
  severity: 'MEDIUM',
  description: 'ICT changes deployed without a documented change management procedure — DORA Art. 9.',
  tags: ['dora', 'change-management', 'resilience'],
  frameworks: ['dora'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'DORA Art. 9 requires financial entities to have ICT change management procedures that ensure changes are tested, authorized, and documented before implementation. Undocumented change processes in financial systems are a regulatory finding — regulators expect evidence of pre-change risk assessment and rollback plans.',
    commonViolations: ['Deployment workflow in a payment service with no .thesmos/change-management.md', 'Migration scripts for financial data with no change advisory board or approval evidence'],
    goodExample: '// .thesmos/change-management.md\n// Standard change: PR review + CI + staging deploy + 24h soak\n// Emergency change: CISO approval + immediate rollback plan required\n// CAB review: weekly for financial-critical services',
    badExample: '// GitHub workflow deploys to payment production on merge, no change management policy documented — Art. 9 gap',
    relatedPlaybooks: ['dora.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const allFiles = (input.changedFiles ?? []);
    const hasDeployConfig = allFiles.some(
      (cf) => (isConfigFile(cf.path) || cf.path.includes('workflow') || cf.path.includes('github/workflows'))
        && CHANGE_DEPLOY_RE.test(cf.content));
    if (!hasDeployConfig) return [];
    const hasFinancialService = allFiles.some(
      (cf) => isSourceFile(cf.path) && looksFinancial(cf.content));
    if (!hasFinancialService) return [];
    const hasChangePolicy = existsSync(join(root, '.thesmos', 'change-management.md'))
      || existsSync(join(root, 'docs', 'change-management.md'))
      || existsSync(join(root, 'compliance', 'dora', 'change-management.md'));
    if (hasChangePolicy) return [];
    return [f('dora_change_management_missing', 'MEDIUM',
      'Deployment changes detected without a change management procedure — DORA Art. 9 requires ICT change controls.',
      'Create .thesmos/change-management.md covering CAB process, rollback criteria, and emergency change procedures.',
      '.thesmos/change-management.md')];
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const DORA_RULES: ThesmosRule[] = [
  DORA_001,
  DORA_002,
  DORA_003,
  DORA_004,
  DORA_005,
  DORA_006,
];
