---
id: repo-health-audit
name: Repo Health Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - audit
  - health
  - governance
enabled: true
---

# Repo Health Audit

## Purpose

Provides a comprehensive health snapshot of a repository: governance coverage, rule configuration drift, adapter freshness, architecture documentation currency, and CI gate effectiveness.

## When to use

- Onboarding a new repo to Prometheus governance
- Quarterly health reviews
- After a major refactor or team change
- When `prometheus doctor` reports issues

## Required inputs

- Repository root directory
- Access to `.prometheus/` directory
- Git history for staleness assessment

## Workflow steps

1. Run `npm run prometheus:doctor` to check installation health
2. Run `npm run prometheus:scan` to refresh the architecture snapshot
3. Run `npm run prometheus:validate` to check rule configuration
4. Run `npm run prometheus:ci-check` to verify adapter freshness
5. Summarise findings across all checks into a health scorecard

## Prometheus commands

```bash
npm run prometheus:doctor
npm run prometheus:scan
npm run prometheus:validate
npm run prometheus:ci-check
```

## Expected output

A health scorecard with green/yellow/red status for each category (governance, adapters, architecture docs, CI gate, rule config) and a prioritised remediation list.

## Related agents

- governance-reviewer
- architecture-reviewer

## Related rule packs

- @prometheus/core
