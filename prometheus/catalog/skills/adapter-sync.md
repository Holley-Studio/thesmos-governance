---
id: adapter-sync
name: Adapter Sync
type: skill
version: 1.0.0
owner: prometheus
tags:
  - adapters
  - sync
  - governance
  - freshness
enabled: true
---

# Adapter Sync

## Purpose

Regenerates all AI adapter files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursor/rules/prometheus.mdc`, `.github/copilot-instructions.md`, `.codex/prometheus.md`) from the current rule registry and active catalog.

## When to use

- After updating Prometheus rules or severity configuration
- When `prometheus ci-check` reports stale adapters
- After enabling or disabling agents/skills in the registry
- Periodically as part of repo maintenance

## Required inputs

- Active Prometheus config (`.prometheus/config.json`)
- Active catalog state (`.prometheus/registry.json`)
- Existing adapter files (for section preservation)

## Workflow steps

1. Run `npm run prometheus:adapters` to regenerate all adapter files
2. Review the diff — only `PROMETHEUS:GENERATED` sections should change
3. Verify that manual sections outside the generated markers are unchanged
4. Run `npm run prometheus:ci-check` to confirm freshness check passes
5. Commit the updated adapter files

## Prometheus commands

```bash
npm run prometheus:adapters
npm run prometheus:ci-check
```

## Expected output

Updated adapter files with refreshed `PROMETHEUS:GENERATED` sections. The output of `prometheus ci-check` should show all adapters as fresh.

## Related agents

- governance-reviewer

## Related rule packs

- @prometheus/core
