---
"thesmos-governance": minor
---

Add `thesmos agent:install` command and shared agent lifecycle module.

**New features:**

- `thesmos agent:install <file>` — install an agent Markdown file into `.thesmos/agents/`, register it in `.thesmos/registry.json`, and synchronize platform adapters in one step.
- `thesmos agent:install <dir>` — batch-install all `.md` files in a directory (non-recursive, deterministic sort, all-or-nothing). `README.md`, `CHANGELOG.md`, and similar meta-files are skipped automatically.
- `--dry-run` flag validates all inputs and shows the proposed operations without mutating any files.
- `--force` flag overwrites an existing canonical file.
- `--no-sync` flag installs and registers but skips adapter regeneration (useful in batch scripts that call `thesmos adapters` once at the end).
- `thesmos agent:create` is refactored to use the shared lifecycle module — agents created with `agent:create` are now auto-registered and adapter-synced in the same pipeline used by `agent:install`.

**Improved blocked-path guidance:**

When the agent tries to write directly to `.claude/agents/`, `.claude/commands/`, or `.claude/skills/` and those paths are in `scope.json` `blockedPaths`, the violation message now includes an actionable suggestion pointing to `thesmos agent:install` and `.thesmos/agents/`.

**Architecture:**

- `thesmos/agent-lifecycle.ts` — new shared module: `toKebabCase`, `isValidAgentId`, `deriveAgentId`, `addAgentToRegistry`, `syncAdapters`, `installAgent`, `isIgnoredAgentFile`, `AgentInstallError`.
- All validation runs before any filesystem mutation (all-or-nothing guarantee).
- Adapter sync is called once per batch, never once per file.
