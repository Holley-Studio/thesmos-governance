# Changelog

## Unreleased

### Minor Changes

- **Trust Execution Hardening (5.1.0):** Phases 0–8 — fail-closed assurance, safe Claude execution defaults, real Pantheon `--execute`, builder/`agent:run` repairs, execution receipts + local metrics, release pins, health/catalog integrity, and score honesty via real `governance.log.jsonl` evidence.

  - Shared `assurance.ts` (`PASS|FAIL|INCOMPLETE|ERROR`); empty/missing evidence never reports 100%.
  - `compliance:report` reads `.thesmos/report.json`; CI uses `dist/cli.js` + SARIF fail-closed + coverage floors.
  - `mcp --stdio` alias; product facts from `catalog/product-facts.json`.
  - Autopilot: `dangerouslySkipPermissions` default-off; Depends-on runtime gate; orchestrate brief-only unless `--execute`.
  - `agent:run`, RAG scaffolds (OpenAI/Cohere/local embed), versioned receipts, `eval` runtime section.
  - Catalog loads reviewers + pantheon + figma + root; doctor/catalog:validate honest exits; CI `--health-threshold=90`.
  - **Phase 8:** `review` / `validate` / `ci` / MCP `scan_file` append enforcement events (`review.clean` on empty); score tip when INCOMPLETE.
  - `agents:doctor`: skip false `registry_inconsistency` when the agent is catalog-backed (matches drift).
  - Regenerate `catalog/product-facts.json` with the 5.1.0 version bump.
  - **Elevate (stress follow-up):** TECH_DEBT→WARN with weighted compliance; NODE_022/TS_010 async-hint precision; SLOP_002 workspace-aware deps; `ci` smoke receipts; `commit:lint -m`; `commit:create` uses `execFileSync` (no shell); js-yaml 4.3.0 + esbuild 0.28.1 override.
  - **Pantheon Chat permission deadlock (macOS):** Unix socket under `os.tmpdir()` exceeded `sun_path` (ENAMETOOLONG) so the bridge never bound and every Edit/Write/Bash was denied. Socket now lives at `/tmp/thesmos-perm/p-<16hex>.sock` with listen error logging.
  - Supply chain: brace-expansion 5.0.8; Actions SHA-pinned; `npm publish --provenance` unchanged (no auto-publish).

- **Cross-platform Thesmos guard (Operation Aegis):** Claude Code hooks no longer depend on Unix shell (`npx … 2>&1 || true`, Bash wrappers) for governance.

  - Node entrypoint `dist/thesmos-guard.js` is the source of truth (`check` | `budget-check` | `drift`).
  - Thin wrappers: `bin/thesmos-guard.sh` (LF) and `bin/thesmos-guard.cmd` (CRLF) — no duplicated rule logic.
  - `thesmos claude:govern install` writes Node-direct commands via `process.execPath` + resolved entry.
  - Plugin `hooks/hooks.json` uses exec-form `node` + `args` with `${CLAUDE_PLUGIN_ROOT}`.
  - New config: `autoMode.failClosed` defaults to **true** — infrastructure failures (malformed stdin/config, internal exceptions) block with exit 2. Explicit `failClosed: false` restores legacy fail-open.
  - `bin` entry: `thesmos-guard`. Windows CI job exercises the real guard path.
  - Statusline remains Bash-only (non-critical path); document honestly — not required for PreToolUse.

- **Federated agent architecture:** Thesmos governs agent behavior without claiming ownership of every file under `.claude/agents/`.

  - Ownership manifest: `.thesmos/managed-agents.json` (only listed paths are Thesmos-owned).
  - Managed Claude fallbacks write to `.claude/agents/thesmos/` (and `~/.claude/agents/thesmos/` for local install).
  - Scope allows creating/editing unmanaged project agents; overwriting managed files is blocked with guidance.
  - Discovery: `thesmos agents:list --all`, `agents:doctor`, `agents:conflicts` (project > user > plugin precedence).
  - Adoption: `thesmos agent:adopt` / `agent:release` (external agents are never auto-adopted).
  - Adapter and local installer sync never overwrite or delete untracked files; modified managed files are preserved and reported.
  - Zeus uses unrestricted `Agent` tooling and documents external-agent interoperability.
  - New package layout: `pantheon-plugin/` for Claude Code plugin distribution (fallback copy path remains).

## 5.0.0

### Major Changes

- 0ccee2a: **5.0: The tool is free. The gods are $24.**

  Every governance rule is now free for everyone — the complete 1,137-rule
  engine, every framework pack, every compliance pack (GDPR/HIPAA/EU AI
  Act/DORA). `activeRulesForTier()` returns the full engine regardless of
  tier (BREAKING for anyone depending on the free-tier restriction).

  The paid product is the **Full Pantheon** — all 67 specialist agents,
  **$24 one-time** (was $79), content-gated: premium agents are physically
  absent from the free npm distribution rather than honor-system-gated.

  New:

  - The npm tarball now ships the 6 free starter gods (Zeus, Athena, Argus,
    Apollo, Hephaestus, Hebe) — previously it shipped ZERO pantheon agents,
    so the free tier was broken for real npm installs.
  - `thesmos pantheon:install --pack <zip|dir>` — one-command install of the
    purchased Gumroad pack: extracts, validates, installs all agents,
    regenerates adapters, drops the purchase marker. Idempotent; re-download
    - re-run is the update channel.
  - `pantheon:list` / `pantheon:install` show computed god counts and a $24
    upsell only when running on the free distribution.
  - `pack-gate.test.ts` guards the content gate in CI — premium agents can
    never silently leak into the tarball again.

## 4.8.0

### Minor Changes

- 7499d19: Add `thesmos agent:install` command and shared agent lifecycle module.

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

- 62d7185: Add `thesmos pantheon:install --write` and VS Code extension UX improvements.

  **`pantheon:install --write`:**

  A new `--write` flag on `pantheon:install` writes agent content directly to `.thesmos/agents/<id>.md` and runs `thesmos adapters` in a single pass — no intermediate `pantheon/exports/` directory required.

  This replaces the previous three-step export flow (`pantheon:export` → `pantheon/exports/` → `agent:install`) with a single intentional command:

  ```bash
  thesmos pantheon:install --all --write
  ```

  The `--write` path uses the `agent-lifecycle` module: each agent file is written to the canonical `.thesmos/agents/` location, registered in `.thesmos/registry.json`, and adapters are regenerated once at the end. The original registry-only behaviour (no `--write`) is unchanged.

  **VS Code extension v4.8.0:**

  - **`⚡ Pantheon` status bar item** — permanent, always-visible launcher that opens Pantheon Chat in an editor tab from anywhere in VS Code.
  - **`$(cloud-download) Set Up Thesmos` status bar state** — replaces the previous "not installed" error badge with a clickable button that runs the full setup flow (`npm install && thesmos init && thesmos scan`).
  - **"Install Pantheon Agents" command** — separate from setup; shows a modal confirmation before writing agent files, making the two-step onboarding explicit for new users.
  - **Two-step welcome card** — Findings panel welcome view now shows Step 1 (setup) and Step 2 (install agents) with dedicated buttons.
  - **Drag-and-drop attachments** in Pantheon Chat — drag files or images from Finder or VS Code Explorer onto the chat to attach them. Shows a gold ⚡ overlay during drag; falls back to base64 temp-file flow in sandboxed contexts.
  - **"Open in Editor Tab" panel button** — `$(window)` icon in the Pantheon Chat panel title bar.
  - **`thesmos.setup` command** — wired to a new terminal that runs governance setup only (no agent installation mixed in).

