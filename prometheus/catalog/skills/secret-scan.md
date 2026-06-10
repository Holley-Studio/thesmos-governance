---
id: secret-scan
name: Secret Scan
type: skill
version: 1.0.0
owner: prometheus
tags:
  - security
  - secrets
  - credentials
  - diff
enabled: true
---

# Secret Scan

## Purpose

Scans diff text and file content for committed secrets: API keys, tokens, connection strings, private keys, and passwords. Operates on both file content and git diff output to catch secrets before they are pushed.

## When to use

- Before every commit (pre-commit hook)
- On every PR diff as part of the CI pipeline
- After a suspected credential leak
- Security audit sweeps of git history

## Required inputs

- Git diff text for the changes being reviewed
- Full file content for new files added to the repository
- Known secret patterns (configured in Prometheus)

## Workflow steps

1. Run `npm run prometheus:review` with diff text — catches `[SEC_001]` patterns
2. Scan for additional patterns: private keys (PEM format), connection strings, JWT secrets
3. For any hit, immediately note the file, line, and redacted pattern
4. Determine if the secret is real or a placeholder (e.g. `your-api-key-here`)
5. If real: advise rotation immediately before any push
6. Report all findings with rotation instructions

## Prometheus commands

```bash
npm run prometheus:review
```

## Expected output

A secret scan result: each finding with the file, approximate line, pattern matched (e.g. "Stripe secret key pattern"), and whether it appears to be a real credential or a placeholder. Real credentials trigger a BLOCKER finding with rotation instructions.

## Related agents

- security-reviewer
- devops-reviewer

## Related rule packs

- @prometheus/core
