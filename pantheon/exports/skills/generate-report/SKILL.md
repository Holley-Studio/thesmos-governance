---
name: generate-report
description: Generates a Thesmos review report in the chosen output format (Markdown, JSON, or console) and optionally saves it to `.thesmos/report.json` for CI integration and trend tracking.
---

# Generate Report

## Purpose

Generates a Thesmos review report in the chosen output format (Markdown, JSON, or console) and optionally saves it to `.thesmos/report.json` for CI integration and trend tracking.

## When to use

- At the end of an AI-assisted review to produce a shareable summary
- In CI to produce a machine-readable findings report
- When a stakeholder requests a summary of the last review
- Generating the PR comment body for an automated review

## Required inputs

- Review findings from `thesmos:review`
- Target output format (Markdown / JSON / console)
- Changed file list and PR metadata

## Workflow steps

1. Run `npm run thesmos:review` to get the findings
2. Choose the output format based on the consumer (CI → JSON, PR comment → Markdown)
3. Format findings with severity groups, file references, and fix suggestions
4. Save to `.thesmos/report.json` if persistence is needed
5. Output the formatted report to stdout or the target file

## Thesmos commands

```bash
npm run thesmos:review -- --markdown
npm run thesmos:review -- --json
```

## Expected output

A formatted report in the requested format. The Markdown report is suitable for GitHub PR comments. The JSON report is suitable for CI artifact storage and programmatic consumption.

## Related agents

- release-readiness-reviewer
- governance-reviewer

## Related rule packs

- @thesmos/core
