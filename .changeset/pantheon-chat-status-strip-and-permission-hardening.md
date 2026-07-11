---
"thesmos-governance": minor
---

Pantheon Chat: persistent status strip + permission-bridge hardening.

**Always-on status strip.** A persistent strip above the composer now reflects the live turn state — Thinking, Writing, running a specific tool, dispatching a god, and **Compacting context** (previously a silently-dropped `compact_boundary` event). It stays lit for the whole turn instead of blanking when text streams, and carries a **live context-window meter** (input + cache tokens vs the 200k window) that turns amber at 75% and red at 90% — so approaching the usage ceiling is visible instead of a surprise. All of it reads events the CLI already emits and renders client-side, so it adds zero token cost.

**Permission-bridge hardening (Argus security audit, 3× HIGH).**
- **HIGH-1** — the consent dialog no longer truncates Bash commands to 400 chars; the full command the user is approving is shown in a scrollable, XSS-safe block. A hidden tail past a cutoff can no longer defeat informed consent.
- **HIGH-2** — session-wide "always allow" is now a gated escalation: `Bash` is excluded entirely (no blanket shell auto-approval), and every other tool requires a native modal confirmation before the grant is added. The pending request still resolves immediately.
- **HIGH-3** — switching into `auto` permission mode (which disarms the per-call human gate) now requires an explicit native modal; declining reverts the dropdown, so a stray webview message can't silently downgrade posture.

**Model routing.** Zeus, Argus, and Athena resolve to Opus (matching the catalog source of truth); marketing copy and the extension welcome panel are aligned to the canonical 67-agent count.
