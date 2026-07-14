---
"thesmos-governance": minor
---

Add `thesmos pantheon:install --write` and VS Code extension UX improvements.

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
