# Handoff — Pantheon Chat Model Truth (deferred PR 3)

**Date:** 2026-08-03
**Status:** Specified, not implemented. Blocked on a base that does not yet exist.
**Depends on:** PR #135 (model registry engine), PR #130 (Pantheon Chat experience), PR #121 (Budget Guardian).

---

## 1. Why this is deferred rather than done

Workstream 3 of Operation Eunomia requires editing files that **exist on no single branch**. Verified with `git cat-file -e <ref>:<path>` on 2026-08-03:

| Required file | `origin/main` | PR #130 | PR #121 |
|---|:--:|:--:|:--:|
| `chat/turnCards.ts` | ❌ | ✅ | ❌ |
| `chat/assistantRouting.ts` | ❌ | ✅ | ❌ |
| `chat/streamProtocol.ts` | ❌ | ✅ | ❌ |
| `usage/subscriptionUsage.ts` | ❌ | ✅ | ❌ |
| `chat/billingContext.ts` | ❌ | ❌ | ✅ |
| `chat/budgetPolicy.ts` | ❌ | ❌ | ✅ |
| `chat/claudeSession.ts` | ✅ | ✅ | ✅ |
| `chat/chatViewProvider.ts` | ✅ | ✅ | ✅ |
| `chat/savingsLedger.ts` | ✅ | ✅ | ✅ |

Mapping the mission's requirements onto that table:

- "turn summary must use the actual effective model" → `turnCards.ts` — **#130 only**
- "agent bubbles distinguish catalog default from runtime model" → `assistantRouting.ts` — **#130 only**
- "actual model reported by the session init event" → `streamProtocol.ts` — **#130 only**
- "preserve the turn-idempotency and single-card work" → **#130 only**
- "subscription mode must not hard-block on estimated API spend" → `budgetPolicy.ts` — **#121 only**

Delivering all of it in one PR would require merging #121 and #130 together, which the mission explicitly forbids ("Do not silently broaden or merge an existing PR"). Writing the #130-only files fresh on a main-based branch would duplicate them and guarantee a hard conflict.

**Therefore:** PR #135 carries the *engine*; this document specifies the *UI*.

---

## 2. What already shipped in PR #135 (do not rebuild)

The chat UI does **not** need to compute any of this — it consumes it.

| Capability | Where | Notes |
|---|---|---|
| Canonical model ids + display names | `thesmos/models/registry.ts` | `displayName` gives "Sonnet 5", "Opus 5", "Fable 5", "Haiku 4.5" |
| Requested vs effective model | `ModelRouteDecision.requestedModelId` / `.effectiveModelId` | `effectiveModelId` is `null` until the runtime reports |
| Mismatch detection | `hasModelMismatch(decision)` | true only when effective differs from requested |
| Fallback record | `ModelRouteDecision.fallback` → `{ from, to, reason }` | `null` when no fallback occurred |
| Approval state | `ModelRouteDecision.approval` | `not-required` / `granted` / `required-but-missing` |
| Reason codes | `ModelRouteDecision.reasonCodes` | e.g. `frontier-denied-no-approval` |
| Human-readable explanation | `explainDecision(decision)` | one line, includes MISMATCH when present |
| Cost, or explicit unknown | `costFor(id, in, out, at)` → `{ known: true, costUsd }` or `{ known: false, reason }` | **never fabricates a price** |
| Savings vs baseline | `savingVsBaseline` / `estimateTierSavingFromCost` | Fable returns a **negative** value (premium) |
| Display formatting | `formatSaving(result)` | returns `"unknown"` when not known |
| Attaching to receipts | `toModelDecisionReceipt(decision)` | flattened, version-stable |

---

## 3. Branch topology for PR 3

```
origin/main
 └── feat/pantheon-experience        (PR #130, head a911c715)
      └── feat/pantheon-chat-model-truth   ← cut from #130's VERIFIED head
```

Cut from `a911c715`, **not** from `main`, so the diff shows only the model-truth delta and #130's turn-idempotency and single-card work is preserved rather than reimplemented.

Target the PR at `feat/pantheon-experience`, not `main`.

Because the extension bundles independently of the engine, registry data must reach it the same way `pantheon-models.ts` does — as a **generated artifact**, not a cross-workspace import. Add a `model-registry` emitter to `thesmos/scripts/export-agents.ts` writing `extensions/vscode/src/generated/model-registry.ts`, and have `savingsLedger.ts` read that instead of its hardcoded `2/3` and `4` constants. That satisfies "derive both extension and core calculations from generated registry data".

