---
id: state-audit
name: State Management Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - state
  - stores
  - context
  - performance
enabled: true
---

# State Management Audit

## Purpose

Audits the application's state management: identifies server state duplicated in client stores, context providers causing excessive re-renders, missing memoisation on derived state, and opportunities to move local state to URL params or server state.

## When to use

- When a performance issue is traced to excessive re-renders
- Before a state management library migration
- After a sprint that added many new stores or context providers
- State architecture reviews for growing applications

## Required inputs

- Store files (`stores/`, Zustand/Redux/Jotai definitions)
- Context provider files
- Server state configuration (React Query, SWR, tRPC)

## Workflow steps

1. Map all state: local (useState), global (Zustand/Redux), server (React Query)
2. Identify server-fetched data stored in client global state (anti-pattern)
3. Profile context providers for values that change too frequently
4. Check derived state for missing `useMemo` on expensive computations
5. Identify state that should be URL params instead (search, filters, pagination)

## Thesmos commands

```bash
npm run thesmos:scan
npm run thesmos:review
```

## Expected output

A state topology map with: over-fetching detection (server state in global stores), render-causing context values, memoisation opportunities, and URL-serialisable state that doesn't need to be in memory.

## Related agents

- state-management-reviewer
- data-fetching-reviewer

## Related rule packs

- @thesmos/core
