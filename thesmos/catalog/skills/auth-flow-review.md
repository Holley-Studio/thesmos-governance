---
id: auth-flow-review
name: Auth Flow Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - auth
  - security
  - sessions
  - flows
enabled: true
---

# Auth Flow Review

## Purpose

Reviews the complete authentication flow end-to-end: sign-up, sign-in, session management, token refresh, sign-out, and password reset. Verifies each step is correctly secured and handles edge cases.

## When to use

- When implementing or modifying authentication
- Auth system migrations
- Security audits focusing on authentication
- When a session or token bug is reported

## Required inputs

- Auth-related files (`middleware.ts`, `lib/auth.ts`, `lib/supabase/server.ts`)
- Route handler files for auth endpoints
- Session storage configuration

## Workflow steps

1. Map the complete auth flow: sign-up → verify → sign-in → session → refresh → sign-out
2. Verify each step calls the correct auth helper (server-side only for sensitive operations)
3. Check session token storage (HTTP-only cookies vs. localStorage)
4. Verify token refresh handling (automatic vs. manual)
5. Check sign-out clears all session state
6. Run `npm run thesmos:review` for `[AUTH_001]` findings

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

An auth flow map with security assessment per step: token storage security, refresh token handling, sign-out completeness, missing edge cases (expired tokens, concurrent sessions), and recommended hardening for each gap.

## Related agents

- auth-reviewer
- security-reviewer

## Related rule packs

- @thesmos/core
