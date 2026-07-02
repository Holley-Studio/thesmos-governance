---
name: performance-profile
description: Profiles application performance — bundle size analysis, Core Web Vitals assessment from Lighthouse, render performance hotspots, and data fetching waterfall identification.
---

# Performance Profile

## Purpose

Profiles application performance: bundle size analysis, Core Web Vitals assessment from Lighthouse, render performance hotspots, and data fetching waterfall identification.

## When to use

- After a Lighthouse regression is reported
- When users report slow page loads
- Before a performance-sensitive launch
- Performance optimisation sprints

## Required inputs

- Application bundle analysis (`@next/bundle-analyzer` output or similar)
- Lighthouse report for key pages
- Changed files for bundle impact assessment

## Workflow steps

1. Run `npm run thesmos:review` and check for `[ARCH_001]` large-file findings
2. Analyse bundle with `ANALYZE=true npm run build` if bundle-analyzer is configured
3. Identify large modules contributing to main bundle
4. Check for unnecessary client-side imports that could be server-rendered
5. Review data fetching patterns for waterfall opportunities (`Promise.all`)
6. Produce a prioritised optimisation plan

## Thesmos commands

```bash
npm run thesmos:review
npm run build
```

## Expected output

A performance report: top 5 largest bundle contributors, identified data fetching waterfalls, memoisation opportunities in high-frequency render paths, and estimated LCP improvement from recommended changes.

## Related agents

- performance-reviewer
- build-system-reviewer

## Related rule packs

- @thesmos/core
