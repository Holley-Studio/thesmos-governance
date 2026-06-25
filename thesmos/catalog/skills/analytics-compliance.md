---
id: analytics-compliance
name: Analytics Compliance
type: skill
version: 1.0.0
owner: thesmos
tags:
  - analytics
  - gdpr
  - consent
  - privacy
enabled: true
---

# Analytics Compliance

## Purpose

Reviews analytics implementation for GDPR and CCPA compliance: consent-gated event firing, PII in event properties, cookie consent configuration, and data retention settings.

## When to use

- Before launching analytics in a GDPR region
- When integrating a consent management platform
- Annual privacy reviews
- When a data protection authority requests evidence of compliance

## Required inputs

- Analytics implementation files
- Consent management platform integration
- Event schema definitions

## Workflow steps

1. Map all analytics events and their trigger conditions
2. Verify events do not fire before consent is granted
3. Check event properties for PII (email, name, user identifiers)
4. Verify consent categories are correctly assigned to each event
5. Check cookie expiry settings against GDPR requirements (max 12 months for non-essential)
6. Run `npm run thesmos:review` for logging and secret findings

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A compliance assessment per event: consent gate status, PII field inventory, cookie classification, and data retention alignment. Non-compliant events receive specific remediation steps.

## Related agents

- analytics-reviewer
- privacy-reviewer

## Related rule packs

- @thesmos/core
