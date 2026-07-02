---
name: error-boundary-audit
description: Audits error handling completeness — missing error boundaries on data-fetching components, swallowed exceptions, user-facing error messages leaking implementation details, and missing retry logic on transient failures.
---

# Error Boundary Audit

## Purpose

Audits error handling completeness: missing error boundaries on data-fetching components, swallowed exceptions, user-facing error messages leaking implementation details, and missing retry logic on transient failures.

## When to use

- After a production error causes a blank screen
- When error messages in production show stack traces
- Before a reliability-focused release
- Error handling improvement sprints

## Required inputs

- Component files with data fetching or mutations
- `app/error.tsx` and `app/global-error.tsx` for Next.js
- Error tracking integration (Sentry, Datadog)

## Workflow steps

1. Map all async operations in the component tree
2. Identify components that fetch data without a wrapping error boundary
3. Check error message text for implementation detail leakage
4. Verify error boundaries have user-friendly fallback UIs
5. Check `try/catch` blocks for swallowed errors (empty catch)
6. Verify Sentry or equivalent captures errors at boundaries

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

An error handling coverage map: components with and without error boundary protection, swallowed exceptions, leaked error details, missing retry patterns, and recommended error boundary placement.

## Related agents

- error-handling-reviewer
- observability-reviewer

## Related rule packs

- @thesmos/core
