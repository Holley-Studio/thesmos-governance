# Compliance Review Playbook

## When to use
Before a release, audit, or when onboarding to a new regulatory framework.

## Running compliance reports

```bash
# GDPR
npx thesmos compliance --standard gdpr

# EU AI Act
npx thesmos compliance --standard eu-ai-act

# HIPAA (healthcare projects only)
npx thesmos compliance --standard hipaa

# DORA (EU financial entities only)
npx thesmos compliance --standard dora

# SOC 2
npx thesmos compliance --standard soc2

# NIST AI RMF
npx thesmos compliance --standard nist-ai-rmf

# Write report to file
npx thesmos compliance --standard gdpr --write
npx thesmos compliance --standard gdpr --output ./reports/gdpr-audit.md
```

## Interpreting findings

| Severity | Action |
|----------|--------|
| BLOCKER  | Must fix before deployment. PR will be blocked in CI. |
| HIGH     | Fix within current sprint. Document exception if deferring. |
| MEDIUM   | Fix within 30 days or document risk acceptance. |
| LOW      | Fix opportunistically. |

## Evidence collection

For each BLOCKER/HIGH finding, collect:
1. **Description** — what the rule detected
2. **Remediation** — the fix applied
3. **Commit** — SHA of the fix
4. **Verification** — re-run report showing the finding resolved

Store evidence in `compliance/evidence/` as `{RULE_ID}-{date}.md`.

## Framework-specific notes

**GDPR**: Focus on consent, deletion endpoints, cross-border transfer SCCs, and DPIA for Art. 35 processing.

**EU AI Act**: Requires conformity-assessment.md and model-card.md before any Annex III system goes live.

**HIPAA**: All PHI fields in Prisma schema must have encryption annotation. BAA required before sending PHI to any LLM API.

**DORA**: Only applies to EU financial entities. Requires incident-classification.md, third-party-ict-register.md, and business-continuity.md.

**SOC 2**: Maps to existing SEC_, AUTH_, and LOG_ rules. Run `thesmos scan` to get current posture before Type II audit.

**NIST AI RMF**: Maps GOVERN → MANAGE functions to existing AI_ rules.

## CI gate

Add to your CI pipeline to block deployments with BLOCKER findings:
```bash
npm run thesmos:validate
```
