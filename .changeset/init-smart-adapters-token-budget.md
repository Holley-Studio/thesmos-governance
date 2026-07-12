---
"thesmos-governance": minor
---

`thesmos init` now scaffolds cost governance ON by default and detects adapter targets instead of shotgunning all six:

- **Token budgets enabled for new users.** The scaffolded `.thesmos/config.json` ships `tokenBudget.enabled: true` with the standard defaults ($5/session, $25/day, $500/project, alert at 80%). Enforcement activates when `thesmos claude:govern install` wires the PostToolUse hook — init prints that next step.
- **Detected adapter targets.** Plain `init` now generates CLAUDE.md + AGENTS.md always, and Gemini/Cursor/Copilot/Codex adapters only when that tool's footprint already exists in the repo — no more six-file spray into single-tool repos. `thesmos adapters` still generates every target explicitly.
