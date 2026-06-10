---
id: generate-report
name: Generate Report
type: skill
version: 1.0.0
owner: prometheus
tags:
  - report
  - output
  - ci
  - findings
enabled: true
---

# Generate Report

## Purpose

Generates a Prometheus review report in the chosen output format (Markdown, JSON, or console) and optionally saves it to `.prometheus/report.json` for CI integration and trend tracking.

## When to use

- At the end of an AI-assisted review to produce a shareable summary
- In CI to produce a machine-readable findings report
- When a stakeholder requests a summary of the last review
- Generating the PR comment body for an automated review

## Required inputs

- Review findings from `prometheus:review`
- Target output format (Markdown / JSON / console)
- Changed file list and PR metadata

## Workflow steps

1. Run `npm run prometheus:review` to get the findings
2. Choose the output format based on the consumer (CI → JSON, PR comment → Markdown)
3. Format findings with severity groups, file references, and fix suggestions
4. Save to `.prometheus/report.json` if persistence is needed
5. Output the formatted report to stdout or the target file

## Prometheus commands

```bash
npm run prometheus:review -- --markdown
npm run prometheus:review -- --json
```

## Expected output

A formatted report in the requested format. The Markdown report is suitable for GitHub PR comments. The JSON report is suitable for CI artifact storage and programmatic consumption.

## Related agents

- release-readiness-reviewer
- governance-reviewer

## Related rule packs

- @prometheus/core
