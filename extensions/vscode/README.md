# Thesmos Governance

**Real-time AI repo governance — inline findings, health scores, and adapter sync for Claude, Gemini, Cursor, Copilot, and Codex.**

[![CI](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/Holley-Studio/thesmos-governance/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/thesmos-governance?color=blue)](https://www.npmjs.com/package/thesmos-governance)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/holley-studios.thesmos-governance-vscode)](https://marketplace.visualstudio.com/items?itemName=holley-studios.thesmos-governance-vscode)

---

## What It Does

Thesmos Governance enforces 1,137+ AI-coding rules across your repo — catching security risks, stale adapters, context drift, and bad AI patterns before they land in production. The extension surfaces findings inline in VS Code and keeps your AI assistant configurations in sync automatically.

**Key capabilities:**

- **Pantheon Chat** — Zeus-orchestrated council chamber in the sidebar or editor tab, with god routing banners, permission gates for tool use, and workspace checkpoints
- **Pantheon Agents panel** — browse 65+ specialist gods grouped by division; copy Claude Code invocations in one click
- **Live Findings Panel** — governance violations surface as you code, with severity badges (BLOCKER / HIGH / MEDIUM / LOW)
- **Health Score** — a single 0–100 grade for your repo's governance state, visible in the status bar
- **AI Adapter Sync** — regenerate Claude, Cursor, Copilot, and Gemini config files from one command
- **Autopilot** — Claude Code session orchestration with journal, diff review, and one-click PR
- **Agent Scope** — lock Claude Code to allowed paths and commands to prevent runaway AI edits
- **Token Budget (billing-aware Budget Guardian)** — track estimated AI usage per session and enforce a real spending ceiling on confirmed metered API connections. Costs are computed from token counts, so on subscription-backed sessions (Claude Pro/Max/Team/Enterprise) the figure is an **API-equivalent usage estimate, not a charge** — those sessions are never blocked; they get advisories instead. Unverified connections stay advisory and ask you to classify them. See "Budget Guardian billing modes" below.
- **Commit Lint** — validate commit messages against Conventional Commits before push
- **Import Scan** — supply-chain check for suspicious or unvetted npm packages
- **AI Debt Scanner** — quantify and surface accumulated AI tech debt
- **Context Snapshot** — capture project context for handoff to a fresh AI session
- **Vercel Lint** — catch broken routes, missing env vars, and config issues in vercel.json

---

## Installation

**From VS Code Marketplace** (recommended):

1. Open VS Code
2. Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac) to open Extensions
3. Search **"Thesmos Governance"**
4. Click **Install**

Or install via command line:
```bash
code --install-extension holley-studios.thesmos-governance-vscode
```

**Requirements:**
- VS Code 1.85+
- Node.js 20+
- `thesmos-governance` npm package (auto-detected from `node_modules/.bin` or PATH)

---

## Quick Start

1. **Install the npm package** in your project:
   ```bash
   npm install --save-dev thesmos-governance
   ```

2. **Initialize governance** (creates `.thesmos/config.json`):
   ```bash
   npx thesmos init
   ```

3. **Open your project in VS Code** — the Thesmos icon appears in the Activity Bar (Θ)

4. **Click the Θ icon** to open the Findings panel and run your first scan

5. **Check your health score** in the status bar — click it to see the full breakdown

---

## Commands

Access all commands via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type "Thesmos":

| Command | Description |
|---------|-------------|
| `Thesmos: Open Pantheon Chat in Editor Tab` | Full-screen council chamber with Zeus routing |
| `Thesmos: Scan Repository` | Run a full governance scan |
| `Thesmos: Review Current File` | Check the active file against all rules |
| `Thesmos: Show Health Score` | View the 0–100 governance grade |
| `Thesmos: Regenerate AI Adapters` | Sync Claude, Cursor, Copilot, Gemini configs |
| `Thesmos: Open Config` | Edit `.thesmos/config.json` |
| `Thesmos: Refresh Findings` | Reload the findings panel |
| `Thesmos Autopilot: Generate Autopilot Plan` | Create a Claude Code autopilot plan |
| `Thesmos Autopilot: Review Session Diff (AI)` | AI review of the current autopilot session |
| `Thesmos Autopilot: Open Draft PR` | Open the PR for the current autopilot session |
| `Thesmos: Scan Imports (Supply Chain Check)` | Audit npm dependencies for supply-chain risks |
| `Thesmos: Scan AI Debt` | Quantify accumulated AI tech debt |
| `Thesmos: Snapshot Project Context` | Capture context for AI session handoff |
| `Thesmos: Show Context Health` | Review context freshness and drift |
| `Thesmos: Initialize Agent Scope` | Lock Claude Code to allowed paths/commands |
| `Thesmos: Show Agent Scope` | View current scope restrictions |
| `Thesmos: Show Token Usage Report` | Session token spend breakdown |
| `Thesmos: Lint Last Commit Message` | Validate against Conventional Commits |
| `Thesmos: Create Commit (Guided Wizard)` | Structured commit creation with type/scope guidance |
| `Thesmos: Lint Vercel Deployment Config` | Check vercel.json for common issues |

