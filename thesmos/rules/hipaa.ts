// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * HIPAA rules — HIPAA_001–008
 * Covers PHI encryption (§164.312(a)(2)(iv)), transmission security
 * (§164.312(e)(2)(ii)), access controls (§164.312(a)(1)), audit
 * controls (§164.312(b)), minimum necessary (§164.502(b)),
 * LLM BAA, session timeout (§164.312(a)(2)(iii)), and backup (§164.308(a)(7)).
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

function isPrismaSchema(path: string): boolean {
  return /schema\.prisma$/.test(path);
}

function isApiRoute(path: string): boolean {
  return /(?:api|routes?|handlers?|controllers?)/.test(path) && isSourceFile(path);
}

function findLineNumber(content: string, searchStr: string): number | undefined {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(searchStr)) return i + 1;
  }
  return undefined;
}

const PHI_FIELD_RE = /\b(?:patient|diagnosis|prescription|medical.?record|health.?info|phi\b|protected.?health|dob|date.?of.?birth|ssn|social.?security|insurance.?id|member.?id|npi|icd.?\d)\b/i;
const LLM_CALL_RE = /openai|anthropic|bedrock|vertex|azureopenai|gemini|llm|completion|chat\.completions/i;
const AUDIT_LOG_RE = /audit.?log|audit_trail|auditTrail|access.?log/i;
const AUTH_RE = /authenticate|authorize|requireAuth|getSession|verifyToken|isAuthenticated|checkPermission/i;
const SESSION_TIMEOUT_RE = /maxAge|session.?expir|timeout|sessionTimeout|SESSION_TIMEOUT/i;
const ENCRYPT_RE = /encrypt|KMS|kms|aes|AES|crypto\.cipher|CryptoJS/i;

// ── Rule: HIPAA_001 — PHI stored without encryption at rest ──────────────────

const HIPAA_001: ThesmosRule = {
  id: 'HIPAA_001',
  category: 'hipaa_phi_unencrypted_at_rest',
  severity: 'BLOCKER',
  description: 'PHI fields stored in database without encryption at rest — HIPAA §164.312(a)(2)(iv).',
  tags: ['hipaa', 'phi', 'encryption'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'HIPAA §164.312(a)(2)(iv) requires covered entities to implement encryption for PHI at rest where reasonable and appropriate. Unencrypted PHI columns are a reportable breach if the database is accessed — each breach can result in fines up to $1.9M per violation category per year.',
    commonViolations: ['Prisma schema with patient, diagnosis, prescription columns and no @encrypted annotation', 'MongoDB collection storing PHI documents with no field-level encryption configured'],
    goodExample: '// Use field-level encryption: KMS-encrypted columns, transparent data encryption, or application-layer AES\nmedicalRecord String @encrypted  // custom annotation or middleware handles encryption',
    badExample: 'model Patient {\n  diagnosis String\n  ssn       String\n}  // stored in plaintext — HIPAA §164.312(a)(2)(iv) violation',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isPrismaSchema(cf.path)) continue;
      if (!PHI_FIELD_RE.test(cf.content)) continue;
      if (ENCRYPT_RE.test(cf.content)) continue;
      findings.push(f('hipaa_phi_unencrypted_at_rest', 'BLOCKER',
        'PHI fields found in Prisma schema without encryption annotation — HIPAA §164.312(a)(2)(iv).',
        'Use field-level encryption (e.g., @encrypted or an application-layer cipher) for all PHI columns.',
        cf.path));
    }
    return findings;
  },
};

// ── Rule: HIPAA_002 — PHI transmitted without TLS ────────────────────────────

