# Pantheon Chat — Dispatch Order Approval Gate + Budget Auto-Stop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-execution Dispatch Order approval card (powered by the deterministic `thesmos advise` heuristic — $0, no LLM call) and hard budget enforcement to Pantheon Chat, so Auto-mode users approve cost/model/god-routing once up front and can never silently overrun their session budget.

**Architecture:** A new pure module `dispatchAdvisor.ts` wraps the `thesmos advise --text --json` CLI call and owns all gate/budget decision logic as testable pure functions. `chatViewProvider.ts` (the existing chat controller) gains one new `UiItem` kind (`dispatchOrder`), a pending-prompt slot, and budget checks in `sendPrompt`/`turnDone`. The webview (`chat.ts` + `pantheon.css`) renders the card. No changes to `ClaudeSession`, `autoModeGovernor`, or the guard.

**Tech Stack:** TypeScript (strict), VS Code extension API, vitest, Node `child_process.execFile`, existing esbuild pipeline.

## Context for the implementer (read once)

Pantheon Chat already has: god bubbles with model badges, Zeus banner parsing, governance finding cards, permission dialogs via an MCP-style socket bridge, a savings ledger (`savingsLedger.ts` with `appendSavings` and entry type `'budget_stop'` already defined), a session budget read from `.thesmos/config.json` → `tokenBudget.sessionMaxCostUSD` (displayed in the webview budget bar but **not enforced**), and prompt queueing. The `thesmos advise` CLI (`npx tsx thesmos/bin/cli.ts advise --text="..." --json`) deterministically returns:

```json
{
  "planPath": "(inline --text)",
  "classification": { "mechanicalPct": 60, "creativePct": 15, "architecturePct": 20, "bulkPct": 5 },
  "recommendation": {
    "model": "sonnet",
    "claudeModel": "claude-sonnet-5",
    "codexModel": "gpt-5.5",
    "costMultiple": "baseline (~5x cheaper than the top tier)",
    "rationale": "60% mechanical execution — ..."
  },
  "agents": [
    { "key": "chrysos", "emoji": "💳", "name": "Chrysos", "domain": "Stripe & Payment Security", "score": 3 }
  ]
}
```

Key existing integration points in `extensions/vscode/src/chat/chatViewProvider.ts` (1452 lines at plan time):

| What | Where |
|---|---|
| `UiItem` union | line ~32 |
| `readSessionBudget(workspaceRoot)` | line ~124 |
| Webview message switch (`case 'send'` etc.) | line ~481 in `attach()` |
| `sendPrompt(text, attachments)` | line ~660 |
| `dispatchPrompt(text, attachments, dequeued)` | line ~670 |
| `setModel(modelId)` — restarts session, resumes same conversation | line ~758 |
| `turnDone` handler (cost accounting, savings ledger) | line ~1256 |
| `pushItem` / `broadcast` | line ~1407 |

The webview `extensions/vscode/src/chat/webview/chat.ts` has a **duplicate copy of the `UiItem` type** and a `renderItem(item)` switch (line ~320). Both copies must stay in sync. Webview → controller messages go through `vscode.postMessage({type: ...})`.

Extension tests live in `extensions/vscode/src/__tests__/*.test.ts`, run with `vitest run` from `extensions/vscode/` (`npm test` in that workspace). They are plain node-environment vitest tests — no VS Code test host needed for pure modules.

## Global Constraints

- **Honesty contract (existing, from `savingsLedger.ts`):** every dollar figure shown is an ESTIMATE and must render with `~` and derive only from events that actually happened or the real price sheet (Opus $5/$25, Sonnet $3/$15, Haiku $1/$5 per MTok). Never show a fabricated per-task dollar prediction.
- **Fail-open UX:** if `thesmos advise` is missing, errors, or times out (8 s), the prompt dispatches WITHOUT the gate — the card is an enhancement, never a blocker. Budget enforcement is the opposite: fail-closed (block sends while exceeded).
- **AGNT_031:** the card recommends the advise model; it never auto-escalates to the top tier without the user seeing it.
- **No new config keys.** Gate thresholds are named constants; budget comes from the existing `tokenBudget.sessionMaxCostUSD`.
- **Copyright header** on every new file: `// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.`
- **Conventional Commits** (COMMIT_001) — `feat(chat): ...`, `test(chat): ...`.
- Webview and controller `UiItem` types must be edited in **both** files in the same task.
- Do not modify `autoModeGovernor.ts` (it watches settings.json hook installation — a different job), `claudeSession.ts`, or anything under `thesmos/`.

