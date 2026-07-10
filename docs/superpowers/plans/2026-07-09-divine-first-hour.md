# The Divine First Hour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the adoption arc — a living "thinking" presence across the VS Code extension, a finished split-right Pantheon Chat, an honest Credit Guardian savings ledger, and a mythic `thesmos init` first-run.

**Architecture:** Four workstreams on branch `feat/divine-first-hour`. The extension work builds on the already-implemented chat (`extensions/vscode/src/chat/`, 56 tests passing). A new `WorkingStateManager` unifies busy-state display; a JSONL savings ledger (`.thesmos/savings.jsonl`) is written by the chat controller and read by a new CLI command and the status bar; `thesmos init` gains an output-layer oracle verdict.

**Tech Stack:** TypeScript, VS Code extension API, esbuild, vitest. Engine CLI in `thesmos/` (Node, no LLM calls).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-divine-first-hour-design.md`
- Never claim exact savings — always `~` prefix and "estimated vs flagship baseline" wording.
- Non-TTY / `--json` / `--markdown` CLI output must remain unchanged (no ANSI, no spinner, no banner).
- Respect `prefers-reduced-motion` in all webview animation.
- Extension: `npm run build` and `npm test` must pass in `extensions/vscode/` after every task. Engine: `npm test` at repo root.
- Copyright header on every new file: `// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.`
- Commit after each task with a conventional-commit message; do NOT push to main (push-protected); stay on `feat/divine-first-hour`.

---

### Task 1: WorkingStateManager + status bar working state

**Files:**
- Create: `extensions/vscode/src/workingState.ts`
- Create: `extensions/vscode/src/__tests__/workingState.test.ts`
- Modify: `extensions/vscode/src/statusBar.ts` (add `showWorking` / `restoreIdle` + idle snapshot)

**Interfaces:**
- Produces: `class WorkingStateManager { begin(emoji: string, verb: string): { dispose(): void }; dispose(): void }` constructed with `(onChange: (label: string | undefined) => void)`. Label format: `$(sync~spin) <emoji> <verb>… (<n>s)`.
- Produces: `StatusBarManager.showWorking(label: string): void` and `StatusBarManager.restoreIdle(): void`.

- [ ] **Step 1: Write the failing test**

`extensions/vscode/src/__tests__/workingState.test.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkingStateManager } from '../workingState.js';

describe('WorkingStateManager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits a spinner label on begin and undefined when the last op disposes', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    const reg = mgr.begin('👁', 'Argus watches the gates');
    expect(labels[0]).toContain('$(sync~spin)');
    expect(labels[0]).toContain('👁');
    expect(labels[0]).toContain('Argus watches the gates');
    reg.dispose();
    expect(labels[labels.length - 1]).toBeUndefined();
    mgr.dispose();
  });

  it('ticks elapsed seconds while running', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    mgr.begin('👁', 'watching');
    vi.advanceTimersByTime(3100);
    expect(labels[labels.length - 1]).toMatch(/\(3s\)/);
    mgr.dispose();
  });

  it('most recent registration wins the display; falls back to prior on dispose', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    const a = mgr.begin('👁', 'scanning');
    const b = mgr.begin('🔨', 'forging');
    expect(labels[labels.length - 1]).toContain('🔨');
    b.dispose();
    expect(labels[labels.length - 1]).toContain('👁');
    a.dispose();
    expect(labels[labels.length - 1]).toBeUndefined();
    mgr.dispose();
  });

  it('double dispose is a no-op', () => {
    const labels: Array<string | undefined> = [];
    const mgr = new WorkingStateManager((l) => labels.push(l));
    const reg = mgr.begin('👁', 'watching');
    reg.dispose();
    reg.dispose();
    expect(labels.filter((l) => l === undefined)).toHaveLength(1);
    mgr.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/vscode && npx vitest run src/__tests__/workingState.test.ts`
Expected: FAIL — cannot resolve `../workingState.js`

- [ ] **Step 3: Implement `workingState.ts`**

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * WorkingStateManager — single source of truth for "the extension is busy".
 *
 * Any long operation registers with a god emoji + progress verb; the most
 * recent registration wins the display. While any registration is live, the
 * label ticks elapsed seconds once per second. When the stack empties, the
 * manager emits `undefined` so the owner can restore its idle display.
 *
 * No vscode import — pure logic, driven by a callback, so it unit-tests
 * without an extension host.
 */

interface Entry {
  id: number;
  emoji: string;
  verb: string;
  startedAt: number;
}

