# Audit — Billing-Aware Budget Guardian (Pantheon Chat)

**Date:** 2026-07-26 · **Branch:** `hardening/proof-gate-5.2` · **Status:** implementation ledger (updated as work lands)

## 1. Problem

Pantheon Chat treats Claude Code's cumulative `total_cost_usd` as actual billed spend in every
environment and hard-blocks new prompts when it crosses `tokenBudget.sessionMaxCostUSD`. For
subscription-authenticated sessions (Claude Pro/Max/Team/Enterprise OAuth logins) that number is an
**API-equivalent usage estimate**, not a charge — so Max users get blocked over money they were
never going to spend.

## 2. Where cumulative cost originates (traced)

| Step | Location | Fact |
|---|---|---|
| CLI emits | `extensions/vscode/src/chat/claudeSession.ts` (`case 'result'`) | `event.total_cost_usd` from the Claude Code CLI stream-json `result` event → `turnDone.costUsd`. The CLI computes this from token counts × its price table **regardless of auth mode** (OAuth subscription or API key). It is always an estimate of API-equivalent value; it is never verified billing data. |
| Controller stores | `chatViewProvider.ts` `case 'turnDone'` | `this.totalCostUsd = event.costUsd` (CLI reports cumulative session cost). Persisted in `workspaceState` (`PersistedChat.totalCostUsd`). |
| Enforcement | `chatViewProvider.ts` `sendPrompt()` | Re-reads `.thesmos/config.json` each send; `budgetState(totalCostUsd, budget) === 'exceeded'` → hard block ("⛔ Session budget reached"). No billing awareness. |
| Warning | `chatViewProvider.ts` `case 'turnDone'` | `budgetState` → 'warn' at 80% (once), 'exceeded' → error copy claiming "New prompts are blocked". |
| Policy fn | `dispatchAdvisor.ts` `budgetState()` | Pure `'ok' | 'warn' | 'exceeded'`, warn fraction hardcoded 0.8. |
| UI | `webview/chat.ts` `updateBudgetBar()` | Renders `$cost / $ceiling`; ceiling comes from `sessionBudgetUsd` broadcast — which was **read once in the controller constructor** (stale after config edits). Click opens the raw config file. |
| Codex path | `codexSession.ts` | `turn.completed` never carries cost → `costUsd` undefined → `totalCostUsd` never grows → budget logic inert for Codex sessions. |
| CLI hook (separate surface) | `thesmos/token-budget.ts` `runPostToolBudgetCheck()` | PostToolUse hook estimates cost from tokens × `modelCostTable` and exits 2 (hard stop) at the cost ceiling — same estimate-treated-as-spend issue, opt-in via `tokenBudget.enabled`. |

## 3. Provider authentication resolution (current)

`providerManager.ts` presets:

| Provider | Auth | Billing reality |
|---|---|---|
| `anthropic` | User's own Claude Code login. `envForActive()` returns `undefined` (no env override). The login may be **subscription OAuth** (Pro/Max/Team/Enterprise), **Console OAuth**, or an **API key** (`ANTHROPIC_API_KEY` / `apiKeyHelper`) — the extension cannot tell from the provider id alone. | Mixed — must not be assumed either way. |
| `codex` | `codex login` OAuth (ChatGPT subscription); no key ever touches the extension. | Subscription-shaped, but the CLI reports no cost at all. |
| `glm`, `kimi`, `deepseek` | API key in VS Code SecretStorage → `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` in child env. | Pay-per-token — metered. |
| `custom` | User-supplied Anthropic-compatible proxy URL + key. | Unknowable — the proxy may front a subscription, a metered account, or a local model. |

Available reliable signal for the `anthropic` preset: the CLI's `system/init` stream-json event
carries **`apiKeySource`** — the CLI's own report of how it authenticated. A key-ish value
(`user`/`project`/`org`/`temporary`/`ANTHROPIC_API_KEY`/`apiKeyHelper`) means an API key is billing
the session (metered). `"none"`/absent means an OAuth login — which is **either** a subscription
**or** a Console (metered) account, so it must resolve to `unknown`, not `subscription`.
This event was previously parsed but the field was dropped.

