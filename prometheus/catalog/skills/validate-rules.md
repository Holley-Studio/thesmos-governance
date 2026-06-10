---
id: validate-rules
name: Validate Rules
type: skill
version: 1.0.0
owner: prometheus
tags:
  - validate
  - rules
  - config
  - ci
enabled: true
---

# Validate Rules

## Purpose

Validates the Prometheus rule configuration against the canonical rule registry, checking for unknown rule IDs, severity level consistency, and configuration drift between `.prometheus/config.json` and the adapter files.

## When to use

- After modifying `.prometheus/config.json`
- When `prometheus ci-check` reports configuration drift
- Before merging a PR that changes severity overrides
- Governance audit reviews

## Required inputs

- `.prometheus/config.json`
- Canonical rule registry (built into Prometheus)

## Workflow steps

1. Run `npm run prometheus:validate` to validate the configuration
2. Check for unknown rule IDs in the severity overrides
3. Verify adapter files reflect the current rule config (freshness check)
4. Run `npm run prometheus:ci-check` for the full CI gate check
5. If adapters are stale, run `npm run prometheus:adapters` to refresh them

## Prometheus commands

```bash
npm run prometheus:validate
npm run prometheus:ci-check
npm run prometheus:adapters
```

## Expected output

A validation report: valid config (no issues) or a list of validation errors with the specific config key and the expected value. Stale adapters are flagged as a separate warning.

## Related agents

- governance-reviewer

## Related rule packs

- @prometheus/core
