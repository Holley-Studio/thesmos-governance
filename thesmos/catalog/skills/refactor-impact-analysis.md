---
id: refactor-impact-analysis
name: Refactor Impact Analysis
type: skill
version: 1.0.0
owner: prometheus
tags:
  - refactor
  - impact
  - dependencies
  - architecture
enabled: true
---

# Refactor Impact Analysis

## Purpose

Analyses the downstream impact of a refactor before it is merged: identifies all consumers of the changed API, verifies they have all been updated, and estimates the risk of missing call sites.

## When to use

- Before merging a refactor that renames or moves a widely-used module
- When a function signature changes in a shared utility
- Export API surface changes in a library package
- Monorepo cross-package refactors

## Required inputs

- The entity being refactored (file path, function name, or module name)
- A full-text search of the codebase for the old name
- TypeScript compiler output for remaining type errors

## Workflow steps

1. Identify all import sites of the changed module using `grep` or TypeScript language server
2. Diff the old vs. new API surface (function signatures, export names)
3. Check each import site for compatibility with the new API
4. Run `npm run typecheck` to catch type errors from the refactor
5. Run `npm test` to catch runtime regressions
6. Document updated vs. remaining sites in a completion checklist

## Thesmos commands

```bash
npm run typecheck
npm test
npm run thesmos:review
```

## Expected output

An impact map: the old API, the new API, all known import sites with their update status (updated / needs update / unknown), and a go/no-go recommendation based on coverage.

## Related agents

- refactor-reviewer
- architecture-reviewer

## Related rule packs

- @thesmos/core
