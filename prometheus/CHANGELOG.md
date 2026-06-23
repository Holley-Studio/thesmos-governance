# Changelog

All notable changes to `prometheus-governance` will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.5.0] — 2026-06-23

### Added

**10 New Pantheon Agents — Creative, Business, and Developer Workflow:**

- **Calliope** (`calliope-email-agent`) — Email Design & HTML/MJML Agent. MJML source code, compiled HTML email templates, responsive cross-client design, deliverability checklists, A/B variant specs. Governed by GDPR_004 (no PII in email URLs), SEC_008 (no secrets in templates), GDPR_001 (consent gate awareness).
- **Talos** (`talos-web-dev-agent`) — Web Dev & Implementation Agent. Production-ready Next.js/React/TypeScript components, API routes, database queries, and test scaffolds. Runs a mental Prometheus governance scan on every file before delivery. Governed by SEC_004, AUTH_002, NEXT_003, MCP_001.
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

- New command `prometheus brain:promote --rule=<ID>` scaffolds an approved `ProposedRule` from `brain.json` into a TypeScript rule stub at `prometheus/rules/community/<ID>.ts`
- Generated stubs follow the exact `PrometheusRule` pattern used throughout the core rules (exported `*_RULES` array, externalized regex constant, `.js` imports)
- Printed step-by-step wiring instructions guide the developer to import the stub into `registry.ts`, add a test, and set the release version
- `brain:evolve --approve` now stamps `approvedAt` timestamp on approved proposals
- New `prometheus/rules/community/` directory with README documenting the promotion workflow
- Route registered in CLI: `brain:promote`

**MCP_001 — Expanded Injection Pattern Detection:**

- `INJECTION_RE` in `prometheus/rules/mcp.ts` expanded from 6 patterns to 25+ across 6 attack categories
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

- **`prometheus build:dashboard`** — 5-question wizard that creates a monitoring/analytics dashboard. Supports Next.js React components and plain HTML + Chart.js. Pre-wires Prometheus governance metrics as default data source. Outputs to `src/components/dashboards/<name>.tsx` or `public/dashboards/<name>.html`.

- **`prometheus build:workflow`** — 7-question wizard that creates GitHub Actions CI/CD workflows. Covers all trigger types (PR, push, scheduled, manual, release), all common step groups (test+lint, build+deploy, full CI with Prometheus scan), and all major deploy targets (Vercel, AWS, GCP). Manual approval gates wired via `trstringer/manual-approval`.

- **`prometheus build:rag`** — 9-question wizard for Retrieval-Augmented Generation pipelines. Generates `chunker.ts`, `retriever.ts`, and `pipeline.ts`. Supports OpenAI, Cohere, Anthropic, and local embeddings (all BYOK). Vector stores: Supabase pgvector, Pinecone, Weaviate, in-memory. Retrieval strategies: similarity, MMR (diverse), hybrid keyword+vector. Optional MCP tool wrapper to expose the pipeline to AI agents. Security note included in generated code: sanitize retrieved content to prevent prompt injection via documents.

- **`prometheus build:voice`** — 8-question wizard for real-time voice AI agents. Generates `session.ts`, `transport.ts`, and `pipeline.ts`. Supports WebRTC, Twilio Media Streams, and browser SpeechAPI transports. STT providers: Deepgram, AssemblyAI, OpenAI Whisper, browser native. TTS: ElevenLabs, Deepgram, browser native. LLM: Claude, OpenAI, local (all BYOK). Security warnings for audio PII and session isolation included in generated code.

- **`prometheus build:mcp-tool`** — 5-question wizard that creates a new custom tool for the Prometheus MCP server. Generates `prometheus/mcp-tools/<name>.ts` with full type-safe handler and registration instructions for `mcp-server.ts`. Supports read-only, file-writing, and external-API side-effect profiles. Return types: text, JSON, file list, Prometheus findings.

- **`prometheus build:automation`** — 6-question wizard for CI/CD automations. For GitHub-hosted triggers (cron, webhook, file-change, event) generates `.github/workflows/<name>.yml`. For local triggers generates `.prometheus/automation/<name>.sh` with retry logic and dry-run support. Covers all common step groups (tests, build, deploy, notification, custom) and failure modes (fail+alert, retry×3+alert, log+continue).

**Builder Wizard Infrastructure:**