const HIPAA_002: ThesmosRule = {
  id: 'HIPAA_002',
  category: 'hipaa_phi_no_tls',
  severity: 'BLOCKER',
  description: 'PHI transmitted over HTTP (non-TLS) — HIPAA §164.312(e)(2)(ii) requires encryption in transit.',
  tags: ['hipaa', 'phi', 'tls'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'HIPAA §164.312(e)(2)(ii) requires encryption for PHI in transit. Transmitting PHI over unencrypted HTTP means it can be intercepted by any observer on the network path — a per se HIPAA violation triggering mandatory breach notification and potential fines.',
    commonViolations: ['fetch("http://api.example.com/patients/" + id)  // PHI fetched over HTTP', 'axios.post("http://ehr.internal/records", { patient, diagnosis })  // internal but still unencrypted'],
    goodExample: 'const res = await fetch("https://api.example.com/patients/" + id, { headers: { Authorization: `Bearer ${token}` } });',
    badExample: 'const data = await http.get(`http://phi-service/records/${patientId}`);  // HIPAA §164.312(e)(2)(ii) violation',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    const HTTP_RE = /http:\/\/(?!localhost)[^\s"'`]+/i;
    for (const cf of (input.changedFiles ?? [])) {
      if (!isSourceFile(cf.path) || isTestFile(cf.path)) continue;
      if (!PHI_FIELD_RE.test(cf.content)) continue;
      if (!HTTP_RE.test(cf.content)) continue;
      const line = findLineNumber(cf.content, 'http://');
      findings.push(f('hipaa_phi_no_tls', 'BLOCKER',
        'PHI transmitted over http:// — HIPAA §164.312(e)(2)(ii) mandates TLS for PHI in transit.',
        'Replace all http:// endpoints with https://. Never transmit PHI over unencrypted connections.',
        cf.path, line));
    }
    return findings;
  },
};

// ── Rule: HIPAA_003 — No access control for PHI ──────────────────────────────

const HIPAA_003: ThesmosRule = {
  id: 'HIPAA_003',
  category: 'hipaa_phi_no_access_control',
  severity: 'BLOCKER',
  description: 'API route accessing PHI with no authentication check — HIPAA §164.312(a)(1).',
  tags: ['hipaa', 'phi', 'access-control'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'HIPAA §164.312(a)(1) requires covered entities to implement technical policies that allow only authorized users to access PHI. An unprotected API endpoint that returns PHI is a per se violation — each unauthorized access event can trigger individual breach reports.',
    commonViolations: ['export async function GET(req) { const patient = await db.patient.findUnique(); return Response.json(patient); }  // no auth check', 'app.get("/records/:id", async (req, res) => { res.json(await findRecord(req.params.id)); });  // unauthenticated'],
    goodExample: 'export async function GET(req) {\n  const session = await getSession(req);\n  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });\n  const patient = await db.patient.findUnique({ where: { id: session.userId } });\n  return Response.json(patient);\n}',
    badExample: 'app.get("/phi/:id", (req, res) => res.json(db.query("SELECT * FROM phi WHERE id=?", [req.params.id])));  // no auth — §164.312(a)(1) violation',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isApiRoute(cf.path)) continue;
      if (!PHI_FIELD_RE.test(cf.content)) continue;
      if (AUTH_RE.test(cf.content)) continue;
      findings.push(f('hipaa_phi_no_access_control', 'BLOCKER',
        'API route processes PHI without an authentication/authorization check — HIPAA §164.312(a)(1).',
        'Add authentication middleware and role-based access controls before any PHI access.',
        cf.path));
    }
    return findings;
  },
};

// ── Rule: HIPAA_004 — Audit controls missing on PHI access ───────────────────

const HIPAA_004: ThesmosRule = {
  id: 'HIPAA_004',
  category: 'hipaa_phi_no_audit_log',
  severity: 'HIGH',
  description: 'PHI accessed in API route with no audit log — HIPAA §164.312(b) requires hardware/software activity records.',
  tags: ['hipaa', 'audit', 'phi'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'HIPAA §164.312(b) requires covered entities to implement hardware, software, and procedural mechanisms that record and examine activity in information systems containing PHI. Audit logs must capture who accessed what PHI, when, and from where — without this you cannot detect breaches or fulfill HIPAA investigation obligations.',
    commonViolations: ['PHI API route that queries the database but writes no access log', 'Patient record view with no audit entry capturing user ID, timestamp, and record accessed'],
    goodExample: 'const record = await db.patient.findUnique({ where: { id } });\nawait auditLog.append({ userId: session.userId, action: "read", recordId: id, timestamp: Date.now(), ip: req.ip });\nreturn record;',
    badExample: 'const patient = await db.patient.findUnique({ where: { id } });\nreturn Response.json(patient);  // no audit log — §164.312(b) violation',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isApiRoute(cf.path)) continue;
      if (!PHI_FIELD_RE.test(cf.content)) continue;
      if (AUDIT_LOG_RE.test(cf.content)) continue;
      findings.push(f('hipaa_phi_no_audit_log', 'HIGH',
        'PHI accessed in API route with no audit log — HIPAA §164.312(b) requires activity records.',
        'Log each PHI access (user, timestamp, record ID, action) to an immutable audit trail.',
        cf.path));
    }
    return findings;
  },
};

