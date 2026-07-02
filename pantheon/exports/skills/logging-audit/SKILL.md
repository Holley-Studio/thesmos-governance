---
name: logging-audit
description: Audits logging practices — unstructured `console.*` calls that should be structured logger calls, PII in log statements, missing log levels, and log verbosity that could cause performance issues or storage costs.
---

# Logging Audit

## Purpose

Audits logging practices: unstructured `console.*` calls that should be structured logger calls, PII in log statements, missing log levels, and log verbosity that could cause performance issues or storage costs.

## When to use

- When logging is inconsistent across the codebase
- After a privacy incident involving logged PII
- Before a SOC2 audit requiring log access controls
- Observability improvement sprints

## Required inputs

- All source files with logging calls
- Structured logger configuration (`lib/logger.ts`, Pino, Winston)
- PII field definitions for the project

## Workflow steps

1. Run `npm run thesmos:review` to find all `[LOG_001]` findings
2. List all `console.log/warn/error/debug` calls in non-script, non-test files
3. Check each for PII: user emails, names, full request bodies
4. Identify calls that should be structured logger calls
5. Check log levels (use `debug` for dev, `info` for key operations, `error` for failures)
6. Produce a migration plan to structured logging

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A logging audit: all unstructured log calls with migration suggestions, PII exposure findings, log level recommendations, and an estimated structured logging adoption percentage.

## Related agents

- observability-reviewer
- privacy-reviewer

## Related rule packs

- @thesmos/core
