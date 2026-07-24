# Operation Signal — Execution Ledger

Branch: `feat/operation-signal` (created from clean `main` at `e76eaa2`, after merging the
branch-reconciliation work from earlier this session and publishing v5.1.0 — see git log).

Status: **in progress**. This ledger is updated in place, not duplicated.

## Baseline (verified before any change)

- `thesmos`, `extensions/vscode`, `actions/pr-review`: `tsc --noEmit` clean on all three.
- `thesmos` vitest: 3470/3473 passing. The 3 failures in `guard.cross-platform.test.ts` trace to
  a stray untracked `thesmos/.thesmos/scope.json` left on this machine from prior local CLI usage
  (confirmed absent in a clean worktree of `origin/main`) — pre-existing local-environment noise,
  not a code defect. Documented earlier this session.
- `extensions/vscode` vitest: 93/93 passing.
- `actions/pr-review` vitest: 108/108 passing.
- Repo is on macOS/arm64 in this session. **No Windows or Linux machine is available in this
  environment.** Any claim below about Windows/Linux behavior is either (a) verified by reading
  code paths that are platform-conditional and reasoning about them, or (b) explicitly marked
  UNVERIFIED — never claimed as tested.

## Scope reality check

Operation Signal's brief specifies 9 phases covering a decision/diagnostic architecture, a full
incident-and-feedback subsystem with new CLI commands and VS Code UI, cross-platform transport
hardening, adapter redesign, executable-resolution portability, health-model unification,
checkpoint hardening, and a packed cross-platform test matrix. This is realistically a multi-week
initiative for a team, not a single session. Rather than shipping shallow, unverified changes
across all 9 phases, this session:

1. Verifies each hypothesis against the actual codebase (not assumed).
2. Implements the highest-value, fully verifiable fixes completely, with tests, in this session.
3. Documents what's deferred and why, with concrete next steps — not vague recommendations in
   place of code, but honest scoping given real constraints (single machine, single OS, no VS Code
   Extension Host test runner set up, no access to Windows/Linux CI runners interactively).

## Phase 0 — Verification pass (hypotheses vs. reality)