// ── Rule: HIPAA_005 — PHI in API response without minimum-necessary filter ───

const HIPAA_005: ThesmosRule = {
  id: 'HIPAA_005',
  category: 'hipaa_phi_minimum_necessary_missing',
  severity: 'HIGH',
  description: 'API response may return full PHI record without minimum-necessary filtering — HIPAA §164.502(b).',
  tags: ['hipaa', 'phi', 'minimum-necessary'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'HIPAA §164.502(b) minimum necessary standard requires that only PHI reasonably necessary to accomplish the intended purpose is used or disclosed. Returning full patient records when only a subset is needed exposes more PHI than warranted and violates this standard.',
    commonViolations: ['db.patient.findMany()  // returns all fields including diagnosis, SSN, prescriptions', "SELECT * FROM patients WHERE clinicId = $1  // returns everything when only name + appointment is needed"],
    goodExample: 'const patient = await db.patient.findUnique({ where: { id }, select: { name: true, appointmentDate: true } });  // only what the caller needs',
    badExample: 'const records = await db.patient.findMany();  // §164.502(b) violation — returns all PHI for all patients',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    const SELECT_STAR_RE = /findMany\(\)|findFirst\(\)|findUnique\(\)|\bSELECT \*/i;
    for (const cf of (input.changedFiles ?? [])) {
      if (!isApiRoute(cf.path)) continue;
      if (!PHI_FIELD_RE.test(cf.content)) continue;
      if (!SELECT_STAR_RE.test(cf.content)) continue;
      const line = findLineNumber(cf.content, 'findMany') ?? findLineNumber(cf.content, 'SELECT *');
      findings.push(f('hipaa_phi_minimum_necessary_missing', 'HIGH',
        'PHI route returns all fields without a select clause — HIPAA §164.502(b) minimum-necessary standard.',
        'Use a select clause to return only the PHI fields required for the specific purpose.',
        cf.path, line));
    }
    return findings;
  },
};

// ── Rule: HIPAA_006 — PHI sent to LLM without BAA reference ─────────────────

const HIPAA_006: ThesmosRule = {
  id: 'HIPAA_006',
  category: 'hipaa_phi_to_llm_no_baa',
  severity: 'HIGH',
  description: 'PHI sent to an external LLM API with no Business Associate Agreement referenced.',
  tags: ['hipaa', 'phi', 'llm', 'baa'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'Under HIPAA, an LLM vendor processing PHI on your behalf is a Business Associate. 45 CFR §164.308(b) requires a signed Business Associate Agreement before disclosing PHI to them. Sending PHI to OpenAI, Anthropic, or similar without a BAA is an unlawful disclosure.',
    commonViolations: ['const summary = await openai.complete(`Patient ${patient.name} with ${patient.diagnosis}`);  // no BAA', "await anthropic.messages.create({ messages: [{ role: 'user', content: `PHI: ${phi}` }] })  // no BAA reference"],
    goodExample: '// Azure OpenAI with HIPAA BAA signed and referenced in config\n// config.llmBaa = "azure-openai-hipaa-baa-2024.pdf"\nconst result = await azureOpenAI.chat(sanitizedPrompt);  // PHI redacted or BAA in place',
    badExample: 'const dx = await openai.complete(`Diagnose: ${patient.symptoms} History: ${patient.medicalRecord}`);  // PHI to 3rd party without BAA',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const findings: Finding[] = [];
    for (const cf of (input.changedFiles ?? [])) {
      if (!isSourceFile(cf.path) || isTestFile(cf.path)) continue;
      if (!PHI_FIELD_RE.test(cf.content)) continue;
      if (!LLM_CALL_RE.test(cf.content)) continue;
      const hasBaa = /baa|business.?associate.?agreement|hipaa.?compliant|covered.?entity/i.test(cf.content);
      if (hasBaa) continue;
      const line = findLineNumber(cf.content, 'openai') ?? findLineNumber(cf.content, 'anthropic');
      findings.push(f('hipaa_phi_to_llm_no_baa', 'HIGH',
        'PHI sent to external LLM with no Business Associate Agreement reference — HIPAA violation.',
        'Obtain a BAA from the LLM provider (e.g., Azure OpenAI) and document it in a comment or config.',
        cf.path, line));
    }
    return findings;
  },
};

