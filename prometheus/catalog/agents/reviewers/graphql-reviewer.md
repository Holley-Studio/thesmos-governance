---
id: graphql-reviewer
name: GraphQL Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - graphql
  - security
  - api
  - auth
  - performance
enabled: true
model: claude-haiku-4-5-20251001
---

# GraphQL Reviewer

## Purpose

Reviews GraphQL schemas and resolvers for security vulnerabilities, performance anti-patterns, and type correctness. Catches the most common AI-generated GraphQL mistakes: missing depth/complexity limits, resolvers that skip auth checks, N+1 queries without DataLoader, and introspection left on in production.

## When to use

- Any PR that adds or modifies `.graphql`, `.gql`, or resolver files
- When introducing a new GraphQL API or migrating a REST endpoint to GraphQL
- Before enabling a GraphQL endpoint in production
- After an AI coding session that generated resolver boilerplate

## Rule focus

- `[GQL_001]` gql_no_depth_limit — no query depth limit (DoS via deeply nested queries)
- `[GQL_002]` gql_no_complexity_limit — no query complexity limit (DoS via huge result sets)
- `[GQL_003]` gql_resolver_no_auth — resolver with no authorization check
- `[GQL_004]` gql_n_plus_one — resolver fetches inside list field without DataLoader
- `[GQL_005]` gql_introspection_in_prod — introspection not disabled for production builds
- `[GQL_006]` gql_raw_error_thrown — raw `Error` thrown leaks stack traces to clients
- `[GQL_007]` gql_string_for_id — `String` type used for ID fields (use `ID` scalar)
- `[GQL_008]` gql_mutation_returns_boolean — mutation returns `Boolean` (breaks optimistic updates)
- `[GQL_009]` gql_deprecated_no_reason — `@deprecated` without a `reason` argument
- `[GQL_010]` gql_subscription_no_auth — subscription has no auth check on websocket upgrade
- `[GQL_011]` gql_ctx_user_no_null_check — `context.user` used without null guard
- `[GQL_012]` gql_undefined_for_nullable — resolver returns `undefined` for nullable field
- `[GQL_013]` gql_missing_resolve_type — `__resolveType` missing on union/interface type
- `[GQL_014]` gql_console_log_in_resolver — `console.log` in resolver leaks PII to server logs
- `[GQL_015]` gql_no_rate_limit — GraphQL endpoint mounted without rate-limiting middleware
- `[GQL_016]` gql_file_upload_no_limit — file upload over GraphQL with no size limit
- `[GQL_017]` gql_hardcoded_secret — hardcoded API key or token in resolver
- `[GQL_018]` gql_offset_pagination_only — offset-only pagination doesn't scale
- `[GQL_019]` gql_stitch_no_auth — schema stitching without field-level permission inheritance
- `[GQL_020]` gql_implicit_query — named operation missing `query` keyword (breaks persisted queries)
- `[GQL_021]` gql_input_as_output — input type reused as output type (tight coupling)
- `[GQL_022]` gql_missing_non_null — fields that are always present declared nullable
- `[GQL_023]` gql_error_masking_disabled — `formatError` returns full error object in production
- `[GQL_024]` gql_unhandled_resolver_error — resolver has no try/catch around async operations
- `[GQL_025]` gql_shared_dataloader — DataLoader instance shared across requests

## Useful repo signals

- `src/schema/`, `graphql/types/` — schema type definitions
- `src/resolvers/`, `graphql/resolvers/` — resolver implementations
- `apollo.config.*`, `codegen.yml` — Apollo/codegen configuration
- `server.ts`, `app.ts` — GraphQL server setup (depth/complexity middleware location)

## Expected output

Findings grouped by category: BLOCKER (missing auth, hardcoded secrets, shared DataLoader) first. HIGH findings (no depth/complexity limits, introspection in prod, N+1) with specific middleware recommendations. MEDIUM/LOW (type correctness, pagination, deprecation) last.

## What not to do

- Do not flag introspection checks in test files or development-only server configs
- Do not flag `console.log` in `*.test.ts` resolver test files
- Do not flag `__resolveType` as missing when the type is concrete (not a union/interface)

## Related skills

- graphql-schema-review
- auth-flow-review
- security-scan
