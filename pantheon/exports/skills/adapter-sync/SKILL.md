---
name: adapter-sync
description: Regenerates all AI adapter files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursor/rules/thesmos.mdc`, `.github/copilot-instructions.md`, `.codex/thesmos.md`) from the current rule registry and active catalog.
---

# Adapter Sync

## Purpose

Regenerates all AI adapter files (`CLAUDE.md`, `GEMINI.md`, `AGENTS.md`, `.cursor/rules/thesmos.mdc`, `.github/copilot-instructions.md`, `.codex/thesmos.md`) from the current rule registry and active catalog.

## When to use

- After updating Thesmos rules or severity configuration
- When `thesmos ci-check` reports stale adapters
- After enabling or disabling agents/skills in the registry
- Periodically as part of repo maintenance

## Required inputs

- Active Thesmos config (`.thesmos/config.json`)
- Active catalog state (`.thesmos/registry.json`)
- Existing adapter files (for section preservation)

## Workflow steps

1. Run `npm run thesmos:adapters` to regenerate all adapter files
2. Review the diff — only `THESMOS:GENERATED` sections should change
3. Verify that manual sections outside the generated markers are unchanged
4. Run `npm run thesmos:ci-check` to confirm freshness check passes
5. Commit the updated adapter files

## Thesmos commands

```bash
npm run thesmos:adapters
npm run thesmos:ci-check
```

## Expected output

Updated adapter files with refreshed `THESMOS:GENERATED` sections. The output of `thesmos ci-check` should show all adapters as fresh.

## Related agents

- governance-reviewer

## Related rule packs

- @thesmos/core
