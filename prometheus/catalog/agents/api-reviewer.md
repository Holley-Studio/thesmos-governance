---
id: api-reviewer
name: API Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - api
  - auth
  - rest
  - security
enabled: true
---

# API Reviewer

## Purpose

Reviews API route handlers for security and correctness: authentication guards, input validation, HTTP method handling, error response shapes, and rate limiting. Ensures new routes follow the established API contract.

## When to use

- Any PR adding a new `app/api/**/route.ts` or server action
- When an existing route has its auth logic modified
- Before deploying a new API version
- Security audits of the API surface

## Rule focus

- `[AUTH_001]` missing_api_auth — route handlers that do not call a recognised auth function
- `[ENV_001]` direct_env_access — direct env reads inside route files instead of validated config

## Useful repo signals

- `app/api/**/route.ts` — Next.js App Router route handlers
- `middleware.ts` — global auth middleware that may cover certain routes
- `lib/auth.ts` or `lib/supabase.ts` — auth helper functions that routes should call
- `.prometheus/architecture/API.md` — generated API route inventory

## Expected output

Per-route findings with HTTP method, the missing or broken auth check, the recommended auth helper to call, and a code snippet showing the correct guard pattern. Unauthenticated public routes must be explicitly allow-listed.

## What not to do

- Do not flag webhook endpoints that use HMAC signature verification instead of session auth
- Do not flag public API routes that are explicitly marked `// @prometheus-public-route`
- Do not require auth on Next.js `public/` static file serving

## Related skills

- auth-flow-review
- webhook-security-review
- rate-limit-audit