## File Structure

- **Create** `extensions/vscode/src/chat/dispatchAdvisor.ts` — advise CLI invocation + all pure decision logic (parse, gate rule, budget state, tier-saving label)
- **Create** `extensions/vscode/src/__tests__/dispatchAdvisor.test.ts`
- **Modify** `extensions/vscode/src/chat/chatViewProvider.ts` — `dispatchOrder` UiItem, pending gate flow, budget enforcement
- **Modify** `extensions/vscode/src/chat/webview/chat.ts` — card rendering + button messages
- **Modify** `extensions/vscode/src/chat/webview/pantheon.css` — card styles

---

### Task 1: `dispatchAdvisor.ts` — pure decision module

**Files:**
- Create: `extensions/vscode/src/chat/dispatchAdvisor.ts`
- Test: `extensions/vscode/src/__tests__/dispatchAdvisor.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used verbatim by Task 2):
  - `interface DispatchAdvice { classification: {...}; recommendation: {...}; agents: AdviceAgent[] }`
  - `parseAdvice(raw: string): DispatchAdvice | null`
  - `shouldGate(advice: DispatchAdvice, permissionMode: string): boolean`
  - `budgetState(totalCostUsd: number, budgetUsd: number | undefined): 'ok' | 'warn' | 'exceeded'`
  - `runAdvise(workspaceRoot: string, promptText: string): Promise<DispatchAdvice | null>`

- [ ] **Step 1: Write the failing tests**

Create `extensions/vscode/src/__tests__/dispatchAdvisor.test.ts`:

```typescript
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import {
  parseAdvice,
  shouldGate,
  budgetState,
  type DispatchAdvice,
} from '../chat/dispatchAdvisor.js';

const SAMPLE_ADVICE_JSON = JSON.stringify({
  planPath: '(inline --text)',
  classification: { mechanicalPct: 60, creativePct: 15, architecturePct: 20, bulkPct: 5 },
  recommendation: {
    model: 'sonnet',
    claudeModel: 'claude-sonnet-5',
    codexModel: 'gpt-5.5',
    costMultiple: 'baseline (~5x cheaper than the top tier)',
    rationale: '60% mechanical execution',
  },
  agents: [
    { key: 'chrysos', emoji: '💳', name: 'Chrysos', domain: 'Stripe & Payment Security', score: 3 },
    { key: 'argus', emoji: '👁', name: 'Argus', domain: 'Security & Threat Modeling', score: 1 },
  ],
});

function sample(): DispatchAdvice {
  const parsed = parseAdvice(SAMPLE_ADVICE_JSON);
  if (!parsed) throw new Error('sample must parse');
  return parsed;
}

describe('parseAdvice', () => {
  it('parses valid advise JSON', () => {
    const advice = sample();
    expect(advice.recommendation.claudeModel).toBe('claude-sonnet-5');
    expect(advice.agents).toHaveLength(2);
    expect(advice.agents[0].name).toBe('Chrysos');
  });

  it('returns null on malformed JSON', () => {
    expect(parseAdvice('{nope')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseAdvice('{"agents": []}')).toBeNull();
  });

  it('tolerates an empty agents array', () => {
    const raw = JSON.stringify({
      classification: { mechanicalPct: 100, creativePct: 0, architecturePct: 0, bulkPct: 0 },
      recommendation: { model: 'haiku', claudeModel: 'claude-haiku-4-5', codexModel: 'x', costMultiple: 'y', rationale: 'z' },
      agents: [],
    });
    expect(parseAdvice(raw)?.agents).toEqual([]);
  });
});

