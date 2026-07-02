---
name: repo-health-audit
description: Provides a comprehensive health snapshot of a repository — governance coverage, rule configuration drift, adapter freshness, architecture documentation currency, and CI gate effectiveness.
---

# Repo Health Audit

## Purpose

Provides a comprehensive health snapshot of a repository: governance coverage, rule configuration drift, adapter freshness, architecture documentation currency, and CI gate effectiveness.

## When to use

- Onboarding a new repo to Thesmos governance
- Quarterly health reviews
- After a major refactor or team change
- When `thesmos doctor` reports issues

## Required inputs

- Repository root directory
- Access to `.thesmos/` directory
- Git history for staleness assessment

## Workflow steps

1. Run `npm run thesmos:doctor` to check installation health
2. Run `npm run thesmos:scan` to refresh the architecture snapshot
3. Run `npm run thesmos:validate` to check rule configuration
4. Run `npm run thesmos:ci-check` to verify adapter freshness
5. Summarise findings across all checks into a health scorecard

## Thesmos commands

```bash
npm run thesmos:doctor
npm run thesmos:scan
npm run thesmos:validate
npm run thesmos:ci-check
```

## Expected output

A health scorecard with green/yellow/red status for each category (governance, adapters, architecture docs, CI gate, rule config) and a prioritised remediation list.

## Related agents

- governance-reviewer
- architecture-reviewer

## Related rule packs

- @thesmos/core
