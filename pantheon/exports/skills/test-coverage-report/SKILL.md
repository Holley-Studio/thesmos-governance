---
name: test-coverage-report
description: Generates a test coverage report for the project, identifies risky files with low coverage, and produces a prioritised list of coverage gaps to address in the next sprint.
---

# Test Coverage Report

## Purpose

Generates a test coverage report for the project, identifies risky files with low coverage, and produces a prioritised list of coverage gaps to address in the next sprint.

## When to use

- When the CI coverage gate is failing
- During test improvement sprints
- Before a major release that requires coverage thresholds
- After adding a large new feature

## Required inputs

- Vitest or Jest coverage configuration
- Coverage threshold settings
- List of risky files from Thesmos scan

## Workflow steps

1. Run `npm test -- --coverage` to generate a coverage report
2. Filter results to files below the configured threshold
3. Cross-reference with Thesmos's risky file list
4. Prioritise coverage gaps in risky files (auth, payments, migrations) first
5. Generate test stubs for the top 5 uncovered risky files
6. Report coverage delta vs. the previous baseline

## Thesmos commands

```bash
npm test -- --coverage
npm run thesmos:scan
npm run thesmos:review
```

## Expected output

A coverage gap report: overall coverage percentage, files below threshold sorted by risk level, top 5 coverage gap candidates with suggested test cases, and a projected coverage percentage after the recommended additions.

## Related agents

- testing-reviewer
- incident-reviewer

## Related rule packs

- @thesmos/core
