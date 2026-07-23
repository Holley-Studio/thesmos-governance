# Living Council — Shimmer + Turn Summary Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add god-bubble shimmer during active turns and a compact council summary card after each approved-dispatch turn.

**Architecture:** God shimmer uses the existing `body.running` CSS class (already toggled by the `status` message — zero new IPC plumbing). Summary card is a new `turnSummary` UiItem pushed in `turnDone` when `lastApprovedAdvice` was stored; that field is set in `resolveDispatch` on 'approved' status only.

**Tech Stack:** TypeScript, VS Code WebView, CSS keyframe animations, Vitest

## Global Constraints

- All user-content must use `textContent`, never `innerHTML` (AI_028 / existing project convention)
- CSS animations must have `@media (prefers-reduced-motion: reduce)` guards
- Use `--pc-radius` (10px) for card corners; `--pc-gold`, `--pc-gold-bright`, `--pc-dim`, `--pc-bubble`, `--pc-border`, `--pc-font-mono` CSS vars throughout — never hardcode hex colors for semantic roles
- Cost figures keep the `~` prefix (honesty contract established in prior dispatch order work)
- `UiItem` union in `chatViewProvider.ts` and `chat.ts` must stay in sync — identical field names and types for `turnSummary`
- `turnSummary` is emitted ONLY when `lastApprovedAdvice` is set (i.e., dispatch was explicitly approved — not skipped, not dismissed)
- No new npm dependencies
- `npx tsc --noEmit` (from `extensions/vscode/`) and `npx vitest run` must pass before each commit

---

## File Map

| File | Change |
|---|---|
| `extensions/vscode/src/chat/chatViewProvider.ts` | New UiItem variant; 2 new fields; resolveDispatch stores advice; dispatchPrompt records start cost; turnDone pushes card; stop/newSession/openChronicles/restoreCheckpoint clear stale state; exportCouncilRecord handles new kind |
| `extensions/vscode/src/chat/webview/chat.ts` | Sync UiItem union; add `buildTurnSummaryCard`; add `case 'turnSummary'` to `renderItem` |
| `extensions/vscode/src/chat/webview/pantheon.css` | `@keyframes god-shimmer`; `body.running .msg.god` rule; `.turn-summary` card styles |
| `extensions/vscode/dist/webview/chat.js` | Build artifact (Task 3) |
| `extensions/vscode/dist/webview/pantheon.css` | Build artifact (Task 3) |

---

## Task 1: Controller — turn summary UiItem type and push logic

**Files:**
- Modify: `extensions/vscode/src/chat/chatViewProvider.ts`

**Interfaces:**
- Produces: `{ kind: 'turnSummary'; turnId: string; gods: Array<{ emoji: string; name: string }>; model: string; costDeltaUsd: number }` pushed to history, consumed by Task 2

- [ ] **Step 1: Add `turnSummary` to the UiItem union**

In `chatViewProvider.ts`, find the `UiItem` type (line 33). Add the new variant **between** `dispatchOrder` and `error` (currently lines 43–44):

```typescript
  | { kind: 'dispatchOrder'; orderId: string; advice: DispatchAdvice; budgetLine: string | null; status: 'pending' | 'approved' | 'skipped' | 'dismissed' }
  | { kind: 'turnSummary'; turnId: string; gods: Array<{ emoji: string; name: string }>; model: string; costDeltaUsd: number }
  | { kind: 'error'; text: string }
  | { kind: 'turnFooter'; text: string };
```

- [ ] **Step 2: Add two new private fields to PantheonChatController**

Find the class body around line 215 (near the `private budgetWarned = false;` line). Add immediately after it:

```typescript
  /** Advice from the last approved dispatch order — used to build the post-turn summary card. */
  private lastApprovedAdvice: DispatchAdvice | undefined;
  /** Session cost at the start of the current turn — used to compute per-turn cost delta. */
  private turnStartCostUsd = 0;
```

- [ ] **Step 3: Store advice on approved dispatch in resolveDispatch**

Find `resolveDispatch` (line 716). Locate the block after `this.pendingDispatch = undefined;`. Add the approval guard so the full sequence reads:

```typescript
    const pending = this.pendingDispatch;
    if (!pending || pending.orderId !== orderId) return;
    this.pendingDispatch = undefined;
    if (status === 'approved') {
      this.lastApprovedAdvice = pending.advice;
    }
    if (status === 'dismissed') return;
```

- [ ] **Step 4: Record turn start cost in dispatchPrompt**

Find `dispatchPrompt` (line 748). After `this.turnRunning = true;` (line 754), add one line:

```typescript
    this.turnRunning = true;
    this.turnStartCostUsd = this.totalCostUsd;
    this.turnChangedFiles.clear();
```

- [ ] **Step 5: Push the turnSummary card in the turnDone handler**

Find the `turnDone` case (line 1337). After the `if (parts.length > 0) this.pushItem({ kind: 'turnFooter', ... })` line (currently line 1410) and **before** `this.broadcast({ type: 'status', running: false, ... })`, insert:

```typescript
        // Council summary card — appears after approved-dispatch turns only.
        if (this.lastApprovedAdvice) {
          const costDeltaUsd = Math.max(0, this.totalCostUsd - this.turnStartCostUsd);
          this.pushItem({
            kind: 'turnSummary',
            turnId: `ts-${Date.now().toString(36)}`,
            gods: this.lastApprovedAdvice.agents.map((a) => ({ emoji: a.emoji, name: a.name })),
            model: this.lastApprovedAdvice.recommendation.claudeModel,
            costDeltaUsd,
          });
          this.lastApprovedAdvice = undefined;
        }
```

Note: `this.totalCostUsd` was already updated from `event.costUsd` earlier in the same `turnDone` block (line 1364), so `this.totalCostUsd - this.turnStartCostUsd` is the cost of this turn.

- [ ] **Step 6: Clear lastApprovedAdvice on all session-reset paths**

**In `stop()` (line 1006)**, after `if (this.pendingDispatch) this.resolveDispatch(...)`:
```typescript
    if (this.pendingDispatch) this.resolveDispatch(this.pendingDispatch.orderId, 'dismissed');
    this.lastApprovedAdvice = undefined;
    this.session?.stop();
```

**In `newSession()` (line 1157)**, after `this.budgetWarned = false;`:
```typescript
    this.budgetWarned = false;
    this.lastApprovedAdvice = undefined;
```

**In `openChronicles()` (line 1115)**, after `this.savedUsdSession = 0;` (line 1138):
```typescript
    this.savedUsdSession = 0;
    this.lastApprovedAdvice = undefined;
```

**In `restoreCheckpoint()` (line 865)**, inside the `if (choice === RESTORE_FRESH)` branch, after `this.totalCostUsd = 0;` (line 906):
```typescript
        this.totalCostUsd = 0;
        this.savedUsdSession = 0;
        this.lastApprovedAdvice = undefined;
```

- [ ] **Step 7: Add turnSummary to exportCouncilRecord**

In the `for (const item of this.history)` switch inside `exportCouncilRecord` (line 1025). Add a case **before** `case 'error':`:

```typescript
        case 'turnSummary': {
          const godList = item.gods.map((g) => `${g.emoji} ${g.name}`).join(' · ');
          lines.push(`_⚡ ${godList} · \`${item.model}\` · ~$${item.costDeltaUsd.toFixed(4)}_`, '');
          break;
        }
```

- [ ] **Step 8: Run type check**

```bash
cd extensions/vscode && npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 9: Run test suite**

```bash
npx vitest run
```
Expected: 76 tests pass (all existing tests, no new tests needed — logic is simple assignment/subtraction with no branching that warrants unit coverage).

- [ ] **Step 10: Commit**

```bash
git add extensions/vscode/src/chat/chatViewProvider.ts
git commit -m "feat(chat): turnSummary UiItem — store approved dispatch advice, push council card at turnDone"
```

---

## Task 2: Webview — UiItem sync, card renderer, shimmer and summary CSS

**Files:**
- Modify: `extensions/vscode/src/chat/webview/chat.ts`
- Modify: `extensions/vscode/src/chat/webview/pantheon.css`

**Interfaces:**
- Consumes: `{ kind: 'turnSummary'; turnId: string; gods: Array<{ emoji: string; name: string }>; model: string; costDeltaUsd: number }` from Task 1
- Produces: `.turn-summary` card in the message log; gold shimmer on `.msg.god` while `body.running`

- [ ] **Step 1: Add turnSummary to the UiItem union in chat.ts**

In `chat.ts`, find the `UiItem` type (line 19). Add the new variant between `dispatchOrder` and `error` (lines 29–30), mirroring the controller exactly:

```typescript
  | { kind: 'dispatchOrder'; orderId: string; advice: DispatchAdviceUi; budgetLine: string | null; status: 'pending' | 'approved' | 'skipped' | 'dismissed' }
  | { kind: 'turnSummary'; turnId: string; gods: Array<{ emoji: string; name: string }>; model: string; costDeltaUsd: number }
  | { kind: 'error'; text: string }
  | { kind: 'turnFooter'; text: string };
```

Note: the `turnSummary` variant uses only primitive types — no local interface needed.

- [ ] **Step 2: Add buildTurnSummaryCard function**

In `chat.ts`, after the `buildDispatchOrderCard` function (ends around line 685), insert:

```typescript
function buildTurnSummaryCard(item: Extract<UiItem, { kind: 'turnSummary' }>): HTMLDivElement {
  const el = div('turn-summary');

  const godsRow = div('turn-summary-gods');
  for (const god of item.gods) {
    const chip = document.createElement('span');
    chip.className = 'turn-summary-chip';
    chip.textContent = `${god.emoji} ${god.name}`;
    godsRow.appendChild(chip);
  }
  el.appendChild(godsRow);

  const metaRow = div('turn-summary-meta');
  const modelSpan = document.createElement('span');
  modelSpan.className = 'turn-summary-model';
  modelSpan.textContent = item.model;
  const costSpan = document.createElement('span');
  costSpan.className = 'turn-summary-cost';
  costSpan.textContent = `~$${item.costDeltaUsd.toFixed(4)}`;
  metaRow.append(modelSpan, costSpan);
  el.appendChild(metaRow);

  return el;
}
```