- Generic `runBuilderWizard()` runner shared by all 6 builders — eliminates 200+ lines of duplicated wizard-loop code
- All 6 builders support `--plan` (outputs Markdown plan + design decisions), `--scaffold` (writes code), and `--yes` (skips confirmation)
- All scaffold outputs are immediately scanned by the Prometheus governance engine before reporting
- All API keys are BYOK — Prometheus never stores, caches, or proxies credentials

### Changed

- `prometheus/package.json`: version `3.2.0` → `3.3.0`; added keywords: `ai-safety`, `owasp`, `mcp-server`, `brain`, `builder`
- `prometheus/bin/commands/build.ts`: replaced 6 `runBuildStub` stubs with real implementations; added 6 question arrays (40 total questions); imported 6 generator modules

---

## [2.2.0] — 2026-06-21

### Added

**5 Innovation Features:**

- **F1 — `debug_finding` MCP Tool** — New MCP tool on the existing `prometheus mcp:serve` server. Call `debug_finding(rule_id, file_content, line?)` to get a `true_positive` / `likely_false_positive` verdict, the full rule explanation, exact fix suggestion, and suppression command. Closes the "why did this fire?" loop without leaving the AI assistant session.

- **F2 — Post-Fix Verification (`prometheus fix --verify`)** — After applying a fixer, Prometheus immediately re-runs `detect()` on the patched content to confirm the finding is resolved. New exports: `verifyFix(filePath, beforeContent, afterContent, finding, config): VerifyResult` and `VerifyResult` interface. Reports: ✅ verified / ❌ unresolved / ⚠️ regression introduced. Zero external dependencies — uses Prometheus's own rules engine.

- **F3 — GitHub PR Comment Bot (`prometheus github:comment`)** — Posts or updates a single governance summary comment on a GitHub PR. Uses `GITHUB_TOKEN` + native Node 18 `fetch()` — no `@octokit/rest` dependency. Idempotent via an HTML marker (`<!-- prometheus-governance-bot -->`). Includes auto-detection of repo from `git remote`. `--print-workflow` prints a copy-paste GitHub Actions snippet. New file: `prometheus/bin/commands/github-comment.ts`.

- **F4 — Incremental Scan Cache** — sha256-keyed per-file finding cache in `.prometheus/.scan-cache.json`. Unchanged files return cached findings instantly; any rules-version bump invalidates all entries. New exports: `loadCache`, `saveCache`, `getCachedFindings`, `setCachedFindings`, `invalidateCache`, `runReviewCached`. Expected speedup: 70–90% on second scan when most files are unchanged. New file: `prometheus/incremental-cache.ts`.

- **F5 — LSP Real-Time Feedback Server (`prometheus lsp`)** — Standalone LSP 3.17 server over stdio. Surfaces governance findings as real-time squiggles in any LSP-compatible editor (VS Code, Cursor, Neovim, Emacs). Capabilities: `textDocument/didOpen`, `textDocument/didChange` (debounced 500ms), `textDocument/didSave`, hover tooltips with rule explanation, code actions (suppress / explain). VS Code extension now launches the LSP client alongside its existing on-save analysis via `vscode-languageclient`. New file: `prometheus/lang-server.ts`.

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

- `prometheus/fix.ts` now imports `PROMETHEUS_RULES` and `runReview` to power `verifyFix()`.
- `prometheus/bin/commands/fix.ts` gains `--verify` flag.
- `extensions/vscode/src/extension.ts` now lazily starts an LSP client (requires `vscode-languageclient` installed).
- `extensions/vscode/package.json` adds `vscode-languageclient ^9.0.1` as a runtime dependency.

---

## [2.0.0] — 2026-06-20

### Added

**6 New Governance Pillars:**

- **Pillar 1 — MCP Server** (`prometheus mcp:serve`, `prometheus mcp:install`) — Prometheus becomes a Model Context Protocol server. AI assistants call `scan_file`, `explain_rule`, `get_health`, `lint_commit`, and `get_context` *before* generating code. `mcp:install` writes the server entry into `~/.claude/settings.json`. New files: `prometheus/mcp-server.ts`, `prometheus/bin/commands/mcp.ts`.

- **Pillar 2 — Dependency Security** (`prometheus deps:audit`) — Async CVE scanning via OSV.dev (`api.osv.dev/v1/querybatch`). Results cached in `.prometheus/dep-cache.json` (24h TTL) and consumed synchronously by 10 new DEP_001–010 rules: critical CVE (BLOCKER), high/medium CVE, abandoned-with-CVE, no integrity hash, git dependency, major drift, prerelease in prod, deprecated package, stale cache. SBOM export via `--sbom` flag in CycloneDX 1.4 format. New files: `prometheus/osv-client.ts`, `prometheus/rules/deps.ts`, `prometheus/bin/commands/deps.ts`.

