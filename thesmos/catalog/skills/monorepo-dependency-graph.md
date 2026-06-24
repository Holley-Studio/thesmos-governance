---
id: monorepo-dependency-graph
name: Monorepo Dependency Graph
type: skill
version: 1.0.0
owner: prometheus
tags:
  - monorepo
  - dependencies
  - graph
  - architecture
enabled: true
---

# Monorepo Dependency Graph

## Purpose

Maps the dependency graph of a monorepo: which packages depend on which, where circular dependencies exist, and which packages are most critical (highest in-degree) and therefore highest risk to change.

## When to use

- When adding a new inter-package dependency
- When a circular dependency is suspected
- Before a major package extraction or split
- Monorepo architecture reviews

## Required inputs

- `package.json` files for all workspace packages
- Import statements across packages
- Turborepo or Nx task graph configuration

## Workflow steps

1. Enumerate all workspace packages and their declared dependencies
2. Build a directed dependency graph (package A → package B)
3. Detect cycles using depth-first search
4. Identify the most-depended-upon packages (highest in-degree = highest impact)
5. Flag cross-package imports that bypass declared dependencies
6. Produce a visual ASCII dependency graph

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A dependency graph with: package list, dependency edges, detected cycles (with the full cycle path), most critical packages, and undeclared cross-package imports that should be formalised.

## Related agents

- monorepo-reviewer
- architecture-reviewer

## Related rule packs

- @thesmos/core
