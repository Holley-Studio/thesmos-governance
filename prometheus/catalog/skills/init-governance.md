---
id: init-governance
name: Init Governance
type: skill
version: 1.0.0
owner: prometheus
tags:
  - init
  - governance
  - setup
enabled: true
---

# Init Governance

## Purpose

Scaffolds or updates the `.prometheus/` governance folder for a new or existing repository. Safe to run repeatedly — generated sections are overwritten while manual content is preserved.

## When to use

- Setting up Prometheus governance on a new repository
- After upgrading the `prometheus-governance` package
- When the architecture snapshot needs a refresh
- After changing the project configuration

## Required inputs

- Repository root directory
- Active Prometheus config (or defaults for a fresh setup)
- Optional: scan data from `prometheus scan` for architecture files

## Workflow steps

1. Optionally run `npm run prometheus:scan` to generate architecture data
2. Run `npm run prometheus:init` to scaffold all governance files
3. Review the diff — created files are new, updated files have changed generated sections
4. Commit `.prometheus/` to source control
5. Run `npm run prometheus:adapters` to generate AI adapter files

## Prometheus commands

```bash
npm run prometheus:scan
npm run prometheus:init
npm run prometheus:adapters
```

## Expected output

A complete `.prometheus/` directory with README, RULES.md, GUARDRAILS.md, governance docs, architecture snapshots, playbooks, and the registry. All generated content is wrapped in `PROMETHEUS:GENERATED` markers.

## Related agents

- governance-reviewer
- onboarding-reviewer

## Related rule packs

- @prometheus/core
