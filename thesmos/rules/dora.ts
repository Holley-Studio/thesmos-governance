// Copyright (c) 2026 Holley Studios. All rights reserved.
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

// Financial / ICT service patterns that trigger DORA applicability
const FINANCIAL_SERVICE_RE = /payment|transaction|trading|settlement|clearing|custody|order.?book|portfolio|account.?balance|ledger|wire.?transfer/i;
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
    why: 'DORA Art. 18 requires financial entities to classify ICT incidents by type, impact, and severity within documented timeframes. Without a policy, incident response is ad hoc and non-compliant.',
    commonViolations: [
      'No incident classification policy document in the repository',
        'Incident response runbook exists but lacks severity classification criteria',
        'On-call runbook classifies incidents but not per DORA Art. 18 taxonomy',
    ],
    goodExample: `// See docs/incident-classification-policy.md (DORA Art. 18 compliant)
await classifyIncident(event, policyRef);`,
    badExample: `// No classification policy — incident response is ad hoc`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => FINANCIAL_SERVICE_RE.test(cf.content));
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
    why: 'DORA Art. 28 requires financial entities to maintain a register of all ICT third-party service providers and assess their concentration risk. Without a register, supply chain risk is invisible.',
    commonViolations: [
      'External API dependencies not documented in any ICT supplier register',
        'Cloud providers and SaaS tools not enumerated in DORA register',
        'No contractual provisions for ICT resilience with third-party providers',
    ],
    goodExample: `// Third-party ICT register: docs/ict-supplier-register.md
// Vendor: OpenAI — contractual resilience provisions in place`,
    badExample: `import OpenAI from "openai"; // no supplier register entry for this dependency`,
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
    why: 'DORA Art. 25 requires financial entities to test digital operational resilience annually, including advanced threat-led penetration testing (TLPT) every 3 years.',
    commonViolations: [
      'No penetration testing or resilience testing schedule documented',
        'Annual DR test exists but not aligned with DORA Art. 25 requirements',
        'No threat-led penetration test in the past 3 years',
    ],
    goodExample: `// See docs/resilience-testing-plan.md — Art. 25 TLPT scheduled 2026-Q3`,
    badExample: `// No resilience testing plan documented — DORA Art. 25 non-compliance`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => FINANCIAL_SERVICE_RE.test(cf.content));
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
    why: 'DORA Art. 11 requires ICT business continuity policies to include specific Recovery Time Objectives (RTO) and Recovery Point Objectives (RPO) for critical systems.',
    commonViolations: [
      'Business continuity policy exists but lacks RTO/RPO values',
        'DR runbook has recovery steps but no time targets',
        'BCP refers to "reasonable time" rather than specific RTO hours',
    ],
    goodExample: `// BCP: docs/bcp.md — RTO: 4 hours, RPO: 1 hour (DORA Art. 11 compliant)`,
    badExample: `// BCP has no RTO/RPO — non-compliant with DORA Art. 11`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => FINANCIAL_SERVICE_RE.test(cf.content));
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
    why: 'DORA Art. 45 encourages financial entities to participate in threat intelligence sharing arrangements to improve collective cyber resilience.',
    commonViolations: [
      'No threat intelligence sharing framework or membership configured',
        'Security team receives threat intel but does not share back',
        'No ISAC membership or sector intelligence sharing documented',
    ],
    goodExample: `// Threat intel sharing: FS-ISAC membership active — see docs/threat-intel-sharing.md`,
    badExample: `// No threat intelligence sharing configured — DORA Art. 45 recommendation unmet`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasFinancialService = files.some((cf) => FINANCIAL_SERVICE_RE.test(cf.content));
    if (!hasFinancialService) return [];
    const hasThreatConfig = existsSync(join(root, '.thesmos', 'threat-intelligence.md'))
      || existsSync(join(root, 'docs', 'threat-intelligence.md'))
      || existsSync(join(root, 'compliance', 'dora', 'threat-intel.md'));
    if (hasThreatConfig) return [];
    // Only flag if there are multiple financial-service files (suggests a significant ICT footprint)
    const count = files.filter((cf) => FINANCIAL_SERVICE_RE.test(cf.content)).length;
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
    why: 'DORA Art. 30 requires contracts with ICT third-party service providers to include specific provisions on availability, continuity, and exit strategies.',
    commonViolations: [
      'SaaS vendor contract missing SLA for ICT resilience',
        'Cloud provider agreement lacks DORA-required exit assistance clause',
        'Third-party API used without reviewing contract for DORA Art. 30 provisions',
    ],
    goodExample: `// Vendor contract reviewed for DORA Art. 30: docs/vendor-review-dora.pdf`,
    badExample: `// No DORA contract review documented for this third-party dependency`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const allFiles = (input.changedFiles ?? []);
    const hasDeployConfig = allFiles.some(
      (cf) => (isConfigFile(cf.path) || cf.path.includes('workflow') || cf.path.includes('github/workflows'))
        && CHANGE_DEPLOY_RE.test(cf.content));
    if (!hasDeployConfig) return [];
    const hasFinancialService = allFiles.some(
      (cf) => isSourceFile(cf.path) && FINANCIAL_SERVICE_RE.test(cf.content));
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
