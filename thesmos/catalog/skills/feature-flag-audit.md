---
id: feature-flag-audit
name: Feature Flag Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - feature-flags
  - monday
  - growthbook
  - cleanup
enabled: true
---

# Feature Flag Audit

## Purpose

Audits feature flag usage: data mutations not gated by flags, stale flags from fully-rolled-out features, flag naming convention consistency, and the flag inventory in the codebase vs. the flag management system.

## When to use

- Before a major release to ensure flags are correctly set
- Quarterly flag cleanup sprints
- When `[FE_001]` findings appear in PR reviews
- After a full rollout, to clean up the completed flag

## Required inputs

- All source files referencing feature flag checks
- Feature flag management system inventory (Monday.com, GrowthBook, LaunchDarkly)
- Supabase or API write operation files

## Workflow steps

1. Run `npm run thesmos:review` to find `[FE_001]` ungated write operations
2. List all feature flags currently in code
3. Cross-reference with the flag management system for stale flags
4. Identify flags where the rollout is at 100% (candidates for cleanup)
5. Check naming convention consistency across all flags
6. Produce a flag lifecycle report: active, ready-to-clean, missing

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A feature flag lifecycle report: flags in use with their rollout percentage, flags ready for cleanup (100% rollout or explicitly deprecated), write operations missing flag gates, and a prioritised cleanup list.

## Related agents

- feature-flag-reviewer
- release-readiness-reviewer

## Related rule packs

- @thesmos/core
