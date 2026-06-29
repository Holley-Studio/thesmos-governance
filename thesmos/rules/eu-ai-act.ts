// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * EU AI Act rules — EU_AI_001–008
 * Covers Annex III high-risk AI systems, prohibited practices (Art. 5),
 * risk management (Art. 9), data governance (Art. 10), technical docs (Art. 11),
 * logging (Art. 12), human oversight (Art. 14), and GPAI (Art. 51).
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

function findLineNumber(content: string, searchStr: string): number | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(searchStr)) return i + 1;
  }
  return undefined;
}

// Signals that high-risk AI decisions are being made without a human gate
const HIGH_RISK_DECISION_RE = /\b(?:credit.?scor|loan.?approv|hire|recruit|dismiss|medical.?diagnos|benefit.?eligib|risk.?scor|fraud.?scor)\b/i;
const BIOMETRIC_RE = /\b(?:facial.?recogn|fingerprint|iris.?scan|biometric.?verif|real.?time.?remote.?biometric|voice.?print)\b/i;
const LLM_CALL_RE = /openai|anthropic|bedrock|vertex|azureopenai|gemini|llm|completion|chat\.completions/i;
const HUMAN_GATE_RE = /human.?review|human.?in.?the.?loop|hitl|manual.?approv|operator.?confirm|humanOversight/i;
const AUDIT_LOG_RE = /audit.?log|append.?only|immutable.?log|auditTrail|audit_trail/i;

// ── Rule: EU_AI_001 — High-risk AI without conformity assessment ───────────────

const EU_AI_001: ThesmosRule = {
  id: 'EU_AI_001',
  category: 'eu_ai_high_risk_no_conformity',
  severity: 'BLOCKER',
  description: 'High-risk AI system (Annex III) deployed without a conformity assessment — EU AI Act Art. 43.',
  tags: ['eu-ai-act', 'compliance', 'high-risk'],
  frameworks: ['eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 6 and Annex III require high-risk AI systems (credit, education, employment, biometrics, safety) to undergo conformity assessment before deployment. Without it, the deployment is unlawful in the EU.',
    commonViolations: [
      'Credit scoring AI deployed without conformity assessment documentation',
        'CV screening model used in hiring without Art. 9 risk management system',
        'Remote biometric identification deployed without regulatory approval',
    ],
    goodExample: `// Conformity assessment ref: docs/eu-ai-conformity-2026.pdf
const score = await creditModel.score(applicant);`,
    badExample: `const score = await creditModel.score(applicant); // no conformity assessment`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasHighRiskDecision = files.some((cf) => HIGH_RISK_DECISION_RE.test(cf.content) && LLM_CALL_RE.test(cf.content));
    if (!hasHighRiskDecision) return [];
    const hasConformity = existsSync(join(root, '.thesmos', 'conformity-assessment.md'))
      || existsSync(join(root, 'docs', 'conformity-assessment.md'))
      || existsSync(join(root, 'compliance', 'eu-ai-act', 'conformity.md'));
    if (hasConformity) return [];
    return [f('eu_ai_high_risk_no_conformity', 'BLOCKER',
      'High-risk AI decision-making code detected with no conformity assessment document — EU AI Act Art. 43.',
      'Create .thesmos/conformity-assessment.md documenting the Art. 43 conformity procedure before deployment.',
      '.thesmos/conformity-assessment.md')];
  },
};

// ── Rule: EU_AI_002 — Prohibited biometric categorization / real-time ID ───────

