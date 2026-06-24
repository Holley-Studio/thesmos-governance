---
id: onboarding-audit
name: Onboarding Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - onboarding
  - documentation
  - developer-experience
enabled: true
---

# Onboarding Audit

## Purpose

Reviews the repository from a new-engineer perspective: how quickly can someone go from `git clone` to a running local environment? Identifies missing setup steps, undocumented env vars, and outdated README sections.

## When to use

- When onboarding a new engineer
- After a major infrastructure change
- Before opening a repository to external contributors
- Developer experience improvement sprints

## Required inputs

- Repository root directory
- README.md content
- `.env.example` content
- `package.json` scripts

## Workflow steps

1. Read README.md and follow the setup instructions as written
2. Compare env vars in `.env.example` against vars referenced in code
3. Run `npm install` and verify it succeeds on a clean checkout
4. Run each `package.json` script and document any that fail
5. Run `npm run thesmos:doctor` for governance health
6. Produce an onboarding gap report

## Thesmos commands

```bash
npm run thesmos:doctor
npm run thesmos:scan
```

## Expected output

An onboarding gap report listing: missing setup steps, undocumented env vars, failing scripts, and outdated documentation sections. Prioritised by how likely they are to block a new engineer.

## Related agents

- onboarding-reviewer
- documentation-reviewer

## Related rule packs

- @thesmos/core
