# Thesmos Governance

[![CI](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/thesmos-governance?color=blue)](https://www.npmjs.com/package/thesmos-governance)
[![npm downloads](https://img.shields.io/npm/dm/thesmos-governance)](https://www.npmjs.com/package/thesmos-governance)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/holleystudio.thesmos-governance-vscode)](https://marketplace.visualstudio.com/items?itemName=holleystudio.thesmos-governance-vscode)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-blue.svg)](LICENSE)
[![Node ≥20](https://img.shields.io/node/v/thesmos-governance)](https://nodejs.org)

**1,137 rules. Zero config. Built for the AI-assisted engineering era.**

Thesmos is a source-available code governance toolkit that watches AI-generated code for security holes, broken patterns, and architectural mistakes — before they reach production.

Built by [Holley Studio](https://holley.studio) — Thesmos governs its own repository; every PR merged here passed its own gate. Check the [Actions tab](https://github.com/Holley-Studio/thesmos-governance/actions) for proof.

**[Get Pantheon Pro →](https://holleystudio.gumroad.com/l/thesmos-pantheon)** · 40 specialist agents · 1,075 rules · Free Essentials tier always available

---

## Why Thesmos

AI tools write code faster than humans can review it. Copilot, Cursor, and Claude can ship working features in minutes — but they also hallucinate Prisma clients outside module scope, concatenate user input directly into LLM prompts, and create N+1 query waterfalls without a second thought.

Thesmos closes that gap. 1,137 governance rules covering AI safety, security, performance, and correctness — active the moment you install.

---

## Four Ways to Use It

### 1. CLI

Scan your whole codebase and get a health grade:

```bash
npm install thesmos-governance
npx thesmos scan
```

Review only staged changes before committing:

```bash
npx thesmos review
```

Run `thesmos audit` for a detailed JSON + HTML report, or `thesmos init` to walk through setup interactively.

### 2. GitHub Action

Adds governance review to every pull request. BLOCKER findings block the merge. Inline comments appear on the exact line.

Copy this to `.github/workflows/thesmos-pr.yml`:

```yaml
name: Thesmos Governance

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  contents: read

jobs:
  governance:
    name: Governance Review
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Thesmos PR Review
        uses: Holley-Studio/thesmos-governance/actions/pr-review@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on-severity: BLOCKER
          post-inline-comments: 'true'
          update-summary: 'true'
```

No secrets to configure. No build step. The action is fully self-contained.

### 3. VS Code Extension

Install from the `extensions/vscode/` directory for:

- Real-time findings as you write
- Health score in the status bar
- AI adapters panel — keeps Claude, Cursor, Copilot, and Gemini aware of your governance rules so they generate governed code from the first line

### 4. Claude Code Plugin

Install directly inside Claude Code — no separate `npm install` step:

```text
/plugin marketplace add Holley-Studio/thesmos-governance
/plugin install thesmos-governance
```

Ships the MCP server, the `scan` / `review` / `advise` skills, and the same PreToolUse/PostToolUse/Stop governance hooks the CLI's `claude:govern install` writes — enabled per-project, off by default.

---

## Beyond the scanner

The rules engine is the front door — behind it ships a full governance platform:

| Surface | What it does |
|---|---|
| **Diff-aware PR gate** | The GitHub Action blocks only on findings from lines your PR changed — pre-existing debt reports, never blocks. Baseline, inline suppressions, and confidence tiers honored identically across every gate ([the gate contract](docs/gating.md)) |
| **Pantheon** | 67 specialist AI agents orchestrated by Zeus — `thesmos pantheon:*` |
| **Autopilot** | Plan-file-driven autonomous execution on an isolated branch with journaling and one-command revert — `thesmos autopilot:*` |
| **Brain** | Institutional memory that observes findings, learns patterns, and proposes new rules for human approval — `thesmos brain:*` |
| **MCP server** | Governs AI agents *before* they write — `thesmos mcp:serve` |
| **Builder wizard** | Scaffolds governed agents, skills, RAG pipelines, and MCP tools — `thesmos build:*` |
| **Execution advisor** | Recommends the right model + agents for a plan, generates a paste-ready kickoff — `thesmos advise <plan>` |
| **Compliance packs** | GDPR, EU AI Act, HIPAA, DORA rule sets with audit-trail tooling — `thesmos compliance:report`, `agent:audit:*` |
| **Cost & scope guards** | Token budgets with hard stops, agent scope boundaries, 1M-context guard — `thesmos tokens:*`, `scope:*` |

---

## How detection works

Say this plainly, because it matters for how much you should trust a finding: Thesmos's 1,137 rules are **primarily line- and pattern-based** — regex and light structural heuristics applied to file content and diffs. This is not full AST parsing or cross-file data-flow analysis, and we don't market it as one. Pattern-based detection is fast, has zero runtime dependencies, and runs anywhere — but it can be fooled by aliasing, indirection, or code shaped differently than a pattern expects, the same tradeoff every scanner in this class makes.

That admission is exactly why no finding gates blindly:

- **Confidence tiers** — every rule is tagged `high` (near-certain proof, e.g. a committed secret or disabled TLS check), `medium` (a shape heuristic that can misfire, e.g. `exec()` with a template literal whose interpolants might be constants), or `low` (a keyword/presence signal that suggests rather than proves). Only `medium`-confidence and above can fail a build by default; `low`-confidence findings are reported with a visible tag but never flip the exit code.
- **Diff-aware gating** — only findings on a line your PR actually changed (or in a file it added) can block the merge. Everything else in a touched file is reported, never blocking.
- **Suppression system** — a single inline comment (`// thesmos-disable-next-line <rule> -- reason: <why> -- owner: @who`) removes a specific false positive for good. Suppressions require a reason and an owner, and `thesmos suppressions:audit` reports unused, expired, or blanket ones.
- **Baseline** — `.thesmos/baseline.json` is an accepted-debt ledger, so gates only ever fire on *new* problems, never the ones you inherited.

The full policy — including exactly which findings can block a merge and which can't — is documented in [docs/gating.md](docs/gating.md), the single source of truth every gate (`thesmos validate`, `thesmos ci`, and the GitHub Action) follows identically.

### Who audits the auditor

Every pull request merged into *this* repository passes the same `thesmos validate` gate a customer's PR would face — including this one. That's not a promise, it's a public record: [github.com/Holley-Studio/thesmos-governance/actions](https://github.com/Holley-Studio/thesmos-governance/actions).

This codebase is also AI-accelerated, human-directed development — Holley Studio builds Thesmos with Claude Code and other AI assistants throughout. We consider that a strength, not a disclosure to bury: every AI-assisted change that lands here passes through the exact gate we sell you.

---

## The 1,137 Rules

Rules are organized into 17 categories:

| Category | Rules | Examples |
|----------|-------|---------|
| AI / LLM | 27 | Prompt injection, token limit abuse, system prompt leakage |
| Security | 22 | CORS wildcards, prototype pollution, eval usage |
| Prisma | 30 | Missing FK indexes, connection pool exhaustion, N+1 queries |
| Zod | 30 | Schemas bypassed, `.any()` usage, missing API validation |
| tRPC | 25 | Missing auth middleware, unprotected mutations |
| React | 30 | Missing error boundaries, prop drilling, stale closures |
| Next.js | 22 | Client components leaking secrets, missing suspense boundaries |
| Performance | 23 | Waterfall fetches, large bundle imports, unthrottled effects |
| TypeScript | 18 | `any` escape hatches, missing return types |
| Node.js | 30 | Unhandled promise rejections, sync I/O on the main thread |
| Error Handling | 25 | Silent catch blocks, swallowed errors |
| State | 20 | Derived state stored in useState, mutated refs |
| Forms | 20 | Missing validation, uncontrolled inputs |
| Logging | 20 | Secrets in logs, missing request IDs |
| CSS | 20 | Magic numbers, specificity wars |
| Imports | 20 | Barrel file cycles, deep internal imports |
| Database | 23 | Missing transactions, unindexed foreign keys |

Every rule ships with a paired regression test — a false-positive fixture that must **not** fire and a true-positive fixture that must fire (policy in [CONTRIBUTING.md](CONTRIBUTING.md)). As of this writing that's **2,827 passing tests** across 79 test files, verified on every PR.

---

## Severity Levels

| Level | Meaning |
|-------|---------|
| `BLOCKER` | Must fix before merge. Blocks CI. |
| `HIGH` | Security or correctness risk. Fix soon. |
| `MEDIUM` | Quality issue. Fix in this sprint. |
| `LOW` | Best-practice gap. Fix when nearby. |
| `TECH_DEBT` | Tracked, not blocking. |

---

## Configuration

No config file is required. To customize, create `.thesmos/config.json`:

```json
{
  "exclude": ["**/*.test.ts", "scripts/"],
  "rules": {
    "AI_013": "off",
    "PERF_018": "MEDIUM"
  },
  "failOn": "BLOCKER"
}
```

---

## Community Rule Packs

Drop any `.json` rule pack into `.thesmos/packs/` — they load at runtime without a rebuild. See `CONTRIBUTING.md` for the schema.

---

## Repository Structure

```
thesmos-governance/
├── website/              Marketing site (deployed to Vercel)
│   └── index.html
├── thesmos/           npm package — CLI + core engine
│   ├── bin/             CLI entry points (scan, review, audit, init, watch)
│   ├── catalog/         1,137 rules organized by category
│   ├── index.ts         Public API
│   ├── metrics.ts       Health grade calculation
│   └── report.ts        Report generation
├── actions/
│   └── pr-review/       GitHub Action (self-contained, no install step)
├── extensions/
│   └── vscode/          VS Code extension
├── .claude-plugin/       Claude Code plugin manifest + marketplace listing
├── skills/               Plugin skills (scan, review, advise)
├── hooks/                Plugin governance hooks (mirrors claude:govern install)
└── .github/workflows/    CI + release pipeline
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Rule contributions are especially welcome — the catalog is the heart of Thesmos.

Issues and feature requests: [GitHub Issues](https://github.com/Holley-Studio/thesmos-governance/issues)

---

## License

[Functional Source License 1.1, MIT Future License](LICENSE) (FSL-1.1-MIT) — source-available today; converts to MIT four years after each version's release. Free to use, including commercially, except for a Competing Use (offering Thesmos itself, or a substantially similar product, as a hosted or on-premises service to third parties). See [LICENSE](LICENSE) for the full terms.

---

*Built by [Holley Studio](https://github.com/Holley-Studio)*
