---
id: staged-change-review
name: Staged Change Review
type: skill
version: 1.0.0
owner: prometheus
tags:
  - review
  - staged
  - git
  - pre-commit
enabled: true
---

# Staged Change Review

## Purpose

Reviews only the files currently staged in git (via `git diff --staged`) before a commit is made. Faster than a full PR review and ideal as a pre-commit hook or on-demand check during development.

## When to use

- Before running `git commit` to catch issues early
- As a pre-commit hook in a developer's local environment
- When an AI coding assistant finishes a discrete task and wants self-review
- Fast iterative development where full PR review is too slow

## Required inputs

- Staged file content (from `git diff --staged` or `git show :path`)
- Active Prometheus config from `.prometheus/config.json`

## Workflow steps

1. Get the list of staged files: `git diff --staged --name-only`
2. For each staged file, get the staged content: `git show :filename`
3. Also get the diff: `git diff --staged -- filename`
4. Run `npm run prometheus:review` with the staged file set
5. Report only BLOCKER and HIGH findings — skip lower severities for speed
6. If BLOCKERs found, advise unstaging and fixing before committing

## Prometheus commands

```bash
git diff --staged --name-only
npm run prometheus:review
```

## Expected output

A fast, focused finding list: BLOCKER and HIGH violations only, with file and line references and one-line fix suggestions. Designed to be read in under 30 seconds.

## Related agents

- security-reviewer
- code-quality-reviewer

## Related rule packs

- @prometheus/core