## 4. What can and cannot be distinguished

- **Reliably metered:** GLM/Kimi/DeepSeek linked keys (provider-auth), Anthropic sessions whose
  `apiKeySource` names a recognized key source (session-metadata).
- **Reliably subscription:** nothing automatic. OAuth (`apiKeySource: "none"`) is ambiguous between
  subscription and Console accounts. Only explicit user/workspace declaration confirms it.
- **Unknown:** custom proxies (always, unless the user classifies), Anthropic OAuth sessions before
  classification, unrecognized `apiKeySource` values, sessions that haven't started yet.
- **Codex:** the integration itself establishes subscription OAuth (`codex login`); classified
  subscription with confidence `inferred`. Moot for enforcement — no cost is ever reported.

## 5. Final decision table (implemented)

Resolution order (first match wins) — `resolveBillingContext()` in
`extensions/vscode/src/chat/billingContext.ts`:

1. `.thesmos/config.json` `tokenBudget.billingMode` = `subscription` | `metered` → that mode, `workspace-config`, `verified`.
2. Pantheon stored user selection (globalState, per provider) → that mode, `user-selection`, `verified`.
3. Provider auth: custom proxy → `unknown`; GLM/Kimi/DeepSeek with linked key → `metered`, `provider-auth`, `verified`; Codex → `subscription`, `provider-auth`, `inferred`.
4. Anthropic session metadata: recognized key-ish `apiKeySource` → `metered`, `session-metadata`, `verified`; `"none"` / unrecognized / absent → `unknown`.
5. Fallback → `unknown`.

Budget policy matrix — `decideBudget()` in `extensions/vscode/src/chat/budgetPolicy.ts`
(pure, deterministic, unit-tested; UI never reimplements it):

| Billing mode | Under warning | Over warning | Over limit |
|---|---|---|---|
| Subscription (**`verified` only**) | continue (`none`) | advisory (API-equivalent copy) | **continue** with advisory — never blocks |
| Metered | continue | warning at `warnAtFraction` (default 0.8) | **block** (fail-closed), unblocks immediately when ceiling raised or mode reclassified |
| Unknown | continue | advisory (unverified-billing copy) | continue + request classification — never silently becomes either mode |

**Confidence gate:** the Subscription row applies only at `confidence: 'verified'` (workspace config,
explicit user selection, or provider auth metadata). An *inferred* subscription — the `codex login`
heuristic — takes the **Unknown** row instead. An inference is a display label, not a billing fact:
it must never trigger *or disable* monetary enforcement. Correspondingly, the verified-metered check
is evaluated **before** any inference, so a verified metered signal can never be outranked.

Subscription advisory threshold: `tokenBudget.subscriptionWarningEquivalentUSD` (falls back to
`sessionMaxCostUSD` if unset). Invalid inputs sanitized: non-finite/negative cost → 0;
non-finite/≤0 limits → no limit; `warnAtFraction` outside (0,1) → 0.8.

## 6. Defects fixed alongside (found during trace)

- **Queue bypass:** `drainQueue()` dispatched queued prompts without re-checking the budget — a
  queued prompt could run after a metered ceiling was reached mid-turn. Now re-checked per dequeue.
  The durable fix is a **single choke point** in `dispatchPrompt()`: every path that reaches the CLI
  (direct send, approved *or* skipped dispatch order, dequeued prompt, resumed session) runs the
  billing decision there, so a ceiling or classification change between gating and dispatch cannot be
  bypassed. `sendPrompt`/`drainQueue` still check earlier purely for UX (error before queueing);
  `dispatchPrompt` is the check that guards the wire.
- **Stale billing mode across provider switch:** switching providers kept the previous provider's
  `apiKeySource`, so the budget bar could report the old provider's billing mode. Now cleared and
  re-classified on switch.
