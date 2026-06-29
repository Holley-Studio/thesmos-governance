# Model Card — thesmos-governance AI Governance Agent

**Last updated:** 2026-06-29  
**Governed by:** EU AI Act Art. 13 (Transparency), Art. 9 (Risk Management)  
**Risk class:** Limited risk (governance tooling, no autonomous deployment authority)

---

## System Description

Thesmos-governance is an AI-augmented static analysis and governance framework for software
repositories. It operates as a Claude Code agent (claude-sonnet-4-6) guided by 1,130 security,
quality, and compliance rules across 60+ categories.

**Primary function:** Detect policy violations in changed files, generate governance reports,
and advise human developers — it does not autonomously merge code, deploy, or modify production
systems.

---

## Intended Use

| Use case | Supported |
|---|---|
| Pre-commit / PR code review | ✅ |
| CI gate on BLOCKER/HIGH violations | ✅ |
| Governance documentation generation | ✅ |
| Autonomous code deployment | ❌ |
| Medical, legal, or financial decisions | ❌ |
| Biometric processing | ❌ |

---

## AI Model Details

| Field | Value |
|---|---|
| Provider | Anthropic |
| Model ID | claude-sonnet-4-6 |
| Modality | Text (code analysis) |
| Fine-tuned | No |
| Knowledge cutoff | August 2025 |

---

## Human Oversight

All findings are advisory. Developers must review and approve every suggested fix.
BLOCKER findings gate CI but require a human to merge or override via `disabledRules`.
No action is taken autonomously without explicit human approval.

---

## Limitations

- Static analysis only — cannot reason about runtime behavior or distributed system state.
- Rule coverage is heuristic; false positives are expected on complex patterns.
- Not a substitute for penetration testing, formal security audits, or legal counsel.
- Rules targeting specific frameworks (HIPAA, EU AI Act) require domain expert validation.

---

## Risk Management

- Rule severity reviewed per release (see `.thesmos/RULES.md`).
- BLOCKER rules require independent security review before changes.
- `disabledRules` override is logged and auditable via `audit.jsonl`.
- Agent scope restricted by `.thesmos/scope.json` and `.claude/settings.json` bash deny-list.

---

## Transparency Disclosures

- All governance decisions are rule-based and traceable to a specific rule ID.
- Model outputs are advisory text, not legal or medical advice.
- This system does not learn from project data; no training occurs at inference time.
- Audit trail: `.thesmos/audit.jsonl` (append-only).

---

## Contact

**Maintainer:** Matt Holley — holley42@yahoo.com  
**Repository:** https://github.com/Holley-Studio/thesmos-governance  
**License:** SEE LICENSE IN LICENSE
