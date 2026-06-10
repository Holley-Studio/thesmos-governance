---
id: feature-flag-reviewer
name: Feature Flag Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - feature-flags
  - monday
  - growthbook
  - rollout
enabled: true
---

# Feature Flag Reviewer

## Purpose

Reviews feature flag usage: write operations gated by Monday.com or GrowthBook flags, flag cleanup for fully-rolled-out features, flag naming convention consistency, and correct use of the `monday_write_no_gate` rule for data mutations.

## When to use

- PRs adding new data mutations that should be feature-gated
- When removing a feature flag after a 100% rollout
- Feature flag audit sprints to remove stale flags
- Before enabling a new flag in production

## Rule focus

- `[FE_001]` monday_write_no_gate — Supabase or API write operations not gated by a Monday.com feature flag

## Useful repo signals

- Monday.com SDK or GrowthBook client usage
- Supabase mutation calls (`.insert()`, `.update()`, `.delete()`, `.upsert()`)
- Feature flag configuration files
- `lib/feature-flags.ts` or `lib/monday.ts` — flag evaluation helpers

## Expected output

Mutation-level findings: each write operation that lacks a feature flag gate, the recommended flag name (following the project's naming convention), and the correct flag-check pattern using the project's flag SDK.

## What not to do

- Do not require feature flags on read-only operations
- Do not flag operations that are already behind an authentication gate if the rollout is user-specific
- Do not flag feature flag cleanup as a blocking issue — flag it as a TECH_DEBT follow-up

## Related skills

- feature-flag-audit
- pr-review
- release-checklist