- **Stale ceiling display:** `sessionBudgetUsd` was read once in the controller constructor and
  broadcast forever; raising the ceiling updated enforcement but not the bar. Now re-read per status broadcast.
- **Schema drift:** runtime reads `tokenBudget` (and `routing`, `context1M`, `reviewIgnorePaths`,
  `name`, `version`) but `thesmos/config.schema.json` (`additionalProperties: false`) defined none of
  them — the repo's own live config failed its own schema. All added with descriptions/validation.
- **CLI hook parity:** `thesmos/token-budget.ts` cost-based hard stop (exit 2) now applies only when
  `billingMode` is explicitly `metered`; `auto`/`subscription` degrade to an advisory alert with
  classification guidance. The token-count ceiling (`sessionMaxTokens`) still hard-stops in all modes
  (it is usage governance, not a billing claim). Old configs without `billingMode` are treated as
  `auto` → advisory — per the migration rule that an old config must not be reinterpreted as
  confirmed metered billing.

## 7. Acceptance-criteria evidence

Filled in at completion — see §9 Validation.

- Subscription never blocked on estimate: `decideBudget` matrix + controller gate only blocks on
  `enforcement === 'block'`; policy tests `subscription above configured ceiling → advisory/continue`.
- Metered keeps configurable hard ceiling: matrix row + controller tests; raise-ceiling path re-reads
  config per send and per queue-drain.
- Unknown stays advisory + asks for classification: matrix row + budget-bar quick-pick actions
  (Set as subscription / Set as metered API / Open config / Raise ceiling / New session).
- UI identifies mode: budget bar label `Subscription · ~$x API equivalent · Advisory only` /
  `Metered API · ~$x / $y` / `Billing unknown · ~$x estimated`; `role="button"`, `tabindex=0`,
  `aria-label`, Enter/Space activation; CSP unchanged (no inline scripts).
- Language: all copy says "API-equivalent usage estimate" (subscription) / "estimated metered
  usage" (metered) / never "charged"/"actual".
- Old configs compatible: `sessionMaxCostUSD`-only configs parse unchanged; absent `billingMode` = `auto`.
- No secrets: billing context carries only a boolean `hasLinkedKey`; keys never leave SecretStorage;
  no key material in messages, labels, logs, or persisted state.

## 8. Files changed

New:
- `extensions/vscode/src/chat/billingContext.ts` — BillingMode/BillingContext types, `resolveBillingContext()` (pure), `ProviderBillingCapability` contract.
- `extensions/vscode/src/chat/budgetPolicy.ts` — `decideBudget()` (pure matrix), `parseTokenBudgetSettings()`/`readTokenBudgetSettings()` (config compat + sanitization).
- `extensions/vscode/src/chat/budgetBarModel.ts` — pure, browser-safe budget-bar view model (labels, tooltip, aria).
- Tests: `budgetPolicy.test.ts`, `billingContext.test.ts`, `budgetBarModel.test.ts`,
  `claudeSession.test.ts`, `budgetEnforcementPaths.test.ts` (9 end-to-end dispatch-path tests) in
  `extensions/vscode/src/__tests__/`; `thesmos/config-schema.test.ts`.

Modified:
- `extensions/vscode/src/chat/claudeSession.ts` — surface `apiKeySource` from the CLI init event.
- `extensions/vscode/src/chat/providerManager.ts` — billing selection storage (globalState, per provider) + `detectBillingContext()`.
- `extensions/vscode/src/chat/chatViewProvider.ts` — billing-aware gates in `sendPrompt`/`drainQueue`, post-turn notices, budget-bar action menu (classify/raise/open/new), fresh ceiling in every status frame, `apiKeySource` persistence, accessible budget-bar HTML.
- `extensions/vscode/src/chat/dispatchAdvisor.ts` — removed superseded `budgetState` (single source of truth: `decideBudget`).
- `extensions/vscode/src/chat/webview/chat.ts` + `pantheon.css` — mode chip, model-driven bar, Enter/Space activation, focus outline.
- `thesmos/token-budget.ts` + `token-budget.test.ts` — cost hard-stop gated on `billingMode: 'metered'`; advisory copy for subscription/auto; token ceiling unchanged; 6 new tests.
- `thesmos/types.ts`, `thesmos/init.ts`, `thesmos/config.schema.json` — new tokenBudget fields, init template, full schema definition (+ `name`, `version`, `routing`, `context1M`, `reviewIgnorePaths` drift fixes).
- `extensions/vscode/README.md`, `CHANGELOG.md` — billing-mode documentation and release-notes draft.

