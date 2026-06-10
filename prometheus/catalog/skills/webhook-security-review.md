---
id: webhook-security-review
name: Webhook Security Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - webhooks
  - security
  - hmac
  - api
enabled: true
---

# Webhook Security Review

## Purpose

Reviews webhook handler implementations for security: HMAC signature verification, replay attack prevention, idempotency handling, and correct secret management for webhook secrets.

## When to use

- When adding a new webhook endpoint (Stripe, GitHub, Shopify, etc.)
- Security reviews of existing webhook handlers
- After a webhook spoofing incident
- Before a PCI or SOC2 audit

## Required inputs

- Webhook handler route files
- Webhook secret configuration
- Provider-specific signature verification documentation

## Workflow steps

1. Identify all webhook handler routes (`app/api/webhooks/**`)
2. Verify each handler verifies the incoming signature before processing
3. Check the timing-safe comparison for signatures (avoid timing attacks)
4. Verify webhook secrets are stored in environment variables, not source
5. Check for idempotency handling (duplicate event prevention)
6. Run `npm run prometheus:review` for `[AUTH_001]` and `[SEC_001]` findings

## Prometheus commands

```bash
npm run prometheus:review
```

## Expected output

A webhook security assessment per handler: signature verification status, replay protection presence, idempotency mechanism, secret management correctness, and BLOCKER findings for missing signature verification.

## Related agents

- api-reviewer
- security-reviewer

## Related rule packs

- @prometheus/core
