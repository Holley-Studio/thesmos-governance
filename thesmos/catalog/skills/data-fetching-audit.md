---
id: data-fetching-audit
name: Data Fetching Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - data-fetching
  - react-query
  - waterfalls
  - cache
enabled: true
---

# Data Fetching Audit

## Purpose

Audits data fetching patterns for performance and correctness: request waterfalls, missing cache revalidation, client-side fetching that should be server-side, and stale-while-revalidate configuration.

## When to use

- When page loads are slow and network traces show waterfall patterns
- During a Next.js App Router migration
- Before a performance review with stakeholders
- After adding a new data-heavy feature

## Required inputs

- Page and component files with data fetching
- React Query / SWR / native fetch configuration
- Next.js cache revalidation settings

## Workflow steps

1. Identify all data fetching sites (useQuery, useSWR, fetch, server component async)
2. Look for sequential awaits that could be parallelised with `Promise.all`
3. Check cache configuration for each fetch (revalidate, staleTime, cacheTime)
4. Identify client-side fetches that could be server component fetches
5. Check for N+1 patterns (fetching inside loops)
6. Produce a waterfall diagram description and optimisation plan

## Thesmos commands

```bash
npm run thesmos:review
npm run thesmos:scan
```

## Expected output

A data fetching audit: identified waterfalls with parallelisation opportunities, N+1 patterns with batching solutions, client-fetch-to-server-component migration candidates, and estimated performance improvement per change.

## Related agents

- data-fetching-reviewer
- performance-reviewer

## Related rule packs

- @thesmos/core
