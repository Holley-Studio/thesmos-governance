---
name: validate-rules
description: Validates the Thesmos rule configuration against the canonical rule registry, checking for unknown rule IDs, severity level consistency, and configuration drift between `.thesmos/config.json` and the adapter files.
---

# Validate Rules

## Purpose

Validates the Thesmos rule configuration against the canonical rule registry, checking for unknown rule IDs, severity level consistency, and configuration drift between `.thesmos/config.json` and the adapter files.

## When to use

- After modifying `.thesmos/config.json`
- When `thesmos ci-check` reports configuration drift
- Before merging a PR that changes severity overrides
- Governance audit reviews

## Required inputs

- `.thesmos/config.json`
- Canonical rule registry (built into Thesmos)

## Workflow steps

1. Run `npm run thesmos:validate` to validate the configuration
2. Check for unknown rule IDs in the severity overrides
3. Verify adapter files reflect the current rule config (freshness check)
4. Run `npm run thesmos:ci-check` for the full CI gate check
5. If adapters are stale, run `npm run thesmos:adapters` to refresh them

## Thesmos commands

```bash
npm run thesmos:validate
npm run thesmos:ci-check
npm run thesmos:adapters
```

## Expected output

A validation report: valid config (no issues) or a list of validation errors with the specific config key and the expected value. Stale adapters are flagged as a separate warning.

## Related agents

- governance-reviewer

## Related rule packs

- @thesmos/core