const EU_AI_002: ThesmosRule = {
  id: 'EU_AI_002',
  category: 'eu_ai_prohibited_biometric',
  severity: 'BLOCKER',
  description: 'Biometric categorization or real-time remote biometric identification — prohibited practice under EU AI Act Art. 5.',
  tags: ['eu-ai-act', 'biometric', 'prohibited'],
  frameworks: ['eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 5 prohibits real-time remote biometric identification in public spaces by law enforcement (with narrow exceptions) and biometric categorisation by sensitive attributes (race, political opinion, etc.).',
    commonViolations: [
      'Facial recognition API called on public venue footage in real time',
        'Users categorised by inferred ethnicity or religion from biometric data',
        'Employee badge scans used to infer political affiliation',
    ],
    goodExample: `// Use consent-based biometric verification, not identification
await verifyFaceMatch(enrolledTemplate, capturedFace); // 1:1, not 1:N`,
    badExample: `await identifyFaceInCrowd(videoFrame); // prohibited in EU`,
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isSourceFile(cf.path) || isTestFile(cf.path)) continue;
      if (!BIOMETRIC_RE.test(cf.content)) continue;
      if (!LLM_CALL_RE.test(cf.content)) continue;
      const line = findLineNumber(cf.content, 'biometric') ?? findLineNumber(cf.content, 'facial');
      findings.push(f('eu_ai_prohibited_biometric', 'BLOCKER',
        'Biometric AI capability combined with LLM call — real-time biometric ID is prohibited under EU AI Act Art. 5.',
        'Remove this capability or obtain a narrowly scoped law-enforcement exemption with documented legal basis.',
        cf.path, line));
    }
    return findings;
  },
};

// ── Rule: EU_AI_003 — No risk management system for high-risk AI ───────────────

const EU_AI_003: ThesmosRule = {
  id: 'EU_AI_003',
  category: 'eu_ai_no_risk_management_system',
  severity: 'HIGH',
  description: 'High-risk AI system with no risk management documentation — EU AI Act Art. 9.',
  tags: ['eu-ai-act', 'risk-management', 'compliance'],
  frameworks: ['eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 9 requires high-risk AI systems to have a documented risk management system covering identification, estimation, evaluation, and residual risk.',
    commonViolations: [
      'High-risk AI deployed without any risk register',
        'Risk assessment exists but not updated after model retraining',
        'No mitigation measures documented for identified risks',
    ],
    goodExample: `// Risk management ref: docs/risk-register-v2.md — updated 2026-03-01
const decision = await loanModel.predict(application);`,
    badExample: `const decision = await loanModel.predict(application); // no risk management`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasAiDecision = files.some((cf) => HIGH_RISK_DECISION_RE.test(cf.content));
    if (!hasAiDecision) return [];
    const hasRiskMgmt = existsSync(join(root, '.thesmos', 'risk-management.md'))
      || existsSync(join(root, 'docs', 'risk-management.md'))
      || existsSync(join(root, 'compliance', 'risk-management.md'));
    if (hasRiskMgmt) return [];
    return [f('eu_ai_no_risk_management_system', 'HIGH',
      'High-risk AI decision code found with no risk management system documented — EU AI Act Art. 9.',
      'Create .thesmos/risk-management.md covering risk identification, evaluation, and mitigation measures.',
      '.thesmos/risk-management.md')];
  },
};

// ── Rule: EU_AI_004 — Training data governance plan missing ──────────────────

const EU_AI_004: ThesmosRule = {
  id: 'EU_AI_004',
  category: 'eu_ai_training_data_governance_missing',
  severity: 'HIGH',
  description: 'High-risk AI with no training data governance plan — EU AI Act Art. 10 requires data quality criteria.',
  tags: ['eu-ai-act', 'data-governance', 'training'],
  frameworks: ['eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 10 requires high-risk AI systems to use training data that meets quality criteria including relevance, representativeness, and freedom from errors and biases.',
    commonViolations: [
      'Training data ingested without documented quality assessment',
        'Model fine-tuned on user submissions without bias screening',
        'No data governance plan for ongoing model updates',
    ],
    goodExample: `// Training data governance: docs/data-governance-plan.md
await trainModel(dataset, { governancePlanRef: "docs/data-governance-plan.md" });`,
    badExample: `await trainModel(dataset); // no governance plan`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const TRAINING_RE = /fine.?tun|train(?:ing)?|dataset|embedding.*ingest|createFineTune|fine_tune/i;
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasTraining = files.some((cf) => TRAINING_RE.test(cf.content));
    if (!hasTraining) return [];
    const hasDataGovernance = existsSync(join(root, '.thesmos', 'data-governance.md'))
      || existsSync(join(root, 'docs', 'data-governance.md'))
      || existsSync(join(root, 'compliance', 'data-governance.md'));
    if (hasDataGovernance) return [];
    return [f('eu_ai_training_data_governance_missing', 'HIGH',
      'Training or fine-tuning pipeline found with no data governance plan — EU AI Act Art. 10.',
      'Document data quality criteria, bias assessment, and data provenance in .thesmos/data-governance.md.',
      '.thesmos/data-governance.md')];
  },
};

