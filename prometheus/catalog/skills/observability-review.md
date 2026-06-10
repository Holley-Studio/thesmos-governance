---
id: observability-review
name: Observability Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - observability
  - tracing
  - metrics
  - monitoring
enabled: true
---

# Observability Review

## Purpose

Reviews the application's observability posture: distributed tracing coverage, metrics instrumentation for new features, alert rule coverage for new failure modes, and dashboard completeness for the changed code paths.

## When to use

- After adding a new service integration or async workflow
- Before a reliability-focused release
- When an incident reveals an observability gap
- Observability improvement sprints

## Required inputs

- Changed source files for observability gap analysis
- OpenTelemetry or other tracing configuration
- Existing alert rules

## Workflow steps

1. Map changed code paths to observability coverage
2. Identify missing traces on critical async operations
3. Check metrics instrumentation for new features (error rate, latency, throughput)
4. Review alert rules for coverage of new failure modes
5. Check dashboard panels for new API routes or workflows
6. Produce an observability gap report

## Prometheus commands

```bash
npm run prometheus:review
npm run prometheus:scan
```

## Expected output

An observability gap report: untraced code paths, missing metrics, uncovered failure modes, and dashboard gaps. Prioritised by impact on incident detection time (MTTD).

## Related agents

- observability-reviewer
- incident-reviewer

## Related rule packs

- @prometheus/core