### Patch Changes

- Replace cryptic rule IDs with Pantheon guardian names and human descriptions.

  Rule categories like `agent_no_scope_declared` and IDs like `AGNT_004` now surface as readable god attributions everywhere they appear:

  **Governance block messages** (`thesmos claude:govern check`):

  Before:

  ```
  [SC_MISSING_LOCKFILE] package.json present but no lockfile found
  ```

  After:

  ```
  [🔒 Nemesis · Supply Chain: Missing Lockfile]
  package.json present but no lockfile found
  ```

  **Brain file** (`.thesmos/brain.md` — read by Claude Code):

  Before:

  ```
  - **AGNT_004** × 3 (src/config.ts…)
  ```

  After:

  ```
  - ⚡ Zeus · Agent: No Token Budget — No agent token budget configured _(AGNT_004)_ × 3 (src/config.ts…)
  ```

  Human name and guardian god lead; the rule ID is tucked in parens for `thesmos explain` reference.

  New module `thesmos/rule-labels.ts` exports `categoryLabel()`, `categoryGuardian()`, `categoryTitle()`, and `ruleNameById()` — available as a public import for downstream tooling.

## 4.7.0

### Minor Changes

- 4e61cbf: The Divine First Hour — the extension never feels frozen, the chat feels alive, and Thesmos starts paying for itself:

  - **Living presence.** A god-flavored working indicator in the status bar for every long operation (scan, save-review, adapters, AI fix), and an instant "the council deliberates…" thinking strip in Pantheon Chat between prompt and first token — with a 2s gap-detector so long tool calls never look frozen.
  - **Credit Guardian.** An honest, append-only savings ledger (`.thesmos/savings.jsonl`): tier-discipline savings per chat turn, budget hard stops, and 1M-context blocks. Surfaced as `⚖ ~$X saved` in the chat header, the token-meter tooltip, and the new `thesmos savings` command. All figures estimated vs the flagship baseline — never counts a recommendation you didn't take.
  - **Split-right chat.** "Open Pantheon Chat in Editor" now splits beside your code by default (`thesmos.chat.openLocation`), plus welcome-screen suggested first prompts.
  - **Mythic first-run.** `thesmos init` greets with the Thesmos banner, an Argus scan line, and closes with an oracle verdict (health grade, first labor, next steps). TTY only — JSON/piped/CI output unchanged.
  - **Two false-positive fixes found by dogfooding this release on this repo's own gate:** SC_002 no longer fires on package.json edits when a lockfile exists on disk (workspace root or alongside), and the DORA rules no longer classify a repo as an EU financial entity on a single weak keyword ("ledger", "transaction", "portfolio"…) — one strong term or two distinct weak terms are now required.

- 9778fe2: Three false-positive/staleness fixes reported from real-world repos:

  - **ENV_001 reworked.** The old rule demanded the meaningless obfuscation `process['env' as 'env']['VAR']` at BLOCKER severity — a pattern with no security value that also breaks bundler inlining. It is now a LOW maintainability rule recommending a central, schema-validated env module; `NEXT_PUBLIC_*` and `NODE_ENV` reads are fully exempt (bundlers require the literal dot form to inline them), the central `env.ts` module itself is exempt, and the bracket-notation auto-fixer was removed. Free-tier rule count shifts 289 → 288 (ENV_001 is no longer a BLOCKER, so it moves to the premium set).
  - **Supabase anon key false positive.** NEXT*047 and VERCEL_002 no longer flag public-by-design keys (`*ANON_KEY*`, `*PUBLISHABLE*`, `*PUBLIC_KEY*`, `*SITE_KEY*`) stored under `NEXT_PUBLIC*` — the Supabase anon key, Stripe publishable key, and captcha site keys are meant to ship to the browser.
  - **Health score no longer freezes.** `thesmos health` (and the VS Code status bar that calls it) now computes from a fresh in-memory scan instead of the last saved `report.json`, so the score reflects the repo as it is now — previously it silently never changed until someone re-ran `thesmos scan`.

- 5c82407: `thesmos init` now generates AI adapter files (CLAUDE.md, GEMINI.md, AGENTS.md, Cursor/Copilot/Codex instructions) by default, so a single init command leaves the repo fully wired — no separate `thesmos adapters` step to forget. Opt out with `--no-adapters`. Adapter generation runs after profile application so the agent-context section reflects any profile agents just installed, and is skipped in `--dry-run`. The Pantheon routing doctrine (this repo's CLAUDE.md and the buyer kit's PANTHEON.md) also gains a "Skill Frameworks — Process vs. Personnel" section defining how Thesmos composes with process-skill frameworks like Superpowers: skills decide when/how to dispatch subagents, the Pantheon routing table decides which agent gets dispatched.
- 9778fe2: `thesmos init` now scaffolds cost governance ON by default and detects adapter targets instead of shotgunning all six:

  - **Token budgets enabled for new users.** The scaffolded `.thesmos/config.json` ships `tokenBudget.enabled: true` with the standard defaults ($5/session, $25/day, $500/project, alert at 80%). Enforcement activates when `thesmos claude:govern install` wires the PostToolUse hook — init prints that next step.
  - **Detected adapter targets.** Plain `init` now generates CLAUDE.md + AGENTS.md always, and Gemini/Cursor/Copilot/Codex adapters only when that tool's footprint already exists in the repo — no more six-file spray into single-tool repos. `thesmos adapters` still generates every target explicitly.

- 1c65117: Pantheon Chat: persistent status strip + permission-bridge hardening.

  **Always-on status strip.** A persistent strip above the composer now reflects the live turn state — Thinking, Writing, running a specific tool, dispatching a god, and **Compacting context** (previously a silently-dropped `compact_boundary` event). It stays lit for the whole turn instead of blanking when text streams, and carries a **live context-window meter** (input + cache tokens vs the 200k window) that turns amber at 75% and red at 90% — so approaching the usage ceiling is visible instead of a surprise. All of it reads events the CLI already emits and renders client-side, so it adds zero token cost.

  **Permission-bridge hardening (Argus security audit, 3× HIGH).**

  - **HIGH-1** — the consent dialog no longer truncates Bash commands to 400 chars; the full command the user is approving is shown in a scrollable, XSS-safe block. A hidden tail past a cutoff can no longer defeat informed consent.
  - **HIGH-2** — session-wide "always allow" is now a gated escalation: `Bash` is excluded entirely (no blanket shell auto-approval), and every other tool requires a native modal confirmation before the grant is added. The pending request still resolves immediately.
  - **HIGH-3** — switching into `auto` permission mode (which disarms the per-call human gate) now requires an explicit native modal; declining reverts the dropdown, so a stray webview message can't silently downgrade posture.

  **Model routing.** Zeus, Argus, and Athena resolve to Opus (matching the catalog source of truth); marketing copy and the extension welcome panel are aligned to the canonical 67-agent count.

