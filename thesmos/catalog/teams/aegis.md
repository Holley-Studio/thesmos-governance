---
id: aegis
name: "The Aegis — Trust, Risk & Compliance Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "Athena's aegis was not decoration — it was the shield that let heroes fight. Trust is the same: security, compliance, legal, and ethics must cover the product before growth can safely charge."
mission: Trust & compliance — security threat modeling, GRC gaps, legal risk, and AI ethics reviewed as one shield
invocation: thesmos pantheon:team aegis "[System, feature, or audit to harden]"
enabled: true
sequence:
  - argus-security-agent
  - nemesis-compliance-agent
  - themis-legal-agent
  - dike-ethics-agent
  - momus-challenger-agent
---

# The Aegis — Trust, Risk & Compliance Team

## Mission

Make a product or feature safe to ship under real constraints: security threats, compliance frameworks, legal exposure, and AI ethics. The Aegis activates before high-risk launches, vendor reviews, SOC 2 / GDPR / AI Act work, or when a BLOCKER spans security and law.

## When to invoke

- Pre-launch security + compliance review
- SOC 2 / ISO / GDPR / HIPAA / AI Act gap assessment
- Threat model for a new system that also processes personal data
- AI feature ethics + legal risk before release
- Vendor / subprocessors risk register

## Invocation

```
thesmos pantheon:team aegis "[System or feature, data classes, and the framework or risk you must satisfy]"
```

## Sequence rationale

1. **Argus** — threats, OWASP, auth/data-flow risks
2. **Nemesis** — GRC gap analysis and risk register
3. **Themis** — contracts, ToS/privacy, liability
4. **Dike** — EU AI Act / bias / responsible AI
5. **Momus** — challenges false confidence and checkbox compliance

## Output the team owes

- Threat model with prioritized risks
- Compliance gap list mapped to frameworks
- Legal / policy actions required before ship
- AI ethics risk class + human oversight needs (if AI)
- Momus challenge: "what audit finding would embarrass us in 90 days?"