// ── Rule: HIPAA_007 — No automatic session timeout for PHI access ─────────────

const HIPAA_007: ThesmosRule = {
  id: 'HIPAA_007',
  category: 'hipaa_phi_session_no_timeout',
  severity: 'HIGH',
  description: 'PHI access route with no session timeout configuration — HIPAA §164.312(a)(2)(iii).',
  tags: ['hipaa', 'phi', 'session-timeout'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'HIPAA §164.312(a)(2)(iii) requires automatic logoff after a period of inactivity to prevent unauthorized access to PHI when a workstation is left unattended. Without session timeouts, a shared computer leaves PHI accessible to the next user.',
    commonViolations: ['NextAuth session with no maxAge — sessions never expire', 'JWT tokens for PHI access with no exp claim or 30-day TTL'],
    goodExample: 'export const authOptions = { session: { strategy: "jwt", maxAge: 15 * 60 } };  // 15-minute timeout for PHI sessions',
    badExample: 'const session = await iron.unseal(cookie, secret, iron.defaults);  // no maxAge — session never expires',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer', 'security-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const files = (input.changedFiles ?? []).filter(
      (cf) => isApiRoute(cf.path) && PHI_FIELD_RE.test(cf.content));
    if (files.length === 0) return [];
    const allContent = (input.changedFiles ?? []).map((cf) => cf.content).join('\n');
    const hasTimeout = SESSION_TIMEOUT_RE.test(allContent);
    if (hasTimeout) return [];
    return [f('hipaa_phi_session_no_timeout', 'HIGH',
      'PHI routes found with no session timeout configuration — HIPAA §164.312(a)(2)(iii).',
      'Configure automatic session expiry (maxAge) for sessions that access PHI.',
      files[0]!.path)];
  },
};

// ── Rule: HIPAA_008 — PHI backup plan undocumented ───────────────────────────

const HIPAA_008: ThesmosRule = {
  id: 'HIPAA_008',
  category: 'hipaa_phi_backup_undocumented',
  severity: 'MEDIUM',
  description: 'PHI stored in database with no backup/recovery plan documented — HIPAA §164.308(a)(7).',
  tags: ['hipaa', 'phi', 'backup'],
  frameworks: ['hipaa'],
  sinceVersion: '2.1.0',
  explain: {
    why: 'HIPAA §164.308(a)(7) requires a contingency plan including data backup procedures, disaster recovery, and an emergency mode operation plan for systems containing PHI. Absence of a documented backup plan means you cannot demonstrate HIPAA §164.308(a)(7) compliance during an audit.',
    commonViolations: ['PHI stored in production database with no .thesmos/backup-plan.md', 'Database contains patient records but no documented RTO/RPO or backup frequency'],
    goodExample: '// .thesmos/backup-plan.md\n// RTO: 4 hours, RPO: 1 hour\n// Daily encrypted snapshots to separate AWS region\n// Quarterly restore drills documented',
    badExample: '// PHI in production DB, no backup docs anywhere in repo — §164.308(a)(7) gap',
    relatedPlaybooks: ['hipaa.md'],
    relatedAgents: ['compliance-reviewer'],
    relatedSkills: [],
  },
  detect(input: DetectInput): Finding[] {
    const root = input.root ?? process.cwd();
    const hasPhi = (input.changedFiles ?? []).some(
      (cf) => isPrismaSchema(cf.path) && PHI_FIELD_RE.test(cf.content));
    if (!hasPhi) return [];
    const hasBackupPlan = existsSync(join(root, '.thesmos', 'backup-plan.md'))
      || existsSync(join(root, 'docs', 'backup-plan.md'))
      || existsSync(join(root, 'compliance', 'backup-plan.md'));
    if (hasBackupPlan) return [];
    return [f('hipaa_phi_backup_undocumented', 'MEDIUM',
      'PHI stored with no backup/recovery plan — HIPAA §164.308(a)(7) requires a contingency plan.',
      'Document backup procedures, RTO, and RPO for PHI systems in .thesmos/backup-plan.md.',
      '.thesmos/backup-plan.md')];
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const HIPAA_RULES: ThesmosRule[] = [
  HIPAA_001,
  HIPAA_002,
  HIPAA_003,
  HIPAA_004,
  HIPAA_005,
  HIPAA_006,
  HIPAA_007,
  HIPAA_008,
];