describe('shouldGate', () => {
  it('always gates in auto mode — the dispatch order is the one human approval', () => {
    const single = { ...sample(), agents: [sample().agents[0]] };
    expect(shouldGate(single, 'auto')).toBe(true);
    expect(shouldGate({ ...sample(), agents: [] }, 'auto')).toBe(true);
  });

  it('gates council-scale work (2+ gods) in any mode', () => {
    expect(shouldGate(sample(), 'default')).toBe(true);
    expect(shouldGate(sample(), 'acceptEdits')).toBe(true);
  });

  it('does not gate single-god work outside auto mode', () => {
    const single = { ...sample(), agents: [sample().agents[0]] };
    expect(shouldGate(single, 'default')).toBe(false);
  });

  it('does not gate god-less prompts outside auto mode', () => {
    expect(shouldGate({ ...sample(), agents: [] }, 'plan')).toBe(false);
  });
});

describe('budgetState', () => {
  it('is ok with no budget configured', () => {
    expect(budgetState(999, undefined)).toBe('ok');
  });

  it('is ok below 80%', () => {
    expect(budgetState(3.99, 5)).toBe('ok');
  });

  it('warns at 80% and above', () => {
    expect(budgetState(4.0, 5)).toBe('warn');
    expect(budgetState(4.9, 5)).toBe('warn');
  });

  it('is exceeded at 100% and above', () => {
    expect(budgetState(5.0, 5)).toBe('exceeded');
    expect(budgetState(7.2, 5)).toBe('exceeded');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd extensions/vscode && npx vitest run src/__tests__/dispatchAdvisor.test.ts
```

Expected: FAIL — `Cannot find module '../chat/dispatchAdvisor.js'`.

- [ ] **Step 3: Write the implementation**

Create `extensions/vscode/src/chat/dispatchAdvisor.ts`:

```typescript
// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * DispatchAdvisor — pre-execution routing/cost advice for Pantheon Chat.
 *
 * Wraps the deterministic `thesmos advise` heuristic (no LLM call, ~instant)
 * and owns the pure decision logic for:
 *   - when to show the Dispatch Order approval card (shouldGate)
 *   - session budget state (budgetState) — display is advisory, enforcement
 *     lives in the chat controller
 *
 * Fail-open by design: any advise failure (missing CLI, timeout, bad JSON)
 * returns null and the prompt dispatches without a gate.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface AdviceAgent {
  key: string;
  emoji: string;
  name: string;
  domain: string;
  score: number;
}

export interface DispatchAdvice {
  classification: {
    mechanicalPct: number;
    creativePct: number;
    architecturePct: number;
    bulkPct: number;
  };
  recommendation: {
    model: string;
    claudeModel: string;
    codexModel: string;
    costMultiple: string;
    rationale: string;
  };
  agents: AdviceAgent[];
}

/** Council-scale threshold for the chat gate outside auto mode. */
const COUNCIL_GATE_MIN_GODS = 2;
/** Budget warn threshold as a fraction of the session ceiling. */
const BUDGET_WARN_FRACTION = 0.8;
/** Kill advise if it hasn't answered in this many ms — the gate is optional. */
const ADVISE_TIMEOUT_MS = 8000;

/** Parse `thesmos advise --json` output. Null on anything malformed. */
export function parseAdvice(raw: string): DispatchAdvice | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const cls = obj.classification as Record<string, unknown> | undefined;
  const rec = obj.recommendation as Record<string, unknown> | undefined;
  if (!cls || !rec) return null;
  if (typeof rec.claudeModel !== 'string' || typeof rec.model !== 'string') return null;
  const agentsRaw = Array.isArray(obj.agents) ? obj.agents : [];
  const agents: AdviceAgent[] = [];
  for (const a of agentsRaw) {
    const ag = a as Record<string, unknown>;
    if (typeof ag.name === 'string' && typeof ag.domain === 'string') {
      agents.push({
        key: typeof ag.key === 'string' ? ag.key : '',
        emoji: typeof ag.emoji === 'string' ? ag.emoji : '🔮',
        name: ag.name,
        domain: ag.domain,
        score: typeof ag.score === 'number' ? ag.score : 0,
      });
    }
  }
  return {
    classification: {
      mechanicalPct: Number(cls.mechanicalPct) || 0,
      creativePct: Number(cls.creativePct) || 0,
      architecturePct: Number(cls.architecturePct) || 0,
      bulkPct: Number(cls.bulkPct) || 0,
    },
    recommendation: {
      model: rec.model,
      claudeModel: rec.claudeModel,
      codexModel: typeof rec.codexModel === 'string' ? rec.codexModel : '',
      costMultiple: typeof rec.costMultiple === 'string' ? rec.costMultiple : '',
      rationale: typeof rec.rationale === 'string' ? rec.rationale : '',
    },
    agents,
  };
}

/**
 * Gate rule:
 *  - auto mode: ALWAYS gate. Auto disarms the per-call permission dialogs, so
 *    the dispatch order is the single up-front human approval for the run.
 *  - other modes: gate only council-scale work (2+ matched gods) — per-call
 *    gates already protect the user; the card adds routing/cost visibility.
 */
export function shouldGate(advice: DispatchAdvice, permissionMode: string): boolean {
  if (permissionMode === 'auto') return true;
  return advice.agents.length >= COUNCIL_GATE_MIN_GODS;
}

/** Session budget state. No budget configured → always 'ok'. */
export function budgetState(
  totalCostUsd: number,
  budgetUsd: number | undefined,
): 'ok' | 'warn' | 'exceeded' {
  if (budgetUsd === undefined || budgetUsd <= 0) return 'ok';
  if (totalCostUsd >= budgetUsd) return 'exceeded';
  if (totalCostUsd >= budgetUsd * BUDGET_WARN_FRACTION) return 'warn';
  return 'ok';
}

/**
 * Invoke `thesmos advise --text=<prompt> --json` and parse the result.
 * Resolution order mirrors godMapper: local .bin shim, then the monorepo CLI.
 * Returns null (never throws) on any failure — the gate is optional.
 */
export function runAdvise(workspaceRoot: string, promptText: string): Promise<DispatchAdvice | null> {
  const binShim = join(
    workspaceRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'thesmos.cmd' : 'thesmos',
  );
  const monorepoCli = join(workspaceRoot, 'thesmos', 'bin', 'cli.ts');

  let command: string;
  let args: string[];
  if (existsSync(binShim)) {
    command = binShim;
    args = ['advise', `--text=${promptText}`, '--json'];
  } else if (existsSync(monorepoCli)) {
    command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    args = ['tsx', monorepoCli, 'advise', `--text=${promptText}`, '--json'];
  } else {
    return Promise.resolve(null);
  }

  return new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      { cwd: workspaceRoot, timeout: ADVISE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolvePromise(null);
          return;
        }
        resolvePromise(parseAdvice(stdout));
      },
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd extensions/vscode && npx vitest run src/__tests__/dispatchAdvisor.test.ts
```

Expected: PASS — 12 tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/vscode/src/chat/dispatchAdvisor.ts extensions/vscode/src/__tests__/dispatchAdvisor.test.ts
git commit -m "feat(chat): dispatch advisor module — advise wrapper + gate/budget logic"
```

---

### Task 2: Controller wiring — `dispatchOrder` UiItem, gate flow, budget enforcement

**Files:**
- Modify: `extensions/vscode/src/chat/chatViewProvider.ts`

**Interfaces:**
- Consumes (from Task 1): `runAdvise`, `shouldGate`, `budgetState`, `type DispatchAdvice` from `./dispatchAdvisor.js`.
- Produces (used by Task 3):
  - New `UiItem` variant: `{ kind: 'dispatchOrder'; orderId: string; advice: DispatchAdvice; budgetLine: string | null; status: 'pending' | 'approved' | 'skipped' | 'dismissed' }`
  - Webview → controller messages: `{ type: 'dispatchApprove', orderId }` and `{ type: 'dispatchSkip', orderId }`
  - Controller → webview message: `{ type: 'dispatchResolved', orderId, status }`

- [ ] **Step 1: Add the import and UiItem variant**

At the top of `chatViewProvider.ts`, next to the other `./chat` imports:

```typescript
import { runAdvise, shouldGate, budgetState, type DispatchAdvice } from './dispatchAdvisor.js';
```

In the `UiItem` union (line ~32), add after the `'governance'` variant:

```typescript
  | { kind: 'dispatchOrder'; orderId: string; advice: DispatchAdvice; budgetLine: string | null; status: 'pending' | 'approved' | 'skipped' | 'dismissed' }
```

- [ ] **Step 2: Add pending-dispatch state to the class**

Next to `private turnRunning = false;` (line ~207):

```typescript
  /** Prompt held while its Dispatch Order card awaits approval. */
  private pendingDispatch:
    | { orderId: string; text: string; attachments: string[]; advice: DispatchAdvice }
    | undefined;
  /** True once an 80% budget warning has been shown this session. */
  private budgetWarned = false;
```

- [ ] **Step 3: Gate `sendPrompt`**

Replace the existing `sendPrompt` method (line ~660) with:

```typescript
  private async sendPrompt(text: string, attachments: string[] = []): Promise<void> {
    // Budget enforcement (fail-closed): re-read the ceiling each send so the
    // user can raise it in .thesmos/config.json and immediately continue.
    const budget = readSessionBudget(this.workspaceRoot);
    if (budgetState(this.totalCostUsd, budget) === 'exceeded') {
      this.pushItem({
        kind: 'error',
        text:
          `⛔ Session budget reached (~$${this.totalCostUsd.toFixed(2)} of $${budget!.toFixed(2)}). ` +
          `Raise tokenBudget.sessionMaxCostUSD in .thesmos/config.json (click the budget bar) or start a new session.`,
      });
      return;
    }

    if (this.turnRunning) {
      // A turn is live — queue this prompt and dispatch it when the turn ends.
      this.promptQueue.push({ text, attachments });
      this.pushItem({ kind: 'user', text: this.userDisplayText(text, attachments), queued: true });
      return;
    }

    // A newer prompt supersedes any card still awaiting approval.
    if (this.pendingDispatch) this.resolveDispatch(this.pendingDispatch.orderId, 'dismissed');

    // Dispatch Order gate — deterministic advise heuristic, $0, fail-open.
    const advice = await runAdvise(this.workspaceRoot, text);
    if (advice && shouldGate(advice, this.permissionMode)) {
      const orderId = `do-${Date.now().toString(36)}`;
      this.pendingDispatch = { orderId, text, attachments, advice };
      const budgetLine =
        budget !== undefined
          ? `$${this.totalCostUsd.toFixed(2)} of $${budget.toFixed(2)} session budget used`
          : null;
      this.pushItem({ kind: 'dispatchOrder', orderId, advice, budgetLine, status: 'pending' });
      return;
    }

    await this.dispatchPrompt(text, attachments, false);
  }
```

- [ ] **Step 4: Add the resolve method**

After `sendPrompt`, add:

```typescript
  /** Resolve a pending Dispatch Order card: approve routes + dispatches, skip dispatches as-is. */
  private resolveDispatch(orderId: string, status: 'approved' | 'skipped' | 'dismissed'): void {
    const card = this.history.find(
      (i): i is Extract<UiItem, { kind: 'dispatchOrder' }> =>
        i.kind === 'dispatchOrder' && i.orderId === orderId,
    );
    if (card && card.status === 'pending') {
      card.status = status;
      this.broadcast({ type: 'dispatchResolved', orderId, status });
      this.schedulePersist();
    }
    const pending = this.pendingDispatch;
    if (!pending || pending.orderId !== orderId) return;
    this.pendingDispatch = undefined;
    if (status === 'dismissed') return;

    let prompt = pending.text;
    if (status === 'approved') {
      // Approval steers routing: name the approved gods so Zeus dispatches them,
      // and apply the recommended model tier (AGNT_031) for the whole turn.
      if (pending.advice.agents.length > 0) {
        const roster = pending.advice.agents.map((a) => `${a.emoji} ${a.name} (${a.domain})`).join(', ');
        prompt += `\n\n⚡ Approved dispatch order: engage ${roster} as subagents for their domains.`;
      }
      const rec = pending.advice.recommendation.claudeModel;
      if (rec && rec !== this.modelId && this.providers.active.id === 'claude') {
        void this.setModel(rec).then(() => this.dispatchPrompt(prompt, pending.attachments, false));
        return;
      }
    }
    void this.dispatchPrompt(prompt, pending.attachments, false);
  }
```

**[VERIFY]** `this.providers.active.id === 'claude'` — confirm the `ProviderManager` active-provider id string in `providerManager.ts` (it may be `'claude'` or `'claude-code'`). Use whatever literal that file defines.

- [ ] **Step 5: Wire the webview messages**

In the `attach()` message switch (line ~481), the incoming message type needs one new field. Add `orderId?: string;` to the inline message type annotation, then add two cases after `case 'permissionResponse'`:

```typescript
          case 'dispatchApprove':
            if (typeof msg.orderId === 'string') this.resolveDispatch(msg.orderId, 'approved');
            break;
          case 'dispatchSkip':
            if (typeof msg.orderId === 'string') this.resolveDispatch(msg.orderId, 'skipped');
            break;
```

- [ ] **Step 6: Budget warn + auto-stop in `turnDone`**

In the `turnDone` handler, directly after `if (event.costUsd !== undefined) this.totalCostUsd = event.costUsd;` (line ~1283), insert:

```typescript
        // Budget guardian: warn once at 80%, hard-notify at 100%. Enforcement
        // (blocking the next send) happens in sendPrompt, fail-closed.
        {
          const budget = readSessionBudget(this.workspaceRoot);
          const state = budgetState(this.totalCostUsd, budget);
          if (state === 'warn' && !this.budgetWarned) {
            this.budgetWarned = true;
            this.pushItem({
              kind: 'turnFooter',
              text: `— ⚠️ ~$${this.totalCostUsd.toFixed(2)} of $${budget!.toFixed(2)} session budget used —`,
            });
          } else if (state === 'exceeded') {
            this.pushItem({
              kind: 'error',
              text:
                `⛔ Session budget reached (~$${this.totalCostUsd.toFixed(2)} of $${budget!.toFixed(2)}). ` +
                `New prompts are blocked until you raise tokenBudget.sessionMaxCostUSD or start a new session.`,
            });
            try {
              appendSavings(this.workspaceRoot, {
                ts: new Date().toISOString(),
                type: 'budget_stop',
                detail: `session stopped at $${this.totalCostUsd.toFixed(2)} (ceiling $${budget!.toFixed(2)})`,
                costUsd: this.totalCostUsd,
              });
            } catch {
              // Ledger write is best-effort — never break a turn over it.
            }
          }
        }
```

- [ ] **Step 7: Clear pending state on stop/newSession**

Find the `stop()` and `newSession()` methods (search `private stop(` / `private newSession(`). At the top of each, add:

```typescript
    if (this.pendingDispatch) this.resolveDispatch(this.pendingDispatch.orderId, 'dismissed');
```

And in `newSession()` also reset the warn flag:

```typescript
    this.budgetWarned = false;
```

- [ ] **Step 8: Typecheck and existing tests**

```bash
cd extensions/vscode && npx tsc --noEmit && npx vitest run
```

Expected: clean typecheck; all existing tests still pass (the new UiItem variant is additive).

- [ ] **Step 9: Commit**

```bash
git add extensions/vscode/src/chat/chatViewProvider.ts
git commit -m "feat(chat): dispatch order gate + session budget enforcement in chat controller"
```

---

### Task 3: Webview — render the Dispatch Order card

**Files:**
- Modify: `extensions/vscode/src/chat/webview/chat.ts`
- Modify: `extensions/vscode/src/chat/webview/pantheon.css`

**Interfaces:**
- Consumes (from Task 2): the `dispatchOrder` UiItem shape, `dispatchResolved` broadcast, and the `dispatchApprove`/`dispatchSkip` postMessage contract — all exactly as defined in Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Sync the webview UiItem type**

In `chat.ts`, find the local `UiItem` union (mirror of the controller's) and add the same variant added in Task 2 Step 1. Also add a matching local interface:

```typescript
interface DispatchAdviceUi {
  classification: { mechanicalPct: number; creativePct: number; architecturePct: number; bulkPct: number };
  recommendation: { model: string; claudeModel: string; costMultiple: string; rationale: string };
  agents: Array<{ emoji: string; name: string; domain: string }>;
}
```

(the webview only renders — it needs no `key`/`score`/`codexModel`).

- [ ] **Step 2: Add the card builder**

Add after `buildGovernanceCard` (line ~578):

```typescript
function buildDispatchOrderCard(item: Extract<UiItem, { kind: 'dispatchOrder' }>): HTMLDivElement {
  const card = div('dispatch-order');
  card.dataset.orderId = item.orderId;

  const title = div('dispatch-order-title');
  title.textContent = `⚡ Dispatch Order — ${item.advice.agents.length || 'no'} specialist${item.advice.agents.length === 1 ? '' : 's'} matched`;
  card.appendChild(title);

  for (const god of item.advice.agents) {
    const row = div('dispatch-order-god');
    row.textContent = `${god.emoji} ${god.name} — ${god.domain}`;
    card.appendChild(row);
  }

  const model = div('dispatch-order-model');
  model.textContent = `Recommended: ${item.advice.recommendation.model} (${item.advice.recommendation.claudeModel}) · ${item.advice.recommendation.costMultiple}`;
  card.appendChild(model);

  const why = div('dispatch-order-rationale');
  why.textContent = item.advice.recommendation.rationale;
  card.appendChild(why);

  if (item.budgetLine) {
    const budget = div('dispatch-order-budget');
    budget.textContent = `~${item.budgetLine} (estimates vs flagship baseline)`;
    card.appendChild(budget);
  }

  const actions = div('dispatch-order-actions');
  if (item.status === 'pending') {
    const approve = document.createElement('button');
    approve.className = 'dispatch-approve';
    approve.textContent = '⚡ Approve & Execute';
    approve.addEventListener('click', () => {
      vscode.postMessage({ type: 'dispatchApprove', orderId: item.orderId });
    });
    const skip = document.createElement('button');
    skip.className = 'dispatch-skip';
    skip.textContent = 'Send as-is';
    skip.addEventListener('click', () => {
      vscode.postMessage({ type: 'dispatchSkip', orderId: item.orderId });
    });
    actions.appendChild(approve);
    actions.appendChild(skip);
  } else {
    const done = div('dispatch-order-status');
    done.textContent =
      item.status === 'approved' ? '✓ Approved — council dispatched'
      : item.status === 'skipped' ? '→ Sent as-is'
      : '· Superseded';
    actions.appendChild(done);
  }
  card.appendChild(actions);
  return card;
}
```

**[VERIFY]** `vscode` is the module-level result of `acquireVsCodeApi()` in `chat.ts` — reuse whatever identifier the file already uses for `postMessage` (check `buildPermissionCard` for the pattern).

- [ ] **Step 3: Wire `renderItem` and `dispatchResolved`**

In the `renderItem` switch (line ~320), add:

```typescript
    case 'dispatchOrder': {
      append(buildDispatchOrderCard(item));
      break;
    }
```

In the controller-message switch (line ~664 area, alongside `case 'godComplete'`), add:

```typescript
    case 'dispatchResolved': {
      const el = document.querySelector<HTMLDivElement>(
        `.dispatch-order[data-order-id="${msg.orderId}"]`,
      );
      if (el) {
        const actions = el.querySelector('.dispatch-order-actions');
        if (actions) {
          actions.innerHTML = '';
          const done = div('dispatch-order-status');
          done.textContent =
            msg.status === 'approved' ? '✓ Approved — council dispatched'
            : msg.status === 'skipped' ? '→ Sent as-is'
            : '· Superseded';
          actions.appendChild(done);
        }
      }
      break;
    }
```

**[VERIFY]** the message-handler's `msg` type annotation — extend it with `orderId?: string; status?: string;` the same way other cases access their fields.

- [ ] **Step 4: Styles**

Append to `pantheon.css` (follow the file's existing custom-property conventions — check how `.permission-card` and `.governance-card` are styled and match their spacing/radius variables):

```css
/* ── Dispatch Order — the pre-execution approval gate ─────────────────── */
.dispatch-order {
  border: 1px solid rgba(255, 215, 0, 0.45);
  border-radius: 8px;
  background: linear-gradient(160deg, rgba(255, 215, 0, 0.08), rgba(255, 215, 0, 0.02));
  padding: 12px 14px;
  margin: 8px 0;
}
.dispatch-order-title {
  font-weight: 600;
  color: #ffd700;
  margin-bottom: 6px;
}
.dispatch-order-god {
  padding: 2px 0 2px 8px;
  opacity: 0.95;
}
.dispatch-order-model {
  margin-top: 8px;
  font-weight: 500;
}
.dispatch-order-rationale {
  font-size: 0.9em;
  opacity: 0.75;
  margin-top: 2px;
}
.dispatch-order-budget {
  font-size: 0.85em;
  opacity: 0.7;
  margin-top: 6px;
}
.dispatch-order-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.dispatch-order-actions button {
  cursor: pointer;
  border-radius: 6px;
  padding: 6px 14px;
  border: 1px solid transparent;
  font-weight: 600;
}
.dispatch-approve {
  background: #ffd700;
  color: #1a1a1a;
}
.dispatch-approve:hover {
  filter: brightness(1.1);
}
.dispatch-skip {
  background: transparent;
  color: inherit;
  border-color: rgba(255, 255, 255, 0.25) !important;
}
.dispatch-order-status {
  opacity: 0.7;
  font-size: 0.9em;
}
```

(If `pantheon.css` defines shared variables like `--pantheon-gold`, use them instead of the literals.)

- [ ] **Step 5: Build the extension**

```bash
cd extensions/vscode && npm run build 2>&1 | tail -5
```

Expected: clean esbuild output for both the extension and webview bundles.

**[VERIFY]** the build script name — check `extensions/vscode/package.json` scripts (`build`, `compile`, or `esbuild`); use the one that bundles `dist/webview`.

- [ ] **Step 6: Commit**

```bash
git add extensions/vscode/src/chat/webview/chat.ts extensions/vscode/src/chat/webview/pantheon.css
git commit -m "feat(chat): render dispatch order approval card in the council chamber"
```

---

### Task 4: End-to-end verification

**Files:** none created — verification only.

- [ ] **Step 1: Full test + typecheck sweep**

```bash
cd extensions/vscode && npx tsc --noEmit && npx vitest run
```

Expected: 0 type errors; all tests pass including the 12 new dispatchAdvisor tests.

- [ ] **Step 2: Live advise smoke test**

```bash
cd /Users/MHolley/Desktop/thesmos-governance && npx tsx thesmos/bin/cli.ts advise --text="Build a Stripe payment flow with authentication and a checkout page UI" --json | head -30
```

Expected: JSON with `recommendation.claudeModel` and a non-empty `agents` array (Chrysos should match).

- [ ] **Step 3: Extension Development Host walkthrough**

Launch the Extension Development Host (F5 in `extensions/vscode`). In Pantheon Chat:

1. Set permission mode to **default**; send *"Build a Stripe payment flow with auth and a checkout page, and have security review it"* → Dispatch Order card appears (2 gods matched). Click **Send as-is** → prompt dispatches unchanged, card shows "→ Sent as-is".
2. Send a trivial prompt ("what files are in thesmos/rules?") → NO card (0–1 gods, non-auto mode); response streams normally.
3. Switch to **auto** mode (confirm the native warning dialog) → send any prompt → card ALWAYS appears. Click **⚡ Approve & Execute** → card shows "✓ Approved", model badge in the header reflects the recommended tier, response streams, gods dispatch.
4. Set `tokenBudget.sessionMaxCostUSD` to `0.01` in `.thesmos/config.json`, run one turn, then try another prompt → blocked with the ⛔ budget card. Raise the budget → send works again without a restart.
5. Reload the webview (close/reopen sidebar) → resolved cards persist and render inert (no live buttons).

- [ ] **Step 4: Commit any fixups, then final commit**

```bash
git add -A extensions/vscode
git commit -m "test(chat): dispatch order + budget enforcement verification fixups"
```

(Skip if the walkthrough needed no changes.)

---

## Self-Review Notes

- **Spec coverage:** Dispatch Order card ✅ (Tasks 1–3) · budget auto-stop ✅ (Task 2 Steps 3+6) · approval steers routing + model tier ✅ (Task 2 Step 4) · $0 deterministic advise ✅ (Task 1) · honesty contract ✅ (`~` prefixes, no fabricated per-phase dollars — the card shows the real cost multiple and real budget consumption only).
- **Deliberately out of scope (already exist):** usage bar, savings ledger, god model badges, governance cards, council export. **Deferred (needs stream support that doesn't exist):** per-god dollar attribution — the CLI stream carries no per-subagent cost; the god bubbles' existing model badge + elapsed time is the honest limit today.
- **Type consistency:** `DispatchAdvice`/`AdviceAgent` defined once in Task 1, imported in Task 2; webview uses its own narrowed `DispatchAdviceUi` mirror (webview file has no module imports from the extension host — it is a separate bundle).
- **[VERIFY] markers** (4) flag file-local details the implementer must confirm in-place: provider id literal, webview postMessage identifier, msg type annotation, build script name.