---

## Configuration

All settings are under **Settings → Extensions → Thesmos Governance**:

| Setting | Default | Description |
|---------|---------|-------------|
| `thesmos.enable` | `true` | Enable/disable the extension |
| `thesmos.runOnSave` | `true` | Re-run review on every file save |
| `thesmos.debounceMs` | `1000` | Milliseconds to wait after save before re-analyzing |
| `thesmos.showStatusBar` | `true` | Show health score in the status bar |
| `thesmos.binaryPath` | `""` | Absolute path to thesmos binary (leave empty for auto-detect) |
| `thesmos.autoScan` | `false` | Auto-run scan on activation when no report exists |
| `thesmos.autopilot.baseBranch` | `"main"` | Base branch to diff against in autopilot review |

### Budget Guardian billing modes

Pantheon Chat shows a budget bar fed by the Claude Code CLI's cumulative `total_cost_usd`. That
number is always an **estimate computed from token counts** — the CLI reports it for every auth
mode, so on a subscription login it is an *API-equivalent* figure, not money you spent. The
Budget Guardian therefore distinguishes three modes (configure in `.thesmos/config.json` →
`tokenBudget.billingMode`, or click the budget bar and pick one):

| Mode | Bar label | Behavior |
|------|-----------|----------|
| `subscription` | `Subscription · ~$30.06 API equivalent · Advisory only` | Never blocks on the estimate. Advisory at `subscriptionWarningEquivalentUSD` (default $30). Provider usage limits (e.g. Claude weekly limits) still apply — subscription use is not unlimited. |
| `metered` | `Metered API · ~$12.40 / $15.00` | Real spend protection: warns at `warnAtFraction` (default 0.8) of `sessionMaxCostUSD`, hard-pauses new prompts at the ceiling. Raise the ceiling (budget-bar action) and the same session continues immediately. |
| `auto` (default) | `Billing unknown · ~$8.21 estimated` | Detects from provider/session auth metadata: linked GLM/Kimi/DeepSeek keys and API-key-authenticated Claude sessions classify as metered; everything unverified (including OAuth logins, which may be a subscription **or** a metered Console account, and custom proxies) stays advisory and asks you to classify. Unknown never silently becomes either mode. |

Old configs that only set `sessionMaxCostUSD` are treated as `auto` — they are **not**
reinterpreted as confirmed metered billing. Billing-mode changes and ceiling changes apply on the
next prompt without restarting VS Code; queued prompts re-check the ceiling before dispatching.
The same rule applies to the CLI-side `thesmos claude:govern` hook: cost ceilings hard-stop only
in `metered` mode (token-count ceilings still apply everywhere).

---

## Supported AI Platforms

Thesmos generates and validates adapter configurations for:

| Platform | File |
|----------|------|
| Claude Code | `.claude/settings.json` |
| Cursor | `.cursor/rules/` |
| GitHub Copilot | `.github/copilot-instructions.md` |
| Gemini | `GEMINI.md` |
| OpenAI Codex / AGENTS.md | `AGENTS.md` |
| Windsurf | `.windsurfrc` |

---

## Links

- **Documentation:** [holley.studio/thesmos](https://holley.studio/thesmos)
- **GitHub:** [Holley-Studio/thesmos-governance](https://github.com/Holley-Studio/thesmos-governance)
- **npm package:** [thesmos-governance](https://www.npmjs.com/package/thesmos-governance)
- **Issues:** [github.com/Holley-Studio/thesmos-governance/issues](https://github.com/Holley-Studio/thesmos-governance/issues)
- **Discussions:** [github.com/Holley-Studio/thesmos-governance/discussions](https://github.com/Holley-Studio/thesmos-governance/discussions)

---

## License

MIT — see [LICENSE](https://github.com/Holley-Studio/thesmos-governance/blob/main/LICENSE)
