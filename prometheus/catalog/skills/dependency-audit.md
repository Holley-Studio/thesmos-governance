---
id: dependency-audit
name: Dependency Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - dependencies
  - npm
  - security
  - audit
enabled: true
---

# Dependency Audit

## Purpose

Audits the project's dependencies for known vulnerabilities, unnecessary or duplicated packages, bundle size impact, and incorrect `devDependencies` vs. `dependencies` classification.

## When to use

- Before a major release
- When `npm audit` reports vulnerabilities
- After a Dependabot or Renovate PR batch
- Dependency hygiene sprints

## Required inputs

- `package.json` and lock file
- `npm audit` output
- Current `node_modules` footprint

## Workflow steps

1. Run `npm audit` and capture the vulnerability report
2. Check for packages in `dependencies` that should be in `devDependencies`
3. Identify duplicate packages (same package at multiple versions via `npm ls`)
4. Flag packages with known large bundle sizes relative to their utility
5. Verify `@types/*` packages are in `devDependencies`
6. Recommend upgrades or replacements for deprecated packages

## Prometheus commands

```bash
npm audit
npm ls --depth=0
```

## Expected output

A dependency health report: CVE summary, misclassified packages, duplicate resolution opportunities, and a prioritised list of recommended changes (fix / upgrade / replace / remove).

## Related agents

- dependency-reviewer
- build-system-reviewer

## Related rule packs

- @prometheus/core
