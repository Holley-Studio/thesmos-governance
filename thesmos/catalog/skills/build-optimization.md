---
id: build-optimization
name: Build Optimization
type: skill
version: 1.0.0
owner: prometheus
tags:
  - build
  - bundle
  - performance
  - optimization
enabled: true
---

# Build Optimization

## Purpose

Optimises the project's build configuration and output: identifies tree-shaking opportunities, code splitting candidates, unnecessary re-transpilation, and build cache misses that slow CI.

## When to use

- When build times are slowing CI significantly
- When the production bundle size grows unexpectedly
- Build system migration (e.g. Webpack → Turbopack)
- Performance optimisation sprints

## Required inputs

- `next.config.ts` or build tool configuration
- Bundle analyser output
- CI build timing reports

## Workflow steps

1. Analyse bundle with `ANALYZE=true npm run build`
2. Identify the top 10 largest modules in the client bundle
3. Check if any can be dynamically imported (`next/dynamic`, `React.lazy`)
4. Review `experimental.optimizePackageImports` for large package tree-shaking
5. Check for duplicate packages bundled at different versions
6. Run `npm run thesmos:review` for `[ARCH_001]` large-file findings

## Thesmos commands

```bash
npm run thesmos:review
npm run build
```

## Expected output

A build optimisation report: top contributors to bundle size, dynamic import candidates, tree-shaking opportunities, and estimated bundle size reduction per recommendation.

## Related agents

- build-system-reviewer
- performance-reviewer

## Related rule packs

- @thesmos/core
