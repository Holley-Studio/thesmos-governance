# Workflow: Security Audit Sprint

> **When to use:** Security review of a PR, feature, component, API endpoint, or full codebase segment before merge or deployment. Also for incident response and regulatory audit preparation.
>
> **Trigger phrase to Zeus:** `"Security audit [component/PR/feature] before we ship."`
>
> **Agents involved:** Zeus → Argus → (conditional) Themis → Mnemosyne
>
> **Estimated sessions:** 1–3 sessions depending on findings severity.

---

## Phase 1 — Initial Security Review

### Step 1: Zeus routes to Argus

```
⚡ ZEUS — EXECUTIVE ORCHESTRATION

Situation: Security review required for [component/PR] before [merge/deployment/compliance deadline].
Argus will threat-model, score findings by severity, and return a priority-ordered remediation list.
Themis is on standby for regulatory implications if BLOCKER findings involve PII or compliance risk.

Routing:
  • God Agent Argus → Full security audit: STRIDE threat model, CVSS-scored findings, remediation patterns

Dependency order:
  1. Argus audit (blocking — nothing ships until this clears)
  2. Themis (conditional — only if Argus flags regulatory exposure)
  3. Mnemosyne (final — documents audit trail regardless of outcome)

Success criteria:
  [ ] Argus delivers: STRIDE table across all 6 categories
  [ ] All findings scored with CVSS and exploitation scenario
  [ ] Residual risk statement present
  [ ] 0 BLOCKERs confirmed before merge is unblocked

— Zeus | Executive Orchestration
Thesmos check: AGNT_001 ✅ | AGNT_006 ✅
```

---

### Step 2: Argus — Full Security Audit

**Trigger:** "Argus, security-audit [component]. Run STRIDE across all 6 categories. CVSS-score every finding. Return a priority-ordered remediation list."

**Argus delivers:**

**STRIDE threat model** (all 6 categories — omitting any requires explicit justification):

| Category | Threat | Finding | CVSS | Priority |
|---|---|---|---|---|
| Spoofing | [e.g., Missing origin validation on WebSocket] | [SEC/AUTH rule ID] | 8.1 HIGH | P0 |
| Tampering | [e.g., SQL built with template literals] | [SEC_006] | 9.8 CRITICAL | P0 — BLOCKER |
| Repudiation | [e.g., No audit log on delete operations] | [LOG_016] | 4.2 MEDIUM | P2 |
| Information Disclosure | [e.g., stack traces in API error responses] | [ERR_005] | 5.3 MEDIUM | P1 |
| Denial of Service | [e.g., No rate limiting on LLM endpoint] | [AI_006] | 6.5 HIGH | P1 |
| Elevation of Privilege | [e.g., User ID from req.body trusted] | [AUTH_004] | 9.1 CRITICAL | P0 — BLOCKER |

**For every Critical/High finding:**
- Exploitation scenario: "An attacker could [specific attack], resulting in [specific impact]"
- Copy-paste-ready remediation: exact code pattern to replace the vulnerable pattern
- Verification step: how to confirm the fix is correct

**Residual risk statement** (always present, even for 0-finding reviews):
> "After remediation of [N] findings, residual risk is assessed as [Low/Medium/High]. Remaining exposure: [specific known limitations or accepted risks]."

---

## Phase 2 — BLOCKER Remediation (if findings present)

### Hard stop: BLOCKER gating

If Argus returns any BLOCKER finding:

```
⚡ ZEUS — BLOCKER HOLD

Argus has returned [N] BLOCKER findings on [component].

BLOCKER list:
  1. [Finding + CVSS + rule ID] — Assigned to: [engineer/team]
  2. [Finding + CVSS + rule ID] — Assigned to: [engineer/team]

Nothing in scope ships until Argus confirms: 0 BLOCKERs.

Routing Themis: [conditional — if any BLOCKER involves PII, RLS, or regulatory data]

— Zeus | Executive Orchestration
```

---

### Conditional Step 3A: Themis — Regulatory & Legal Exposure

**Triggered when:** Argus flags findings involving PII logging, RLS disabled on user data, unencrypted PHI, missing consent revocation, or any GDPR/HIPAA/SOC 2 compliance-adjacent finding.

**Trigger:** "Themis, Argus has flagged [finding description]. Assess the regulatory exposure — GDPR implications, notification requirements, and remediation timeline requirement."

**Themis delivers:**
- Jurisdiction identified: which regulations apply to this finding (GDPR Art. X, HIPAA §164.X, SOC 2 CC6.X)
- Exposure assessment: is this a violation, a risk, or a documentation gap?
- Notification requirement: does this constitute a breach requiring DPA notification? Timeline?
- Remediation timeline requirement: is there a legally mandated deadline for the fix?
- Attorney review checklist: 5–8 specific items for outside counsel if litigation exposure is present
- Disclaimer: Themis provides legal framework analysis, not legal advice — specific jurisdictions require licensed counsel