export class WorkingStateManager {
  private readonly entries: Entry[] = [];
  private nextId = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly onChange: (label: string | undefined) => void) {}

  begin(emoji: string, verb: string): { dispose(): void } {
    const entry: Entry = { id: this.nextId++, emoji, verb, startedAt: Date.now() };
    this.entries.push(entry);
    this.emit();
    if (this.timer === undefined) {
      this.timer = setInterval(() => this.emit(), 1000);
    }
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const idx = this.entries.findIndex((e) => e.id === entry.id);
        if (idx !== -1) this.entries.splice(idx, 1);
        if (this.entries.length === 0 && this.timer !== undefined) {
          clearInterval(this.timer);
          this.timer = undefined;
        }
        this.emit();
      },
    };
  }

  private emit(): void {
    const top = this.entries[this.entries.length - 1];
    if (!top) {
      this.onChange(undefined);
      return;
    }
    const seconds = Math.floor((Date.now() - top.startedAt) / 1000);
    this.onChange(`$(sync~spin) ${top.emoji} ${top.verb}… (${seconds}s)`);
  }

  dispose(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.entries.length = 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/vscode && npx vitest run src/__tests__/workingState.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Add `showWorking`/`restoreIdle` to StatusBarManager**

In `extensions/vscode/src/statusBar.ts`, add a private idle snapshot and two methods. Every existing idle-state setter records the snapshot. Concretely:

Add field after line 21 (`private readonly pantheonItem…`):

```ts
  /** Last idle (non-working) main-item state, restored when work completes. */
  private idleSnapshot: { text: string; tooltip: string | vscode.MarkdownString; bg: vscode.ThemeColor | undefined } | undefined;
```

Add a private helper and the two public methods (place after `showLoading()`):

```ts
  private snapshotIdle(): void {
    this.idleSnapshot = {
      text: this.item.text,
      tooltip: this.item.tooltip ?? '',
      bg: this.item.backgroundColor as vscode.ThemeColor | undefined,
    };
  }

  /** Working state — driven by WorkingStateManager. Label already contains the spinner codicon. */
  showWorking(label: string): void {
    this.item.text = label;
    this.item.tooltip = 'Thesmos is working — the gods are at their labors.';
    this.item.backgroundColor = undefined;
  }

  /** Restore whatever idle state was showing before work began. */
  restoreIdle(): void {
    if (!this.idleSnapshot) {
      this.showInactive();
      return;
    }
    this.item.text = this.idleSnapshot.text;
    this.item.tooltip = this.idleSnapshot.tooltip;
    this.item.backgroundColor = this.idleSnapshot.bg;
  }
```

Then append `this.snapshotIdle();` as the LAST line inside each of: `showHealth(…)`, `showScanNeeded()`, `showNotInstalled()`, `showInactive()`. (NOT in `showLoading`, `showAgentRouting`, `showAutopilotSession`, `showWorking` — those are transient.)

- [ ] **Step 6: Build + full test run**

Run: `cd extensions/vscode && npm run build && npm test`
Expected: build clean, 60 tests pass (56 prior + 4 new)

- [ ] **Step 7: Commit**

```bash
git add extensions/vscode/src/workingState.ts extensions/vscode/src/__tests__/workingState.test.ts extensions/vscode/src/statusBar.ts
git commit -m "feat(vscode): WorkingStateManager + status bar working/idle states"
```

---

### Task 2: Wire WorkingStateManager into extension operations

**Files:**
- Modify: `extensions/vscode/src/extension.ts` (construct manager, wire on-save analysis)
- Modify: `extensions/vscode/src/commands.ts` (wire scan/adapters/fix commands)

**Interfaces:**
- Consumes: `WorkingStateManager`, `StatusBarManager.showWorking/restoreIdle` from Task 1; `GodMapper` from `src/chat/godMapper.ts` (existing — `mapper.resolve('argus')` returns `{emoji, progressVerb, …}`).
- Produces: `getWorking: () => WorkingStateManager` callback passed into `registerCommands` (new 7th parameter).

- [ ] **Step 1: Construct and own the manager in `ThesmosExtension`**

In `extensions/vscode/src/extension.ts`:

```ts
import { WorkingStateManager } from './workingState.js';
import { GodMapper } from './chat/godMapper.js';
```

In the constructor after `this.statusBar = new StatusBarManager();`:

```ts
    this.godMapper = new GodMapper(workspaceRoot);
    this.working = new WorkingStateManager((label) => {
      if (label !== undefined) this.statusBar.showWorking(label);
      else this.statusBar.restoreIdle();
    });
    this.disposables.push({ dispose: () => this.working.dispose() });
```

with fields `private readonly working: WorkingStateManager;` and `private readonly godMapper: GodMapper;`.

- [ ] **Step 2: Wrap the debounced on-save analysis**

Find the full-analysis method that currently calls `this.statusBar.showLoading()` (extension.ts:510). Replace the `showLoading()` call with a working registration held for the duration, using try/finally:

```ts
    const argus = this.godMapper.resolve('argus');
    const reg = this.working.begin(argus.emoji, argus.progressVerb);
    try {
      // …existing analysis body unchanged…
    } finally {
      reg.dispose();
    }
```

(The existing `statusBar.showHealth(...)` at the end of analysis re-snapshots idle, so `restoreIdle()` lands on the fresh grade.)

- [ ] **Step 3: Wire commands**

Pass `() => this.working` and `this.godMapper` into `registerCommands` (extend its signature with `getWorking: () => WorkingStateManager, godMapper: GodMapper`). Inside `commands.ts`, wrap the bodies of `thesmos.adapters` and the AI-fix commands (`thesmos.fix.single`, `thesmos.fix.all`) the same way:

```ts
      const god = godMapper.resolve('hephaestus'); // fix commands
      const reg = getWorking().begin(god.emoji, god.progressVerb);
      try {
        // …existing body…
      } finally {
        reg.dispose();
      }
```

Use `godMapper.resolve('mnemosyne')` for `thesmos.adapters` (falls back to Oracle 🔮 if not in the map — acceptable). `thesmos.scan` keeps its notification AND gains the same registration so the status bar agrees.

- [ ] **Step 4: Build + tests + manual check**

Run: `cd extensions/vscode && npm run build && npm test`
Expected: clean. Manual (Extension Development Host): save a file → status bar shows `$(sync~spin) 👁 inspecting the perimeter… (1s)` then returns to the grade.

- [ ] **Step 5: Commit**

```bash
git add extensions/vscode/src/extension.ts extensions/vscode/src/commands.ts
git commit -m "feat(vscode): god-flavored working state on scan, save-review, adapters, and AI fix"
```

---

### Task 3: Chat webview thinking strip

**Files:**
- Modify: `extensions/vscode/src/chat/webview/chat.ts`
- Modify: `extensions/vscode/src/chat/webview/pantheon.css`

**Interfaces:**
- Consumes: existing webview state — `send()` (chat.ts:592), inbound `delta`/`item`/`deltaDone`/`status` handlers, `body.running` class toggle (chat.ts:515).
- Produces: self-contained webview behavior; no new message types.

- [ ] **Step 1: Add thinking element logic to `chat.ts`**

Add near the other top-level state (`let liveBubble…`, ~line 79):

```ts
// ── Thinking indicator ────────────────────────────────────────────────────────
// Shown instantly on send and whenever the turn is running but nothing has
// streamed for >2s (long tool gaps). Removed by any content event.
const THINKING_VERBS = [
  'The council deliberates',
  'Zeus weighs the matter',
  'The oracle stirs',
  'Wisdom gathers on Olympus',
];
let thinkingEl: HTMLDivElement | undefined;
let thinkingVerbIdx = 0;
let thinkingGapTimer: ReturnType<typeof setTimeout> | undefined;
let turnRunning = false;

function showThinking(): void {
  if (thinkingEl) return;
  thinkingEl = div('msg thinking');
  thinkingVerbIdx = (thinkingVerbIdx + 1) % THINKING_VERBS.length;
  thinkingEl.innerHTML =
    `<span class="pulse"></span><span class="verb">⚡ ${THINKING_VERBS[thinkingVerbIdx]}…</span>`;
  append(thinkingEl);
}

function hideThinking(): void {
  thinkingEl?.remove();
  thinkingEl = undefined;
}

/** Every stream event resets the gap timer; if 2s pass mid-turn, think again. */
function bumpThinkingGap(): void {
  hideThinking();
  clearTimeout(thinkingGapTimer);
  if (!turnRunning) return;
  thinkingGapTimer = setTimeout(() => {
    if (turnRunning) showThinking();
  }, 2000);
}
```

- [ ] **Step 2: Wire the triggers**

1. In `send()` (chat.ts:592), after `vscode.postMessage({ type: 'send', … })`, add: `turnRunning = true; showThinking();`
2. In the inbound message handler: at the top of the `delta` case and the `item` case, call `bumpThinkingGap()`.
3. In the `status` case (chat.ts:515 area), add: `turnRunning = msg.running; if (!msg.running) { clearTimeout(thinkingGapTimer); hideThinking(); }`
4. In the `deltaDone` case, call `bumpThinkingGap()` (turn may continue with tools).
5. In the `reset` and `history` cases, call `hideThinking()` and `clearTimeout(thinkingGapTimer)`.

- [ ] **Step 3: Style it in `pantheon.css`**

```css
/* ── Thinking indicator ─────────────────────────────────────────────── */
.msg.thinking {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--gold, #c9a84c);
  font-style: italic;
  opacity: 0.85;
}
.msg.thinking .pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--gold, #c9a84c);
  animation: thesmos-pulse 1.2s ease-in-out infinite;
}
@keyframes thesmos-pulse {
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.35); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .msg.thinking .pulse { animation: none; opacity: 0.8; }
}
```

- [ ] **Step 4: Build + manual verification**

Run: `cd extensions/vscode && npm run build && npm test`
Manual: send a prompt → gold pulsing "⚡ The council deliberates…" appears instantly, replaced by streaming text; during a long Bash tool call the indicator returns after 2s; Stop removes it.

- [ ] **Step 5: Commit**

```bash
git add extensions/vscode/src/chat/webview/chat.ts extensions/vscode/src/chat/webview/pantheon.css
git commit -m "feat(vscode): instant thinking indicator in Pantheon Chat — no more frozen feel"
```

---

### Task 4: `thesmos.chat.openLocation` setting

**Files:**
- Modify: `extensions/vscode/package.json` (configuration contribution)
- Modify: `extensions/vscode/src/chat/chatViewProvider.ts` (`openInTab`, line 293)

- [ ] **Step 1: Add the setting to `package.json`** (inside the existing `configuration.properties` block)

```json
"thesmos.chat.openLocation": {
  "type": "string",
  "enum": ["beside", "active"],
  "default": "beside",
  "description": "Where 'Open Pantheon Chat in Editor' places the chat tab: split to the right of the active editor (beside) or in the active column."
}
```

- [ ] **Step 2: Read it in `openInTab()`**

Replace the hardcoded `vscode.ViewColumn.Beside` (chatViewProvider.ts:297):

```ts
    const location = vscode.workspace.getConfiguration('thesmos').get<string>('chat.openLocation', 'beside');
    const column = location === 'active' ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside;
```

and pass `column` where `vscode.ViewColumn.Beside` was.

- [ ] **Step 3: Build, test, commit**

Run: `cd extensions/vscode && npm run build && npm test` → clean.

```bash
git add extensions/vscode/package.json extensions/vscode/src/chat/chatViewProvider.ts
git commit -m "feat(vscode): thesmos.chat.openLocation setting (split-right by default)"
```

---

### Task 5: Savings ledger core (engine)

**Files:**
- Create: `thesmos/savings.ts`
- Create: `thesmos/savings.test.ts`

**Interfaces:**
- Produces:
  - `type SavingsEntry = { ts: string; type: 'model_tier' | 'budget_stop' | 'context_1m_block'; detail: string; estSavedUsd?: number; model?: string; costUsd?: number }`
  - `appendSavingsEntry(root: string, entry: SavingsEntry): void` — appends one JSON line to `<root>/.thesmos/savings.jsonl`, creating the dir/file as needed.
  - `readSavingsEntries(root: string): SavingsEntry[]` — tolerant reader (skips malformed lines).
  - `summarizeSavings(entries: SavingsEntry[], monthOf: Date): { monthEstUsd: number; monthEvents: number; byType: Record<string, number> }`
  - `estimateTierSaving(model: string, turnCostUsd: number): number | undefined` — flagship models (`/opus|fable/i`) → undefined; `/sonnet/i` → `turnCostUsd * 4`; `/haiku/i` → `turnCostUsd * 24`. (Doctrine: flagship ≈ 5× mid, mid ≈ 5× fast — AGNT_031. Saving = cost × (multiple − 1). Estimated, vs flagship baseline.)

- [ ] **Step 1: Write the failing test** (`thesmos/savings.test.ts`)

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendSavingsEntry,
  readSavingsEntries,
  summarizeSavings,
  estimateTierSaving,
  type SavingsEntry,
} from './savings.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'thesmos-savings-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('savings ledger', () => {
  it('appends JSONL and reads it back', () => {
    const entry: SavingsEntry = {
      ts: '2026-07-09T12:00:00.000Z', type: 'model_tier',
      detail: 'turn on sonnet', estSavedUsd: 0.12, model: 'sonnet', costUsd: 0.03,
    };
    appendSavingsEntry(root, entry);
    appendSavingsEntry(root, { ...entry, estSavedUsd: 0.08 });
    const lines = readFileSync(join(root, '.thesmos', 'savings.jsonl'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(readSavingsEntries(root)).toHaveLength(2);
  });

  it('skips malformed lines when reading', () => {
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(join(root, '.thesmos', 'savings.jsonl'),
      '{"ts":"2026-07-09T12:00:00.000Z","type":"budget_stop","detail":"x"}\nnot json\n');
    expect(readSavingsEntries(root)).toHaveLength(1);
  });

  it('returns [] when no ledger exists', () => {
    expect(readSavingsEntries(root)).toEqual([]);
  });

  it('summarizes only the given month', () => {
    const mk = (ts: string, usd: number): SavingsEntry =>
      ({ ts, type: 'model_tier', detail: 'd', estSavedUsd: usd });
    const entries = [mk('2026-07-01T00:00:00Z', 1), mk('2026-07-20T00:00:00Z', 2), mk('2026-06-30T00:00:00Z', 99)];
    const s = summarizeSavings(entries, new Date('2026-07-09T00:00:00Z'));
    expect(s.monthEstUsd).toBe(3);
    expect(s.monthEvents).toBe(2);
    expect(s.byType['model_tier']).toBe(2);
  });

  it('estimates tier savings vs flagship baseline', () => {
    expect(estimateTierSaving('claude-sonnet-4-6', 0.05)).toBeCloseTo(0.2);
    expect(estimateTierSaving('claude-haiku-4-5', 0.01)).toBeCloseTo(0.24);
    expect(estimateTierSaving('claude-opus-4-8', 0.5)).toBeUndefined();
    expect(estimateTierSaving('claude-fable-5', 0.5)).toBeUndefined();
    expect(estimateTierSaving('glm-4.7', 0.5)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run thesmos/savings.test.ts` (repo root)
Expected: FAIL — module not found

- [ ] **Step 3: Implement `thesmos/savings.ts`**

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Credit Guardian savings ledger — append-only JSONL at .thesmos/savings.jsonl.
 *
 * Honesty contract: every dollar figure is an ESTIMATE vs the flagship-model
 * baseline, computed only from events that actually happened (a turn genuinely
 * ran on a cheaper tier; a budget stop genuinely fired). Never counts a
 * recommendation the user didn't take. Display layers must render figures with
 * a "~" prefix and the "estimated vs flagship baseline" disclaimer.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SavingsEntry {
  ts: string;
  type: 'model_tier' | 'budget_stop' | 'context_1m_block';
  detail: string;
  estSavedUsd?: number;
  model?: string;
  costUsd?: number;
}

export function savingsLedgerPath(root: string): string {
  return join(root, '.thesmos', 'savings.jsonl');
}

export function appendSavingsEntry(root: string, entry: SavingsEntry): void {
  const path = savingsLedgerPath(root);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(entry) + '\n', 'utf-8');
}

export function readSavingsEntries(root: string): SavingsEntry[] {
  const path = savingsLedgerPath(root);
  if (!existsSync(path)) return [];
  const out: SavingsEntry[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as SavingsEntry;
      if (typeof parsed.ts === 'string' && typeof parsed.type === 'string') out.push(parsed);
    } catch {
      // Tolerant reader — a corrupt line never breaks the report.
    }
  }
  return out;
}

export interface SavingsSummary {
  monthEstUsd: number;
  monthEvents: number;
  byType: Record<string, number>;
}

export function summarizeSavings(entries: SavingsEntry[], monthOf: Date): SavingsSummary {
  const y = monthOf.getUTCFullYear();
  const m = monthOf.getUTCMonth();
  const summary: SavingsSummary = { monthEstUsd: 0, monthEvents: 0, byType: {} };
  for (const e of entries) {
    const d = new Date(e.ts);
    if (d.getUTCFullYear() !== y || d.getUTCMonth() !== m) continue;
    summary.monthEvents += 1;
    summary.monthEstUsd += e.estSavedUsd ?? 0;
    summary.byType[e.type] = (summary.byType[e.type] ?? 0) + 1;
  }
  return summary;
}

/**
 * Tier-discipline estimate vs the flagship baseline (AGNT_031 doctrine:
 * flagship ≈ 5× mid tier, mid ≈ 5× fast tier). A turn that cost $C on the mid
 * tier would have cost ≈ 5×$C on the flagship → estimated saving = 4×$C.
 * Unknown/flagship models return undefined — no claim is made.
 */
export function estimateTierSaving(model: string, turnCostUsd: number): number | undefined {
  if (!Number.isFinite(turnCostUsd) || turnCostUsd <= 0) return undefined;
  if (/opus|fable/i.test(model)) return undefined;
  if (/sonnet/i.test(model)) return turnCostUsd * 4;
  if (/haiku/i.test(model)) return turnCostUsd * 24;
  return undefined;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run thesmos/savings.test.ts` → PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add thesmos/savings.ts thesmos/savings.test.ts
git commit -m "feat(engine): Credit Guardian savings ledger (append-only JSONL, honest estimates)"
```

---

### Task 6: `thesmos savings` CLI command

**Files:**
- Create: `thesmos/bin/commands/savings.ts`
- Modify: `thesmos/bin/cli.ts` (register `savings` in the command table + import)

**Interfaces:**
- Consumes: `readSavingsEntries`, `summarizeSavings` from Task 5.
- Produces: `cmdSavings(argv: string[]): Promise<void>` — supports `--json`.

- [ ] **Step 1: Implement the command**

`thesmos/bin/commands/savings.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos savings — Credit Guardian month-to-date report.
 * All figures are estimates vs the flagship-model baseline; the ledger at
 * .thesmos/savings.jsonl is user-inspectable JSONL.
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { readSavingsEntries, summarizeSavings } from '../../savings.ts';

const TYPE_LABEL: Record<string, string> = {
  model_tier: 'Model-tier discipline (ran on a cheaper tier)',
  budget_stop: 'Token-budget hard stops',
  context_1m_block: '1M-context configs blocked (AGNT_037)',
};

export async function cmdSavings(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { flags } = parseArgs(argv);
  const entries = readSavingsEntries(root);
  const summary = summarizeSavings(entries, new Date());

  if (flag(flags, 'json')) {
    process.stdout.write(JSON.stringify({ ...summary, totalEntries: entries.length }, null, 2) + '\n');
    return;
  }

  const out: string[] = [];
  out.push('⚖  Credit Guardian — month to date');
  out.push('');
  if (summary.monthEvents === 0) {
    out.push('No savings events recorded yet this month.');
    out.push('Savings accrue as Pantheon Chat turns run on non-flagship models,');
    out.push('budget stops fire, or 1M-context configs are blocked.');
  } else {
    out.push(`Estimated saved: ~$${summary.monthEstUsd.toFixed(2)}   (${summary.monthEvents} events)`);
    out.push('');
    for (const [type, count] of Object.entries(summary.byType)) {
      out.push(`  ${TYPE_LABEL[type] ?? type}: ${count}`);
    }
  }
  out.push('');
  out.push('Estimates are vs the flagship-model baseline (AGNT_031 tier doctrine).');
  out.push(`Ledger: .thesmos/savings.jsonl (${entries.length} entries)`);
  process.stdout.write(out.join('\n') + '\n');
}
```

- [ ] **Step 2: Register in `thesmos/bin/cli.ts`**

Add import `import { cmdSavings } from './commands/savings.ts';` alongside the others, and in the command table add:

```ts
  savings: cmdSavings,
```

- [ ] **Step 3: Verify manually**

Run: `node --experimental-strip-types thesmos/bin/cli.ts savings` (or however sibling commands run in this repo — check `package.json` scripts; `npm run thesmos -- savings` if a wrapper exists).
Expected: friendly zero state + disclaimer. Then seed a line into `.thesmos/savings.jsonl` and re-run → table with `~$` figure. Delete the seeded line after.

- [ ] **Step 4: Run engine tests**

Run: `npx vitest run thesmos/` → all pass.

- [ ] **Step 5: Commit**

```bash
git add thesmos/bin/commands/savings.ts thesmos/bin/cli.ts
git commit -m "feat(cli): thesmos savings — Credit Guardian month-to-date report"
```

---

### Task 7: Chat controller writes model_tier entries; savings in chat header

**Files:**
- Create: `extensions/vscode/src/chat/savingsLedger.ts` (extension-side thin twin of Task 5's ledger — the extension bundles separately from the engine)
- Create: `extensions/vscode/src/__tests__/savingsLedger.test.ts`
- Modify: `extensions/vscode/src/chat/chatViewProvider.ts` (turnDone handler ~line 875; status broadcasts; HTML header ~line 412)
- Modify: `extensions/vscode/src/chat/webview/chat.ts` (render savings in header)

**Interfaces:**
- Produces (extension): `appendSavings(root: string, entry: SavingsEntry): void`, `monthSavingsUsd(root: string, now: Date): number`, `estimateTierSaving(model: string, turnCostUsd: number): number | undefined` — same formulas as Task 5 (keep the two implementations in sync; each carries a comment pointing at the other).
- Produces (webview protocol): `status` message gains optional `savedUsdSession?: number; savedUsdMonth?: number`.

- [ ] **Step 1: Write the failing test** — mirror Task 5's append/read/estimate tests against `../chat/savingsLedger.js` (same cases: append+read, malformed line skip, month filter, tier estimates). Copy the test bodies from Task 5 Step 1, adjusting the import path and using `monthSavingsUsd(root, new Date('2026-07-09T00:00:00Z'))` in place of `summarizeSavings`.

- [ ] **Step 2: Run to verify failure**, then implement `savingsLedger.ts` with the same code as Task 5's `savings.ts` minus `summarizeSavings` (replace with):

```ts
export function monthSavingsUsd(root: string, now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  let total = 0;
  for (const e of readSavingsEntries(root)) {
    const d = new Date(e.ts);
    if (d.getUTCFullYear() === y && d.getUTCMonth() === m) total += e.estSavedUsd ?? 0;
  }
  return total;
}
```

Header comment must note: "Formulas duplicated from thesmos/savings.ts — keep in sync (extension bundles independently of the engine)."

- [ ] **Step 3: Run to verify pass** — `cd extensions/vscode && npx vitest run src/__tests__/savingsLedger.test.ts`

- [ ] **Step 4: Record a ledger entry per completed turn**

In `chatViewProvider.ts` `turnDone` case (~line 875): the CLI reports **cumulative** session cost, so per-turn cost is the delta. Add fields `private prevCostUsd = 0;` and `private savedUsdSession = 0;` to the class. Inside `turnDone`, after `this.totalCostUsd = event.costUsd`:

```ts
        if (event.costUsd !== undefined) {
          const turnCost = Math.max(0, event.costUsd - this.prevCostUsd);
          this.prevCostUsd = event.costUsd;
          const saved = estimateTierSaving(this.model ?? this.modelId ?? '', turnCost);
          if (saved !== undefined && saved > 0) {
            this.savedUsdSession += saved;
            appendSavings(this.workspaceRoot, {
              ts: new Date().toISOString(),
              type: 'model_tier',
              detail: `chat turn on ${this.model ?? this.modelId}`,
              estSavedUsd: saved,
              model: this.model ?? this.modelId,
              costUsd: turnCost,
            });
          }
        }
```

(Adjust `this.model ?? this.modelId` to whichever field holds the resolved model string — both exist in this class; prefer the one populated from the `system/init` event.) Reset `prevCostUsd = 0` wherever a new session starts (`restartSession` / new-session handling — search `totalCostUsd = 0` and mirror it).

Extend every `broadcast({ type: 'status', … })` call to include:

```ts
      savedUsdSession: this.savedUsdSession,
      savedUsdMonth: monthSavingsUsd(this.workspaceRoot, new Date()),
```

- [ ] **Step 5: Render in the webview header**

In the HTML scaffold (chatViewProvider.ts ~line 413), after the `session-meta` span add:

```html
      <span id="savings" title="Credit Guardian — estimated savings vs flagship baseline. Ledger: .thesmos/savings.jsonl"></span>
```

In `chat.ts` `status` case:

```ts
      const savingsEl = document.getElementById('savings');
      if (savingsEl) {
        const s = msg.savedUsdSession ?? 0;
        const m = msg.savedUsdMonth ?? 0;
        savingsEl.textContent = m > 0 ? `⚖ ~$${m.toFixed(2)} saved` : '';
        savingsEl.setAttribute('title',
          `Credit Guardian (estimated vs flagship baseline)\nSession: ~$${s.toFixed(2)} · Month: ~$${m.toFixed(2)}\nLedger: .thesmos/savings.jsonl`);
      }
```

Update the `InboundMessage` status variant type: `savedUsdSession?: number; savedUsdMonth?: number`. Style in `pantheon.css`:

```css
#savings { color: var(--gold, #c9a84c); font-size: 11px; margin-left: 8px; opacity: 0.9; }
```

- [ ] **Step 6: Build + tests + commit**

Run: `cd extensions/vscode && npm run build && npm test` → clean.

```bash
git add extensions/vscode/src/chat/savingsLedger.ts extensions/vscode/src/__tests__/savingsLedger.test.ts extensions/vscode/src/chat/chatViewProvider.ts extensions/vscode/src/chat/webview/chat.ts extensions/vscode/src/chat/webview/pantheon.css
git commit -m "feat(vscode): Credit Guardian — per-turn tier savings in ledger + chat header"
```

---

### Task 8: budget_stop + context_1m_block ledger events; status bar savings line

**Files:**
- Modify: `extensions/vscode/src/extension.ts` (1M badge site, ~line 215)
- Modify: `thesmos/bin/commands/claude-govern.ts` (budget hard-stop site)
- Modify: `extensions/vscode/src/statusBar.ts` (`showTokenCost` tooltip)

- [ ] **Step 1: 1M-block event (extension).** At the `this.statusBar.show1MContextBadge(rel)` call site in extension.ts (~line 215), append a ledger event — once per session per source, guarded by a `private loggedContext1M = new Set<string>();` field:

```ts
          if (!this.loggedContext1M.has(rel)) {
            this.loggedContext1M.add(rel);
            appendSavings(workspaceRoot, {
              ts: new Date().toISOString(),
              type: 'context_1m_block',
              detail: `1M context flagged in ${rel}`,
            });
          }
```

(import `appendSavings` from `./chat/savingsLedger.js`.)

- [ ] **Step 2: budget_stop event (engine).** In `thesmos/bin/commands/claude-govern.ts`, locate the `budget-check` hard-stop branch (search for `hardStopAt` or the exit path that blocks the session). Where the hard stop fires, add:

```ts
import { appendSavingsEntry } from '../../savings.ts';
// …at the hard-stop branch:
appendSavingsEntry(root, {
  ts: new Date().toISOString(),
  type: 'budget_stop',
  detail: `token budget hard stop (${reason})`,
});
```

(`root` and a human-readable `reason` are both in scope in that command — adapt names to the actual code; if the file structure differs materially, put the append wherever the hard-stop decision is made, and note it in the commit message.)

- [ ] **Step 3: Status bar month line.** In `statusBar.ts` `showTokenCost(…)`, extend the signature to `showTokenCost(sessionCostUSD: number, todayCostUSD: number, monthSavedUSD = 0)` and append to the tooltip before the closing `_Click for full report_` line:

```ts
      (monthSavedUSD > 0 ? `⚖ Saved this month: **~$${monthSavedUSD.toFixed(2)}** _(estimated)_\n\n` : '') +
```

Update the call site in extension.ts to pass `monthSavingsUsd(workspaceRoot, new Date())`.

- [ ] **Step 4: Build both packages, run both test suites, commit**

```bash
cd extensions/vscode && npm run build && npm test && cd ../.. && npx vitest run thesmos/
git add extensions/vscode/src/extension.ts extensions/vscode/src/statusBar.ts thesmos/bin/commands/claude-govern.ts
git commit -m "feat: budget-stop and 1M-block savings events + month savings in status bar"
```

---

### Task 9: Mythic first-run — `thesmos init` oracle verdict

**Files:**
- Modify: `thesmos/bin/commands/init.ts` (output layer only — after `writeThesmosDir`, before the existing results print)
- Create: `thesmos/bin/lib/oracle.ts`
- Create: `thesmos/bin/lib/oracle.test.ts`

**Interfaces:**
- Produces: `formatOracleVerdict(input: { grade: string; score: number; topFinding?: { severity: string; category: string; file: string } ; fileCount?: number }): string` — pure string builder (testable), ANSI-free; and `mythicBanner(): string`. TTY gating and color live at the call site.

- [ ] **Step 1: Write the failing test** (`thesmos/bin/lib/oracle.test.ts`)

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { formatOracleVerdict, mythicBanner } from './oracle.js';

describe('oracle verdict', () => {
  it('renders grade, score, and the top finding', () => {
    const out = formatOracleVerdict({
      grade: 'B', score: 78,
      topFinding: { severity: 'HIGH', category: 'missing_api_auth', file: 'app/api/route.ts' },
    });
    expect(out).toContain('B');
    expect(out).toContain('78');
    expect(out).toContain('missing_api_auth');
    expect(out).toContain('app/api/route.ts');
    expect(out).toContain('ORACLE');
  });

  it('renders a clean verdict with no findings', () => {
    const out = formatOracleVerdict({ grade: 'A+', score: 98 });
    expect(out).toContain('A+');
    expect(out).not.toContain('undefined');
  });

  it('banner mentions Thesmos and contains no ANSI escapes', () => {
    const b = mythicBanner();
    expect(b.toUpperCase()).toContain('THESMOS');
    expect(b).not.toContain('[');
  });
});
```

- [ ] **Step 2: Run to verify failure**, then implement `thesmos/bin/lib/oracle.ts`:

```ts
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mythic first-run output — pure string builders (no ANSI, no fs, no TTY
 * checks; the caller decides when to show these and whether to colorize).
 */

export function mythicBanner(): string {
  return [
    '',
    '  ⚡ T H E S M O S — the law the gods write for code',
    '  ────────────────────────────────────────────────',
    '',
  ].join('\n');
}

export interface OracleInput {
  grade: string;
  score: number;
  topFinding?: { severity: string; category: string; file: string };
  fileCount?: number;
}

export function formatOracleVerdict(input: OracleInput): string {
  const lines: string[] = [];
  lines.push('  ┌─ THE ORACLE SPEAKS ─────────────────────────────┐');
  lines.push(`  │  Health: ${input.grade} (${input.score}/100)`);
  if (input.fileCount !== undefined) {
    lines.push(`  │  👁 Argus surveyed ${input.fileCount} files`);
  }
  if (input.topFinding) {
    lines.push(`  │  First labor: [${input.topFinding.severity}] ${input.topFinding.category}`);
    lines.push(`  │    ${input.topFinding.file}`);
  } else {
    lines.push('  │  No new findings — the gates hold.');
  }
  lines.push('  └─────────────────────────────────────────────────┘');
  lines.push('');
  lines.push('  Next: thesmos review        — full findings');
  lines.push('        thesmos savings       — Credit Guardian report');
  lines.push('        VS Code extension     — summon the council (Pantheon Chat)');
  return lines.join('\n');
}
```

- [ ] **Step 3: Run to verify pass** — `npx vitest run thesmos/bin/lib/oracle.test.ts`

- [ ] **Step 4: Wire into `cmdInit` (TTY only)**

In `thesmos/bin/commands/init.ts`, define the gate near the top of the non-JSON output path: `const mythic = process.stdout.isTTY === true && !json && !markdown;`. When `mythic`, print `mythicBanner()` before the scan, and after `writeThesmosDir(...)` compute and print the verdict:

```ts
  if (mythic) {
    try {
      const { runReview } = await import('../../review.ts');
      const review = await runReview(root, config);
      const findings = review.findings ?? [];
      const top = findings[0];
      const { computeHealthScore } = await import('../../health.ts'); // use the actual exported name — check thesmos/health.ts exports and adapt
      process.stdout.write(formatOracleVerdict({
        grade: review.healthGrade ?? '—',   // if health isn't on the review result, call the health module directly; adapt to real API
        score: review.healthScore ?? 0,
        fileCount: scan?.fileCount,
        topFinding: top ? { severity: top.severity, category: top.category, file: top.file } : undefined,
      }) + '\n');
    } catch {
      // Verdict is decoration — init must never fail because of it.
    }
  }
```

**Implementation note:** the exact health/review API must be read from `thesmos/review.ts` and `thesmos/health.ts` at implementation time (both exist; `runReview(root, config, files?)` is already imported by the chat controller via the extension runner, and `health.ts` exports the score computation used by `thesmos health`). Keep the try/catch so any API mismatch degrades to no verdict rather than a broken init.

- [ ] **Step 5: Manual verification**

In a scratch repo: `thesmos init` (TTY) → banner + verdict + next steps. `thesmos init --json | cat` → byte-identical JSON to before (no banner). `thesmos init` piped (`| cat`) → no banner (isTTY false).

- [ ] **Step 6: Run engine tests + commit**

```bash
npx vitest run thesmos/
git add thesmos/bin/lib/oracle.ts thesmos/bin/lib/oracle.test.ts thesmos/bin/commands/init.ts
git commit -m "feat(cli): mythic first-run — banner + oracle verdict on thesmos init (TTY only)"
```

---

### Task 10: Chat empty-state welcome + changeset + docs

**Files:**
- Modify: `extensions/vscode/src/chat/chatViewProvider.ts` (empty-state HTML, ~line 421)
- Create: `.changeset/divine-first-hour.md`

- [ ] **Step 1: Enrich the empty state.** Replace the `#empty` block content:

```html
    <div id="empty">
      <div class="glyph">🏛️</div>
      <div class="headline">THE COUNCIL AWAITS</div>
      <div>Describe your task — Zeus will route it to the right god.</div>
      <div class="first-prompts">
        <button class="suggest" data-prompt="Have Argus review my most recently changed files for security issues">👁 Argus: review my recent changes</button>
        <button class="suggest" data-prompt="What is the current health of this repo? Summarize the top findings.">⚖ Judge this repo's health</button>
        <button class="suggest" data-prompt="Explain what Thesmos governance is enforcing in this workspace">📜 What laws govern this place?</button>
      </div>
    </div>
```

In `chat.ts`, delegate clicks: on `.suggest` click → set `input.value = btn.dataset.prompt ?? ''` and call `send()`. In `pantheon.css`:

```css
.first-prompts { display: flex; flex-direction: column; gap: 6px; margin-top: 14px; }
.first-prompts .suggest {
  background: var(--card, rgba(255,255,255,.04));
  border: 1px solid var(--border, rgba(255,255,255,.08));
  color: inherit; border-radius: 6px; padding: 6px 10px; cursor: pointer; text-align: left;
}
.first-prompts .suggest:hover { border-color: var(--gold, #c9a84c); }
```

- [ ] **Step 2: Changeset.** `.changeset/divine-first-hour.md`:

```md
---
"thesmos-governance": minor
---

The Divine First Hour — the extension never feels frozen, the chat feels alive, and Thesmos starts paying for itself:

- **Living presence.** A god-flavored working indicator in the status bar for every long operation (scan, save-review, adapters, AI fix), and an instant "the council deliberates…" thinking strip in Pantheon Chat between prompt and first token.
- **Credit Guardian.** An honest, append-only savings ledger (`.thesmos/savings.jsonl`): tier-discipline savings per chat turn, budget hard stops, and 1M-context blocks. Surfaced as `⚖ ~$X saved` in the chat header, the token tooltip, and the new `thesmos savings` command. All figures estimated vs the flagship baseline — never counts a recommendation you didn't take.
- **Split-right chat.** "Open Pantheon Chat in Editor" now splits beside your code by default (`thesmos.chat.openLocation`).
- **Mythic first-run.** `thesmos init` greets with the Thesmos banner and closes with an oracle verdict (health grade, first labor, next steps). TTY only — JSON/piped output unchanged.
```

- [ ] **Step 3: Full verification sweep** (the spec's list)

1. `cd extensions/vscode && npm run build && npm test` → clean; repo root `npx vitest run thesmos/` → clean.
2. Extension Dev Host: prompt → thinking strip instantly; god bubble verbs; turn footer; `⚖ ~$X saved` after a Sonnet/Haiku turn.
3. Save file → Argus spinner in status bar → grade returns.
4. Tab command opens split-right.
5. Stop mid-stream → no stuck indicator.
6. `thesmos init` TTY vs piped as in Task 9.
7. `thesmos savings` zero state + seeded state.
8. Reduced-motion → static dot.

- [ ] **Step 4: Commit**

```bash
git add extensions/vscode/src/chat/chatViewProvider.ts extensions/vscode/src/chat/webview/chat.ts extensions/vscode/src/chat/webview/pantheon.css .changeset/divine-first-hour.md
git commit -m "feat(vscode): chat welcome suggestions + Divine First Hour changeset"
```