- 9778fe2: Fix severity resolution: `mergeConfig()` now merges user `severityRules` on top of
  the full default rule list instead of replacing it. Previously, any project with a
  `severityRules` array in `.thesmos/config.json` silently ran up to 198
  BLOCKER-declared rules at MEDIUM severity — those rules never blocked CI.

  **Root cause:** `config.ts` replaced `severityRules` with the user's partial list,
  then `classifySeverity()` fell back to `SEVERITY_DEFAULT = 'MEDIUM'` for every rule
  not in that list, ignoring each rule's declared severity.

  **First-run notice:** On the first `thesmos scan` (or any command that loads config)
  after upgrading, if your config would have silenced any BLOCKER rules under the old
  behavior, thesmos prints a one-time notice to stderr:

  > [thesmos] ℹ️ N rules now enforce as BLOCKER that were previously silent under
  > your config — see CHANGELOG.md for details.

  This fires once per project and is then acknowledged via `.thesmos/.severity-fix-ack`
  (gitignored, per-machine).

  **Migration:** If a rule now blocking CI is one you intentionally want at a lower
  severity, add an explicit override in `.thesmos/config.json`:

  ```json
  {
    "severityRules": [
      { "category": "some_blocker_category", "severity": "MEDIUM" }
    ]
  }
  ```

  User-specified entries still win. Unspecified rules now use their registry-declared
  severity instead of defaulting to MEDIUM.

  **Bump rationale:** Minor, not patch — the behavioral change (previously-silent
  BLOCKER rules now blocking CI) is intentional and expected after a bug fix, but has
  breaking consequences for misconfigured pipelines that relied on the silent fallback.

  **Deferred:** Per-rule `detect()` fixture suite (200+ fixtures) is tracked in
  GitHub issue #96 and documented at `.thesmos/known-gaps/detect-fixture-suite.md`.
  The regression test added here (`severity.test.ts` — `it.each` over all BLOCKER
  rules with a partial user config) covers the config-merge path and would have caught
  the original gap.

### Patch Changes

- 9778fe2: False-positive fixes for client-component detection and stale guidance text:

  - **SEC_001 / IMPORT_005 now verify directive position.** A `'use client'`
    string anywhere in a file no longer marks it as a client component — the
    directive must be the first non-comment statement, exactly as Next.js
    requires. Test fixtures, scanner sources, and docs containing the string
    no longer trip `admin_client_in_browser` or `server_module_in_client`.
    New helper: `isClientComponentFile()` in `secrets.ts`, with tests.
  - **Retired bracket-notation guidance scrubbed.** `vibe_hardcoded_secret`'s
    suggestion and the `hardcoded_credentials`/`vibe_hardcoded_secret` good
    examples still recommended `process['env' as 'env']['VAR']` — they now
    recommend standard `process.env` reads via a schema-validated env module,
    matching the ENV_001 rework.

- ce928aa: `claude:govern install` now writes a `permissions.allow` block alongside governance hooks.

  Every project that runs `thesmos claude:govern install` (or `thesmos:adapters`) automatically gets prompt-free approval for read-only tool patterns extracted from real usage across sessions:

  - **Playwright MCP** — `browser_navigate`, `browser_take_screenshot`, `browser_snapshot`, `browser_resize`, `browser_console_messages`, `browser_close` (observation-only; click/fill/eval remain gated)
  - **TypeScript typecheck** — exact form `Bash(npx tsc --noEmit)` (no file writes)

  `claude:govern uninstall` removes only the thesmos-managed entries; any user-added entries are preserved. Existing `permissions.allow` entries are never overwritten or removed during install.

## 4.6.0

### Minor Changes

