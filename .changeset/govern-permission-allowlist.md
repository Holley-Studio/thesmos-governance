---
"thesmos-governance": patch
---

`claude:govern install` now writes a `permissions.allow` block alongside governance hooks.

Every project that runs `thesmos claude:govern install` (or `thesmos:adapters`) automatically gets prompt-free approval for read-only tool patterns extracted from real usage across sessions:

- **Playwright MCP** — `browser_navigate`, `browser_take_screenshot`, `browser_snapshot`, `browser_resize`, `browser_console_messages`, `browser_close` (observation-only; click/fill/eval remain gated)
- **TypeScript typecheck** — exact form `Bash(npx tsc --noEmit)` (no file writes)

`claude:govern uninstall` removes only the thesmos-managed entries; any user-added entries are preserved. Existing `permissions.allow` entries are never overwritten or removed during install.