**Quality gate:** Themis output must state the jurisdiction before every regulatory claim. "GDPR requires..." without "Under GDPR Art. 6(1)(a) in EU member states..." fails the gate.

---

### Conditional Step 3B: Argus — Re-review after remediation

After BLOCKERs are remediated:

**Trigger:** "Argus, re-review [specific findings] after remediation. Confirm 0 BLOCKERs and update the residual risk statement."

**Argus delivers:**
- Per-finding remediation verification: confirmed fixed / confirmed not fixed / partially fixed
- Updated residual risk statement
- Merge/deploy clearance: explicit green or explicit hold

---

## Phase 3 — Audit Trail Documentation

### Step 4: Mnemosyne — Security Log Entry

**Triggered:** After Argus confirms 0 BLOCKERs (whether from the initial review or after remediation).

**Trigger:** "Mnemosyne, document the security audit for [component]. Log findings, remediations, and Argus's clearance for the audit trail."

**Mnemosyne delivers:**
- Structured audit log entry for `.thesmos/audit.jsonl` or the designated audit store
- Audit record format:

```json
{
  "type": "security_audit",
  "date": "YYYY-MM-DD",
  "component": "[component name]",
  "auditor": "Argus",
  "findings_total": N,
  "findings_by_severity": { "critical": N, "high": N, "medium": N, "low": N },
  "blockers_resolved": N,
  "legal_review": true/false,
  "legal_reviewer": "Themis",
  "cleared_by": "Argus",
  "cleared_at": "YYYY-MM-DD",
  "residual_risk": "Low/Medium/High",
  "notes": "[any accepted risks or known limitations]"
}
```

- Human-readable summary for `.thesmos/brain.md` or the project knowledge base
- Link to findings list (PR comment, Linear ticket, or Notion doc) for traceability

---

## Zeus Council Report (Final)

```
⚡ ZEUS — COUNCIL REPORT

👁 Argus has delivered: Security audit of [component] complete.
   Initial findings: [N] BLOCKER, [N] HIGH, [N] MEDIUM, [N] LOW.
   BLOCKERs resolved: [N/N] confirmed by Argus.
   Residual risk: [Low/Medium/High].
   Merge: [CLEARED / HOLD — reason].

⚖️ Themis has delivered: [Conditional — only if invoked]
   Regulatory exposure: [GDPR/HIPAA/SOC 2] — [Low/Medium/High].
   Notification required: [Yes/No]. Deadline: [date or N/A].

📚 Mnemosyne has delivered: Audit log entry recorded.
   Audit trail complete for [compliance/legal/internal] purposes.

[If CLEARED:]
Security audit complete. [Component] is cleared for [merge/deployment].

[If HOLD:]
Security hold remains. [N] findings unresolved. Re-review required after remediation.

— Zeus | Executive Orchestration
Thesmos check: AGNT_001 ✅ | AGNT_006 ✅
```

---

## Scope variants

### PR review (fast track — single endpoint or small change)

```
⚡ ZEUS → Argus: "Review PR #[N] — focus on [auth, SQL, PII] surface area. Return STRIDE
for affected attack surface only. Flag BLOCKERs. Deprioritise LOW findings."
```

Argus returns a focused STRIDE table covering only the changed surface, with BLOCKER/HIGH findings called out first.

### Full codebase audit (compliance preparation)

Add Nemesis parallel with Argus:
> "Nemesis, run GRC and compliance assessment alongside Argus's security audit — SOC 2 CC controls, GDPR Article mapping, and risk register update."

Mnemosyne documents both outputs in a unified compliance audit record.

### Incident response (live production issue)

```
⚡ ZEUS — INCIDENT

Situation: Live security incident. [Brief description.]

Routing:
  • Argus → Immediate threat assessment: is the attack ongoing? What is the blast radius?
  • Themis → Notification obligations: DPA, affected users, partners — timeline and scope
  • Hera → Incident response coordination: internal comms, team roles, timeline tracking

Dependency order:
  1. Argus confirms blast radius (blocks everything else — we cannot notify without scope)
  2. Themis determines notification obligations (depends on Argus's scope assessment)
  3. Hera coordinates execution (depends on Themis's notification requirements)

Escalate to God Council immediately if blast radius is unknown or if regulatory notification
deadline is within 72 hours (GDPR breach notification window).
```

---

## Handoff contracts

| From | To | What is handed off |
|---|---|---|
| Zeus | Argus | Component/PR in scope, focus areas, deadline |
| Argus | Themis | Specific findings with PII/compliance implications |
| Argus | Zeus | STRIDE table, CVSS scores, BLOCKER list, clearance status |
| Themis | Zeus | Regulatory exposure level, notification decision, timeline |
| Zeus | Mnemosyne | Full audit outcome (Argus + Themis outputs) |
| Mnemosyne | Zeus | Audit log entry location and confirmation |
