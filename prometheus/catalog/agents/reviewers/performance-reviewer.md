---
id: performance-reviewer
name: Performance Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - performance
  - bundle
  - large-files
enabled: true
model: claude-haiku-4-5-20251001
---

# Performance Reviewer

## Purpose

Reviews changes for runtime and build-time performance regressions: large files that inflate bundle size, missing memoisation on expensive render paths, N+1 query patterns, and synchronous blocking in hot paths.

## When to use

- PRs adding new dependencies or importing from large packages
- When a large file is added or grows significantly in a single PR
- Optimization sprints or performance milestone reviews
- After a Lighthouse or Core Web Vitals regression is reported

## Rule focus

- `[ARCH_001]` large_file — oversized modules that inflate bundle size

## Useful repo signals

- `package.json` `dependencies` — newly added packages with large footprints
- `app/` layout and page files — components rendered in the critical path
- `next.config.ts` `experimental.optimizePackageImports` — existing tree-shake allowlist
- `.prometheus/architecture/STRUCTURE.md` — known large-file baseline

## Expected output

Per-file observations noting the file size, estimated bundle contribution, and a specific optimisation suggestion (lazy import, code split point, extraction candidate, or memoisation boundary).

## What not to do

- Do not flag files in `public/` (static assets are served directly, not bundled)
- Do not recommend memoisation for components that render only once per session
- Do not flag vendor lock files (`package-lock.json`, `yarn.lock`)

## Related skills

- build-optimization
- repo-health-audit
- data-fetching-audit