- **Pillar 3 — Agent Governance** — 12 new AGNT_001–012 rules detecting missing scope declarations, unconstrained Bash, ungoverned MCP servers, absent hooks, no token budget, no audit trail, and unrestricted network access. Dual-directory guard (`.claude/` AND `.prometheus/` must both exist) prevents false positives in dev environments. Plus tamper-evident **Agent Audit Trail** (`prometheus agent:audit:log|verify|report|export|rotate`) — append-only `.prometheus/audit.jsonl` with sha256 hash-chained entries using `node:crypto`. `verify` detects tampering by recomputing the entire chain. New files: `prometheus/agent-audit.ts`, `prometheus/rules/agents.ts`, `prometheus/bin/commands/agent-audit.ts`.

- **Pillar 4 — SARIF Output** (`prometheus validate --sarif`) — SARIF 2.1.0 JSON for GitHub Security tab, VS Code Problems panel, Azure DevOps. All 911 rules emit full `reportingDescriptor` metadata. `prometheus ci:github-security` generates a GitHub Actions workflow that uploads `prometheus.sarif` to `github/codeql-action/upload-sarif@v3`. New file: `prometheus/sarif.ts`.

- **Pillar 5 — License Compliance** — 10 new LIC_001–010 rules: GPL in commercial projects (BLOCKER), unknown/UNLICENSED deps, LGPL copyleft, missing LICENSE file, proprietary dep, invalid SPDX, dual-license ambiguity, AI training restriction, GPL/Apache incompatibility (BLOCKER), missing NOTICE file. All rules use the `changedFiles !== undefined` filesystem guard to avoid false positives in changed-files mode. New file: `prometheus/rules/license.ts`.

- **Pillar 6 — GDPR Compliance Pack** (`prometheus compliance:report --standard gdpr`) — 15 new GDPR_001–015 rules covering: PII in console.log, analytics without consent, cookie without consent banner, PII in URL params, PII in localStorage, missing data deletion endpoint, PII in external logging (BLOCKER), unencrypted PII in Prisma schema, missing privacy policy link, third-party tracking without consent, PII in API error responses (BLOCKER), missing retention policy, session without expiry, real PII in test fixtures, and IP storage without consent. `compliance:report --standard gdpr` generates an audit-ready Markdown evidence report mapping each finding to its GDPR article. New files: `prometheus/rules/gdpr.ts`, `prometheus/bin/commands/compliance.ts`.

**3 Quick Wins:**

- **Governance Certificate** (`prometheus certificate:generate`, `prometheus certificate:verify`) — Signed JSON artifact per delivery with sha256 hash chain for tamper detection. Fields: `rulesChecked`, `blockers`, `healthScore`, `healthGrade`, `hash`, `chain`. Agencies include in every delivery. New file: `prometheus/bin/commands/certificate.ts`.

- **Health Badge** (`prometheus health --badge`) — Prints shield.io badge markdown to stdout. Color ranges: ≥80 brightgreen, ≥70 green, ≥60 yellowgreen, ≥50 yellow, ≥40 orange, <40 red.

- **AI Code Fingerprinting** (`prometheus ai:fingerprint`) — Detects AI-generated files using git Co-Authored-By commit markers and static content heuristics (over-explained comments, step-numbered blocks, AI docstring patterns, boilerplate try/catch). Reports `aiGeneratedEstimate`, `topTool`, and per-file confidence scores. `--format json` for machine-readable output. New file: `prometheus/bin/commands/ai-fingerprint.ts`.

- Total rule count: **911** (864 previous + 12 AGNT + 10 DEP + 10 LIC + 15 GDPR).

### Changed

- `formatFindingsSarif()` in `review.ts` now delegates to `sarif.ts` for full rule metadata emission — all 911 rules appear in SARIF output regardless of whether they have findings.
- `prometheus health --badge` added as a new flag to the existing `health` command.
- README rule counts updated from 864 → 911.

---

## [1.3.0] — 2026-06-20

### Added

