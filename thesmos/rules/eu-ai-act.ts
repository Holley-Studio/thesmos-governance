// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
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
// Fingerprint terms require biometric context (scan/verify/auth/etc.) so that
// code-authorship terms (ai-fingerprint, cmdAiFingerprint, fingerprintFinding)
// never match while fingerprintScanner / verifyFingerprint / fingerprint_auth do.
const BIOMETRIC_RE = /facial.?recogn|iris.?scan|biometric.?verif|real.?time.?remote.?biometric|voice.?print|(?:finger|thumb).?print.?(?:scan|match|verif|recogn|reader|sensor|auth)|(?:scan|match|verif|recogn|read|sens|auth)\w*.?(?:finger|thumb).?print/i;
// API-shaped identifiers only — bare vendor/product words ("llm", "gemini",
// "completion") appear in help text and docs and are not evidence of an API call.
const LLM_CALL_RE = /openai\.|anthropic\.|new\s+(?:OpenAI|Anthropic)|chat\.completions|messages\.create\s*\(|generateContent\s*\(|bedrock|vertexai|azureopenai/i;
// Import/require lines name modules, not runtime biometric capability.
const IMPORT_LINE_RE = /^\s*(?:import|export)\b|require\s*\(/;
// Biometric + LLM signals must co-occur within this many lines to count as one system.
const BIOMETRIC_LLM_WINDOW = 10;
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
    why: 'EU AI Act Art. 43 requires Annex III high-risk AI systems to undergo a conformity assessment before market placement. Systems making automated credit, hiring, medical, or law-enforcement decisions that skip this step expose operators to fines up to €30M or 6% of global turnover.',
    commonViolations: ['Deploying an LLM-based credit scoring API with no .thesmos/conformity-assessment.md', 'Integrating AI hiring recommendations in production with no Art. 43 evidence file'],
    goodExample: '// .thesmos/conformity-assessment.md exists and references an EU Notified Body\n// or internal assessment per Art. 43(2) for non-third-party-assessed systems',
    badExample: 'const approved = await llm.creditScore(applicant);  // no conformity assessment filed — EU AI Act violation',
    relatedPlaybooks: ['eu-ai-act.md'],
    relatedAgents: ['compliance-reviewer', 'ai-reviewer'],
    relatedSkills: [],
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
    why: 'EU AI Act Art. 5 prohibits real-time remote biometric identification and AI-based biometric categorization in publicly accessible spaces as a fundamental rights violation. Violating this prohibition carries the highest fine tier: €35M or 7% of global turnover.',
    commonViolations: ['const match = await llm.facialRecognition(frame, database);  // real-time biometric ID', 'biometricVerify(userIris, enrolledTemplates)  // iris-based categorization without exemption'],
    goodExample: '// If biometric processing is genuinely required, obtain law-enforcement exemption\n// with specific legal basis, judicial authorization, and limited scope documentation',
    badExample: 'const category = await ai.classifyByBiometric(faceEmbedding);  // categorizes individuals — Art. 5 prohibition',
    relatedPlaybooks: ['eu-ai-act.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isSourceFile(cf.path) || isTestFile(cf.path)) continue;
      const lines = cf.content.split('\n');
      const biometricLines: number[] = [];
      const llmLines: number[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (BIOMETRIC_RE.test(line) && !IMPORT_LINE_RE.test(line)) biometricLines.push(i);
        if (LLM_CALL_RE.test(line)) llmLines.push(i);
      }
      if (biometricLines.length === 0 || llmLines.length === 0) continue;
      // Same window pattern as csharp.ts — signals must be within ±N lines.
      const hit = biometricLines.find((bi) =>
        llmLines.some((li) => Math.abs(li - bi) <= BIOMETRIC_LLM_WINDOW));
      if (hit === undefined) continue;
      findings.push(f('eu_ai_prohibited_biometric', 'BLOCKER',
        'Biometric AI capability combined with LLM call — real-time biometric ID is prohibited under EU AI Act Art. 5.',
        'Remove this capability or obtain a narrowly scoped law-enforcement exemption with documented legal basis.',
        cf.path, hit + 1));
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
    why: 'EU AI Act Art. 9 requires a continuous risk management system for Annex III systems covering: identification and analysis of known and foreseeable risks, risk estimation, and evaluation measures. Absence of this documentation blocks conformity assessment and deployment.',
    commonViolations: ['Deploying an ML hiring pipeline with no risk analysis document', 'Integrating AI credit decisions with no documented risk mitigation measures'],
    goodExample: '// .thesmos/risk-management.md exists with: risk inventory, probability/impact matrix, mitigation steps, residual risk acceptance',
    badExample: 'const score = await llm.riskScore(loan);  // no risk management plan filed — Art. 9 non-compliant',
    relatedPlaybooks: ['eu-ai-act.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const files = (input.changedFiles ?? []).filter((cf) => isSourceFile(cf.path) && !isTestFile(cf.path));
    // Art. 9 governs AI systems: require an AI call signal alongside the
    // high-risk decision keyword, same as EU_AI_001/006/007 — words like
    // "hire" or "dismiss" alone appear in ordinary non-AI business code.
    const hasAiDecision = files.some((cf) => HIGH_RISK_DECISION_RE.test(cf.content) && LLM_CALL_RE.test(cf.content));
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
    why: 'EU AI Act Art. 10 requires that training data for high-risk AI systems meets data quality criteria: relevance, representativeness, freedom from errors, and completeness. Without a documented governance plan, you cannot demonstrate compliance — fine tier up to €15M or 3% of global turnover.',
    commonViolations: ['Ingesting user data for fine-tuning with no data governance document', 'Training a classification model on a public dataset with no bias or quality assessment'],
    goodExample: '// .thesmos/data-governance.md documents: data sources, quality criteria, bias checks, consent basis, retention policy',
    badExample: 'await uploadTrainingFile(scrapeAllUsers());  // no data governance plan — Art. 10 violation',
    relatedPlaybooks: ['eu-ai-act.md', 'gdpr.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    // Prefix word boundaries: "training"/"trainModel" match, but "constraints"
    // ("s-train") and "restrain" do not.
    const TRAINING_RE = /\bfine.?tun|\btrain|\bdataset|embedding.*ingest|createFineTune|fine_tune/i;
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
    why: 'EU AI Act Art. 11 and Annex IV require providers of high-risk AI systems to maintain technical documentation before market placement. This includes general system description, design specs, training methodology, monitoring procedures, and instructions for use.',
    commonViolations: ['Shipping LLM integration with no .thesmos/model-card.md', 'AI system in production with no technical docs — blocks downstream conformity assessment'],
    goodExample: '// .thesmos/model-card.md covers: model provider, version, intended use, known limitations, performance metrics, monitoring plan',
    badExample: 'const result = await llm.complete(prompt);  // in production with no model card or technical documentation',
    relatedPlaybooks: ['eu-ai-act.md'],
    relatedAgents: ['compliance-reviewer', 'ai-reviewer'],
    relatedSkills: [],
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
    why: 'EU AI Act Art. 12 mandates automatic logging for high-risk AI systems to enable post-market monitoring and regulatory audit. Logs must be tamper-evident, retained for a defined period, and include sufficient data to reconstruct each decision.',
    commonViolations: ['LLM credit decision returned with no audit log write', 'AI hiring recommendation served with no traceability record'],
    goodExample: 'const result = await llm.creditDecision(applicant);\nawait auditLog.append({ ts: Date.now(), model, input: hash(applicant), output: result, userId });\nreturn result;',
    badExample: 'return await llm.riskScore(application);  // no log — cannot reconstruct what the AI decided after the fact',
    relatedPlaybooks: ['eu-ai-act.md', 'hipaa.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
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
    why: 'EU AI Act Art. 14 requires that high-risk AI systems allow natural persons to effectively oversee their operation, understand outputs, and override decisions. Fully automated pipelines that immediately act on AI recommendations without a human review step violate this mandate.',
    commonViolations: ['const hired = score > 0.8; await sendOfferLetter(candidate);  // no human review before action', 'if (aiLoanDecision === "approve") await disburseFunds(amount);  // automated action without oversight'],
    goodExample: 'const recommendation = await llm.assessApplication(candidate);\nawait queue.push({ type: "hiring_review", candidate, recommendation, requiresHumanApproval: true });\n// Human reviewer acts on the recommendation, not the AI directly',
    badExample: 'const score = await ai.evaluate(applicant); await hire(applicant);  // Art. 14 violation: no human in the loop',
    relatedPlaybooks: ['eu-ai-act.md'],
    relatedAgents: ['compliance-reviewer', 'ai-reviewer'],
    relatedSkills: [],
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
    why: 'EU AI Act Art. 51 requires providers and deployers of general-purpose AI models with systemic risk to conduct adversarial testing and capability evaluations. Even for non-systemic-risk GPAI, documenting capability limits is required for downstream deployers to assess downstream risk.',
    commonViolations: ['Using GPT-4 or Claude in production with no evaluation of task-specific capabilities or failure modes', 'No /evals directory or .thesmos/capability-evaluation.md documenting what the model can and cannot do'],
    goodExample: '// .thesmos/capability-evaluation.md or /evals/\n// Documents: tasks model was evaluated on, failure modes, benchmark scores, human evaluation results',
    badExample: 'const result = await openai.chat(messages);  // no eval suite, no capability docs — Art. 51 gap',
    relatedPlaybooks: ['eu-ai-act.md'],
    relatedAgents: ['compliance-reviewer', 'ai-reviewer'],
    relatedSkills: [],
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
