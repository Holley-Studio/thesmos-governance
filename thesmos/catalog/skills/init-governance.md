---
id: init-governance
name: Init Governance
type: skill
version: 1.0.0
owner: thesmos
tags:
  - init
  - governance
  - setup
enabled: true
---

# Init Governance

## Purpose

Scaffolds or updates the `.thesmos/` governance folder for a new or existing repository. Safe to run repeatedly — generated sections are overwritten while manual content is preserved.

## When to use

- Setting up Thesmos governance on a new repository
- After upgrading the `thesmos-governance` package
- When the architecture snapshot needs a refresh
- After changing the project configuration

## Required inputs

- Repository root directory
- Active Thesmos config (or defaults for a fresh setup)
- Optional: scan data from `thesmos scan` for architecture files

## Workflow steps

1. Optionally run `npm run thesmos:scan` to generate architecture data
2. Run `npm run thesmos:init` to scaffold all governance files
3. Review the diff — created files are new, updated files have changed generated sections
4. Commit `.thesmos/` to source control
5. Run `npm run thesmos:adapters` to generate AI adapter files

## Thesmos commands

```bash
npm run thesmos:scan
npm run thesmos:init
npm run thesmos:adapters
```

## Expected output

A complete `.thesmos/` directory with README, RULES.md, GUARDRAILS.md, governance docs, architecture snapshots, playbooks, and the registry. All generated content is wrapped in `THESMOS:GENERATED` markers.

## Related agents

- governance-reviewer
- onboarding-reviewer

## Related rule packs

- @thesmos/core
