---
id: rls-policy-audit
name: RLS Policy Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - rls
  - supabase
  - postgres
  - security
enabled: true
---

# RLS Policy Audit

## Purpose

Audits Supabase Row Level Security policies for completeness and correctness: every user-facing table has RLS enabled, policies cover all required access patterns (SELECT, INSERT, UPDATE, DELETE), and policies use the correct auth function.

## When to use

- After adding a new Supabase table
- Before a security audit
- When a data isolation bug is reported
- Supabase migration reviews

## Required inputs

- Supabase migration files with policy definitions
- List of all user-facing tables
- Access pattern requirements per table

## Workflow steps

1. List all tables from migration files
2. Verify each table has `ENABLE ROW LEVEL SECURITY`
3. For each table, verify policies exist for all required operations
4. Check policy conditions use `auth.uid()` or `auth.role()` correctly
5. Run `npm run thesmos:review` for `[DB_001]` findings
6. Test policies with the Supabase policy editor for each user role

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

An RLS coverage matrix: each table × operation (SELECT/INSERT/UPDATE/DELETE) with policy status (has policy / missing / disabled). Gaps produce HIGH or BLOCKER findings depending on data sensitivity.

## Related agents

- supabase-reviewer
- database-reviewer

## Related rule packs

- @thesmos/core
