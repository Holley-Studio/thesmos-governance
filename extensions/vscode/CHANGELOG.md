# Changelog

All notable changes to the Thesmos Governance VS Code extension are documented here.

## [1.5.0] - 2026-06-28

### Fixed

- **LSP crash "env: node: No such file or directory"** — the language server now starts with `NodeModule` transport (VS Code's own Node binary via `process.execPath`) instead of `Executable` transport. Eliminates exit-code-127 crashes when VS Code is launched from the macOS Dock where nvm/volta are not on PATH.

### Added

- **"Fix with AI" button** — new `$(sparkle)` button in the Findings panel toolbar (`thesmos.fixWithAi`). Sends all BLOCKER and HIGH findings to Claude Code CLI via `claude < .thesmos/.ai-fix-session.md`; falls back to clipboard copy if the CLI is not installed. Complements the existing deterministic `fix.all` for findings that require AI reasoning.
- **Release notes on update** — after installing a new version, a "What's New" toast opens this CHANGELOG in Markdown Preview so users always know what changed.
- **Agent presence indicators** — the Agents sidebar now shows a spinning `$(sync~spin)` icon and "working…" label when an agent task is active; clears automatically when the terminal closes or after 60 s.
- **Rich agent invoke UX** — invoking an agent now opens a dedicated terminal running `claude -p 'Agent(...)'` directly (previously only copied a snippet to the clipboard) and reflects status in the sidebar and status bar simultaneously.

## [1.4.0] - 2026-06-25

### Added

- **Agents Panel** — new sidebar panel listing all 40 Pantheon agents grouped by domain; click any agent to compose a task prompt and copy the invocation snippet to clipboard (`thesmos.agents.invoke`)
- **`pantheon:council` CLI command** — routes a natural-language question to 2–4 relevant agents and streams labeled council output per agent; supports `--out=<file>` and `--max=<n>` flags
- **`get_active_agents` MCP tool** — returns all 40 Pantheon agents with domains, roles, models, and invocation instructions; supports optional `domain` filter
- **`.thesmosignore` support** — gitignore-style patterns in a root `.thesmosignore` file are now honoured by the file walker; supports `*`, `**`, `?`, anchored patterns, and directory patterns
- **`thesmos notify` command** — posts Slack-compatible webhook alerts when findings meet a severity threshold (`--webhook=<url> --on=BLOCKER`); supports `--dry-run`
- **25 new auto-fixable rules** in `fix.ts` (total: 55+): `direct_env_access`, `any_type_no_comment`, `ts_as_any`, `empty_catch_block`, `floating_promise`, `hardcoded_http_url`, `import_react_unnecessary`, `todo_in_production`, `merge_conflict_markers`, `require_in_esm`, `py_bare_except`, `py_open_without_encoding`, `docker_latest_tag`, `gha_unpinned_action`, `insecure_random`, `cookie_no_secure_flags`

## [1.3.0] - 2026-06-24

### Added
- Dedicated Activity Bar sidebar with Θ brand icon
- AI Debt Scanner (`thesmos.debtScan`) — quantify accumulated AI tech debt
- Context Snapshot (`thesmos.contextSnapshot`) — capture project context for AI session handoff
- Context Health (`thesmos.contextHealth`) — review context freshness and drift
- Commit Lint (`thesmos.commitLint`) — validate commit messages against Conventional Commits
- Commit Create Wizard (`thesmos.commitCreate`) — guided commit creation with type/scope prompts
- Vercel Lint (`thesmos.vercelLint`) — validate vercel.json for common deployment issues
- Import Scan (`thesmos.importScan`) — supply-chain check for npm dependencies
- Token Budget commands (`thesmos.tokensReport`, `thesmos.tokensReset`, `thesmos.tokensBudget`)
- Agent Scope commands (`thesmos.scopeInit`, `thesmos.scopeStatus`, `thesmos.scopeCheck`)

### Changed
- Renamed from `thesmos-governance` to `thesmos-governance` (package and publisher namespace)
- Extension ID is now `holley-studios.thesmos-governance-vscode`
- Activity Bar icon updated to Θ (Thesmos brand)

## [1.2.0] - 2026-06-18

### Added
- Autopilot view with session journal, diff review, PR creation, and revert commands
- `thesmos.autopilot.*` command group (generate, cancel, review, openPR, viewJournal, revert)
- `thesmos.autopilot.baseBranch` configuration setting

### Changed
- Findings panel now shows BLOCKER/HIGH/MEDIUM/LOW severity badges

## [1.1.0] - 2026-06-16

### Added
- Health score status bar item (0–100 governance grade)
- `thesmos.health` command to view full health breakdown
- `thesmos.adapters` command to regenerate AI adapter files
- `thesmos.autoScan` setting for activation-time auto-scan

### Fixed
- Extension activation race condition on large workspaces

## [1.0.0] - 2026-06-15

### Added
- Initial release under `thesmos-governance` publisher
- Findings panel with inline governance violations
- `scan`, `reviewFile`, `openConfig`, `refreshFindings` commands
- `thesmos.enable`, `thesmos.runOnSave`, `thesmos.debounceMs`, `thesmos.showStatusBar`, `thesmos.binaryPath` settings
- Activity bar view container with Findings and Autopilot views
- Auto-detect thesmos binary from `node_modules/.bin` or PATH
