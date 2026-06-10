---
id: integration-test-review
name: Integration Test Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - testing
  - integration
  - database
  - api
enabled: true
---

# Integration Test Review

## Purpose

Reviews integration test quality: tests that mock the database (fragile) vs. tests that use a real database (reliable), API integration tests that cover error paths, and test data management correctness.

## When to use

- Integration test PRs
- When integration tests pass in CI but fail in production
- Test quality improvement sprints
- After a mock/prod divergence incident

## Required inputs

- Integration test files
- Database fixture or seed files
- Mock vs. real dependency configuration

## Workflow steps

1. Identify all integration tests and their dependency strategy (real vs. mock)
2. Flag database-mocked tests on critical paths as fragile
3. Check test data setup and teardown for isolation guarantees
4. Verify integration tests cover the main error paths (DB unavailable, auth failure)
5. Check that tests run against a test database, not production
6. Run the integration test suite and report failures

## Prometheus commands

```bash
npm test
```

## Expected output

An integration test quality assessment: mock vs. real dependency usage, isolation guarantees, error path coverage, test data management correctness, and recommended improvements ordered by incident risk reduction.

## Related agents

- testing-reviewer
- database-reviewer

## Related rule packs

- @prometheus/core
