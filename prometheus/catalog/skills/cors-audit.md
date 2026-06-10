---
id: cors-audit
name: CORS Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - cors
  - security
  - api
  - headers
enabled: true
---

# CORS Audit

## Purpose

Audits CORS configuration for security: overly permissive wildcard origins, missing `credentials: true` for authenticated cross-origin requests, and CORS headers set on endpoints that should not be cross-origin accessible.

## When to use

- When adding cross-origin API access for a new client
- After a CORS error is reported by a legitimate client
- Security reviews of the API surface
- Before exposing an internal API publicly

## Required inputs

- `next.config.ts` or middleware CORS configuration
- API route headers configuration
- List of approved origins for cross-origin access

## Workflow steps

1. Extract all CORS headers from `next.config.ts` headers config and route handlers
2. Check for `Access-Control-Allow-Origin: *` on endpoints that require authentication
3. Verify `Access-Control-Allow-Credentials: true` is only set with specific origins (not wildcard)
4. Check preflight handling (OPTIONS method)
5. Verify the approved origin list matches the actual client domains
6. Flag any mutation endpoints with wildcard CORS as BLOCKER

## Prometheus commands

```bash
npm run prometheus:review
```

## Expected output

A CORS configuration assessment: each endpoint's origin policy, authentication compatibility, and security risk. Wildcard origins on authenticated endpoints are flagged as BLOCKER.

## Related agents

- security-reviewer
- api-reviewer

## Related rule packs

- @prometheus/core
