---
"thesmos-governance": minor
---

The Divine First Hour — the extension never feels frozen, the chat feels alive, and Thesmos starts paying for itself:

- **Living presence.** A god-flavored working indicator in the status bar for every long operation (scan, save-review, adapters, AI fix), and an instant "the council deliberates…" thinking strip in Pantheon Chat between prompt and first token — with a 2s gap-detector so long tool calls never look frozen.
- **Credit Guardian.** An honest, append-only savings ledger (`.thesmos/savings.jsonl`): tier-discipline savings per chat turn, budget hard stops, and 1M-context blocks. Surfaced as `⚖ ~$X saved` in the chat header, the token-meter tooltip, and the new `thesmos savings` command. All figures estimated vs the flagship baseline — never counts a recommendation you didn't take.
- **Split-right chat.** "Open Pantheon Chat in Editor" now splits beside your code by default (`thesmos.chat.openLocation`), plus welcome-screen suggested first prompts.
- **Mythic first-run.** `thesmos init` greets with the Thesmos banner, an Argus scan line, and closes with an oracle verdict (health grade, first labor, next steps). TTY only — JSON/piped/CI output unchanged.
- **Two false-positive fixes found by dogfooding this release on this repo's own gate:** SC_002 no longer fires on package.json edits when a lockfile exists on disk (workspace root or alongside), and the DORA rules no longer classify a repo as an EU financial entity on a single weak keyword ("ledger", "transaction", "portfolio"…) — one strong term or two distinct weak terms are now required.
