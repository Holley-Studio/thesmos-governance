---
id: e2e-test-review
name: E2E Test Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - testing
  - e2e
  - playwright
  - cypress
enabled: true
---

# E2E Test Review

## Purpose

Reviews end-to-end test quality and coverage: critical user journeys covered, flaky test patterns, test isolation, and CI execution time. Ensures E2E tests provide reliable regression protection.

## When to use

- E2E test PRs
- When E2E tests are flaky in CI
- Before adding a critical user journey to the regression suite
- E2E test quality sprints

## Required inputs

- E2E test files (Playwright or Cypress)
- Critical user journey definitions
- CI test execution timing

## Workflow steps

1. Map E2E tests to the user journeys in the product specification
2. Identify critical journeys without E2E coverage (checkout, auth, onboarding)
3. Review test assertions for specificity (avoid overly broad assertions)
4. Check for flakiness patterns (hardcoded waits, race conditions)
5. Verify test isolation (tests don't depend on each other's state)
6. Review CI execution time and parallel sharding configuration

## Thesmos commands

```bash
npm test
```

## Expected output

An E2E test coverage map: journeys covered, journeys missing, flakiness risk assessment per test, and recommendations for parallelisation and isolation improvements.

## Related agents

- testing-reviewer
- fullstack-reviewer

## Related rule packs

- @thesmos/core
