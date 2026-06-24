# Thesmos Governance

[![CI](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/thesmos-governance?color=blue)](https://www.npmjs.com/package/thesmos-governance)
[![npm downloads](https://img.shields.io/npm/dm/thesmos-governance)](https://www.npmjs.com/package/thesmos-governance)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/holley-studios.thesmos-governance-vscode)](https://marketplace.visualstudio.com/items?itemName=holley-studios.thesmos-governance-vscode)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node ≥20](https://img.shields.io/node/v/thesmos-governance)](https://nodejs.org)

**1035 rules. Zero config. Built for the AI-assisted engineering era.**

Thesmos is an open-source code governance toolkit that watches AI-generated code for security holes, broken patterns, and architectural mistakes — before they reach production.

---

## Why Thesmos

AI tools write code faster than humans can review it. Copilot, Cursor, and Claude can ship working features in minutes — but they also hallucinate Prisma clients outside module scope, concatenate user input directly into LLM prompts, and create N+1 query waterfalls without a second thought.

Thesmos closes that gap. 1035 governance rules covering AI safety, security, performance, and correctness — active the moment you install.

---

## Three Ways to Use It

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

---

## The 1035 Rules

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
│   ├── catalog/         1035 rules organized by category
│   ├── index.ts         Public API
│   ├── metrics.ts       Health grade calculation
│   └── report.ts        Report generation
├── actions/
│   └── pr-review/       GitHub Action (self-contained, no install step)
├── extensions/
│   └── vscode/          VS Code extension
└── .github/workflows/   CI + release pipeline
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Rule contributions are especially welcome — the catalog is the heart of Thesmos.

Issues and feature requests: [GitHub Issues](https://github.com/Holley-Studio/thesmos-governance/issues)

---

## License

MIT — [LICENSE](LICENSE)

---

*Built by [Holley Studios](https://github.com/Holley-Studio)*
