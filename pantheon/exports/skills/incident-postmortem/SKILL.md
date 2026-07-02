---
name: incident-postmortem
description: Structures and reviews a post-incident code analysis — identifies the root cause in code, verifies the fix addresses the root cause (not just the symptom), and generates action items to prevent recurrence.
---

# Incident Postmortem

## Purpose

Structures and reviews a post-incident code analysis: identifies the root cause in code, verifies the fix addresses the root cause (not just the symptom), and generates action items to prevent recurrence.

## When to use

- After a production incident is resolved
- When writing a blameless postmortem
- Before closing an incident ticket
- Reliability improvement reviews

## Required inputs

- Incident description and timeline
- The hotfix PR and its diff
- Error logs or stack traces from the incident

## Workflow steps

1. Map the incident timeline to specific code changes (git blame / git log)
2. Identify the root cause code path and the triggering condition
3. Review the hotfix PR with `incident-reviewer` agent focus
4. Verify a regression test exists for the exact failure mode
5. Generate action items: test coverage, monitoring, process changes
6. Run `npm run thesmos:review` on the hotfix to verify no new issues

## Thesmos commands

```bash
npm run thesmos:review
npm test
```

## Expected output

A postmortem code analysis: root cause location (file, line, function), contributing factors, hotfix correctness assessment, regression test status, and a prioritised action-item list for preventing recurrence.

## Related agents

- incident-reviewer
- observability-reviewer

## Related rule packs

- @thesmos/core