- **Conventional Commits Governance** (`prometheus commit:lint`, `prometheus commit:create`) — 10 new COMMIT_001–010 rules validate commit messages against the Conventional Commits specification using the standard `detect()` sentinel pattern (path `.git/COMMIT_EDITMSG`). Rules integrate with `explain`, `baseline`, and `suppressions:audit` automatically. `commit:lint` validates messages from the `commit-msg` hook, `--last`, or `--message "..."`. `commit:create` is an interactive wizard for building valid commit messages step-by-step.
- **Vercel Deployment Governance** (`prometheus vercel:lint`) — 10 new VERCEL_001–010 rules covering: literal secrets in `vercel.json` (BLOCKER), server secrets with `NEXT_PUBLIC_` prefix (BLOCKER), cron routes missing `CRON_SECRET` check (HIGH), env vars not documented in `.env.example` (HIGH), missing `.env.example` when env vars are used (HIGH), missing `maxDuration` in function config (MEDIUM), middleware missing edge runtime export (MEDIUM), missing security headers (MEDIUM), `maxDuration` exceeding plan limit (LOW), and open redirect patterns in redirects config (HIGH).
- **`commit-msg` git hook enforcement** — `prometheus hooks install --commit-msg` now writes a real enforcement block calling `prometheus commit:lint "$1"`. Previously a no-op placeholder.
- **`commitLint` and `vercel` config sections** in `PrometheusConfig` — customise allowed commit types, max subject length, ticket patterns, Vercel plan limits, and cron auth requirements via `.prometheus/config.json`.
- Total rule count: **864** (844 previous + 10 COMMIT + 10 VERCEL).

### Changed

- `generateHookBlock('commit-msg')` now generates a real enforcement script instead of a placeholder comment.
- `HookInstallOptions` gains optional `commitMsg?: boolean` field; `hooks install --commit-msg` installs the `commit-msg` hook alongside `pre-commit` and `pre-push`.

---

## [1.2.0] — 2026-06-18

### Added

- **Slopsquatting Guard** (`prometheus import:scan`) — validates every npm/PyPI package in changed files against live registry APIs. Flags phantom packages (404), newly-registered packages (< 30 days old), and typosquat candidates (edit distance ≤ 2 from top packages). Works offline with graceful degradation. 10 new rules: SLOP_006–015.
- **Agent Scope Enforcement** (`prometheus scope:*`) — `.prometheus/scope.json` defines workspace boundaries and operation limits. PreToolUse hook intercepts every Write/Edit/Bash call and exits 2 on scope violations. Commands: `scope:init`, `scope:status`, `scope:check`.
- **Token Budget Governance** (`prometheus tokens:*`) — PostToolUse hook logs token usage per tool call to `.prometheus/token-usage.jsonl`. Enforces configurable session, daily, and project cost caps with alert and hard-stop thresholds. Commands: `tokens:report`, `tokens:reset`, `tokens:budget`.
- **AI Debt Fingerprinting** (`prometheus debt:scan`) — 20 new DEBT_001–020 rules that detect AI-specific code debt patterns traditional linters miss: duplicate function bodies, swallowed errors, magic numbers, O(n²) nested loops, vague variable names, commented-out blocks, missing `finally`, and more. Outputs a 0–100 debt score with A–F grade.
- **Context Health + Session Handoff** (`prometheus context:*`) — generates `.prometheus/context.md` from the live codebase (stack, established patterns, active constraints). `prometheus adapters` now auto-updates the snapshot. CLAUDE.md preamble now references `context.md` as step 1. Commands: `context:snapshot`, `context:health`.
- **Bash tool governance** — `claude:govern` PreToolUse hook now intercepts `Bash(npm install *)` / `Bash(pip install *)` calls and validates package names before they execute.
- **PostToolUse budget hook** — added to `.claude/settings.json` alongside existing PreToolUse and Stop hooks.
- **`tokenBudget` in `PrometheusConfig`** — configure token budgets directly in `.prometheus/config.json`.

### Fixed

- Token budget hook now reads usage from `hookData.usage` (top-level) — was incorrectly reading from `hookData.tool_response.usage` which is never populated.
- PyPI age check now uses the package's first-ever release date across all versions, not the latest-version upload time (which caused established packages to falsely appear new on release day).
- DEBT_007 (commented-out blocks) now correctly emits findings for blocks that run to end of file.
- DEBT_011 (magic numbers) no longer flags `UPPER_SNAKE_CASE` constant definitions — naming the constant is the correct fix.
- DEBT_007 now skips JSDoc blocks (`/**`) to prevent false-positives on `@example` code snippets.
- `getScopeStatus` now reports `allowDelete: false` / `allowGitPush: false` when unconfigured (was reporting `true`, implying permissions were granted when no scope was configured).
- CI: added `@rolldown/binding-linux-x64-gnu` and `linux-x64-musl` entries with resolved/integrity hashes to root lockfile (npm optional-dep bug identical to the lightningcss fix in 1.1.0).

