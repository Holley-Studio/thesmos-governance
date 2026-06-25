---
id: pr-review
name: PR Review
type: skill
version: 1.0.0
owner: thesmos
tags:
  - review
  - pr
  - git
enabled: true
---

# PR Review

## Purpose

Performs a complete Thesmos-governed review of a pull request: scans all changed files, applies all active rules, produces severity-ranked findings, and formats the output for inclusion in a GitHub PR comment.

## When to use

- As the default review skill for every PR on a Thesmos-governed repo
- When an AI agent is asked to "review this PR"
- As the first step in a multi-agent review pipeline

## Required inputs

- List of changed files with their content and diff
- Active Thesmos config (`.thesmos/config.json`)
- Target branch and PR description for context

## Workflow steps

1. Run `npm run thesmos:review` with the changed file list
2. Parse findings grouped by severity (BLOCKER → HIGH → MEDIUM → LOW → TECH_DEBT)
3. Check for BLOCKER findings — if any, surface them immediately at the top
4. Format findings as a GitHub-flavoured Markdown comment
5. Append adapter freshness status (run `thesmos ci-check` to verify)

## Thesmos commands

```bash
npm run thesmos:review -- --base=main
npm run thesmos:ci-check
```

## Expected output

A structured PR review comment with severity-grouped findings, file-and-line references, suggested fixes for each finding, and a final merge recommendation (APPROVE / REQUEST_CHANGES / COMMENT).

## Related agents

- security-reviewer
- code-quality-reviewer
- testing-reviewer

## Related rule packs

- @thesmos/core
