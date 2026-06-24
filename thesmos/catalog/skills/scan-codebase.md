---
id: scan-codebase
name: Scan Codebase
type: skill
version: 1.0.0
owner: prometheus
tags:
  - scan
  - architecture
  - discovery
enabled: true
---

# Scan Codebase

## Purpose

Runs the Prometheus scanner to discover the repository's structure: pages, API routes, components, stores, test files, large files, and risky files. Outputs a structured scan result used by other skills and the init command.

## When to use

- Initial repository onboarding
- After a major structural refactor
- Before running `init-governance` to populate architecture files with real data
- When `.thesmos/architecture/` files look stale

## Required inputs

- Repository root directory
- Active Prometheus config for threshold settings (large file line limit)

## Workflow steps

1. Run `npm run thesmos:scan` from the repository root
2. Review the scan output for discovered pages, routes, and components
3. Check the `largeFiles` and `riskyFiles` lists for items needing attention
4. Use the scan result to refresh architecture documentation
5. If large/risky files are found, run `npm run thesmos:review` for immediate findings

## Thesmos commands

```bash
npm run thesmos:scan
npm run thesmos:scan -- --json
```

## Expected output

A structured scan result showing: detected framework, pages and API routes, component counts, shared UI files, state stores, test files, large files (over threshold), and risky files (auth, payments, migrations).

## Related agents

- architecture-reviewer
- governance-reviewer

## Related rule packs

- @thesmos/core
