---
id: ci-pipeline-audit
name: CI Pipeline Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - ci
  - github-actions
  - pipeline
  - security
enabled: true
---

# CI Pipeline Audit

## Purpose

Audits CI/CD pipeline configuration for security, correctness, and efficiency: unpinned action versions, overly broad permissions, secrets in logs, slow jobs that could be parallelised, and missing required status checks.

## When to use

- When adding or significantly modifying CI workflows
- Quarterly CI security audits
- After a supply chain incident involving GitHub Actions
- Before enforcing required status checks on the main branch

## Required inputs

- `.github/workflows/*.yml` files
- Current branch protection settings
- CI execution timing reports

## Workflow steps

1. Audit action versions — third-party actions should be pinned to a commit SHA
2. Review workflow permissions — prefer `contents: read` as minimum
3. Check for secret exposure in workflow steps (echo, env var logging)
4. Identify slow jobs that could run in parallel
5. Verify all required checks are listed in branch protection
6. Run `npm run prometheus:review` on workflow files for security findings

## Prometheus commands

```bash
npm run prometheus:review
```

## Expected output

A CI audit report: unpinned actions, excessive permissions, potential secret exposure, parallelisation opportunities, and missing branch protection requirements. Prioritised by security risk.

## Related agents

- ci-reviewer
- devops-reviewer

## Related rule packs

- @prometheus/core
