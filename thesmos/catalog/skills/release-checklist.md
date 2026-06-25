---
id: release-checklist
name: Release Checklist
type: skill
version: 1.0.0
owner: thesmos
tags:
  - release
  - checklist
  - gate
  - pre-release
enabled: true
---

# Release Checklist

## Purpose

Generates and validates a pre-release checklist covering governance, code quality, security, migrations, and documentation. Produces a go/no-go determination for the release.

## When to use

- Before cutting a release branch or tagging a production deployment
- When a release manager requests a go/no-go determination
- As the final step in a release pipeline
- After a hotfix is ready to deploy

## Required inputs

- Latest `thesmos:review` findings
- Pending migration files
- Adapter freshness status
- CHANGELOG.md for the current version

## Workflow steps

1. Run `npm run thesmos:review` — assert zero BLOCKER findings
2. Run `npm run thesmos:ci-check` — assert all adapters are fresh
3. Check `supabase/migrations/` for unapplied migrations and their runbooks
4. Verify CHANGELOG.md entry for the release version
5. Verify feature flags are set to the correct rollout percentage
6. Produce the release checklist with pass/fail/warn status per item

## Thesmos commands

```bash
npm run thesmos:review
npm run thesmos:ci-check
npm run thesmos:validate
```

## Expected output

A release checklist in Markdown format suitable for a GitHub release PR. Each item has a status (✅ pass / ❌ fail / ⚠️ warn), and the overall verdict is RELEASE_READY or BLOCKED.

## Related agents

- release-readiness-reviewer
- governance-reviewer

## Related rule packs

- @thesmos/core
