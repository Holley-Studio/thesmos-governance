---
id: auth-reviewer
name: Auth Reviewer
type: agent
version: 1.0.0
owner: prometheus
tags:
  - auth
  - security
  - sessions
  - supabase
enabled: true
---

# Auth Reviewer

## Purpose

Deeply reviews authentication and authorisation logic: session handling, token rotation, privilege escalation risks, missing route guards, and incorrect use of auth helpers across the client/server boundary.

## When to use

- PRs touching auth middleware, session stores, or auth helper functions
- When adding role-based access control or permission checks
- After a security report involving session or token issues
- Auth system migrations (e.g. NextAuth → Supabase Auth)

## Rule focus

- `[AUTH_001]` missing_api_auth — route handlers and server actions lacking auth checks
- `[INFRA_001]` admin_client_in_browser — Supabase service-role key used outside server context
- `[DB_001]` rls_disabled — auth bypass through disabled RLS

## Useful repo signals

- `middleware.ts` — route matcher patterns and session validation
- `lib/auth.ts`, `lib/supabase/server.ts` — server-side auth helpers
- `lib/supabase/client.ts` — client-side auth helpers (should never use service role key)
- `app/api/**/route.ts` — route handlers that need auth guards

## Expected output

Auth-specific findings with the attack vector (unauthenticated access, privilege escalation, session fixation), the vulnerable code path, and a hardened implementation. For Supabase projects, includes the correct `createServerClient` vs. `createBrowserClient` pattern.

## What not to do

- Do not flag auth check calls that return a user object even if the variable is ignored — the call itself establishes the gate
- Do not flag `createBrowserClient` in server components — only flag `serviceRoleKey` leakage
- Do not flag CSRF token validation for GET endpoints

## Related skills

- auth-flow-review
- rls-policy-audit
- security-scan
