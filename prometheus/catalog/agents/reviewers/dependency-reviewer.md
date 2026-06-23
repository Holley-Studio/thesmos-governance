---
id: dependency-reviewer
name: Dependency Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - dependencies
  - npm
  - security
  - bundle
enabled: true
---

# Dependency Reviewer

## Purpose

Reviews changes to `package.json` and lock files for new dependencies with known vulnerabilities, packages that dramatically increase bundle size, duplicate packages serving the same purpose, and unpinned version ranges in production dependencies.

## When to use

- Any PR that modifies `package.json` or lock files
- Dependency update PRs (Dependabot, Renovate)
- Before a major version bump of a core framework
- Security audit sprints

## Rule focus

- `[ARCH_001]` large_file — lock files that have grown significantly may indicate transitive dependency sprawl

## Useful repo signals

- `package.json` `dependencies` vs `devDependencies` — misclassified packages inflate production bundles
- `package-lock.json` or `yarn.lock` — diff size indicates dependency churn
- `.npmrc` — registry configuration and audit settings
- `next.config.ts` `experimental.optimizePackageImports` — tree-shake configuration

## Expected output

A table of added/removed/upgraded packages with: bundle size impact (estimated), known CVE count if any, whether the package is already available via an existing dependency, and a recommendation (accept / replace / audit further).

## What not to do

- Do not flag `devDependencies` for bundle size impact — they are not included in production builds
- Do not flag patch-version bumps as high-risk unless the package has a track record of breaking changes
- Do not recommend removing type packages (`@types/*`) — they have zero runtime cost

## Related skills

- dependency-audit
- build-optimization
- security-scan