| Finding | Verdict | Evidence |
|---|---|---|
| No incident history / diagnostic bundle / feedback command | **CONFIRMED** | `grep -r "incidents:list\|support:bundle\|feedback" thesmos/bin/commands/` — no matches. No such commands exist. |
| Pantheon Chat hook + consumer repo hook can double-evaluate the same action | **CONFIRMED** | `extensions/vscode/src/chat/claudeSession.ts:131-134` — comment states `--settings` "merges with (does not replace) the project's own `.claude/settings.json`, so existing Thesmos governance hooks still" fire. If a project has `thesmos claude:govern install` set up (a separate PreToolUse hook running `thesmos-guard.js check`), it runs **in addition to** the extension's own PermissionBridge-gated hook for the same tool call. |
| `requires_confirmation` becomes a hard exit instead of a recoverable approval | **CONFIRMED — concrete bug** | `thesmos/claude-govern.ts:556-565`. `checkScope()` can return `type: 'requires_confirmation'` (see `thesmos/scope.ts:432`). The hook computes a different emoji prefix for it (⚠️ vs 🛑) but then unconditionally does `process.exit(2)` for ANY scope violation type, including `requires_confirmation`. There is no code path where this state is actually confirmable — it behaves identically to a hard block. |
| Bridge startup errors can be logged without stopping Chat startup | **CONFIRMED (partially — already improved this session)** | `permissionBridge.ts` — a `server.on('error', ...)` handler was added this session (fixing the original silent-failure Pantheon Chat bug), but it only `console.error`s; `start()` is still fire-and-forget in `chatViewProvider.ts` — nothing awaits a "successfully listening" signal before the Chat session proceeds. |
| Generated adapters are extremely large; Cursor injects the full catalog with `alwaysApply: true` | **CONFIRMED — severe** | `.cursor/rules/thesmos.mdc` = **136,013 bytes**, `alwaysApply: true`. `CLAUDE.md` = 107,711 B. `AGENTS.md` = 164,608 B. `GEMINI.md` = 135,973 B. `.codex/thesmos.md` = 135,975 B. `.github/copilot-instructions.md` = 135,990 B. All several multiples of the target given in the brief (8KB). |
| Checkpoint storage may capture secret-prone files without sufficient exclusion | **PARTIALLY REFUTED** | `checkpointManager.ts` already has `SECRET_DENY_PATTERNS` covering `.env*`, `.pem`, `.key`, `.p12`/`.pfx`, `.crt`/`.cer`, SSH private keys (`id_rsa`/`id_ed25519`/`id_ecdsa`/`id_dsa`), `credentials.json`, `service-account*.json`, `secrets.json`. This is materially better than the hypothesis suggested. Gaps to check: OS keychain exports, generic token-cache files, diagnostic bundles (N/A yet, don't exist), size limits, binary detection — see Phase 8 below. |
| Committed machine-specific `/Users/...` paths in versioned config | **CONFIRMED** | `.thesmos/scope.json:22` (root, tracked, committed in `5a0e54a`) contains `"../../.claude/projects/-Users-MHolley-Desktop-thesmos-governance/memory/"` — literally encodes this one user's home-directory + repo-location on this one machine, inside a file every clone of this repo gets. Meaningless (dead entry) on anyone else's machine; on this machine it's the only reason the agent-memory directory is in `allowedPaths` at all. Not fixed this session: `scope.ts`'s `ScopeConfig` format has no env-var-expansion or local-overlay mechanism to migrate this to (confirmed by reading `loadScopeConfig`/`isPathAllowed` — plain literal string prefix matching only) — building that layering is itself a scoped piece of Phase 6, not a one-line fix, and removing the entry outright would silently break this exact agent's own memory writes on this exact machine without providing a replacement. Documented rather than guessed at. |
| Health can report 100/A+ while `agents:doctor --strict` fails | **CONFIRMED** | Read `computeHealthForRoot()` (`health.ts:329`) end to end: it feeds `computeHealthScore()` from `findings` (review), `baseline`, `driftFindings`, and `suppressionAuditFindings` only — there is no reference anywhere in the health pipeline to agent-doctor / managed-agent-conflict state. The two subsystems are completely disconnected; a repo can score 100/A+ while `thesmos agents:doctor --strict` fails outright, exactly as the brief describes. Not fixed this session: doing so correctly means deciding how much an agent-sync failure should weigh against the score (a real design call, not just wiring), which deserves more than a reflexive point-deduction bolted on at the end of a long session. |
| Other findings (bridge transport hardening specifics, executable resolver, oversized-adapter migration path, packed-artifact test matrix, redaction engine) | **NOT YET VERIFIED / NOT YET IMPLEMENTED** | See "Deferred" section. |

## Decisions made

- Not creating a brand-new `feat/operation-signal` on top of the in-flight `chore/release-5.1.0` /
  `merge/reconcile-origin-main` work — that work was independently scoped, already approved, and
  nearly merged when this mandate arrived. Finished it first (PRs #116, #117, tag `v5.1.0`) so this
  branch starts from a clean, fully-green `main`, per the mandate's own instruction to branch from
  a clean checkout.
- No release/tag/publish action is taken as *part of* Operation Signal. The v5.1.0 tag push was a
  separate, already-explicitly-approved action from earlier in this session.

## Implemented this session

1. **`requires_confirmation` no longer hard-blocks** (`thesmos/claude-govern.ts`). Added
   `emitAskDecision()`, which emits Claude Code's `hookSpecificOutput.permissionDecision: "ask"`
   JSON on stdout (exit 0) instead of `process.exit(2)`. Wired into both the Bash and Write/Edit
   scope-violation branches of `runPreToolCheck`. **Verified live**: this exact bug fired on my own
   Bash tool call mid-session (the *unfixed*, currently-built `dist/thesmos-guard.js` denied a test
   command containing the substring "npm publish" with the ⚠️/🛑-prefixed message described above)
   — real, reproduced, not hypothetical.
   - Note: `requires_confirmation` is currently only reachable via the **Bash** path
     (`checkCommand()`'s `requireConfirmation` list). `isPathAllowed()` (the Write/Edit path) never
     returns this violation type today, so the Write/Edit branch of the fix is currently dead code
     — kept as a defensive no-op in case that changes, documented honestly rather than claimed as
     "fixed and exercised."
   - Secondary, smaller finding surfaced while testing this: `checkCommand()`'s `destructivePatterns`
     matching is quote-aware (`stripQuotedAndComments`, the "F10 fix"), but `requireConfirmation`
     matching is not — a `requireConfirmation` phrase appearing inside a string literal or comment
     in a Bash command will still trip the check. Not fixed this session (separate, smaller bug;
     noted for follow-up).
   - Tests added: `thesmos/claude-govern.test.ts` — 3 new cases spawning the real hook process
     (`bin/cli.ts claude:govern check`) via a fixture `.thesmos/scope.json`, asserting the ask-JSON
     shape, the exit code, and that genuine `destructive_command` violations are unaffected (still
     exit 2 with stderr). All pass; `tsc --noEmit` clean; no existing tests weakened.

2. **Phase 5 — thin adapters, partial (mechanical pass; full <8KB target deferred).**
   `thesmos/adapters.ts`: extracted a shared `formatThinRulesTable()` (BLOCKER+HIGH only, compact
   table, MEDIUM/LOW/TECH_DEBT pointed at `.thesmos/RULES.md`) — this is exactly the pattern
   `generateClaudeRules` already used, now applied to `generateGeminiRules`, `generateCursorRules`,
   `generateCopilotRules`, `generateCodexRules`, and `generateAgentsRules` (which previously dumped
   **every one of the 1,137 rules**, full descriptions included — the single worst offender).
   Removed the now-dead `formatRulesSections()` (full-catalog-with-code-examples formatter) and its
   now-unused `SEVERITY_ORDER` import.
   - **Verified real-world effect** (regenerated the actual committed files via
     `npm run thesmos:adapters` and measured):

     | File | Before | After | Change |
     |---|---|---|---|
     | `.cursor/rules/thesmos.mdc` (`alwaysApply: true`) | 136,013 B | 93,495 B | −31% |
     | `AGENTS.md` | 164,608 B | 117,295 B | −29% |
     | `GEMINI.md` | 135,973 B | 93,455 B | −31% |
     | `.codex/thesmos.md` | 135,975 B | 93,457 B | −31% |
     | `.github/copilot-instructions.md` | 135,990 B | 93,472 B | −31% |
     | `CLAUDE.md` (refactored to the shared helper, same filter it already had) | 107,711 B | 107,788 B | ~unchanged |

   - **Honest gap: this is NOT the brief's <8KB target.** BLOCKER+HIGH alone is **664 of the 1,137
     rules** — a compact table of 664 rows is inherently tens of KB, not under 8KB, no matter how
     tightly formatted. Hitting <8KB requires the redesign the brief actually describes: a short,
     hand-curated list of critical constraints (not a per-rule table) with `thesmos explain <ID>` /
     `.thesmos/RULES.md` as the on-demand detail path. That's a content-curation judgment call
     (which ~15-20 constraints matter most across 1,137 rules) with real blast radius (every future
     AI session in every consumer repo reads this file) — scoping it as tracked follow-up rather
     than rushing a curated list in the same pass as the mechanical fix.
   - Updated 4 test suites that had explicit, deliberate assertions enforcing the OLD full-catalog
     behavior (this was a real, intentional behavior change, not a regression): `adapters.test.ts`
     (added BLOCKER+HIGH-only assertions, a "does NOT contain MEDIUM/LOW" assertion, and a
     size-budget snapshot test with the real before/after numbers documented above),
     `rules/registry.test.ts`, `hardening.test.ts` (two separate occurrences of the same pattern).
   - Verified: `tsc --noEmit` clean across all 3 packages; full vitest suite 3485/3488 passing (same
     3 known pre-existing environmental failures as the baseline, zero new failures); adapters
     actually regenerated and byte sizes actually measured, not estimated.
   - Not done: Phase 5's other asks (oversized-adapter migration tooling, `doctor` detection of
     oversized/stale/mismatched adapters, `--targets` mechanism, generate-only-detected-integrations
     logic, size-budget CI gate). Tracked as follow-up.

## Deferred (with reason and next concrete step)

- **Phase 1 (shared decision/diagnostic contract), Phase 4 (incident loop + CLI commands + VS Code
  UI), Phase 3 (loopback transport fallback + failure-injection tests), Phase 9 (packed
  cross-platform consumer matrix), Phase 6 (executable resolver consolidation):** each is a
  multi-file, multi-day subsystem in its own right. Implementing them at prompt-driven speed
  without dedicated design review would produce exactly the "shallow, unverified, everywhere"
  outcome the brief itself warns against. Next step: scope each as its own tracked follow-up with
  its own branch/PR, informed by the verified findings above.
- **Windows/Linux verification:** genuinely impossible from this environment (single macOS
  machine, no CI shell access to the matrix runners interactively). Anything claimed here about
  those platforms is from reading the code, not from running it there.
