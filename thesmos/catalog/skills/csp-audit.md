---
id: csp-audit
name: Content Security Policy Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - csp
  - security
  - headers
  - xss
enabled: true
---

# Content Security Policy Audit

## Purpose

Audits the Content Security Policy configuration for completeness and correctness: missing directives, overly permissive `unsafe-inline` or `unsafe-eval`, and CSP violations that block legitimate functionality.

## When to use

- When setting up CSP for the first time
- After a CSP violation is reported in production
- Security header reviews
- Before a security audit

## Required inputs

- `next.config.ts` headers configuration
- `middleware.ts` CSP header setup
- CSP violation reports (if available)

## Workflow steps

1. Extract the current CSP header from `next.config.ts` or `middleware.ts`
2. Parse each directive and check for `unsafe-inline` and `unsafe-eval` usage
3. Verify `default-src` is set and appropriately restrictive
4. Check `script-src` for inline script allowances vs. nonce usage
5. Verify `connect-src` covers all external API endpoints
6. Recommend a nonce-based CSP if inline scripts are currently required

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A CSP directive-by-directive assessment: current value, security risk, and recommended hardening. Overall CSP score (A+ to F) based on directive strictness.

## Related agents

- security-reviewer
- compliance-reviewer

## Related rule packs

- @thesmos/core