- [ ] **Step 3: Add case 'turnSummary' to renderItem**

In `renderItem` (line 328), add the case immediately after `case 'dispatchOrder':` (around line 478):

```typescript
    case 'dispatchOrder': {
      append(buildDispatchOrderCard(item));
      break;
    }
    case 'turnSummary': {
      append(buildTurnSummaryCard(item));
      break;
    }
    case 'error': {
```

- [ ] **Step 4: Run type check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 5: Add god shimmer animation to pantheon.css**

In `pantheon.css`, find the `/* ── Dispatch Order ─── */` section (line 938). Insert the following block **immediately before** that section:

```css
/* ── God bubble shimmer during an active turn ────────────────────────── */
@keyframes god-shimmer {
  0%, 100% { box-shadow: 0 0 0 0 rgba(212, 169, 65, 0); }
  50% { box-shadow: 0 0 10px 3px rgba(212, 169, 65, 0.25); }
}
body.running .msg.god:not(.done):not(.error) {
  animation: god-shimmer 2s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  body.running .msg.god:not(.done):not(.error) { animation: none; }
}
```

This uses `body.running` — already toggled by the existing `status` message (set to `true` in `dispatchPrompt`, `false` at `turnDone`). No new IPC message needed.

The `:not(.done):not(.error)` guard ensures completed god bubbles stop shimmering as soon as their `toolResult` arrives, even while other gods still run.

- [ ] **Step 6: Add turn summary card styles to pantheon.css**

Immediately after the shimmer block and still before `/* ── Dispatch Order ─── */`, add:

```css
/* ── Turn summary card — compact council report after approved dispatches ── */
.turn-summary {
  align-self: stretch;
  max-width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--pc-border);
  border-left: 2px solid var(--pc-gold);
  border-radius: 6px;
  background: rgba(212, 169, 65, 0.03);
  font-size: 0.82em;
  animation: pc-rise 0.22s ease-out;
}
.turn-summary-gods {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.turn-summary-chip {
  color: var(--pc-gold);
  background: rgba(212, 169, 65, 0.1);
  border-radius: 4px;
  padding: 1px 6px;
}
.turn-summary-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--pc-dim);
  white-space: nowrap;
}
.turn-summary-model {
  font-family: var(--pc-font-mono);
}
.turn-summary-cost {
  font-family: var(--pc-font-mono);
}
@media (prefers-reduced-motion: reduce) {
  .turn-summary { animation: none; }
}
```

- [ ] **Step 7: Run type check again (CSS has no TS impact, but confirm no regressions)**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add extensions/vscode/src/chat/webview/chat.ts extensions/vscode/src/chat/webview/pantheon.css
git commit -m "feat(chat): god shimmer + turn summary card — Living Council webview"
```

---

## Task 3: Build and end-to-end verification

**Files:**
- Modify (build): `extensions/vscode/dist/webview/chat.js`, `chat.js.map`, `pantheon.css`, `pantheon.css.map`

- [ ] **Step 1: Build the extension**

```bash
npm run compile
```
Expected: exits 0, no errors, dist files updated.

- [ ] **Step 2: Run full test suite one final time**

```bash
npx vitest run
```
Expected: all 76 tests pass.

- [ ] **Step 3: E2E — shimmer on a council-scale prompt**

Launch Extension Development Host (VS Code Run & Debug → "Launch Extension"). In the Pantheon Chat sidebar, send a prompt that triggers a 2-god dispatch card, e.g.:

> "Review my recent changes for security issues and also design a Stripe webhook handler"

Approve the dispatch card. While the turn runs, confirm the god bubble(s) glow with a subtle gold pulse. When the turn ends, confirm the glow stops.

- [ ] **Step 4: E2E — turn summary card appears**

After the approved turn from Step 3 completes, confirm a compact card appears below the turn footer. It should show:
- God chips: e.g. `⚔️ Ares` · `👁 Argus`
- Model: e.g. `claude-sonnet-4-6`
- Cost delta: e.g. `~$0.0031`

- [ ] **Step 5: E2E — trivial prompt shows no shimmer, no summary**

Send: "what is 2 + 2?" (no dispatch gate triggered). Confirm: no shimmer on any element, no summary card after the turn.

- [ ] **Step 6: E2E — skipped dispatch shows no summary**

Send a 2-god prompt again. This time click "Send as-is". Confirm: no summary card appears (skip is not the same as approve).

- [ ] **Step 7: E2E — persistence after panel reopen**

Close and reopen the Pantheon Chat sidebar. Confirm existing summary cards reappear in history with correct content.

- [ ] **Step 8: Commit build artifacts**

```bash
git add extensions/vscode/dist/webview/chat.js \
        extensions/vscode/dist/webview/chat.js.map \
        extensions/vscode/dist/webview/pantheon.css \
        extensions/vscode/dist/webview/pantheon.css.map
git commit -m "build(chat): compile Living Council — shimmer + turn summary card"
```
