---
id: add-tests
name: Add Tests
type: skill
version: 1.0.0
owner: prometheus
tags:
  - testing
  - vitest
  - jest
  - coverage
enabled: true
---

# Add Tests

## Purpose

Adds missing test files for changed or risky files identified by the testing-reviewer agent. Generates test skeletons from the file's exported API and the project's testing framework conventions.

## When to use

- When `testing-reviewer` flags files missing test coverage
- After a `[TEST_001]` finding in a PR review
- When adding a new risky file (auth, payments, migrations)
- Test coverage improvement sprints

## Required inputs

- The file(s) requiring tests
- The project's testing framework (Vitest, Jest)
- Existing test files for pattern reference
- The active Prometheus config for risky-file classification

## Workflow steps

1. Identify files with `[TEST_001]` findings from `npm run thesmos:review`
2. For each file, determine the test co-location convention (`*.test.ts` or `__tests__/`)
3. Extract the file's exported functions and their input/output types
4. Generate a test skeleton with `describe` blocks for each exported function
5. Add at minimum: happy path, edge case (null/undefined), and error path tests
6. Run the test suite to verify the skeleton compiles: `npm test`

## Thesmos commands

```bash
npm run thesmos:review
npm test
```

## Expected output

One or more new test files with filled-in test cases for the risky file's critical paths. The tests should compile and run (though they may initially fail if the implementation has bugs).

## Related agents

- testing-reviewer
- incident-reviewer

## Related rule packs

- @thesmos/core
