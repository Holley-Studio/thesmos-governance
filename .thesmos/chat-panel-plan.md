# Pantheon Chat — Claude Code in a Mythic Chat Panel

## Context

[Claude Code Chat](https://claudecodechat.com/) (341k installs) proved the demand: developers want Claude Code **without the terminal** — a chat webview inside VS Code that renders streaming responses, tool calls, diffs, permission dialogs, and session history. It works by spawning the `claude` CLI as a subprocess in headless stream-JSON mode and rendering the event stream in a webview.

**Thesmos Pantheon Chat** does the same thing — but where Claude Code Chat is a generic wrapper, ours is a **governed council chamber**. Every subagent renders as its god (emoji, domain, progress verb from `pantheon-map.json`), Zeus routing headers become real UI banners, Thesmos hook blocks render as governance interventions, and the token budget lives in the chat header. This is the flagship visual expression of the Pantheon — the thing that makes Thesmos *feel* like gods at work instead of log lines.

**Why this brings value:**

1. **Zero-terminal Claude Code** — table stakes (proven by 341k installs of the generic version)
2. **God personas** — no other tool can render subagents as characters; we own the 58-agent catalog
3. **Governance visibility** — BLOCKER rules firing, scope violations, token budgets — rendered as divine interventions, not stderr noise
4. **Sales asset** — screenshots/demos of the council chamber are the strongest marketing artifact Thesmos can produce

## Verified Technical Foundation

Confirmed via official Claude Code docs (July 2026):

| Fact | Implication |
|---|---|
| Spawning `claude` CLI subprocess is **ToS-allowed**; works with the user's existing subscription login | Architecture = CLI subprocess, NOT Agent SDK (SDK requires API keys; subscription OAuth with SDK is banned) |
| `claude -p --output-format stream-json --input-format stream-json --verbose --include-partial-messages` | Full streaming event feed: assistant text deltas, tool_use, tool_result, final result with `total_cost_usd` |
| `--permission-prompt-tool` (MCP tool) is the documented mechanism for custom permission dialogs in headless mode | We ship a tiny in-extension MCP permission server → render Approve/Deny dialogs in the webview (same approach as Claude Code Chat) |
| Project hooks (`.claude/settings.json`) **still fire** in headless mode | Our existing `agent-activity.cjs` hook keeps writing `agent-activity.jsonl` → god spawn/complete events flow for free |
| `Agent` tool_use events carry `subagent_type` + `description` in tool input; subagent messages carry `parent_tool_use_id` | We can render a god bubble the moment Zeus dispatches, and complete it on tool_result |
| Sessions stored at `~/.claude/projects/<project-slug>/<session-id>.jsonl`; `--resume <id>` restores | Session history browser is possible (parse defensively — format is internal) |

## Architecture

```
┌─────────────────────────── VS Code ───────────────────────────┐
│                                                                │
│  ┌──────────────────┐   postMessage    ┌────────────────────┐  │
│  │ Pantheon Chat    │ ◄──────────────► │ Extension Host     │  │
│  │ Webview (UI)     │                  │                    │  │
│  │ · mythic theme   │                  │ ClaudeSession      │  │
│  │ · god bubbles    │                  │  · spawn claude -p │  │
│  │ · diffs/tools    │                  │  · stream-json I/O │  │
│  │ · permission     │                  │  · kill/interrupt  │  │
│  │   dialogs        │                  │                    │  │
│  └──────────────────┘                  │ PermissionServer   │  │
│                                        │  (MCP, in-process) │  │
│                                        │                    │  │
│                                        │ GodMapper          │  │
│                                        │  pantheon-map.json │  │
│                                        └─────────┬──────────┘  │
│                                                  │ spawns      │
│                                        ┌─────────▼──────────┐  │
│                                        │ claude CLI          │  │
│                                        │ (user's own login,  │  │
│                                        │  hooks + governance │  │
│                                        │  fire normally)     │  │
│                                        └────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

**Placement:** Both a sidebar `WebviewView` (in the existing `thesmos` activity-bar container) **and** an "open as editor tab" command — same HTML, two hosts (this matches Claude Code Chat's UX). Sidebar is the daily driver; editor tab for deep sessions.

## Event → UI Mapping (the Pantheon layer)

| Stream event | Rendered as |
|---|---|
| User prompt | Right-aligned user bubble |
| `system/init` | Session header: model, session id, tools count |
| Assistant text deltas | Streaming markdown bubble (left) |
| Assistant text starting with `⚡ ZEUS` header convention | **Zeus routing banner** — gold gradient, lightning icon, parsed god list |
| `Agent` tool_use (`subagent_type: "Argus — Security Agent"`) | **God bubble**: 👁 emoji avatar, name, domain, `progressVerb` from pantheon-map ("watching the gates…"), animated spinner, elapsed time |
| Subagent tool_result | God bubble completes: ✓, result summary, duration |
| `Edit`/`Write`/`MultiEdit` tool_use | Inline syntax-highlighted diff card (green/red), "Open in editor" button |
| `Bash` tool_use | Collapsed command card with output preview |
| Other tools (Read/Grep/etc.) | One-line collapsed chips |
| PreToolUse hook **block** (Thesmos governance) | 🛑 **Intervention card**: "Themis blocks this write — scope violation" with rule id |
| Permission request (via MCP permission server) | In-chat Approve / Deny / Always-allow dialog |
| `result` event | Footer: `total_cost_usd`, duration, token counts → feeds existing token meter in statusBar |

**Theme:** Distinct Pantheon mythic — deep night background with subtle starfield, gold (#FFD700) accents, per-domain accent colors (security red, strategy blue, content purple, growth green), marble-texture Zeus banners. Respects `prefers-reduced-motion`; readable in light theme via CSS variables.

## Files

**New (extension):**

- `extensions/vscode/src/chat/claudeSession.ts` — spawn/manage `claude` subprocess, stream-json parse, interrupt, resume (~250 lines)
- `extensions/vscode/src/chat/permissionServer.ts` — minimal MCP server for `--permission-prompt-tool` (~120 lines)
- `extensions/vscode/src/chat/godMapper.ts` — subagent_type → pantheon-map lookup (emoji, domain, progressVerb, domain color) (~60 lines)
- `extensions/vscode/src/chat/chatViewProvider.ts` — WebviewView + WebviewPanel host, postMessage protocol (~200 lines)
- `extensions/vscode/src/chat/webview/` — chat UI (HTML/CSS/JS, bundled by existing esbuild) (~600 lines)
  - `chat.ts` (message rendering, streaming, autoscroll), `pantheon.css` (mythic theme), `diff.ts` (diff cards)

**Modified:**

- `extensions/vscode/src/extension.ts` — register view + commands
- `extensions/vscode/src/commands.ts` — `thesmos.pantheon.chat.open`, `.openInTab`, `.newSession`, `.stop`
- `extensions/vscode/src/statusBar.ts` — chat entry point button
- `extensions/vscode/package.json` — contributes: view in `thesmos` container, commands, keybinding (⌘⇧G "summon the gods")
- `extensions/vscode/esbuild.mjs` — second entry point for webview bundle

**Reused as-is:** `pantheon-map.json` (58 gods), `agent-activity.cjs` hook + jsonl, existing FileSystemWatcher patterns from `agentActivityPanel.ts`, token meter in statusBar.

## Phased Delivery

**Phase 1 — MVP (the demo-able core):**
Chat webview (sidebar + tab) · send prompt → spawn CLI → stream markdown · tool-call cards + inline diffs · **god bubbles for Agent spawns** · **Zeus banner rendering** · stop button · **visible usage/token-budget bar in chat header** · cost/token footer · permission mode selector (default/acceptEdits/plan passthrough via `--permission-mode`)

### Usage Bar — Phase 1 Spec

The usage bar is a persistent band at the top of every chat session. It is **never hidden** — it is the one piece of real-time feedback the user needs to govern a council session.

```
┌─────────────────────────────────────────────────── Chat Header ───────────────┐
│  ⚡ Pantheon Chat                          🔵 claude-sonnet-4-6               │
│  ┌────────────────────────────────────────────────────────────────┐  $0.23    │
│  │████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  / $5.00  │
│  └────────────────────────────────────────────────────────────────┘           │
│     46% of session budget used · 2,841 tokens                                 │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Data sources:**
- **Running cost**: Cumulative `total_cost_usd` from each `result` event in the stream. Between result events, interpolate from `usage.input_tokens + output_tokens` deltas reported in partial messages.
- **Budget ceiling**: Read `tokenBudget` or `costBudgetUSD` from `.thesmos/config.json` at session start. Fall back to extension setting `thesmos.pantheon.sessionBudgetUSD` (default: $5.00). Show "no limit" state when unset.
- **Token count**: Sum `input_tokens + output_tokens` from all `result` events in the session.

**Visual states:**
| Fill % | Bar color | Meaning |
|---|---|---|
| 0–60% | `#22c55e` (green) | Healthy — gods have room |
| 60–85% | `#f59e0b` (amber) | Approaching limit — consider wrapping up |
| 85–100% | `#ef4444` (red) | Near budget — new tasks will likely truncate |
| >100% | Red + pulsing | Over budget — CLI will auto-stop |

**Behavior:**
- Bar fills left-to-right with gradient matching state color
- Numbers update in real-time as `result` events arrive (debounced 200ms)
- Clicking the bar opens `.thesmos/config.json` at the budget line
- Session reset (new conversation) resets bar to 0
- Persists across tool calls — only resets on explicit "New Session"

**Phase 2 — Parity with Claude Code Chat:**
In-chat permission dialogs (MCP permission server) · session history browser (`~/.claude/projects` + `--resume`) · `@` file mentions (workspace file picker) · image attach (write temp file, reference path in prompt) · slash-command passthrough · model picker

**Phase 3 — Differentiation (no one else can build this):**
Governance intervention cards (hook blocks rendered as god interventions) · council view (parallel god bubbles in a grid while a council runs) · god voice styling (per-agent response framing) · session export as "council record"

## Ecosystem Integration — VS Code Agents, Cursor, and Beyond

Pantheon Chat is Thesmos's **primary governed interface** — but "feel the gods" means reaching developers wherever they already work. Three surfaces, three integration strategies:

### 1. Pantheon Chat (this spec) — The Flagship Council Chamber
Full visual experience. God bubbles, Zeus banners, usage bar, governance interventions. The only interface where you truly *feel* the council. Ships as the `thesmos` VS Code extension's primary feature.

### 2. VS Code Copilot Chat Participant (`@pantheon`) — Phase 2
VS Code's [Chat Participant API](https://code.visualstudio.com/api/extension-guides/chat) lets extensions register as `@handle` participants in GitHub Copilot Chat.

**Integration model:**
```typescript
// Registered as vscode.chat.createChatParticipant('thesmos.pantheon', handler)
// Users type: @pantheon have Argus review this auth flow
// We detect the Zeus routing header in the response and render it in Copilot chat
```
- Route requests through the same `ClaudeSession` subprocess architecture
- Zeus's routing header parses → response prefixed with the correct god's identity
- No god bubbles (Copilot chat is text-only), but identity and methodology come through
- Opens Pantheon Chat panel when user says "open council" — bridges surfaces

**Why it's Phase 2:** The participant API adds complexity but minimal differentiation vs Pantheon Chat. Ship the flagship first; add the Copilot bridge for reach.

### 3. Cursor — Via System Prompt Injection (ships now, no extension needed)
Cursor's agent system is governed by `.cursor/rules` (and `CLAUDE.md` for project rules). The Pantheon routing table already exists at `pantheon/sources/claude-extras/PANTHEON.md`.

**Integration model:**
```
# For Cursor users — add to .cursor/rules or CLAUDE.md:
# Copy pantheon/sources/claude-extras/PANTHEON.md → .cursor/rules/01-pantheon.mdc
```
- Gods route through text-only persona, no visual UI
- Zeus routing header still appears in responses
- BLOCKER rules fire via `.thesmos/scope.json` if Thesmos is installed in the project
- `thesmos init --cursor` command (Phase 2 CLI) copies PANTHEON.md + creates `.cursor/rules/`

**The feel-the-gods philosophy across surfaces:**
| Surface | God identity | Usage bar | Governance | Best for |
|---|---|---|---|---|
| Pantheon Chat | ✅ Full visual | ✅ Live bar | ✅ Intervention cards | Deep council sessions |
| VS Code Copilot `@pantheon` | ✅ Text persona | ❌ | ✅ Text warnings | Quick god queries |
| Cursor via rules | ✅ Text persona | ❌ | ✅ BLOCKER blocks | Cursor-first teams |
| Claude Code terminal | ✅ Text persona | ❌ | ✅ Hook blocks | Power users |

The **identity** of each god — their voice, output contract, methodology, failure modes — travels across all surfaces. The Pantheon Chat adds the *visual ceremony*. But a developer who gets a response that opens with `👁 ARGUS — SECURITY & THREAT MODELING` and delivers a STRIDE threat model is experiencing a god regardless of which surface they're on.

## Risks & Mitigations

- **CLI stream-json format is internal and can change** → version-detect on `system/init`, defensive parsing, integration test against a pinned CLI version in CI
- **Subagent token deltas aren't forwarded** (only spawn + final result) → god bubbles show progressVerb + elapsed time while running, not live text — this is actually fine dramatically ("Argus is watching the gates…")
- **Session jsonl format is internal** → history browser parses defensively, feature-flags off on parse failure
- **Windows/WSL paths** → Phase 1 targets macOS/Linux; Windows support in Phase 2 (spawn via `cmd /c` where needed)
- **Extension bundle size** → webview bundle is separate esbuild entry; no framework (vanilla TS + CSS), keeps dist small

## Verification

1. `npm run build:ext` clean; existing extension tests pass
2. Launch Extension Development Host → open Pantheon Chat → send "list the files in thesmos/rules" → verify streaming text, Read tool chips, cost footer
3. Send a prompt that triggers a god dispatch (e.g. "have Argus review secrets.ts") → verify god bubble appears with 👁 avatar + progressVerb, completes with ✓ and duration
4. Trigger a scope violation (write outside allowedPaths) → verify intervention card renders (Phase 3; in Phase 1 verify the error text renders readably)
5. Stop button mid-stream → subprocess killed, UI shows interrupted state
6. Theme check: light + dark VS Code themes, reduced-motion
7. Unit tests: stream-json parser fixtures (recorded real sessions), godMapper lookups, Zeus-banner regex parser
