---
"thesmos-governance": minor
---

`thesmos init` now generates AI adapter files (CLAUDE.md, GEMINI.md, AGENTS.md, Cursor/Copilot/Codex instructions) by default, so a single init command leaves the repo fully wired — no separate `thesmos adapters` step to forget. Opt out with `--no-adapters`. Adapter generation runs after profile application so the agent-context section reflects any profile agents just installed, and is skipped in `--dry-run`. The Pantheon routing doctrine (this repo's CLAUDE.md and the buyer kit's PANTHEON.md) also gains a "Skill Frameworks — Process vs. Personnel" section defining how Thesmos composes with process-skill frameworks like Superpowers: skills decide when/how to dispatch subagents, the Pantheon routing table decides which agent gets dispatched.
