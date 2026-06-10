---
id: security-scan
name: Security Scan
type: skill
version: 1.0.0
owner: prometheus
tags:
  - security
  - secrets
  - auth
  - rls
enabled: true
---

# Security Scan

## Purpose

Runs a focused security sweep across all changed files using Prometheus's security-related rules: secret detection, direct env access, missing API auth, RLS policy gaps, and admin client boundary violations.

## When to use

- Security-focused PR review
- Before merging any PR that touches auth, credentials, or database access
- Periodic security audit sweeps
- After a security incident to verify the fix does not introduce new issues

## Required inputs

- Changed files with full content and diff text
- Active Prometheus config with security rule severity settings
- `.prometheus/config.json` for severity overrides

## Workflow steps

1. Run `npm run prometheus:review` filtering for security rule categories
2. Separately scan the diff text for secret patterns: API keys, tokens, connection strings
3. Check all API route handlers for missing auth guards
4. Check all Supabase migration files for RLS policy completeness
5. Verify no admin/service-role client is used outside server context
6. Report findings grouped by risk level

## Prometheus commands

```bash
npm run prometheus:review
```

## Expected output

A security findings report with BLOCKER findings (secrets, missing auth on sensitive routes) listed first with immediate remediation steps, followed by HIGH and lower findings with recommended fixes.

## Related agents

- security-reviewer
- auth-reviewer
- database-reviewer

## Related rule packs

- @prometheus/core