---

## 4. Required behaviour

### 4.1 Model names — always explicit generation

Never render "Opus" or "Sonnet" bare. Use `registry.displayName` plus the role suffix:

```
Sonnet 5  — Default
Opus 5    — Complex
Fable 5   — Exceptional / approval required
Haiku 4.5 — Mechanical
```

### 4.2 Requested vs effective

When routing changes the model, show all four: requested model, actual model from the session init event, the fallback if any, and the routing reason. If `hasModelMismatch(decision)` is true, the mismatch must be **visible**, not folded into a tooltip.

The **turn summary must use `effectiveModelId`**, never the recommendation. If `effectiveModelId` is `null`, say "awaiting runtime confirmation" — do not display the requested model as though it were confirmed.

### 4.3 Agent bubbles

Distinguish the agent's **catalog default** (from `PANTHEON_MODELS`) from the **actual runtime model** (from the decision). When they differ, both are shown; the runtime value wins visually.

### 4.4 Fallback is never silent

- Fable unavailable → fall back to Opus 5, record and display the reason.
- Opus 5 unavailable → fall back to Sonnet 5, record and display the reason.
- Every fallback renders its `from → to` and `reason`.

### 4.5 Fable requires an approval card

Selecting Fable must present an approval card that captures `approvedBy`, `reasonOpusInsufficient`, and `approvedAt` — the three fields `FrontierApproval` requires. Without all three, `selectProfile` already returns `deep-reasoning` with `approval: 'required-but-missing'`; the UI must show that denial rather than appearing to honour the selection.

### 4.6 CLI version

Check the installed Claude Code version and give a **precise** upgrade message when it cannot expose the configured model.

⚠️ **Constraint:** the registry currently records `minCliVersion: null` for every model, because no verified minimum was available at the time of writing. `checkCliVersion` therefore stays silent by design — inventing a threshold would produce confidently wrong upgrade advice.

**To implement this properly:** verify the actual minimum versions, add them to the registry entries, and the check activates automatically. Until then, the *empirically reliable* signal is already available and needs no version number: if the session init event reports a model other than the one requested, that is a real, observed capability gap — surface it as a mismatch.

### 4.7 Subscription vs metered billing

These must remain distinct:

- **Subscription mode** — advisory only. Must **not** invent per-token charges, and must **not** hard-block on estimated API cost.
- **Metered API mode** — may use verified price data from the registry.
- **Unknown pricing** — renders `"unknown"`. Never a substituted estimate.

The hard-block logic lives in `budgetPolicy.ts`, which exists **only on PR #121**. That piece belongs to #121 and is recorded as a note against it, not reimplemented here.

The core engine already refuses to fabricate: `calcCost` returns `null` for unknown models, `TokenEvent.costKnown` marks the event, and `BudgetReport.unknownCostEvents` makes totals a stated lower bound.

### 4.8 Preserve PR #130's work

Do not reintroduce duplicate responses or multiple history entries. The turn-idempotency and single-card behaviour on #130 is a prerequisite, not a starting point.

---

## 5. Tests PR 3 must add

1. Chat shows both requested and effective model.
2. A mismatch is visibly rendered, not hidden.
3. A fallback renders `from → to` and the reason.
4. Turn summary uses the effective model, never the recommendation.
5. Agent bubble distinguishes catalog default from runtime model.
6. Selecting Fable without full approval shows the denial.
7. Subscription mode does not hard-block on estimated API spend.
8. Unknown pricing renders `"unknown"`, never a number.
9. Fable savings render as a **premium**, not as zero or unknown.
10. Existing duplicate-response tests still pass (regression guard on #130).

---

## 6. Exact next action

```bash
git fetch origin
git checkout -b feat/pantheon-chat-model-truth a911c715   # PR #130's verified head
# implement §4, add §5 tests
gh pr create --draft --base feat/pantheon-experience
```

Re-verify `a911c715` is still #130's head before branching — if #130 has moved, cut from its current head instead and note the change.

---

## 7. Residual risk

- **#130 is still a draft.** If its files change, this spec's file-level assumptions need re-checking. The behavioural requirements in §4 are stable regardless.
- **The `budgetPolicy.ts` hard-block fix cannot be done here** without pulling in #121. It is recorded as a note against #121.
- **No verified `minCliVersion` exists for any model.** §4.6 is partially blocked on external verification, and the honest interim behaviour is documented above.
