---
name: final-hardening-pass
description: The last review pass before merging — confirms all BLOCKER findings are resolved, debug artifacts are removed, adapter files are fresh, and the PR is in a releasable state. This skill is intentionally opinionated and conservative.
---

# Final Hardening Pass

## Purpose

The last review pass before merging: confirms all BLOCKER findings are resolved, debug artifacts are removed, adapter files are fresh, and the PR is in a releasable state. This skill is intentionally opinionated and conservative.

## When to use

- Immediately before approving a PR for merge
- As the final step in an AI-assisted review pipeline
- When a PR has been through multiple rounds of review and needs a final clean sweep
- Release gate reviews

## Required inputs

- Final state of all changed files
- Output from the most recent `thesmos:review` run
- Adapter freshness status from `thesmos ci-check`

## Workflow steps

1. Re-run `npm run thesmos:review` on the final file state
2. Assert zero BLOCKER findings — any remaining blockers must be fixed
3. Scan for debug artifacts: `console.log`, `TODO`, `FIXME`, `debugger`, commented-out code
4. Verify adapter freshness: `npm run thesmos:ci-check`
5. Check that test files exist for any risky files in the PR
6. Verify the PR description is complete and references relevant tickets

## Thesmos commands

```bash
npm run thesmos:review
npm run thesmos:ci-check
```

## Expected output

A merge-readiness verdict: MERGE_READY (all gates pass) or NEEDS_WORK (list of remaining issues). For NEEDS_WORK, provides a checklist of required actions ordered by severity.

## Related agents

- release-readiness-reviewer
- governance-reviewer

## Related rule packs

- @thesmos/core
