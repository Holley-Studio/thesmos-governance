---
id: rate-limit-audit
name: Rate Limit Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - rate-limiting
  - api
  - security
  - abuse-prevention
enabled: true
---

# Rate Limit Audit

## Purpose

Audits API endpoints and AI-powered routes for rate limiting: missing rate limits on sensitive or expensive endpoints, rate limit configuration correctness, and abuse prevention for AI cost-attack vectors.

## When to use

- Before exposing a new AI-powered endpoint
- When an endpoint is being abused or receiving unusual traffic
- Security reviews of the API surface
- Before a public API launch

## Required inputs

- API route files
- Rate limiting middleware configuration (Upstash Redis, middleware.ts)
- AI endpoint cost estimates

## Workflow steps

1. List all API routes and their rate limit configuration
2. Identify routes missing rate limits: auth endpoints, AI endpoints, write operations
3. Check rate limit granularity (per-IP vs. per-user vs. per-API-key)
4. Verify rate limit responses use `429 Too Many Requests` with `Retry-After`
5. For AI endpoints, check the cost per request and set limits accordingly
6. Run `npm run thesmos:review` for `[AUTH_001]` findings on unprotected routes

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A rate limit coverage map: routes with and without rate limits, recommended limits per route (based on cost and sensitivity), and a priority list for adding missing rate limits.

## Related agents

- api-reviewer
- ai-safety-reviewer

## Related rule packs

- @thesmos/core
