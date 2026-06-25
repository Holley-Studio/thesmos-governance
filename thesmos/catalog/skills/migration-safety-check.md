---
id: migration-safety-check
name: Migration Safety Check
type: skill
version: 1.0.0
owner: thesmos
tags:
  - migration
  - database
  - safety
  - rollback
enabled: true
---

# Migration Safety Check

## Purpose

Validates database migration files for safe execution in production: checks for locking operations, missing rollbacks, NOT NULL columns without defaults, and sequences that could cause data loss.

## When to use

- Before running any migration against a production database
- When a PR adds SQL or Prisma migrations
- After a migration-related incident
- Database release gate reviews

## Required inputs

- Migration files (SQL or Prisma schema diff)
- Target table sizes (if known)
- Postgres version in production

## Workflow steps

1. Parse migration files for destructive statements (DROP, TRUNCATE, ALTER TYPE)
2. Check NOT NULL additions for existing rows — verify DEFAULT is provided
3. Estimate lock duration for ALTER TABLE operations on large tables
4. Verify rollback SQL exists for each destructive operation
5. Run `npm run thesmos:review` to catch `[DB_001]` and `[SEC_001]` findings
6. Produce a migration runbook with the run order and rollback steps

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A migration safety report: each migration file assessed as safe / review-required / high-risk. High-risk operations include a rollback script and an estimated maintenance-window duration.

## Related agents

- migration-reviewer
- database-reviewer

## Related rule packs

- @thesmos/core
