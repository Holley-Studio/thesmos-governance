---
id: graphql-schema-review
name: GraphQL Schema Review
type: skill
version: 1.0.0
owner: thesmos
tags:
  - graphql
  - api
  - security
  - schema
  - performance
enabled: true
---

# GraphQL Schema Review

## Purpose

Reviews GraphQL schemas and resolvers for depth/complexity limits, auth gaps, N+1 query patterns, type correctness, and production readiness. Covers the full GraphQL security surface: from schema design to resolver implementation to server middleware configuration.

## When to use

- Before launching a new GraphQL API
- When adding new types, mutations, or subscriptions
- Security review of an existing GraphQL endpoint
- After AI-generated GraphQL resolver boilerplate review

## Required inputs

- Changed `.graphql`, `.gql`, and resolver TypeScript/JavaScript files
- Server entry point (where Apollo Server or Yoga is configured)
- Active Thesmos config

## Workflow steps

1. Run `npm run thesmos:review` on all GraphQL schema and resolver files
2. Check for depth and complexity limit configuration in the server setup
3. Verify every resolver that accesses user data has an auth check at the field level
4. Identify list-field resolvers and confirm DataLoader is used to batch DB calls
5. Check introspection configuration — should be disabled in `NODE_ENV=production`
6. Verify `formatError` is configured to mask stack traces in production
7. Scan for `String` types used as IDs and `mutation` functions returning `Boolean`
8. Check subscriptions for websocket-level auth validation

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

Findings grouped by category:
- **Security** (BLOCKER/HIGH): missing auth, hardcoded secrets, introspection in prod, shared DataLoader
- **Performance** (HIGH): missing depth/complexity limits, N+1 without DataLoader
- **Type correctness** (MEDIUM): String for ID, Boolean mutation return, implicit query keyword
- **Best practices** (LOW): missing `@deprecated` reasons, `console.log` in resolvers

## Related agents

- graphql-reviewer
- security-reviewer
- api-reviewer

## Related rule packs

- @thesmos/core
