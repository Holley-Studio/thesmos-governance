# prometheus-governance

AI-stack-agnostic repo governance: code review rules, CI gates, and adapter generation for any AI coding assistant.

Works with Claude, Gemini, Cursor, Copilot, Codex, and AGENTS.md — all driven from a single canonical rule registry with zero duplication.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [CLI commands](#cli-commands)
- [GitHub Actions](#github-actions)
- [Library API](#library-api)
- [Configuration](#configuration)
- [How it works](#how-it-works)

---

## Install

```bash
npm install --save-dev prometheus-governance
```

Add npm scripts to your `package.json`:

```json
{
  "scripts": {
    "prometheus:init":     "prometheus init",
    "prometheus:scan":     "prometheus scan",
    "prometheus:review":   "prometheus review",
    "prometheus:validate": "prometheus validate",
    "prometheus:doctor":   "prometheus doctor",
    "prometheus:adapters": "prometheus adapters",
    "prometheus:ci-check": "prometheus ci-check",
    "prometheus:audit":    "prometheus audit"
  }
}
```

---

## Quick start

```bash
# 1. Scaffold the governance folder and GitHub Actions workflow
npm run prometheus:init

# 2. Analyse your repo structure
npm run prometheus:scan

# 3. Generate AI assistant instruction files
npm run prometheus:adapters

# 4. Run a health check (use this in CI before validate)
npm run prometheus:ci-check

# 5. Review changed files against the last scan
npm run prometheus:review -- --base=main

# 6. Gate CI — exits 1 on BLOCKER findings
npm run prometheus:validate -- --base=main
```

---

## CLI commands

All commands support `--json` and `--markdown` output flags.

### `prometheus init`

Scaffolds or updates the `.prometheus/` governance folder and the GitHub Actions workflow template.

```bash
npm run prometheus:init
npm run prometheus:init -- --dry-run    # preview without writing
npm run prometheus:init -- --json       # machine-readable output
```

**Creates:**
- `.prometheus/README.md` — project contract
- `.prometheus/config.json` — repo-specific config (preserved across runs)
- `.prometheus/GUARDRAILS.md` — active rules
- `.prometheus/RULES.md` — full rule reference
- `.prometheus/governance/CODE_REVIEW.md` — code review checklist
- `.prometheus/governance/REVIEW_AGENT.md` — AI agent instructions
- `.prometheus/governance/SEVERITY_MODEL.md` — severity levels
- `.prometheus/architecture/` — detected project structure (populated by `scan`)
- `.prometheus/playbooks/` — step-by-step guides
- `.github/workflows/prometheus-review.yml` — CI workflow (preserved across runs)

### `prometheus scan`

Analyses repo structure and writes `.prometheus/report.json`.

```bash
npm run prometheus:scan
npm run prometheus:scan -- --json
```

Detects framework, auth, test setup, API routes, components, large files, and more.

### `prometheus review`

Reviews changed files against your rule set. Always exits 0 — use `validate` for CI gating.

```bash
npm run prometheus:review -- --base=main
npm run prometheus:review -- --base=origin/main --markdown
npm run prometheus:review -- src/api/users.ts src/lib/auth.ts
```

### `prometheus validate`

Same as `review` but exits 1 when `failOnSeverity` findings are present (default: `BLOCKER`).

```bash
npm run prometheus:validate -- --base=origin/$GITHUB_BASE_REF
```

Use this as your CI gate. Review results are printed; only exit code signals pass/fail.

### `prometheus doctor`

Full installation health check: required files, npm scripts, adapter files, report freshness, config validity, IDE dirs, GitHub workflow.

```bash
npm run prometheus:doctor
npm run prometheus:doctor -- --json
npm run prometheus:doctor -- --markdown
```

### `prometheus ci-check`

Lightweight CI-critical health check. Faster than `doctor` — checks only what CI needs: required governance files exist, adapter files are current (rule count + version match), and config is valid.

Exits 1 if any check fails. Run this before `validate` in CI.

```bash
npm run prometheus:ci-check
npm run prometheus:ci-check -- --json
```

### `prometheus adapters`

Generates AI assistant instruction files from the canonical `PROMETHEUS_RULES` registry. Preserves manual content outside `<!-- PROMETHEUS:GENERATED -->` markers.

```bash
npm run prometheus:adapters
npm run prometheus:adapters -- --targets=claude,gemini
npm run prometheus:adapters -- --json
```

**Generated files:**
| Target | Output |
|---|---|
| `claude` | `CLAUDE.md` |
| `gemini` | `GEMINI.md` |
| `cursor` | `.cursor/rules/prometheus.mdc` |
| `copilot` | `.github/copilot-instructions.md` |
| `codex` | `.codex/prometheus.md` |
| `agents` | `AGENTS.md` |

### `prometheus audit`

Combined `doctor` + scan-based `review`. Informational only — always exits 0. Use for broad visibility; use `validate` for CI gating.

```bash
npm run prometheus:audit
npm run prometheus:audit -- --markdown
```

---

## GitHub Actions

`prometheus init` writes `.github/workflows/prometheus-review.yml` to your repo. It runs on every pull request:

```
scan → ci-check → review → validate (gate) → doctor
```

`validate` is the only step that can fail the job. All other steps upload their output to a `prometheus-report` artifact.

**Adjust for your package manager** (default: `npm ci`):

| Manager | Install | Run |
|---|---|---|
| npm | `npm ci` | `npm run` |
| pnpm | `pnpm install --frozen-lockfile` | `pnpm run` |
| yarn | `yarn install --immutable` | `yarn` |
| bun | `bun install` | `bun run` |

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
} from 'prometheus-governance';
```

### Key functions

```typescript
// Load and merge .prometheus/config.json with defaults
const config = loadConfig(root);

// Analyse repo structure
const scan = runScanner(root, config);

// Review changed files
const findings = runReview({ scan, config, changedFiles });

// CI gate
const exitCode = exitCodeFor(findings, config); // 0 | 1

// Full installation health check
const checks = runDoctorForRoot(root, config);

// Fast CI health check (adapter freshness, required files)
const ciChecks = runCiCheckForRoot(root, config);

// Generate adapter content for any AI target
import { buildAdapterContent, PROMETHEUS_RULES } from 'prometheus-governance';
const claudeContent = buildAdapterContent('claude', existing, PROMETHEUS_RULES, config);
```

### Types

```typescript
import type {
  PrometheusConfig,
  ScanResult,
  Finding,
  DoctorCheck,
  Severity,
  Rule,
  AdapterTarget,
} from 'prometheus-governance';
```

---

## Configuration

Edit `.prometheus/config.json` to customise behaviour:

```json
{
  "project": "My App",
  "failOnSeverity": ["BLOCKER"],
  "warnOnSeverity": ["HIGH"],
  "largeFileThreshold": 300,
  "ignoredFolders": ["node_modules", ".next", "dist"],
  "protectedBranches": ["main"],
  "doctor": {
    "reportMaxAgeDays": 7
  }
}
```

**Severity levels:**

| Level | Default CI effect | Use for |
|---|---|---|
| `BLOCKER` | `exit 1` | Security violations, data leaks, broken invariants |
| `HIGH` | Warning | Auth gaps, risky patterns, near-violations |
| `MEDIUM` | Advisory | Type safety, quality issues |
| `LOW` | Advisory | Style, minor cleanup |
| `TECH_DEBT` | Advisory | Large files, complexity debt |

---

## How it works

```
PROMETHEUS_RULES          (canonical registry — single source of truth)
       │
       ├── adapters.ts    → CLAUDE.md, GEMINI.md, .cursor/, .github/, .codex/, AGENTS.md
       ├── init.ts        → .prometheus/ governance folder
       ├── scanner/       → repo analysis → report.json
       ├── review.ts      → per-file findings from report.json
       ├── severity.ts    → exit codes (0 | 1)
       ├── doctor.ts      → installation health
       └── ci-check.ts    → fast CI gate (adapter freshness + required files)
```

**Adapter freshness:** every generated adapter embeds a `<!-- PROMETHEUS:META -->` comment with `version`, `target`, and `ruleCount`. `prometheus ci-check` reads this metadata without re-running the generator — no timestamps involved, fully deterministic.

**Manual content is never overwritten:** all generated sections are wrapped in `<!-- PROMETHEUS:GENERATED START id -->` / `<!-- PROMETHEUS:GENERATED END id -->` markers. Content outside the markers is always preserved.

---

## Remaining publish steps

Before running `npm publish`:

1. Verify the package name `prometheus-governance` is available: `npm view prometheus-governance`
2. Update `repository.url` in `package.json` to your actual GitHub URL
3. Ensure you're logged in: `npm whoami`
4. Run a final check: `npm run prepublishOnly`
5. Tag the release: `git tag v1.0.0`

> **Note:** Do not `npm publish` from the library source directory (`prometheus/`) directly. The `.gitignore` excludes consumer artifacts — they belong in repos that depend on this package, not here.
