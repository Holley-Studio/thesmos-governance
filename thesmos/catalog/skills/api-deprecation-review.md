---
id: api-deprecation-review
name: API Deprecation Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - api
  - deprecation
  - versioning
  - breaking-changes
enabled: true
---

# API Deprecation Review

## Purpose

Reviews API deprecation processes: identifies breaking changes without deprecation notices, consumers of deprecated endpoints that must migrate, and verifies deprecation timelines are being followed.

## When to use

- When removing or changing an API endpoint
- Before publishing a major version with breaking changes
- Deprecation timeline reviews
- When a deprecated endpoint is still receiving traffic

## Required inputs

- API route files with deprecation annotations
- Consumer list for deprecated endpoints
- Deprecation timeline documentation

## Workflow steps

1. Identify all changed API endpoints and classify as additive / breaking / removal
2. For breaking changes, check for deprecation notices in prior versions
3. Find all consumers of deprecated endpoints (grep across the codebase)
4. Verify each consumer has a migration plan
5. Check `X-Deprecated` or `Sunset` response headers are set
6. Verify the deprecation is documented in CHANGELOG.md

## Thesmos commands

```bash
npm run thesmos:review
npm run thesmos:scan
```

## Expected output

A deprecation status report: endpoints being removed/changed, their consumers, migration progress per consumer, and a timeline assessment (on track / at risk / overdue).

## Related agents

- api-reviewer
- backend-reviewer

## Related rule packs

- @thesmos/core