- e8ce8d1: AGNT_037 (1M context window governance) is now a hard BLOCKER gate instead of an advisory HIGH lint. Enabling a `[1m]` model variant or `context-1m` beta header without explicit `"context1M": { "allow1M": true }` in `.thesmos/config.json` now blocks the Write/Edit governance hook and fails CI, instead of only printing a warning. The matcher is scoped to live config contexts (model assignments, `anthropic-beta` values) so it does not fire on prose/documentation mentioning `[1m]`.
- e8ce8d1: Adds a native Claude Code plugin surface (`.claude-plugin/plugin.json` + marketplace listing) that registers the existing MCP server, the governance PreToolUse/PostToolUse/Stop hooks, and three skills (scan/review/advise). Install via `/plugin marketplace add Holley-Studio/thesmos-governance` — no separate `npm install` step required.
- e8ce8d1: New `power: 'lean' | 'god'` config governs Pantheon orchestration ceremony in AI-assistant adapter output. `lean` (default) routes to one specialist with a one-line Zeus header and no auto-council; `god` unlocks the full multi-line routing banners, council assembly/report blocks, and deep-research escalation. `thesmos advise` now assigns a model recommendation per plan phase (splitting a plan across model tiers when phases genuinely differ in depth) instead of a single recommendation for the whole plan.
- e8ce8d1: New rule tiering engine. The free CLI now runs a 289-rule Essentials set (every BLOCKER plus the complete AI-code safety net — VIBE/AI/SLOP rule families); the remaining 848 rules unlock via a distribution-gated premium pack marker (`~/.thesmos/premium/pack.json` or a project's `.thesmos/premium/pack.json`), or explicitly via `config.tier` / the `THESMOS_TIER` environment variable. New `thesmos tier` command reports the active tier and rule counts (supports `--json`).

### Patch Changes

- aff19cb: claude:govern check now writes block messages to stderr so Claude Code displays them (blocking hooks only surface stderr on exit 2; stdout was silently dropped, making every block appear as "No stderr output"). Ships alongside the already-committed VIBE_007 placeholder and VIBE_009 JSX `<select>` template-literal false-positive fixes, which were fixed in source but never published.
- 4ece775: Fixed the Linux secrets vault path (`secret-tool`) to pipe the master key via real stdin (`execFileSync`'s `input` option) instead of an intermediate `echo`/`printf` shell process, which briefly exposed the raw key in that process's own argv. Also documented — but could not eliminate — a matching, narrower exposure on macOS: Apple's own `security` CLI has no stdin/env alternative to its `-w` flag (its own `-h` text admits this: "Use of the -p or -w options is insecure"), so the key briefly appears in `security`'s argv there. Local-only, single-user exposure window in both cases; not remotely exploitable.

All notable changes to `thesmos-governance` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.6.0] — 2026-06-23

### Added

**Universal Intelligence Protocol — injected into every generated CLAUDE.md:**
Every `thesmos adapters` run now appends the Pantheon Universal Intelligence Protocol to the generated CLAUDE.md. All 34 God Agents inherit: Consultation Mode (ranked options with trade-offs), Calibrated Confidence markers ([ASSUMPTION], [VERIFY], [LIKELY]), Adversarial Self-Check, Governance Badge on every output, Proactive Insight Protocol, Temporal Scope declarations, and God Council Escalation. The protocol is generated by the new `generatePantheonProtocol()` function in `adapters.ts`.

**3 New God Agents (catalog: 70 → 73, Pantheon: 31 → 34):**

- **God Agent Proteus** (`proteus-drift-agent`) — Drift & Alignment Monitor. Detects product drift, prompt drift, architecture drift, brand drift, strategy drift, and governance drift. Compares the current state against documented baselines; surfaces findings by domain with severity (BLOCKER/HIGH/MEDIUM/LOW) and delegates corrections to domain specialists. Integrates with `thesmos drift` (infrastructure) and `.thesmos/brain.md` (context baseline). Governed by AGNT_001, MCP_001.
- **God Agent Momus** (`momus-challenger-agent`) — Challenger & Clarity Enforcer. Challenges plans, ideas, and research before they execute using Socratic method, Gary Klein's Pre-mortem, Charlie Munger's Inversion, Red Team thinking, and Five Whys. Delivers: premise check, 3 weakest assumptions, 5 unasked questions, 3 failure scenarios, specificity demands, and unrepresented interests. Auto-invoked by Zeus before irreversible decisions. Governed by AGNT_001, LIC_001.
- **God Agent Metis** (`metis-pm-agent`) — Project Manager & Execution Planner. Converts plans into executable phases with entry/exit criteria, critical path (CPM), RACI ownership tables, risk registers, definitions of done, and status templates. Auto-invoked by Zeus before plans longer than 4 weeks and by Daedalus after PRD approval. Governed by AGNT_001, SC_002.

**"God Agent" naming convention applied to all 37 Pantheon agents** — Every agent's `name:` frontmatter field and `## Identity` opening now use the "God Agent [Name]" prefix. Example: `name: "God Agent Zeus — Executive Agent"` and `"You are God Agent Zeus, Executive Agent..."`. Applied to: all 21 agents in `catalog/agents/pantheon/`, the 10 workflow agents (Chiron, Calliope, Cassandra, etc.), and the 6 security investigators (Hades, Cerberus, Nyx, etc.).

**God Council protocol added to God Agent Zeus** — Full arbitration process: conflict trigger conditions, 5-step arbitration sequence, permanent vetoes (Argus security veto, Themis legal veto that cannot be overridden), and standing rule that Momus is invoked before every God Council session.

**Delegation map in Zeus updated** — Now includes all 34 God Agents including Metis, Momus, Proteus, Chiron, Cassandra, Calliope, Erato, Kratos, Aether, Polyhymnia, Talos, Clio, and Eos. Direct peer delegation rules added: any agent can invoke Momus (challenge check), Proteus (drift check), Argus (security), or Themis (legal) without routing through Zeus.

**Domain mastery sections added to all 37 existing agents** — Three new sections per agent inserted after `## Constraints`:

- `## Failure modes` — 3–5 domain-specific failure patterns with diagnostic questions
- `## Problem diagnosis` — 3–4 questions the agent asks before accepting the stated problem
- `## What makes this God Agent's judgment unique` — 4–5 non-obvious expert insights from deep domain experience

### Changed

- **`thesmos/package.json`** — version `3.5.0` → `3.6.0`
- **`thesmos/catalog.test.ts`** — agent count assertion `70` → `73`
- **`thesmos/bin/commands/compliance.ts`** — footer version `v3.5.0` → `v3.6.0`
- **`thesmos/adapters.ts`** — added `generatePantheonProtocol()` function; `generateClaudeRules` now appends Universal Protocol to every CLAUDE.md output

### Website & Documentation

- **`holley.studio/thesmos`** — version badge `v3.5.0` → `v3.6.0`, Pantheon count `31` → `34`, 3 new Pantheon cards (Proteus, Momus, Metis), new "Why Thesmos is Different" section with 4-card comparison and competitive table
- **`thesmos/README.md`** — new "Why Thesmos is different" section with 7 key selling points and feature comparison table

---

## [3.5.0] — 2026-06-23

### Added

**10 New Pantheon Agents — Creative, Business, and Developer Workflow:**

- **Calliope** (`calliope-email-agent`) — Email Design & HTML/MJML Agent. MJML source code, compiled HTML email templates, responsive cross-client design, deliverability checklists, A/B variant specs. Governed by GDPR_004 (no PII in email URLs), SEC_008 (no secrets in templates), GDPR_001 (consent gate awareness).
- **Talos** (`talos-web-dev-agent`) — Web Dev & Implementation Agent. Production-ready Next.js/React/TypeScript components, API routes, database queries, and test scaffolds. Runs a mental Thesmos governance scan on every file before delivery. Governed by SEC_004, AUTH_002, NEXT_003, MCP_001.
- **Clio** (`clio-case-study-agent`) — Case Study & Social Proof Agent. Customer interview frameworks (STAR structure), first draft with [VERIFY] placeholders, ROI calculation worksheets, testimonial pull quotes, LinkedIn post versions, and PDF design briefs for Hephaestus. Governed by LIC_001 (no fabricated quotes), GDPR_013 (client consent required).
- **Eos** (`eos-automation-agent`) — Automation & Workflow Engineering Agent. n8n/Zapier/Make workflow JSON, GitHub Actions YAML, shell scripts, webhook handler code, and runbooks. All API keys BYOK. Governed by SC_007 (no script injection), SC_001 (pinned actions), SEC_007 (no hardcoded credentials).
- **Erato** (`erato-brand-voice-agent`) — Brand Voice & Messaging Architecture Agent. Brand voice guides, messaging architecture (hero message → pillars → proof points), tagline options with rationale, boilerplate copy at 4 lengths, competitor voice differentiation matrix. The guide that Apollo executes within.
- **Kratos** (`kratos-devops-agent`) — DevOps & Infrastructure Agent. Dockerfiles (multi-stage, non-root), docker-compose, GitHub Actions CI/CD, Terraform modules, K8s manifests, secrets management plans, and runbooks. Governed by K8S_001, SC_006, SEC_007.
- **Aether** (`aether-ai-strategy-agent`) — AI Product Strategy & Prompt Engineering Agent. LLM selection matrix, system prompt engineering (with injection hardening), RAG pipeline architecture, evaluation frameworks, token cost estimates. Governed by MCP_001, AGNT_001, LIC_008. All LLM API keys BYOK.
- **Polyhymnia** (`polyhymnia-docs-agent`) — Technical Documentation Agent. READMEs with badges/quickstart/API surface, API references, ADR templates, runbooks, JSDoc/TSDoc annotations, and changelog entries. Developer-facing technical docs only — not marketing content. Governed by LIC_001, GDPR_013.
- **Cassandra** (`cassandra-qa-agent`) — QA & Testing Strategy Agent. Test strategy documents, test plans (happy path + edge cases + error cases), Vitest/Jest scaffolds, Playwright E2E outlines, coverage targets by module type, CI test pipeline config. Risk-based prioritisation; never recommends 100% coverage as a goal. Governed by SC_002, AUTH_002, GDPR_001.
- **Chiron** (`chiron-architecture-agent`) — Architecture & Engineering Advisory Agent. Architecture recommendations with named alternatives and explicit trade-offs, ADR documents, C4 model system diagrams, technology selection matrices, refactoring roadmaps, and technical debt inventories. The senior engineer in the room. Governed by MCP_001, SC_001, AGNT_001.

**Pantheon now spans 31 agents** covering executive, marketing, content, creative, design, sales, CX, legal, finance, PR, BD, operations, knowledge, video, animation, photography, security investigation, email design, web development, case studies, automation, brand voice, DevOps, AI strategy, technical documentation, QA, and architecture.

---

## [3.4.0] — 2026-06-22

### Added

**`brain:promote` — Community Rule Promotion:**

- New command `thesmos brain:promote --rule=<ID>` scaffolds an approved `ProposedRule` from `brain.json` into a TypeScript rule stub at `thesmos/rules/community/<ID>.ts`
- Generated stubs follow the exact `ThesmosRule` pattern used throughout the core rules (exported `*_RULES` array, externalized regex constant, `.js` imports)
- Printed step-by-step wiring instructions guide the developer to import the stub into `registry.ts`, add a test, and set the release version
- `brain:evolve --approve` now stamps `approvedAt` timestamp on approved proposals
- New `thesmos/rules/community/` directory with README documenting the promotion workflow
- Route registered in CLI: `brain:promote`

**MCP_001 — Expanded Injection Pattern Detection:**

- `INJECTION_RE` in `thesmos/rules/mcp.ts` expanded from 6 patterns to 25+ across 6 attack categories
- System prompt overrides: `ignore/disregard/forget/override previous instructions`, `your new instructions are`
- Role-play escapes: `you are now a`, `act as if`, `pretend to be`, `roleplay as`
- Delimiter injection: `<system>`, `[INST]`, `<|im_start|>`, `### System`
- Instruction hijacking: `SYSTEM:`, `before calling this`, `you must also`, `additionally send/exfiltrate`
- Encoding obfuscation: `base64_decode`, `atob()`, `String.fromCharCode`, hex escape sequences
- Exfil signals: `exfiltrate`, `send/upload/post to https://` or `/api/`

**Sensitive Field Taxonomy:**

- `PII_FIELD_RE` in GDPR rules extended with high-sensitivity fields: `bankAccount`, `routingNumber`, `accountNumber`, `creditScore`, `socialSecurity`, `taxId`, `driversLicense`, `medicalRecord`, `healthInsurance`
- `PII_FIELD_RE` extended with medium-sensitivity API response fields: `salary`, `compensation`, `is_admin`, `isAdmin`, `permissions`, `sessionId`, `session_token`, `accessToken`, `refreshToken`
- `CRED_RE` in security rules extended with: `privateKey`, `private_key`, `clientSecret`, `client_secret`, `serviceAccountKey`, `database_password`, `db_password`, `connectionString`, `connection_string`

**6 New Pantheon Security Investigation Agents:**

- **Hecate** (`hecate-prompt-injection-agent`) — AI prompt injection and MCP tool poisoning investigator. Detects direct and indirect injection in LLM pipelines, tool descriptions, and agent configurations. References MCP_001–003.
- **Nemesis** (`nemesis-supply-chain-agent`) — CI/CD supply chain attack investigator. Audits GitHub Actions for unpinned actions, script injection, secrets exposure, and dependency confusion. References SC_001–008.
- **Cerberus** (`cerberus-oauth-agent`) — OAuth token theft investigator. Reviews token storage, JWT handling, cookie security, and timing attack risks in authentication flows. References AUTH_002–005, SEC_019.
- **Nyx** (`nyx-api-enumeration-agent`) — API enumeration and BOLA/IDOR investigator. Ensures resource ownership validation and rate limiting on all identifier-based API routes. References AUTH_002, SEC_015, DAST_001–002.
- **Ate** (`ate-sql-injection-agent`) — SQL injection and WAF evasion investigator. Detects unparameterized queries, raw ORM misuse, and WAF bypass patterns. References SEC_004, DAST_005–006.
- **Hades** (`hades-credential-agent`) — Credential dumping and secret exposure investigator. Audits hardcoded credentials, unsafe secret storage, and git history for leaked key material. References SEC_007–011, SEC_016, GDPR_008.

---

## [3.3.0] — 2026-06-22

### Added

**Complete Builder Wizard — 6 New Generators:**

- **`thesmos build:dashboard`** — 5-question wizard that creates a monitoring/analytics dashboard. Supports Next.js React components and plain HTML + Chart.js. Pre-wires Thesmos governance metrics as default data source. Outputs to `src/components/dashboards/<name>.tsx` or `public/dashboards/<name>.html`.

- **`thesmos build:workflow`** — 7-question wizard that creates GitHub Actions CI/CD workflows. Covers all trigger types (PR, push, scheduled, manual, release), all common step groups (test+lint, build+deploy, full CI with Thesmos scan), and all major deploy targets (Vercel, AWS, GCP). Manual approval gates wired via `trstringer/manual-approval`.

- **`thesmos build:rag`** — 9-question wizard for Retrieval-Augmented Generation pipelines. Generates `chunker.ts`, `retriever.ts`, and `pipeline.ts`. Supports OpenAI, Cohere, Anthropic, and local embeddings (all BYOK). Vector stores: Supabase pgvector, Pinecone, Weaviate, in-memory. Retrieval strategies: similarity, MMR (diverse), hybrid keyword+vector. Optional MCP tool wrapper to expose the pipeline to AI agents. Security note included in generated code: sanitize retrieved content to prevent prompt injection via documents.

- **`thesmos build:voice`** — 8-question wizard for real-time voice AI agents. Generates `session.ts`, `transport.ts`, and `pipeline.ts`. Supports WebRTC, Twilio Media Streams, and browser SpeechAPI transports. STT providers: Deepgram, AssemblyAI, OpenAI Whisper, browser native. TTS: ElevenLabs, Deepgram, browser native. LLM: Claude, OpenAI, local (all BYOK). Security warnings for audio PII and session isolation included in generated code.

- **`thesmos build:mcp-tool`** — 5-question wizard that creates a new custom tool for the Thesmos MCP server. Generates `thesmos/mcp-tools/<name>.ts` with full type-safe handler and registration instructions for `mcp-server.ts`. Supports read-only, file-writing, and external-API side-effect profiles. Return types: text, JSON, file list, Thesmos findings.

- **`thesmos build:automation`** — 6-question wizard for CI/CD automations. For GitHub-hosted triggers (cron, webhook, file-change, event) generates `.github/workflows/<name>.yml`. For local triggers generates `.thesmos/automation/<name>.sh` with retry logic and dry-run support. Covers all common step groups (tests, build, deploy, notification, custom) and failure modes (fail+alert, retry×3+alert, log+continue).

**Builder Wizard Infrastructure:**

- Generic `runBuilderWizard()` runner shared by all 6 builders — eliminates 200+ lines of duplicated wizard-loop code
- All 6 builders support `--plan` (outputs Markdown plan + design decisions), `--scaffold` (writes code), and `--yes` (skips confirmation)
- All scaffold outputs are immediately scanned by the Thesmos governance engine before reporting
- All API keys are BYOK — Thesmos never stores, caches, or proxies credentials

### Changed

- `thesmos/package.json`: version `3.2.0` → `3.3.0`; added keywords: `ai-safety`, `owasp`, `mcp-server`, `brain`, `builder`
- `thesmos/bin/commands/build.ts`: replaced 6 `runBuildStub` stubs with real implementations; added 6 question arrays (40 total questions); imported 6 generator modules

---

## [2.2.0] — 2026-06-21

### Added

**5 Innovation Features:**

- **F1 — `debug_finding` MCP Tool** — New MCP tool on the existing `thesmos mcp:serve` server. Call `debug_finding(rule_id, file_content, line?)` to get a `true_positive` / `likely_false_positive` verdict, the full rule explanation, exact fix suggestion, and suppression command. Closes the "why did this fire?" loop without leaving the AI assistant session.

- **F2 — Post-Fix Verification (`thesmos fix --verify`)** — After applying a fixer, Thesmos immediately re-runs `detect()` on the patched content to confirm the finding is resolved. New exports: `verifyFix(filePath, beforeContent, afterContent, finding, config): VerifyResult` and `VerifyResult` interface. Reports: ✅ verified / ❌ unresolved / ⚠️ regression introduced. Zero external dependencies — uses Thesmos's own rules engine.

- **F3 — GitHub PR Comment Bot (`thesmos github:comment`)** — Posts or updates a single governance summary comment on a GitHub PR. Uses `GITHUB_TOKEN` + native Node 18 `fetch()` — no `@octokit/rest` dependency. Idempotent via an HTML marker (`<!-- thesmos-governance-bot -->`). Includes auto-detection of repo from `git remote`. `--print-workflow` prints a copy-paste GitHub Actions snippet. New file: `thesmos/bin/commands/github-comment.ts`.

- **F4 — Incremental Scan Cache** — sha256-keyed per-file finding cache in `.thesmos/.scan-cache.json`. Unchanged files return cached findings instantly; any rules-version bump invalidates all entries. New exports: `loadCache`, `saveCache`, `getCachedFindings`, `setCachedFindings`, `invalidateCache`, `runReviewCached`. Expected speedup: 70–90% on second scan when most files are unchanged. New file: `thesmos/incremental-cache.ts`.

- **F5 — LSP Real-Time Feedback Server (`thesmos lsp`)** — Standalone LSP 3.17 server over stdio. Surfaces governance findings as real-time squiggles in any LSP-compatible editor (VS Code, Cursor, Neovim, Emacs). Capabilities: `textDocument/didOpen`, `textDocument/didChange` (debounced 500ms), `textDocument/didSave`, hover tooltips with rule explanation, code actions (suppress / explain). VS Code extension now launches the LSP client alongside its existing on-save analysis via `vscode-languageclient`. New file: `thesmos/lang-server.ts`.

**5 Bug Fixes:**

- **BUG-1** — Deleted dead code in `mcp.ts` line 743: `const README_OR_SRC = /(?:README|\.md$|\.txt$)|SOURCE_EXT/` (referenced literal `SOURCE_EXT` string instead of the regex variable; never used).
- **BUG-2** — Fixed NEXT_038 false positive: skip guard was checking `AUTH_IN_MIDDLEWARE` (which matches `NextResponse.redirect`) against route handler files, causing non-auth redirects to trigger the rule. Fix: gate on route handler export pattern only.
- **BUG-3** — Fixed PROTO_001 greedy regex: `[^}]*` with `s` flag matched across function boundaries when a merge function contained nested braces. Fix: bounded lazy `[\s\S]{0,300}?` / `[\s\S]{0,200}?` prevents cross-function matching.
- **BUG-4** — Fixed WS_006 miss: single-regex approach with `[^)]+\)` or `[\s\S]{0,100}?\)` both stop at the arrow function parameter `)` not the outer `ws.on(...)` `)`. Fix: two independent checks — `MSG_HANDLER_WITH_PARSE_RE` (presence of `ws.on("message")`) and `JSON_PARSE_RE` (presence of `JSON.parse`). Also fixed `VALIDATE_RE` false negative where `.parse\s*\(` matched `JSON.parse(` — fixed with negative lookbehind `(?<!JSON)`.
- **BUG-5** — Fixed AI_034 over-aggressive skip guard: `!/public|POST/.test(content)` skipped most real LLM proxy routes (`/api/chat`, `/api/generate`). Fix: path-based `isApiRoute()` / `isServerFile()` helpers identical to the pattern used in `vibe-coding.ts`.

**Test Coverage (210 new tests across 5 previously untested modules):**

- `rules/mcp.test.ts` — 64 tests for MCP_001–020
- `rules/rag.test.ts` — 49 tests for RAG_001–015
- `rules/websocket.test.ts` — 40 tests for WS_001–012
- `rules/prototype.test.ts` — 34 tests for PROTO_001–010
- `rules/jwt.test.ts` — 43 tests for JWT_001–013 (including AUTH_008–013)
- Total test suite: **2623 tests** (2413 previous + 210 new)

### Changed

- `thesmos/fix.ts` now imports `THESMOS_RULES` and `runReview` to power `verifyFix()`.
- `thesmos/bin/commands/fix.ts` gains `--verify` flag.
- `extensions/vscode/src/extension.ts` now lazily starts an LSP client (requires `vscode-languageclient` installed).
- `extensions/vscode/package.json` adds `vscode-languageclient ^9.0.1` as a runtime dependency.

---

## [2.0.0] — 2026-06-20

### Added

**6 New Governance Pillars:**

- **Pillar 1 — MCP Server** (`thesmos mcp:serve`, `thesmos mcp:install`) — Thesmos becomes a Model Context Protocol server. AI assistants call `scan_file`, `explain_rule`, `get_health`, `lint_commit`, and `get_context` _before_ generating code. `mcp:install` writes the server entry into `~/.claude/settings.json`. New files: `thesmos/mcp-server.ts`, `thesmos/bin/commands/mcp.ts`.

- **Pillar 2 — Dependency Security** (`thesmos deps:audit`) — Async CVE scanning via OSV.dev (`api.osv.dev/v1/querybatch`). Results cached in `.thesmos/dep-cache.json` (24h TTL) and consumed synchronously by 10 new DEP_001–010 rules: critical CVE (BLOCKER), high/medium CVE, abandoned-with-CVE, no integrity hash, git dependency, major drift, prerelease in prod, deprecated package, stale cache. SBOM export via `--sbom` flag in CycloneDX 1.4 format. New files: `thesmos/osv-client.ts`, `thesmos/rules/deps.ts`, `thesmos/bin/commands/deps.ts`.

- **Pillar 3 — Agent Governance** — 12 new AGNT_001–012 rules detecting missing scope declarations, unconstrained Bash, ungoverned MCP servers, absent hooks, no token budget, no audit trail, and unrestricted network access. Dual-directory guard (`.claude/` AND `.thesmos/` must both exist) prevents false positives in dev environments. Plus tamper-evident **Agent Audit Trail** (`thesmos agent:audit:log|verify|report|export|rotate`) — append-only `.thesmos/audit.jsonl` with sha256 hash-chained entries using `node:crypto`. `verify` detects tampering by recomputing the entire chain. New files: `thesmos/agent-audit.ts`, `thesmos/rules/agents.ts`, `thesmos/bin/commands/agent-audit.ts`.

- **Pillar 4 — SARIF Output** (`thesmos validate --sarif`) — SARIF 2.1.0 JSON for GitHub Security tab, VS Code Problems panel, Azure DevOps. All 911 rules emit full `reportingDescriptor` metadata. `thesmos ci:github-security` generates a GitHub Actions workflow that uploads `thesmos.sarif` to `github/codeql-action/upload-sarif@v3`. New file: `thesmos/sarif.ts`.

- **Pillar 5 — License Compliance** — 10 new LIC_001–010 rules: GPL in commercial projects (BLOCKER), unknown/UNLICENSED deps, LGPL copyleft, missing LICENSE file, proprietary dep, invalid SPDX, dual-license ambiguity, AI training restriction, GPL/Apache incompatibility (BLOCKER), missing NOTICE file. All rules use the `changedFiles !== undefined` filesystem guard to avoid false positives in changed-files mode. New file: `thesmos/rules/license.ts`.

- **Pillar 6 — GDPR Compliance Pack** (`thesmos compliance:report --standard gdpr`) — 15 new GDPR_001–015 rules covering: PII in console.log, analytics without consent, cookie without consent banner, PII in URL params, PII in localStorage, missing data deletion endpoint, PII in external logging (BLOCKER), unencrypted PII in Prisma schema, missing privacy policy link, third-party tracking without consent, PII in API error responses (BLOCKER), missing retention policy, session without expiry, real PII in test fixtures, and IP storage without consent. `compliance:report --standard gdpr` generates an audit-ready Markdown evidence report mapping each finding to its GDPR article. New files: `thesmos/rules/gdpr.ts`, `thesmos/bin/commands/compliance.ts`.

**3 Quick Wins:**

- **Governance Certificate** (`thesmos certificate:generate`, `thesmos certificate:verify`) — Signed JSON artifact per delivery with sha256 hash chain for tamper detection. Fields: `rulesChecked`, `blockers`, `healthScore`, `healthGrade`, `hash`, `chain`. Agencies include in every delivery. New file: `thesmos/bin/commands/certificate.ts`.

- **Health Badge** (`thesmos health --badge`) — Prints shield.io badge markdown to stdout. Color ranges: ≥80 brightgreen, ≥70 green, ≥60 yellowgreen, ≥50 yellow, ≥40 orange, <40 red.

- **AI Code Fingerprinting** (`thesmos ai:fingerprint`) — Detects AI-generated files using git Co-Authored-By commit markers and static content heuristics (over-explained comments, step-numbered blocks, AI docstring patterns, boilerplate try/catch). Reports `aiGeneratedEstimate`, `topTool`, and per-file confidence scores. `--format json` for machine-readable output. New file: `thesmos/bin/commands/ai-fingerprint.ts`.

- Total rule count: **911** (864 previous + 12 AGNT + 10 DEP + 10 LIC + 15 GDPR).

### Changed

- `formatFindingsSarif()` in `review.ts` now delegates to `sarif.ts` for full rule metadata emission — all 911 rules appear in SARIF output regardless of whether they have findings.
- `thesmos health --badge` added as a new flag to the existing `health` command.
- README rule counts updated from 864 → 911.

---

## [1.3.0] — 2026-06-20

### Added

- **Conventional Commits Governance** (`thesmos commit:lint`, `thesmos commit:create`) — 10 new COMMIT_001–010 rules validate commit messages against the Conventional Commits specification using the standard `detect()` sentinel pattern (path `.git/COMMIT_EDITMSG`). Rules integrate with `explain`, `baseline`, and `suppressions:audit` automatically. `commit:lint` validates messages from the `commit-msg` hook, `--last`, or `--message "..."`. `commit:create` is an interactive wizard for building valid commit messages step-by-step.
- **Vercel Deployment Governance** (`thesmos vercel:lint`) — 10 new VERCEL*001–010 rules covering: literal secrets in `vercel.json` (BLOCKER), server secrets with `NEXT_PUBLIC*`prefix (BLOCKER), cron routes missing`CRON_SECRET`check (HIGH), env vars not documented in`.env.example`(HIGH), missing`.env.example`when env vars are used (HIGH), missing`maxDuration`in function config (MEDIUM), middleware missing edge runtime export (MEDIUM), missing security headers (MEDIUM),`maxDuration` exceeding plan limit (LOW), and open redirect patterns in redirects config (HIGH).
- **`commit-msg` git hook enforcement** — `thesmos hooks install --commit-msg` now writes a real enforcement block calling `thesmos commit:lint "$1"`. Previously a no-op placeholder.
- **`commitLint` and `vercel` config sections** in `ThesmosConfig` — customise allowed commit types, max subject length, ticket patterns, Vercel plan limits, and cron auth requirements via `.thesmos/config.json`.
- Total rule count: **864** (844 previous + 10 COMMIT + 10 VERCEL).

### Changed

- `generateHookBlock('commit-msg')` now generates a real enforcement script instead of a placeholder comment.
- `HookInstallOptions` gains optional `commitMsg?: boolean` field; `hooks install --commit-msg` installs the `commit-msg` hook alongside `pre-commit` and `pre-push`.

---

## [1.2.0] — 2026-06-18

### Added

- **Slopsquatting Guard** (`thesmos import:scan`) — validates every npm/PyPI package in changed files against live registry APIs. Flags phantom packages (404), newly-registered packages (< 30 days old), and typosquat candidates (edit distance ≤ 2 from top packages). Works offline with graceful degradation. 10 new rules: SLOP_006–015.
- **Agent Scope Enforcement** (`thesmos scope:*`) — `.thesmos/scope.json` defines workspace boundaries and operation limits. PreToolUse hook intercepts every Write/Edit/Bash call and exits 2 on scope violations. Commands: `scope:init`, `scope:status`, `scope:check`.
- **Token Budget Governance** (`thesmos tokens:*`) — PostToolUse hook logs token usage per tool call to `.thesmos/token-usage.jsonl`. Enforces configurable session, daily, and project cost caps with alert and hard-stop thresholds. Commands: `tokens:report`, `tokens:reset`, `tokens:budget`.
- **AI Debt Fingerprinting** (`thesmos debt:scan`) — 20 new DEBT_001–020 rules that detect AI-specific code debt patterns traditional linters miss: duplicate function bodies, swallowed errors, magic numbers, O(n²) nested loops, vague variable names, commented-out blocks, missing `finally`, and more. Outputs a 0–100 debt score with A–F grade.
- **Context Health + Session Handoff** (`thesmos context:*`) — generates `.thesmos/context.md` from the live codebase (stack, established patterns, active constraints). `thesmos adapters` now auto-updates the snapshot. CLAUDE.md preamble now references `context.md` as step 1. Commands: `context:snapshot`, `context:health`.
- **Bash tool governance** — `claude:govern` PreToolUse hook now intercepts `Bash(npm install *)` / `Bash(pip install *)` calls and validates package names before they execute.
- **PostToolUse budget hook** — added to `.claude/settings.json` alongside existing PreToolUse and Stop hooks.
- **`tokenBudget` in `ThesmosConfig`** — configure token budgets directly in `.thesmos/config.json`.

### Fixed

- Token budget hook now reads usage from `hookData.usage` (top-level) — was incorrectly reading from `hookData.tool_response.usage` which is never populated.
- PyPI age check now uses the package's first-ever release date across all versions, not the latest-version upload time (which caused established packages to falsely appear new on release day).
- DEBT_007 (commented-out blocks) now correctly emits findings for blocks that run to end of file.
- DEBT_011 (magic numbers) no longer flags `UPPER_SNAKE_CASE` constant definitions — naming the constant is the correct fix.
- DEBT_007 now skips JSDoc blocks (`/**`) to prevent false-positives on `@example` code snippets.
- `getScopeStatus` now reports `allowDelete: false` / `allowGitPush: false` when unconfigured (was reporting `true`, implying permissions were granted when no scope was configured).
- CI: added `@rolldown/binding-linux-x64-gnu` and `linux-x64-musl` entries with resolved/integrity hashes to root lockfile (npm optional-dep bug identical to the lightningcss fix in 1.1.0).

### Changed

- `thesmos adapters` now auto-generates `.thesmos/context.md` on every run.
- CLAUDE.md "Before Each Task" checklist renumbered 1–12; step 1 now reads `.thesmos/context.md`.
- Token budget model cost table expanded with legacy date-suffixed model IDs (`claude-3-5-sonnet-20241022`, etc.) reported by older Claude Code versions.

---

## [1.1.0] — 2026-06-17

### Added

- **57 new governance rules** across three new domains:
  - **Python** (19 rules, PY_026–PY_045): async/await pitfalls, shell injection, `pickle`/`marshal` RCE, FastAPI/Django security patterns, Pydantic v2 migration, blocking I/O in async context, and more.
  - **GraphQL** (25 rules, GQL_001–GQL_025): query depth/complexity limits, resolver auth enforcement, N+1 without DataLoader, introspection disabled in production, type correctness, and production hardening.
  - **Terraform** (13 rules, TF_013–TF_025): sensitive IAM wildcards, open security groups (0.0.0.0/0), RDS deletion protection, KMS key rotation, secrets in `user_data`, `prevent_destroy` on critical resources, and S3 versioning.
- **3 new catalog agents**: `python-reviewer`, `graphql-reviewer`, `infrastructure-reviewer` — available via `thesmos catalog:enable`.
- **`thesmos claude:govern`** — installs Claude Code hooks into `.claude/settings.json` for real-time governance in Auto Mode:
  - `PreToolUse` (Write/Edit): blocks tool call (exit 2) if content contains any BLOCKER finding.
  - `Stop`: runs `thesmos drift` after each session to detect adapter staleness.
  - Install is idempotent; a `_thesmos_governance` marker prevents duplicate hook entries.
  - Autopilot permission profiles now preserve governance hooks when written/restored.

### Fixed

- Lockfile: added Linux lightningcss binaries (`lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl`) with resolved/integrity hashes to fix CI failures on Ubuntu runners (npm optional-dependency bug).
- Multiple audit findings: security hardening, dead code removal, and wiring corrections across core modules.

---

## [1.0.0] — 2026-06-10

### Added

- **142 governance rules** across 8 categories: security, TypeScript, React, Next.js, AI/LLM, performance, database, and code quality
- **6 AI adapter targets**: Claude (`CLAUDE.md`), Gemini (`GEMINI.md`), Cursor (`.cursor/rules/thesmos.mdc`), Copilot (`.github/copilot-instructions.md`), Codex (`.codex/thesmos.md`), and `AGENTS.md` — all generated from a single canonical rule registry with zero duplication
- **CLI commands**: `init`, `scan`, `review`, `validate`, `audit`, `doctor`, `ci-check`, `adapters`, `drift`, `baseline:*`, `explain`, `suppressions:audit`, `metrics`, `pack:*`, `health`, `ci`, `fix`, `update`, `catalog:*`, `agent:create`, `skill:create`
- **Governance folder** (`.thesmos/`): README, config, GUARDRAILS, RULES, governance docs, architecture docs, and a GitHub Actions workflow — all scaffolded by `thesmos init`
- **Baseline system**: snapshot known technical debt so new violations are caught without blocking existing codebases
- **Inline suppressions**: `// thesmos-disable-next-line <id> -- reason: <text>` with expiry dates and audit trail
- **Health score** (0–100 with letter grade): synthesises findings, drift, suppressions, and baseline into a single governance grade
- **Metrics engine**: local-first, privacy-safe governance analytics with history tracking
- **Drift detection**: 12 categories of stale/missing governance artifacts
- **Rule explanation engine**: `thesmos explain <rule-id>` shows why a rule exists, good/bad examples, and related playbooks
- **Catalog system**: 50+ built-in agents and 50+ built-in skills; 5 composable profiles (base, web, next-supabase, enterprise)
- **Pack system**: extensible rule bundles for third-party frameworks
- **Zero runtime dependencies**: the entire tool ships without a single production dependency
- **JSON Schema** for `.thesmos/config.json`: add `$schema` for full editor autocomplete and validation
- **GitHub Actions CI/CD**: workflows for continuous integration (Node 18/20/22 matrix) and npm publishing on version tags

[1.0.0]: https://github.com/Holley-Studio/thesmos-governance/releases/tag/v1.0.0
