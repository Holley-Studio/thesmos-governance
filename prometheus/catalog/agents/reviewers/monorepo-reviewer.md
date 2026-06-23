---
id: monorepo-reviewer
name: Monorepo Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - monorepo
  - turborepo
  - nx
  - packages
enabled: true
---

# Monorepo Reviewer

## Purpose

Reviews changes in monorepo setups: cross-package imports that bypass the public API, workspace dependency versions that drift between packages, circular dependencies between workspace packages, and Turborepo pipeline configuration correctness.

## When to use

- PRs in a Turborepo, Nx, or pnpm workspace that span multiple packages
- When adding a new workspace package
- When a circular dependency is introduced between packages
- Monorepo dependency graph audits

## Rule focus

- `[ARCH_002]` duplicate_component_pattern — components duplicated across workspace packages instead of moved to a shared package
- `[ARCH_001]` large_file — monorepo shared packages that have become too large to be a cohesive unit

## Useful repo signals

- `turbo.json` or `nx.json` — pipeline configuration
- `packages/*/package.json` — workspace package manifests and their inter-dependencies
- `pnpm-workspace.yaml` or `workspaces` field in root `package.json`
- `tsconfig.json` `references` — TypeScript project references for monorepo builds

## Expected output

Package-level dependency findings: imports that cross package boundaries without going through the public index, mismatched peer dependency versions, and circular dependency chains with the full path listed.

## What not to do

- Do not flag direct imports within the same package — only cross-package boundary violations matter
- Do not require shared packages for code shared by exactly two packages that are co-deployed
- Do not flag `devDependencies` version mismatches in leaf packages that do not affect runtime

## Related skills

- monorepo-dependency-graph
- build-optimization
- dependency-audit