### Changed

- `prometheus adapters` now auto-generates `.prometheus/context.md` on every run.
- CLAUDE.md "Before Each Task" checklist renumbered 1–12; step 1 now reads `.prometheus/context.md`.
- Token budget model cost table expanded with legacy date-suffixed model IDs (`claude-3-5-sonnet-20241022`, etc.) reported by older Claude Code versions.

---

## [1.1.0] — 2026-06-17

### Added

- **57 new governance rules** across three new domains:
  - **Python** (19 rules, PY_026–PY_045): async/await pitfalls, shell injection, `pickle`/`marshal` RCE, FastAPI/Django security patterns, Pydantic v2 migration, blocking I/O in async context, and more.
  - **GraphQL** (25 rules, GQL_001–GQL_025): query depth/complexity limits, resolver auth enforcement, N+1 without DataLoader, introspection disabled in production, type correctness, and production hardening.
  - **Terraform** (13 rules, TF_013–TF_025): sensitive IAM wildcards, open security groups (0.0.0.0/0), RDS deletion protection, KMS key rotation, secrets in `user_data`, `prevent_destroy` on critical resources, and S3 versioning.
- **3 new catalog agents**: `python-reviewer`, `graphql-reviewer`, `infrastructure-reviewer` — available via `prometheus catalog:enable`.
- **`prometheus claude:govern`** — installs Claude Code hooks into `.claude/settings.json` for real-time governance in Auto Mode:
  - `PreToolUse` (Write/Edit): blocks tool call (exit 2) if content contains any BLOCKER finding.
  - `Stop`: runs `prometheus drift` after each session to detect adapter staleness.
  - Install is idempotent; a `_prometheus_governance` marker prevents duplicate hook entries.
  - Autopilot permission profiles now preserve governance hooks when written/restored.

### Fixed

- Lockfile: added Linux lightningcss binaries (`lightningcss-linux-x64-gnu`, `lightningcss-linux-x64-musl`) with resolved/integrity hashes to fix CI failures on Ubuntu runners (npm optional-dependency bug).
- Multiple audit findings: security hardening, dead code removal, and wiring corrections across core modules.

---

## [1.0.0] — 2026-06-10

### Added

- **142 governance rules** across 8 categories: security, TypeScript, React, Next.js, AI/LLM, performance, database, and code quality
- **6 AI adapter targets**: Claude (`CLAUDE.md`), Gemini (`GEMINI.md`), Cursor (`.cursor/rules/prometheus.mdc`), Copilot (`.github/copilot-instructions.md`), Codex (`.codex/prometheus.md`), and `AGENTS.md` — all generated from a single canonical rule registry with zero duplication
- **CLI commands**: `init`, `scan`, `review`, `validate`, `audit`, `doctor`, `ci-check`, `adapters`, `drift`, `baseline:*`, `explain`, `suppressions:audit`, `metrics`, `pack:*`, `health`, `ci`, `fix`, `update`, `catalog:*`, `agent:create`, `skill:create`
- **Governance folder** (`.prometheus/`): README, config, GUARDRAILS, RULES, governance docs, architecture docs, and a GitHub Actions workflow — all scaffolded by `prometheus init`
- **Baseline system**: snapshot known technical debt so new violations are caught without blocking existing codebases
- **Inline suppressions**: `// prometheus-disable-next-line <id> -- reason: <text>` with expiry dates and audit trail
- **Health score** (0–100 with letter grade): synthesises findings, drift, suppressions, and baseline into a single governance grade
- **Metrics engine**: local-first, privacy-safe governance analytics with history tracking
- **Drift detection**: 12 categories of stale/missing governance artifacts
- **Rule explanation engine**: `prometheus explain <rule-id>` shows why a rule exists, good/bad examples, and related playbooks
- **Catalog system**: 50+ built-in agents and 50+ built-in skills; 5 composable profiles (base, web, next-supabase, enterprise)
- **Pack system**: extensible rule bundles for third-party frameworks
- **Zero runtime dependencies**: the entire tool ships without a single production dependency
- **JSON Schema** for `.prometheus/config.json`: add `$schema` for full editor autocomplete and validation
- **GitHub Actions CI/CD**: workflows for continuous integration (Node 18/20/22 matrix) and npm publishing on version tags

[1.0.0]: https://github.com/Holley-Studio/prometheus-governance/releases/tag/v1.0.0
