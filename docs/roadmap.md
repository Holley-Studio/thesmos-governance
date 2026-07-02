# Thesmos Roadmap — Honest Gap Register

Last updated: 2026-07-02 · Verified against: 1,137 rules, 2,824 tests (thesmos suite), post-Themis Rising (PRs #55/57/58/59) and Golden Beacon (this operation).

This is the unvarnished list. Every gap here is real, not a strawman we've already solved. No item claims false urgency — effort and owner are estimates, not commitments.

## Engine

| Gap | Why it matters | Effort | Owner |
|---|---|---|---|
| **ai-verify module** | Deferred from Themis Rising Phase 4e — LLM-verifies medium/low-confidence findings before they'd gate, demotes refuted ones with reasoning attached. Turns the regex engine's known weakness into a paid differentiator no competitor has. | Medium (1 module + security review) | Argus, next PR |
| **AST/data-flow detection for top-20 rules** | The real long-term false-positive killer. Current detection is line/pattern regex (honestly documented in README + docs/gating.md). Confidence tiers and diff-aware gating mitigate the symptom; AST fixes the cause for the highest-traffic rules (SQL injection, SSRF, XSS shapes). | Large (own operation — tree-sitter or TS compiler API integration) | Unassigned |
| **20 untested core modules** | `mcp-server.ts` (35KB), `brain.ts`/`brain-learn.ts`/`brain-store.ts`, `vault.ts`, `license.ts`, `agent-audit.ts` (tamper-evident log), `governance-log.ts`, `sarif.ts`, `lang-server.ts`, `profile.ts`, `prompt-engine.ts`, `claude-govern.ts`, `incremental-cache.ts`, `osv-client.ts`, and 7 more. `vault.ts`/`license.ts` touch money paths — prioritize those two first. | Medium per module | Unassigned |
| **Checks API integration** | vs.html implies GitHub Checks API; the action currently uses annotations + issue comments, not `checks.create`. Nicer PR UI, would also make NEW/PRE-EXISTING buckets render as native check annotations. | Small-medium | Talos, candidate next |
| **LIC_001 GPL-dep line attribution** | Talos noted this during Themis Rising 4a/4b review — a PR adding a GPL dependency currently surfaces only in the non-blocking pre-existing section because the finding has no line number. Needs rule-side fix in `thesmos/rules/license.ts`, touches baseline fingerprints. | Small | Argus, has full context already |
| **Auto-baseline maintenance** | Baseline drift causes "new" findings on unrelated PRs. Full automation (bot-commits `baseline:update` on merge) needs a bypass for the push-protected main branch. Partial mitigation: `thesmos doctor` staleness warning already shipped. | Medium | Unassigned |

## Product surface

| Gap | Why it matters | Effort | Owner |
|---|---|---|---|
| **VS Code extension not published to marketplace** | 1.8.0 built and committed, never `vsce publish`'d. Buyers get it via ZIP only. | Trivial (manual publish step) | User, pending |
| **Gumroad products not live** | Full Pantheon ($79), Founders/Agencies verticals ($49 each) — ZIPs built in `dist-packs/`, never uploaded. Starter is the only thing actually purchasable/downloadable right now. | Trivial (manual upload) | User, pending |
| **Public "Pantheon Council" GPT not listed** | Free top-of-funnel GPT for the GPT Store — file exists (`pantheon/exports/chatgpt/pantheon-council-free-gpt-store.txt`), never published as a GPT. | Trivial (manual GPT Store step) | User, pending |
| **Cursor marketplace plugin** | Cursor's Feb 2026 plugin marketplace launch — real distribution channel we don't occupy. Would need packaging the existing `.mdc` rules as a proper plugin manifest. | Medium (new operation) | Unassigned |
| **GitHub App (vs. Action)** | A GitHub App install is lower-friction than copying a workflow YAML — broader reach, different auth model. | Large (new operation) | Unassigned |
| **Pre-commit hook package** | Local-first gating before a PR even opens. Straightforward given the existing CLI, but needs its own packaging/docs. | Small-medium | Unassigned |

## Trust & proof

| Gap | Why it matters | Effort | Owner |
|---|---|---|---|
| **No testimonials/social proof on the website** | Zero customer quotes, zero usage numbers beyond test/rule counts. Normal for a pre-launch product — becomes a gap the moment first customers exist and aren't asked for a quote. | Ongoing (process, not a build) | User |
| **No demo video** | demo.html (interactive terminal animation) exists and is a genuine asset; a real screen-recorded walkthrough (voice + live gate catching a real PR) would convert better for cold traffic. | Medium (needs your voice/screen, can't be automated) | User |
| **No interactive live-gate web widget** | "Paste your code, watch it get gated in the browser" — the strongest possible instant-demo mechanic (see famous.ai research: live preview IS their funnel). Needs a sandboxed client-side or serverless execution of a rule subset. | Large (new operation, security-sensitive — sandboxing untrusted input) | Unassigned |

## Documentation debt (found during Golden Beacon)

| Gap | Why it matters | Effort | Owner |
|---|---|---|---|
| **Agent/persona headcount inconsistent across marketing surfaces** | Root README says "66 specialist AI agent personas"; `thesmos/README.md` says "38 God Agents" (×4); `pantheon-map.json` has 59 entries; `pantheon/exports/claude-code/` has 56 top-level files; `thesmos/catalog/agents/` has 126 `.md` total (includes sub-agents/skills, not 1:1 with personas). Found by Momus during the Golden Beacon docs-honesty pass — not fixed because the fix requires FIRST deciding what counts as a "persona" (top-level god? every export? every catalog file?) before one true number can be written. A docs patch that picks a number without that definition just relocates the drift. | Small once scoped, but needs the definition decided first | Recommend routing to Proteus (drift detection) for the headcount audit before any doc edit |
| **Generated pantheon export files still cite stale rule counts** | ~6+ files under `pantheon/exports/claude-code/`, mirrored in `copilot/`/`codex/`, still say "1,075 rules" — these are generator output (from `thesmos pantheon:export`), not hand sources. Hand-patching them is the anti-pattern CLAUDE.md warns against (edit the generator, not the output) — they'll just regenerate wrong again. | Trivial | Rerun `thesmos pantheon:export` after this PR merges so the corrected number (1,137, fixed in the generator's sources this session) propagates mechanically |
| **Hardcoded test-count citations rot silently** | README now states "2,827 passing tests" in prose — this number visibly moved during the Golden Beacon session alone (2,824 → 2,827) as parallel agents landed changes. A hardcoded number is exactly the mechanism that produced the 911/1,075/1,138 rule-count drift Momus just cleaned up. | Medium (CI change, not a docs edit) | Replace with a CI-generated shields.io JSON endpoint badge that updates on every merge to main, instead of prose |

## What's already strong (don't re-solve)

- Diff-aware gating, confidence tiers, working suppressions, baseline honored everywhere — the trust layer that was broken all session is now fixed and dogfooded live on this repo's own CI.
- 53 workflow skills + 66 agent personas — real, substantial, previously unshipped; Golden Beacon ships them.
- The gate contract is documented (`docs/gating.md`) — most competitors don't explain their own false-positive mitigation this plainly.
