# The Divine First Hour — Design

**Date:** 2026-07-09 · **Status:** Approved (brainstorm with Matthew)
**Goal:** A stranger installs Thesmos → feels the gods within 5 minutes → sees a real catch on their own code → watches the savings number grow → screenshots the council chamber. Adoption first, conversion second.

Four workstreams, in build order. Workstreams 2's foundation (Pantheon Chat, ~3.8k lines in `extensions/vscode/src/chat/`) is already implemented and passing 56 tests — this release finishes and polishes it rather than building it from scratch.

---

## Workstream 1 — Living Presence (the thinking indicator)

**Problem:** the extension feels frozen. Two confirmed gaps:

1. **Chat webview:** between prompt send and the first stream event, nothing renders (the live bubble is only created on the first text delta; `body.running` only toggles the send button to "Queue").
2. **Extension ops:** `thesmos.scan` has a progress notification, but review-on-save, AI fix, adapters, and health refresh can run with no persistent indication.

**Design — one shared mechanism, three surfaces:**

- **`WorkingStateManager`** (`extensions/vscode/src/workingState.ts`): any long operation registers `{god, verb, startedAt}` and disposes on completion/error. Registrations stack; the most recent wins the display. Nothing clears implicitly — errors must dispose too (use try/finally at every call site).
- **Status bar:** while any registration is active, the main item shows `$(sync~spin) <emoji> <verb>… (Ns)`, ticking elapsed seconds; idle returns to the health grade. God emoji/verb from `pantheon-map.json` (already loaded by `godMapper.ts`) with sensible defaults per op (scan/review → Argus "watching the gates", adapters → Mnemosyne, fix → Hephaestus).
- **Chat webview thinking strip:** on `send`, immediately render a thinking indicator bubble — pulsing gold dot + rotating verb ("⚡ The council deliberates…") + elapsed time. It is removed by the first content event (delta, zeus, god, tool) and re-shown whenever `running` is true and nothing has streamed for >2s (covers long tool gaps). Respects `prefers-reduced-motion`.
- **Progress notifications:** review-on-save stays silent by design (status bar only — a notification per save would be noise); AI fix and adapters get cancellable `withProgress` notifications like scan.

## Workstream 2 — Pantheon Chat: finish Phase 1 + split-right

Already built: streaming, Zeus banners, god bubbles, tool/diff/permission/governance/todo cards, turn footer with cost, checkpoints, session history, Claude + Codex providers, permission bridge. Remaining:

- **Split-right default confirmed** (`openInTab` already uses `ViewColumn.Beside`); add setting `thesmos.chat.openLocation`: `"beside"` (default) | `"active"` — controls the tab command target column.
- **Thinking strip** (Workstream 1) wired into the webview.
- **Credit Guardian header** (Workstream 3) added to the chat header.
- **Stabilization pass:** run the manual verification list (below); fix what falls out. No new Phase 2 features (history browser/@-mentions/image attach stay deferred).

## Workstream 3 — Credit Guardian (the "pays for itself" engine)

**Claim to earn:** "Thesmos manages your AI credits — it can pay for itself." The number must be honest: only measurable events, always labeled *estimated*, baseline stated.

- **Ledger:** `.thesmos/savings.jsonl`, append-only. Entry: `{ts, type, detail, estSavedUsd?, model?, costUsd?}`.
- **v1 event sources** (all already-observable, no speculation):
  1. `model_tier` — a chat turn completed on a non-flagship model: `estSavedUsd = costUsd × (flagshipMultiple − 1)` where the multiple comes from a static tier table (flagship ≈ 5× mid, mid ≈ 5× fast — same doctrine as AGNT_031), sourced-commented and marked estimated. Written by the chat controller on each turn's `result` event.
  2. `budget_stop` — token-budget hard stop fired (event only; no $ claim).
  3. `context_1m_block` — AGNT_037 blocked a 1M-context config (event only; no $ claim).
- **Surfaces:**
  - Chat header: `⚖ Saved ~$X` (session) with tooltip showing month-to-date and the baseline disclaimer.
  - Status bar tooltip on the health item: month-to-date savings line.
  - CLI: `thesmos savings` — month-to-date summary table + disclaimer. (Small: read jsonl, group, print.)
- **Honesty rules:** never count a recommendation not taken; always render `~` and "estimated vs flagship baseline"; ledger is user-inspectable JSONL.

## Workstream 4 — Mythic first-run (CLI + welcome)

Output-layer only — no engine changes.

- `thesmos init`: themed banner (Cinzel-spirit ASCII, gold ANSI where TTY supports), Argus spinner line during the initial scan ("👁 Argus opens his hundred eyes… <n> files"), and a closing **oracle verdict**: health grade rendered as a verdict block with the top finding called out and attributed to its god domain.
- Next-steps block points at the chat: "Summon the council: install the VS Code extension → ⌘⇧G".
- First activation of the VS Code extension with no prior chat session shows a one-time welcome in the chat panel (already has an `empty` state — enrich it with the same verdict + a suggested first prompt).
- Non-TTY/CI output unchanged (plain text, no ANSI, no spinner) — existing behavior preserved.

---

## Verification

1. `npm run build` + `npm test` clean in `extensions/vscode/` and repo root after each workstream.
2. Extension Dev Host: send a chat prompt → thinking strip appears instantly, replaced by streaming text; god dispatch shows bubble with verb + elapsed; turn footer shows cost; header shows `⚖ Saved ~$X` after a non-flagship turn.
3. Save a file with `runOnSave` → status bar spins with Argus verb, returns to grade.
4. `thesmos.chat.openLocation` default opens the tab split-right beside the active editor.
5. Kill mid-stream (Stop) → no stuck spinner anywhere.
6. `thesmos init` in a scratch repo (TTY): banner, Argus progress, oracle verdict, next steps. Piped output: plain.
7. `thesmos savings` prints the month table from a seeded jsonl; empty ledger prints a friendly zero state.
8. Reduced-motion: thinking strip pulses replaced by static indicator.

## Risks

- **Savings math credibility** — mitigated by estimated labeling, static sourced tier table, user-inspectable ledger, and never counting untaken recommendations.
- **Stream format drift** (inherited from chat plan) — version-detect + defensive parse + recorded fixtures, unchanged.
- **Scope creep in first-run theatrics** — hard rule: output layer only; if a change touches scan/review logic it's out of scope.