// ── Rule: EU_AI_005 — No technical documentation for model ───────────────────

const EU_AI_005: ThesmosRule = {
  id: 'EU_AI_005',
  category: 'eu_ai_no_technical_documentation',
  severity: 'HIGH',
  description: 'AI system with no technical documentation (model card) — EU AI Act Art. 11 requirement.',
  tags: ['eu-ai-act', 'transparency', 'model-card'],
  frameworks: ['eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 11 requires technical documentation for high-risk AI systems covering the system description, risk management, training data, and performance monitoring.',
    commonViolations: [
      'AI system deployed with no model card or technical documentation',
        'Technical docs exist but are not kept up to date with model changes',
        'Documentation missing key sections required by Annex IV',
    ],
    goodExample: `// Technical documentation: docs/technical-documentation.md (Annex IV compliant)
const result = await model.predict(input);`,
    badExample: `const result = await model.predict(input); // no technical documentation`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasAiCall = files.some((cf) => LLM_CALL_RE.test(cf.content));
    if (!hasAiCall) return [];
    const hasModelCard = existsSync(join(root, '.thesmos', 'model-card.md'))
      || existsSync(join(root, 'docs', 'model-card.md'))
      || existsSync(join(root, 'MODEL_CARD.md'));
    if (hasModelCard) return [];
    return [f('eu_ai_no_technical_documentation', 'HIGH',
      'AI/LLM integration found with no model card or technical documentation — EU AI Act Art. 11.',
      'Create .thesmos/model-card.md describing the model, intended use, performance metrics, and limitations.',
      '.thesmos/model-card.md')];
  },
};

// ── Rule: EU_AI_006 — No automatic logging for high-risk AI decisions ─────────

const EU_AI_006: ThesmosRule = {
  id: 'EU_AI_006',
  category: 'eu_ai_no_decision_audit_log',
  severity: 'HIGH',
  description: 'High-risk AI decision without append-only audit logging — EU AI Act Art. 12 traceability requirement.',
  tags: ['eu-ai-act', 'audit-log', 'traceability'],
  frameworks: ['eu-ai-act', 'hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 12 requires high-risk AI systems to log enough information to enable post-market monitoring and investigation of incidents.',
    commonViolations: [
      'AI decisions not logged or logged in a mutable store',
        'Logs deleted after 30 days without regulatory hold',
        'Log entries missing required fields (timestamp, input hash, output, model version)',
    ],
    goodExample: `await auditLog.append({ id: uuid(), decision, inputHash: hash(input), model, ts: Date.now() });`,
    badExample: `await db.log.create({ data: { decision } }); // mutable, missing required fields`,
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isSourceFile(cf.path) || isTestFile(cf.path)) continue;
      if (!HIGH_RISK_DECISION_RE.test(cf.content)) continue;
      if (!LLM_CALL_RE.test(cf.content)) continue;
      if (AUDIT_LOG_RE.test(cf.content)) continue;
      const line = findLineNumber(cf.content, 'completion') ?? findLineNumber(cf.content, 'openai');
      findings.push(f('eu_ai_no_decision_audit_log', 'HIGH',
        'High-risk AI decision made without an audit log — EU AI Act Art. 12 requires automatic traceability.',
        'Log each AI decision (input hash, model, output, timestamp, user) to an append-only audit store.',
        cf.path, line));
    }
    return findings;
  },
};

