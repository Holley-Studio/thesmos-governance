---
"thesmos-governance": minor
---

Add `thesmos agent:install` command and shared agent lifecycle module.

**New features:**

- `thesmos agent:install <file>` — install an agent Markdown file into `.thesmos/agents/`, register it in `.thesmos/registry.json`, and synchronize platform adapters in one step.
- `thesmos agent:install <dir>` — batch-install all `.md` files in a directory (non-recursive, deterministic sort). A preflight pass validates every file before any mutation; if preflight passes but an unexpected mutation-time failure occurs (e.g. permission change between phases), the installed/failed split is reported as partial-success with recovery instructions. `README.md`, `CHANGELOG.md`, and similar meta-files are skipped automatically.
- `--dry-run` flag validates all inputs and shows the proposed operations without mutating any files.
- `--force` flag overwrites an existing canonical file.
- `--no-sync` flag installs and registers but skips adapter regeneration (useful in batch scripts that call `thesmos adapters` once at the end).
- `thesmos agent:create` is refactored to use the shared lifecycle module — agents created with `agent:create` are now auto-registered and adapter-synced in the same pipeline used by `agent:install`.

**Improved blocked-path guidance (path-specific):**

When the agent tries to write directly to a `.claude/` surface and that path is in `scope.json` `blockedPaths`, the violation now provides surface-specific guidance:
- `.claude/agents/` → points to `thesmos agent:install` and `.thesmos/agents/`
- `.claude/skills/` → points to `thesmos skill:create` / `thesmos adapters`
- `.claude/commands/` → states there is no Thesmos-managed installer and suggests handling outside the governed session

**Safety fixes:**

- Malformed `.thesmos/registry.json` now throws instead of silently resetting to defaults (which would destroy existing registry state).
- Registry writes use a same-directory temporary-file + rename pattern. On POSIX systems, `rename(2)` is atomic when source and destination share a filesystem, so the old file remains intact until the new file is fully written. On Windows, the rename still protects against partial writes even though it is not atomic at the OS level. A 1 MB size guard on registry reads guards against accidental corruption.
- Transaction rollback: if the registry update fails after the canonical file was written, the file is removed to prevent orphaned state.
- Source-equals-destination: installing a file that is already the canonical path is handled as a register-only no-op (no self-overwrite).
- Batch duplicate detection: `agent:install <dir>` now detects when two files normalize to the same agent ID before any mutation and exits with an actionable error.
- Audit entry is written only after all mutations succeed; dry-run never writes an audit entry.
- Audit write failures are non-fatal but now emit a warning via `process.stderr.write` rather than silently swallowing the error.

**Architecture:**

- `thesmos/agent-lifecycle.ts` — new shared module: `toKebabCase`, `isValidAgentId`, `deriveAgentId`, `addAgentToRegistry`, `syncAdapters`, `installAgent`, `isIgnoredAgentFile`, `AgentInstallError`.
- All validation runs before any filesystem mutation. Preflight catches ID collisions, conflicts, and format errors before the first write; unexpected mutation-time failures are reported as partial-success with a recovery command (`thesmos adapters`).
- Adapter sync is called once per batch, never once per file.
