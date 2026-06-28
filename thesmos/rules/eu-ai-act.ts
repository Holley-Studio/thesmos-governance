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