// ── Rule: EU_AI_007 — Human oversight not implemented ────────────────────────

const EU_AI_007: ThesmosRule = {
  id: 'EU_AI_007',
  category: 'eu_ai_no_human_oversight',
  severity: 'HIGH',
  description: 'High-risk AI outcome applied automatically with no human review gate — EU AI Act Art. 14.',
  tags: ['eu-ai-act', 'human-oversight', 'high-risk'],
  frameworks: ['eu-ai-act', 'nist-ai-rmf'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 14 requires high-risk AI systems to be designed to allow natural persons to oversee and intervene in the AI output before consequential actions are taken.',
    commonViolations: [
      'Credit decision applied automatically without human sign-off',
        'Hiring pipeline auto-rejects candidates with no human review stage',
        'Medical treatment recommendation applied directly by the system',
    ],
    goodExample: `if (HIGH_RISK_DECISION) { await queueForHumanReview(decision); } else { applyDecision(decision); }`,
    badExample: `applyDecision(await model.predict(input)); // no human oversight gate`,
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isSourceFile(cf.path) || isTestFile(cf.path)) continue;
      if (!HIGH_RISK_DECISION_RE.test(cf.content)) continue;
      if (!LLM_CALL_RE.test(cf.content)) continue;
      if (HUMAN_GATE_RE.test(cf.content)) continue;
      const line = findLineNumber(cf.content, 'completion') ?? 1;
      findings.push(f('eu_ai_no_human_oversight', 'HIGH',
        'High-risk AI decision applied with no human review gate — EU AI Act Art. 14 mandates meaningful oversight.',
        'Add a human-in-the-loop step before acting on AI output for credit, hiring, medical, or enforcement decisions.',
        cf.path, line));
    }
    return findings;
  },
};

// ── Rule: EU_AI_008 — GPAI model with no capability evaluation ───────────────

const EU_AI_008: ThesmosRule = {
  id: 'EU_AI_008',
  category: 'eu_ai_gpai_no_capability_eval',
  severity: 'MEDIUM',
  description: 'General-purpose AI model used without a capability evaluation — EU AI Act Art. 51.',
  tags: ['eu-ai-act', 'gpai', 'evaluation'],
  frameworks: ['eu-ai-act'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'EU AI Act Art. 13 requires high-risk AI systems to be sufficiently transparent for deployers and users to interpret the system\'s output and use it appropriately.',
    commonViolations: [
      'AI confidence score returned without explanation of what it means',
        'Model outputs lack feature attribution or confidence interval',
        'Users have no way to understand why a decision was made',
    ],
    goodExample: `res.json({ decision, confidence, explanation: await explain(features), appealLink });`,
    badExample: `res.json({ decision }); // no transparency`,
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    const hasGpai = files.some((cf) => LLM_CALL_RE.test(cf.content));
    if (!hasGpai) return [];
    const hasEval = existsSync(join(root, '.thesmos', 'capability-evaluation.md'))
      || existsSync(join(root, 'docs', 'capability-evaluation.md'))
      || existsSync(join(root, 'evals'))
      || existsSync(join(root, 'eval'));
    if (hasEval) return [];
    return [f('eu_ai_gpai_no_capability_eval', 'MEDIUM',
      'General-purpose AI model integrated with no capability evaluation — EU AI Act Art. 51.',
      'Document model capabilities and limitations in .thesmos/capability-evaluation.md or an /evals directory.',
      '.thesmos/capability-evaluation.md')];
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const EU_AI_ACT_RULES: ThesmosRule[] = [
  EU_AI_001,
  EU_AI_002,
  EU_AI_003,
  EU_AI_004,
  EU_AI_005,
  EU_AI_006,
  EU_AI_007,
  EU_AI_008,
];
