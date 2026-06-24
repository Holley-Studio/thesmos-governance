# thesmos-governance

[![CI](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/thesmos-governance)](https://www.npmjs.com/package/thesmos-governance)
[![npm downloads](https://img.shields.io/npm/dm/thesmos-governance)](https://www.npmjs.com/package/thesmos-governance)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node >=20](https://img.shields.io/node/v/thesmos-governance)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/thesmos-governance?activeTab=dependencies)

**One rule registry. Every AI assistant. Zero duplication.**

Thesmos is a repo governance tool for TypeScript projects. Define your code review rules once, then automatically generate instruction files for Claude, Gemini, Cursor, Copilot, Codex, and `AGENTS.md` — keeping every AI assistant on your team in sync. Gate CI on violations, score your codebase health, and give every AI a complete picture of how your repo works.

---

## Why Prometheus?

Without governance, every AI assistant in your team invents its own rules. Claude follows one convention, Cursor follows another, Copilot knows nothing about your auth patterns. Every PR review is inconsistent. Governance debt compounds silently.

Prometheus solves this with a **single source of truth**: 911 rules defined once, propagated everywhere.

| | Prometheus | ESLint | Danger.js | CodeClimate |
| --- | --- | --- | --- | --- |
| AI adapter generation (6 targets) | ✓ | ✗ | ✗ | ✗ |
| Zero runtime dependencies | ✓ | ✗ | ✗ | ✗ |
| Works fully offline | ✓ | ✓ | ✗ | ✗ |
| Governance folder + AI context | ✓ | ✗ | ✗ | ✗ |
| Health score (0–100) | ✓ | ✗ | ✗ | ✓ |
| Built-in rules (no plugins needed) | 911 | ✗ | ✗ | ✓ |
| Installable rule packs | ✓ | ✓ | ✗ | ✗ |
| Inline suppressions with audit | ✓ | ✓ | ✗ | ✗ |
| Baseline for legacy debt | ✓ | ✗ | ✗ | ✗ |
| Free & open source | ✓ | ✓ | ✓ | limited |

---

## Get started in 60 seconds

```bash
# Install
npm install --save-dev thesmos-governance

# Scaffold the governance folder + GitHub Actions workflow
npx thesmos init

# Analyse your repo
npx thesmos scan

# Generate AI assistant instruction files
npx thesmos adapters

# Review changed files (compare against main)
npx thesmos review --base=main

# Gate CI — exits 1 on BLOCKER findings
npx thesmos validate --base=origin/main
```

That's it. You now have:

- `.thesmos/` — governance folder with rules, config, and AI context
- `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/thesmos.mdc`, and more — auto-generated adapter files
- `.github/workflows/thesmos-pr.yml` — CI workflow ready to go

---

## Why Prometheus is different

Other platforms give you AI assistants. Prometheus gives you a governed AI team — 38 God Agents with domain expertise, built-in challengers, and every output governance-checked.

| Capability | ChatGPT GPTs | Cursor Agents | Claude Projects | Prometheus God Agents |
| --- | --- | --- | --- | --- |
| Domain specialization | Basic | Code only | Custom instructions | Deep methodology + mythology |
| Governance-checked outputs | ✗ | ✗ | ✗ | ✅ Prometheus badge on every output |
| Consultation mode (ranked options) | ✗ | ✗ | ✗ | ✅ Universal protocol |
| Cross-agent team + arbitration | ✗ | ✗ | ✗ | ✅ God Council |
| Devil's advocate built-in | ✗ | ✗ | ✗ | ✅ God Agent Momus |
| Drift detection | ✗ | ✗ | ✗ | ✅ God Agent Proteus |
| PM / execution planning | ✗ | ✗ | ✗ | ✅ God Agent Metis |
| Calibrated confidence | ✗ | ✗ | Partial | ✅ [ASSUMPTION] / [VERIFY] markers |
| Problem diagnosis first | ✗ | ✗ | ✗ | ✅ Every agent asks the real question first |
| BYOK / zero surveillance | N/A | N/A | N/A | ✅ All API keys user-supplied |

**7 things no other agent platform does:**

1. **Governance badge on every output** — Every God Agent delivery closes with `Thesmos check: [RULE_ID] ✅`. No other platform runs 1,075 governance rules against AI outputs automatically.
2. **38 world-class God Agents — not assistants** — Each agent has a named methodology, failure mode taxonomy, and adversarial self-check. Not "I know marketing" but "I use Ehrenberg-Bass reach theory, and here's the specific thing your brief gets wrong."
3. **God Council arbitration** — When agents conflict, Zeus arbitrates. Argus holds a permanent security veto; Themis holds a permanent legal veto. You get one decision, not a debate.
4. **God Agent Momus** — The only agent platform with a mandatory challenger. Momus challenges every major decision before it ships using Socratic method, Gary Klein's Pre-mortem, and Munger's Inversion.
5. **God Agent Proteus** — Drift detection built into the team. Product, prompt, architecture, brand, and strategy drift — caught before it costs a sprint.
6. **BYOK and zero surveillance** — Every API key is yours. Nothing is stored. The governance is local. No SaaS subscription required to maintain compliance.
7. **Calibrated confidence** — Every God Agent marks claims with [ASSUMPTION] and [VERIFY]. You know exactly where the confidence ends.

---

## The Prometheus Pantheon

38 God Agents — a governed AI team named after Greek gods, covering every major business and engineering function. Every agent has deep methodology, failure mode taxonomy, domain mastery sections, and the Universal Intelligence Protocol injected by `thesmos adapters`.

Install the full team:

```bash
thesmos pantheon:install --all
thesmos pantheon:export --target=claude-code
```

Or download any agent directly — no install required:

| Agent | Role | Download |
| --- | --- | --- |
| Zeus | Executive orchestration | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/zeus-executive-agent.md) |
| Athena | Business strategy | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/athena-strategy-agent.md) |
| Hermes | Marketing | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/hermes-marketing-agent.md) |
| Nike | Lead generation | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/nike-leadgen-agent.md) |
| Ares | Sales | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/ares-sales-agent.md) |
| Apollo | Content & copy | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/apollo-content-agent.md) |
| Aphrodite | Creative direction | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/aphrodite-creative-agent.md) |
| Hephaestus | UI/UX design | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/hephaestus-design-agent.md) |
| Argus | Security | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/argus-security-agent.md) |
| Hestia | Customer experience | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/hestia-cx-agent.md) |
| Tyche | Analytics & KPIs | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/tyche-analytics-agent.md) |
| Themis | Legal | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/themis-legal-agent.md) |
| Plutus | Finance & pricing | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/plutus-finance-agent.md) |
| Pheme | PR & comms | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/pheme-pr-agent.md) |
| Hera | Operations & HR | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/hera-operations-agent.md) |
| Daedalus | Product management | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/daedalus-product-agent.md) |
| Heracles | Business development | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/heracles-bd-agent.md) |
| Artemis | Photography & art direction | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/artemis-photography-agent.md) |
| Morpheus | Animation & motion | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/morpheus-animation-agent.md) |
| Dionysus | Video production | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/dionysus-video-agent.md) |
| Mnemosyne | Knowledge management | [Claude Code](https://raw.githubusercontent.com/Holley-Studio/thesmos-governance/main/pantheon/exports/claude-code/mnemosyne-knowledge-agent.md) |
| Chiron | Architecture advisory | `thesmos pantheon:export --agent=chiron` |
| Calliope | Email & MJML design | `thesmos pantheon:export --agent=calliope` |
| Cassandra | QA & testing strategy | `thesmos pantheon:export --agent=cassandra` |
| Erato | Brand voice & messaging | `thesmos pantheon:export --agent=erato` |
| Aether | AI product strategy | `thesmos pantheon:export --agent=aether` |
| Kratos | DevOps & infrastructure | `thesmos pantheon:export --agent=kratos` |
| Talos | Web development | `thesmos pantheon:export --agent=talos` |
| Polyhymnia | Technical documentation | `thesmos pantheon:export --agent=polyhymnia` |
| Clio | Case studies | `thesmos pantheon:export --agent=clio` |
| Eos | Automation & workflows | `thesmos pantheon:export --agent=eos` |
| **Proteus** | **Drift & alignment monitor** | `thesmos pantheon:export --agent=proteus` |
| **Momus** | **Challenger & clarity enforcer** | `thesmos pantheon:export --agent=momus` |
| **Metis** | **PM & execution planner** | `thesmos pantheon:export --agent=metis` |
| **Pythia** | **Data analysis & BI** | `thesmos pantheon:export --agent=pythia` |
| **Psyche** | **UX research & user insights** | `thesmos pantheon:export --agent=psyche` |
| **Nemesis** | **Compliance, GRC & risk** | `thesmos pantheon:export --agent=nemesis` |
| **Demeter** | **Customer success & accounts** | `thesmos pantheon:export --agent=demeter` |

See [pantheon/README.md](../pantheon/README.md) for the full documentation, all platform exports, and the installation guide.

### Pantheon Grid

| | Agent | One-liner |
| --- | --- | --- |
| ⚡ | **Zeus** | Routes every task to the right god — executive command centre |
| 🦉 | **Athena** | Maps the battlefield before your team moves — strategy and GTM |
| 📣 | **Hermes** | Turns positioning into campaigns that reach the right people |
| 🏹 | **Artemis** | Hunter's eye for every shot — photography and visual art direction |
| ⚔️ | **Ares** | Closes deals and wins rooms — sales playbooks and objection handling |
| 📝 | **Apollo** | Words that earn attention — content, copy, SEO, and scripts |
| 🎨 | **Aphrodite** | Makes it beautiful and unmistakable — brand and creative direction |
| 🔨 | **Hephaestus** | Builds interfaces that work and feel inevitable — UI/UX design |
| 👁️ | **Argus** | Sees every threat before it lands — security and vulnerability analysis |
| 💛 | **Hestia** | Turns customers into advocates — CX, support, and retention |
| 📊 | **Tyche** | Makes numbers tell the story — analytics, dashboards, and KPIs |
| ⚖️ | **Themis** | Guards you from the contracts that bite — legal and compliance |
| 💰 | **Plutus** | Finds the money and keeps it — finance, pricing, unit economics |
| 📡 | **Pheme** | Gets you in the right rooms and headlines — PR and communications |
| 🏛️ | **Hera** | Runs the machine that runs the company — operations and HR |
| 🗺️ | **Daedalus** | Builds the product the market actually wants — PM and roadmapping |
| 🤝 | **Heracles** | Opens doors no one else can — partnerships and business development |
| 🎥 | **Dionysus** | Makes video people want to watch — production and direction |
| 🌀 | **Morpheus** | Brings interfaces to life — animation and motion direction |
| 🧠 | **Mnemosyne** | Keeps institutional memory alive — knowledge management |
| 🏰 | **Chiron** | Architects systems that don't break — technical advisory |
| ✉️ | **Calliope** | Email that gets opened and acted on — campaigns and MJML |
| 🔍 | **Cassandra** | Finds the bugs before your users do — QA and testing strategy |
| 🎙️ | **Erato** | Gives your brand a voice people remember — messaging and tone |
| 🤖 | **Aether** | Makes AI a product advantage, not a risk — AI product strategy |
| 🚀 | **Kratos** | Ships infrastructure that stays up — DevOps and platform engineering |
| 🕸️ | **Talos** | Builds the web layer that converts — full-stack web development |
| 📚 | **Polyhymnia** | Turns complexity into clarity — technical documentation |
| 📖 | **Clio** | Writes the wins that sell the next deal — case studies |
| ⚙️ | **Eos** | Automates the work that shouldn't be manual — workflows and integrations |
| 🌀 | **Proteus** | Catches drift before it costs a sprint — alignment monitoring |
| 😈 | **Momus** | The voice that says "but what if we're wrong?" — adversarial challenger |
| 🗓️ | **Metis** | Plans the execution so the strategy doesn't die in a doc — PM orchestration |
| 🔮 | **Pythia** | Surfaces insights hiding in your data — SQL, BI, anomaly detection |
| 🦋 | **Psyche** | Understands what users mean, not just what they say — UX research |
| ⚖️ | **Nemesis** | Keeps you on the right side of every regulation — compliance and GRC |
| 🌾 | **Demeter** | Grows accounts that don't churn — customer success and renewals |

**Pantheon commands:**

```bash
thesmos pantheon:list                          # List all 38 agents
thesmos pantheon:export --target=claude-code   # Export as Claude Code native agents
thesmos pantheon:export --target=all           # Export for all 7 platforms
thesmos pantheon:orchestrate "<task>"          # Zeus routes task to specialists
thesmos pantheon:memory save --agent hermes "Note"
```

---

## Contents

- [Install](#install)
- [Commands](#commands)
- [Rule packs](#rule-packs)
- [GitHub Actions](#github-actions)
- [Configuration](#configuration)
- [Adapter targets](#adapter-targets)
- [Health score](#health-score)
- [Baseline system](#baseline-system)
- [Inline suppressions](#inline-suppressions)
- [Library API](#library-api)
- [How it works](#how-it-works)
- [Contributing](#contributing)

---

## Install

```bash
# npm
npm install --save-dev thesmos-governance

# pnpm
pnpm add -D thesmos-governance

# yarn
yarn add -D thesmos-governance

# bun
bun add -d thesmos-governance
```

Add scripts to your `package.json` (optional — you can also use `npx thesmos <command>` directly):

```json
{
  "scripts": {
    "thesmos:init":     "thesmos init",
    "thesmos:scan":     "thesmos scan",
    "thesmos:review":   "thesmos review",
    "thesmos:validate": "thesmos validate",
    "thesmos:doctor":   "thesmos doctor",
    "thesmos:adapters": "thesmos adapters",
    "thesmos:ci-check": "thesmos ci-check",
    "thesmos:health":   "thesmos health"
  }
}
```

**Node.js 20 or later is required.**

---

## Commands

All commands support `--json`, `--markdown`, and `--dry-run` flags where applicable.

### `thesmos init`

Scaffolds or updates the `.thesmos/` governance folder.

```bash
npx thesmos init
npx thesmos init --dry-run    # preview without writing
```

**Creates:**

| File | Purpose |
| --- | --- |
| `.thesmos/config.json` | Repo-specific config (never overwritten after creation) |
| `.thesmos/GUARDRAILS.md` | Active rules summary |
| `.thesmos/RULES.md` | Full rule reference |
| `.thesmos/governance/CODE_REVIEW.md` | Code review checklist |
| `.thesmos/governance/REVIEW_AGENT.md` | AI agent instructions |
| `.thesmos/governance/SEVERITY_MODEL.md` | Severity levels explained |
| `.github/workflows/thesmos-pr.yml` | CI workflow |

---

### `thesmos scan`

Analyses your repo and writes `.thesmos/report.json`. Detects framework, auth system, test setup, API routes, large files, risky patterns, and more.

```bash
npx thesmos scan
npx thesmos scan --json
```

---

### `thesmos review`

Reviews changed files against your rule set. Always exits 0 — use `validate` for CI gating.

```bash
npx thesmos review --base=main
npx thesmos review --base=origin/main --markdown
npx thesmos review src/api/users.ts src/lib/auth.ts
```

---

### `thesmos validate`

Same as `review` but exits 1 when `failOnSeverity` findings are present (default: `BLOCKER`). Use this as your CI gate.

```bash
npx thesmos validate --base=origin/$GITHUB_BASE_REF
```

---

### `thesmos adapters`

Generates AI assistant instruction files from the canonical rule registry. Preserves any content you have written outside `<!-- PROMETHEUS:GENERATED -->` markers.

```bash
npx thesmos adapters
npx thesmos adapters --targets=claude,gemini
```

---

### `thesmos doctor`

Full installation health check: required files, npm scripts, adapter freshness, report age, config validity, IDE dirs, and GitHub workflow.

```bash
npx thesmos doctor
npx thesmos doctor --json
```

---

### `thesmos ci-check`

Lightweight CI gate — checks adapter freshness and required files without re-running the full generator. Faster than `doctor`. Exits 1 on failure.

```bash
npx thesmos ci-check
```

---

### `thesmos health`

Scores your governance posture from 0 to 100 with a letter grade (A+ to F). Combines findings, drift, suppressions, and baseline into a single number.

```bash
npx thesmos health
npx thesmos health --json
```

---

### `thesmos drift`

Detects 12 categories of stale or missing governance artifacts: outdated adapters, missing files, registry mismatches, stale report, and more.

```bash
npx thesmos drift
```

---

### `thesmos explain <rule-id>`

Shows why a rule exists, common violations, good and bad code examples, and related playbooks.

```bash
npx thesmos explain ENV_001
npx thesmos explain direct_env_access
```

---

### `thesmos audit`

Combined `doctor` + scan-based `review`. Always exits 0. Use for broad visibility during development.

```bash
npx thesmos audit --markdown
```

---

### `thesmos fix`

Auto-fixes safe violations. Dry-run by default.

```bash
npx thesmos fix --base=main --dry-run
npx thesmos fix --base=main             # applies changes
```

---

### All commands

| Command | Purpose |
| --- | --- |
| `init` | Scaffold `.thesmos/` folder and GitHub Actions workflow |
| `scan` | Analyse repo → `.thesmos/report.json` |
| `review` | Run rules on changed files (exit 0) |
| `validate` | Run rules and gate CI (exit 0 or 1) |
| `adapters` | Generate AI assistant instruction files |
| `doctor` | Full installation health check |
| `ci-check` | Lightweight CI adapter-freshness gate |
| `health` | Governance health score (0–100) |
| `drift` | Detect stale governance artifacts |
| `audit` | Combined doctor + review (informational) |
| `fix` | Auto-fix safe violations |
| `update` | Convenience: scan + adapters + drift |
| `explain <id>` | Why a rule exists + examples |
| `baseline:create` | Snapshot current debt |
| `baseline:update` | Update baseline after resolving debt |
| `baseline:report` | Show what's in the baseline |
| `suppressions:audit` | Find expired/unused suppressions |
| `metrics` | Governance analytics |
| `ci` | Combined gate: validate + drift + health |
| `catalog:list` | List available agents and skills |
| `catalog:profiles` | List available profiles |
| `catalog:enable` | Enable an agent or skill |
| `agent:create` | Scaffold a new agent file |
| `skill:create` | Scaffold a new skill file |
| `pack:list` | List installed rule packs |
| `pack:validate` | Validate pack manifests |

---

## Rule packs

Packs are installable bundles of additional rules, agents, skills, and playbooks. The built-in registry ships 911 rules — packs let the community (and your organisation) add more without forking.

### Installing a pack

```bash
# Local pack — drop a directory into .thesmos/packs/
mkdir -p .thesmos/packs/my-pack
# create .thesmos/packs/my-pack/pack.json + rules/index.js

# npm pack (scoped under @thesmos/)
npm install --save-dev @thesmos/web
```

### Creating a pack

A pack is a directory with a `pack.json` manifest and a `rules/index.js` that exports `PACK_RULES`:

```json
{
  "id": "@myorg/internal",
  "name": "Internal rules",
  "version": "1.0.0",
  "description": "Company-specific governance rules",
  "author": "My Org",
  "tags": ["internal"],
  "provides": { "rules": true, "agents": false, "skills": false, "playbooks": false, "profiles": false },
  "schemaVersion": "1"
}
```

```javascript
// .thesmos/packs/my-pack/rules/index.js
export const PACK_RULES = [
  {
    id: 'ORG_001',
    category: 'no_direct_db_in_routes',
    description: 'Route handlers must use the service layer — no direct Prisma calls.',
    severity: 'HIGH',
    tags: ['internal', 'architecture'],
    sinceVersion: '1.0.0',
    explain: { why: '...', commonViolations: [], goodExample: '', badExample: '',
                relatedPlaybooks: [], relatedAgents: [], relatedSkills: [] },
    detect({ changedFiles = [] }) {
      // ... return Finding[]
      return [];
    },
  },
];
```

Pack rules are automatically loaded by `thesmos review` and `thesmos validate`. Use `pack:list` and `pack:validate` to inspect what's installed.

---

## GitHub Actions

`thesmos init` writes `.github/workflows/thesmos-pr.yml` to your repo. It runs on every pull request:

```text
scan → ci-check → review → validate (gate) → doctor
```

`validate` is the only step that can fail the job. All other steps upload output to a `thesmos-report` artifact.

**Adjust for your package manager:**

| Manager | Install | Run |
| --- | --- | --- |
| npm | `npm ci` | `npm run` |
| pnpm | `pnpm install --frozen-lockfile` | `pnpm run` |
| yarn | `yarn install --immutable` | `yarn` |
| bun | `bun install` | `bun run` |

---

## Configuration

Edit `.thesmos/config.json` to customise behaviour. The file is created by `thesmos init` and is never overwritten by subsequent runs.

```json
{
  "$schema": "node_modules/thesmos-governance/config.schema.json",
  "project": "My App",
  "failOnSeverity": ["BLOCKER"],
  "warnOnSeverity": ["HIGH"],
  "largeFileThreshold": 300,
  "ignoredFolders": ["node_modules", ".next", "dist"],
  "protectedBranches": ["main"],
  "disabledRules": [],
  "doctor": {
    "reportMaxAgeDays": 7
  }
}
```

Adding `"$schema"` gives you full autocomplete and validation in VS Code and any JSON-Schema-aware editor.

### Severity levels

| Level | Default CI effect | Use for |
| --- | --- | --- |
| `BLOCKER` | `exit 1` | Security violations, data leaks, broken invariants |
| `HIGH` | Warning | Auth gaps, risky patterns, near-violations |
| `MEDIUM` | Advisory | Type safety, quality issues |
| `LOW` | Advisory | Style, minor cleanup |
| `TECH_DEBT` | Advisory | Large files, complexity debt |

### Disabling rules

```json
{
  "disabledRules": ["GATE_001", "direct_env_access"]
}
```

Use rule IDs (`ENV_001`) or category names (`direct_env_access`). Both are shown in `thesmos explain`.

---

## Adapter targets

Every adapter is generated from the same `PROMETHEUS_RULES` array. You never write rules twice.

| Target | Output path | Used by |
| --- | --- | --- |
| `claude` | `CLAUDE.md` | Claude Code, Claude.ai |
| `gemini` | `GEMINI.md` | Gemini CLI, AI Studio |
| `cursor` | `.cursor/rules/thesmos.mdc` | Cursor IDE |
| `copilot` | `.github/copilot-instructions.md` | GitHub Copilot |
| `codex` | `.codex/thesmos.md` | OpenAI Codex CLI |
| `agents` | `AGENTS.md` | OpenAI Agents, generic agents |

Adapters embed a `<!-- PROMETHEUS:META -->` comment with `version`, `target`, and `ruleCount`. `thesmos ci-check` reads this metadata to detect drift without re-running the generator — fully deterministic, no timestamps.

Manual content you write outside `<!-- PROMETHEUS:GENERATED START -->` / `<!-- PROMETHEUS:GENERATED END -->` markers is **always preserved** across regenerations.

---

## Health score

`thesmos health` synthesises your governance state into a single number:

```text
thesmos health

  Grade: A  (87/100)

  Deductions
  ✗  2 HIGH findings            -6
  ✗  1 drift event              -4
  ✗  1 suppression missing reason -3

  Bonuses
  ✓  Baseline in use            +5
  ✓  Zero BLOCKER findings      +5
  ✓  Report is fresh            +5
```

Grades: **A+** (95–100) · **A** (85–94) · **B** (75–84) · **C** (65–74) · **D** (50–64) · **F** (<50)

---

## Baseline system

The baseline lets you adopt Prometheus in an existing codebase without failing CI on day one. Snapshot your current debt, then only new violations block CI.

```bash
# Snapshot current findings as known debt
npx thesmos baseline:create --base=main

# After fixing some debt, update the snapshot
npx thesmos baseline:update --base=main

# See what's in the baseline
npx thesmos baseline:report
```

Findings in the baseline are fingerprinted by `(category, file, normalised message)` — they survive file moves and minor edits.

---

## Inline suppressions

Suppress a single violation inline with a required reason:

```typescript
// thesmos-disable-next-line ENV_001 -- reason: legacy pattern, tracked in #4521
const val = process.env.MY_VAR;
```

Optional fields:

```typescript
// thesmos-disable-next-line ENV_001 -- reason: legacy -- owner: @alice -- expires: 2026-12-31
```

Audit all suppressions in the repo:

```bash
npx thesmos suppressions:audit
```

This flags: missing reasons, expired suppressions, blanket disables (no rule ID), and suppressions where the violation no longer exists.

---

## Library API

Import Prometheus programmatically — for VS Code extensions, build tools, or custom scripts:

```typescript
import {
  loadConfig,
  runScanner,
  runReview,
  runDoctorForRoot,
  runCiCheckForRoot,
  exitCodeFor,
  PROMETHEUS_RULES,
} from 'thesmos-governance';

// Load config from .thesmos/config.json
const config = loadConfig(root);

// Analyse repo structure
const scan = await runScanner(root, config);

// Review changed files
const findings = runReview({ scan, config, changedFiles });

// CI exit code (0 or 1)
const code = exitCodeFor(findings, config);

// Health check
const checks = await runDoctorForRoot(root, config);

// Generate adapter content for any target
import { buildAdapterContent } from 'thesmos-governance';
const content = buildAdapterContent('claude', existing, PROMETHEUS_RULES, config);
```

### Key exports

```typescript
// Rules
PROMETHEUS_RULES           // ThesmosRule[] — all 911 built-in rules
getRulesByTag(tag)         // filter by tag
getRulesBySeverity(sev)    // filter by severity
getRulesByCategory(cat)    // filter by category

// Pack rules — merge built-ins with installed packs
getActiveRules(root)       // → Promise<ThesmosRule[]> (built-ins + pack rules)
loadPackRules(root)        // → Promise<ThesmosRule[]> (pack rules only)

// Review
runReview(input, registry) // → Finding[]  (pass getActiveRules() result as registry)
formatFindingsConsole(f)   // → string
formatFindingsMarkdown(f)  // → string
formatFindingsJson(f)      // → string

// Health
computeHealthForRoot(root, config)   // → HealthScore
computeHealthScore(input)            // pure calculation

// Drift
runDriftForRoot(root, config)        // → DriftEvent[]

// Explain
findRule(idOrCategory)               // → ThesmosRule | undefined
listRules()                          // → ThesmosRule[]
formatExplainConsole(rule, findings) // → string
```

Full type definitions are included. Import types with:

```typescript
import type {
  ThesmosConfig,
  ScanResult,
  Finding,
  DoctorCheck,
  Severity,
  ThesmosRule,
} from 'thesmos-governance';
```

---

## How it works

```text
PROMETHEUS_RULES             ← single source of truth (911 built-in rules + pack rules at runtime)
        │
        ├── adapters.ts      → CLAUDE.md · GEMINI.md · .cursor/ · .github/ · .codex/ · AGENTS.md
        ├── init.ts          → .thesmos/ governance folder
        ├── scanner/         → repo analysis → report.json
        ├── review.ts        → per-file findings
        ├── severity.ts      → exit codes (0 | 1)
        ├── doctor.ts        → installation health
        ├── drift.ts         → adapter freshness + 12 drift categories
        ├── health.ts        → 0–100 governance score
        ├── baseline.ts      → known-debt fingerprinting
        └── suppress.ts      → inline suppression parsing + audit
```

**Pure functions throughout.** All detection, formatting, and classification logic has no side effects and is independently testable. I/O is isolated to entry-point functions (`runDoctorForRoot`, `runDriftForRoot`, etc.).

**Zero runtime dependencies.** The entire tool ships with no production dependencies — just Node.js built-ins. This means no supply-chain risk and instant installs.

**Deterministic.** No timestamps in governance artifacts. Sorted output. Injectable `Date` and `fs` in tests. The same inputs always produce the same outputs.

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development setup, how to add rules, commit conventions, and the PR process.

- [Open an issue](https://github.com/Holley-Studio/thesmos-governance/issues)
- [Read the security policy](../SECURITY.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)

---

## License

MIT — see [LICENSE](../LICENSE) or the `license` field in `package.json`.
