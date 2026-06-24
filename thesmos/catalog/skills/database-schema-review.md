---
id: database-schema-review
name: Database Schema Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - database
  - schema
  - migrations
  - supabase
enabled: true
---

# Database Schema Review

## Purpose

Reviews database schema changes for safety, correctness, and policy completeness: migration ordering, destructive operations, RLS policy definitions for new tables, and index strategy.

## When to use

- Any PR adding SQL migrations or Prisma schema changes
- Before running a migration on a production database
- When a new Supabase table is added
- Database architecture reviews

## Required inputs

- Migration files (SQL or Prisma schema diff)
- Current RLS policy inventory for affected tables
- Table size estimates if available

## Workflow steps

1. List all migration files in chronological order
2. Identify destructive operations (DROP, TRUNCATE, column type changes)
3. For each new table, verify RLS is enabled and policies are defined
4. Check indexes on foreign key columns and frequently-queried fields
5. Run `npm run thesmos:review` to catch `[DB_001]` findings
6. Verify rollback path for each destructive operation

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A migration safety assessment: additive operations (green), restructuring operations (yellow with rollback plan required), destructive operations (red requiring explicit approval). Each table change includes its RLS policy status.

## Related agents

- database-reviewer
- migration-reviewer
- supabase-reviewer

## Related rule packs

- @thesmos/core
