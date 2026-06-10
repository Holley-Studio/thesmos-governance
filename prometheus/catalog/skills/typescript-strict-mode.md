---
id: typescript-strict-mode
name: TypeScript Strict Mode
type: skill
version: 1.0.0
owner: prometheus
tags:
  - typescript
  - strict
  - types
  - quality
enabled: true
---

# TypeScript Strict Mode

## Purpose

Incrementally enables TypeScript strict mode by identifying and fixing `any` types, null reference issues, and implicit any return types in a prioritised order that minimises cascading errors.

## When to use

- When adopting TypeScript strict mode on a non-strict codebase
- After a `[TS_001]` any_type_no_comment finding sweep
- TypeScript upgrade PRs
- Type safety improvement sprints

## Required inputs

- `tsconfig.json` current strict settings
- TypeScript compiler output with `--strict` enabled
- List of `any` usage sites from Prometheus review

## Workflow steps

1. Run `npm run prometheus:review` to find all `[TS_001]` findings
2. Enable `"noImplicitAny": true` in `tsconfig.json` and check compiler output
3. Prioritise fixes by file: start with utility functions (highest impact)
4. Replace each `any` with the narrowest correct type
5. Enable `"strictNullChecks": true` and fix null reference errors
6. Run `npm run typecheck` and `npm test` to verify correctness

## Prometheus commands

```bash
npm run prometheus:review
npm run typecheck
npm test
```

## Expected output

A strict mode adoption report: number of `any` types fixed, remaining `any` types with explanations, null reference issues resolved, and the recommended order for enabling remaining strict checks.

## Related agents

- typescript-reviewer
- code-quality-reviewer

## Related rule packs

- @prometheus/core