Not changed: `.thesmos/config.json` — the Thesmos guard correctly blocks agents from editing
governance config (scope rule). Absent `billingMode` already means `auto`, so behavior is
identical; adding `"billingMode": "auto"` explicitly is an optional manual edit.

## 8b. Working-tree / branch reconciliation (2026-07-27)

The implementation exists in two places and they had **diverged**. Recorded because the divergence
silently dropped enforcement behavior:

| | Working tree (uncommitted) | Branch `fix/billing-aware-budget-guardian` (`cb97343`) |
|---|---|---|
| Timestamp | files mtime 21:27–21:28, 2026-07-26 | commits 22:43, 2026-07-26 |
| Base | `a8132c3` (incl. config-repair hatch) | `d89b7c8` |
| Status | earlier draft | **refined final state** |

The branch is ~75 min newer and was never merged back. Relative to it, the working tree was missing:

1. the `dispatchPrompt()` choke-point billing check (§6) — without it, approved/skipped dispatch
   orders and resumed sessions bypass a reached metered ceiling;
2. the `confidence === 'verified'` gate on the subscription exemption (§5) — without it an *inferred*
   subscription disables monetary enforcement;
3. evaluation of verified-metered **before** inference;
4. `apiKeySource` reset on provider switch;
5. `budgetEnforcementPaths.test.ts` entirely (9 tests);
6. the `Uri.joinPath` mock those tests depend on.

**Resolution:** the branch version of all 7 divergent files was restored into the working tree; all 15
billing-related files now byte-match `cb97343`. The `a8132c3` config-repair-hatch work is untouched
(disjoint files). Verified green after restore. The branch and its worktree are retained as the
record — neither was deleted.

## 9. Validation (re-run 2026-07-27 after reconciliation)

- `npm run typecheck` — all three workspaces pass.
- `npm run build` — thesmos, actions/pr-review, extension (incl. webview + hook bundles) pass; dist regenerated.
- Extension tests: **16 files, 189 passed, 0 failed** — up from 15/174 before reconciliation
  (+1 file, +15 tests recovered from the branch, incl. the 9 dispatch-path enforcement tests).
- Core tests: **120 files — 119 passed; 4075 passed / 75 failed**, all 75 in
  `rules/__fixtures__/blocker-fixture-harness.test.ts` — pre-existing WIP from the proof-gate-5.2
  branch (file + fixtures were modified/untracked before this task; verified via `git stash` that
  HEAD passes 20/20 and this task's diff does not touch that harness). New suites pass: 31/31.
- `npm run thesmos:validate` — exit 0, no BLOCKER (7 TECH_DEBT, 44 baseline suppressed).
- Core tests: the 75 failures in `rules/__fixtures__/blocker-fixture-harness.test.ts` are the
  **Phase 2 worklist** of the proof-gate-5.2 branch, not noise from this task — see
  `2026-07-25-proof-gate-5.2.md` §2. This task's diff does not touch that harness.

## 10. Remaining limitations

- An Anthropic OAuth login cannot be automatically distinguished between a subscription account and
  a Console (metered) account — those sessions surface as `unknown` until the user classifies them
  once (persisted per provider). This is deliberate: `unknown` never silently becomes either mode.
- Custom proxies are always `unknown` unless explicitly classified.
- Codex sessions report no cost; the guardian is display-only there.
- Provider-side subscription usage limits (e.g. Claude weekly limits) are separate from this
  estimate and still apply — copy says so.
