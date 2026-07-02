---
name: api-design-review
description: Reviews API route design for correctness and consistency — HTTP method semantics, URL naming conventions, request/response schema completeness, error response shapes, and versioning strategy.
---

# API Design Review

## Purpose

Reviews API route design for correctness and consistency: HTTP method semantics, URL naming conventions, request/response schema completeness, error response shapes, and versioning strategy.

## When to use

- When adding or modifying API routes
- Before publishing a public API
- API contract reviews with frontend consumers
- When a client integration fails due to unexpected API behaviour

## Required inputs

- API route files (`app/api/**/route.ts` or equivalent)
- Existing API inventory from `.thesmos/architecture/API.md`
- The project's API naming conventions

## Workflow steps

1. Run `npm run thesmos:scan` to refresh the API route inventory
2. Review each new/modified route against the API naming conventions
3. Check HTTP method correctness (GET for reads, POST for creates, PATCH for updates)
4. Verify request validation (Zod schema or equivalent) on mutation endpoints
5. Check error response shapes for consistency with existing routes
6. Document the new/changed routes in `.thesmos/architecture/API.md` if needed

## Thesmos commands

```bash
npm run thesmos:scan
npm run thesmos:review
```

## Expected output

An API design assessment per route: method correctness, naming adherence, request validation presence, response shape consistency, and a list of suggested changes ordered by impact on consumers.

## Related agents

- api-reviewer
- backend-reviewer

## Related rule packs

- @thesmos/core
