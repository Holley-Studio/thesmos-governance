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
| ~~Agent/persona headcount inconsistent across marketing surfaces~~ | **RESOLVED (Operation Thundering Labyrinth, 2026-07-03).** Decree: the marketed number is **67 deployable specialist agents** (59 unique gods after removing phantom Iris; 6 gods carry multiple roles — Ares×4, Psyche/Plutus/Nike/Heracles/Hera ×2). Iris removed from `pantheon-map.json`, `divisions.json`, kit-readme, orchestration guide, and CLAUDE.md routing (photography → Artemis, matching `pantheon.ts` which already routed there). All "66" marketing claims swept to 67. Remaining: make the 67 CI-derivable (count export files) so it never drifts again. | Done (CI badge still open) | Claude, shipped on `chore/headcount-67-remove-iris` |
| **`pantheon:export` generator is destructively out of sync with shipped exports** | Discovered 2026-07-03: running `thesmos pantheon:export --target=all` produces **43 agents** (vs 67 shipped) and would delete ~15,200 lines from `pantheon/exports/` — the committed exports carry the "re-tuned for Claude 5 / GPT-5.5" enrichment that this repo's generator sources do not have. Likely cause: the 4.1–4.3 generator/source work was published to npm but never committed back to this repo (local `thesmos/package.json` is 4.0.0; npm has 4.3.0). Until the generator and catalog sources are re-synced to reproduce the shipped 67, **do NOT rerun `pantheon:export` to fix stale strings** — the previous advice here to do so was wrong. Stale "1,075 rules" citations were hand-patched (exports + the two catalog sources) as the lesser evil, with this row as the honest record. Note: the export command also side-effect-installs into `.claude/agents/` and `.cursor/rules/` in the repo — needs a `--dist-only` mode. | Medium (recover/rebuild 4.3 sources, then regen must round-trip clean) | Unassigned — blocks any future god drop |
| **Hardcoded test-count citations rot silently** | README now states "2,827 passing tests" in prose — this number visibly moved during the Golden Beacon session alone (2,824 → 2,827) as parallel agents landed changes. A hardcoded number is exactly the mechanism that produced the 911/1,075/1,138 rule-count drift Momus just cleaned up. | Medium (CI change, not a docs edit) | Replace with a CI-generated shields.io JSON endpoint badge that updates on every merge to main, instead of prose |

## What's already strong (don't re-solve)

- Diff-aware gating, confidence tiers, working suppressions, baseline honored everywhere — the trust layer that was broken all session is now fixed and dogfooded live on this repo's own CI.
- 53 workflow skills + 66 agent personas — real, substantial, previously unshipped; Golden Beacon ships them.
- The gate contract is documented (`docs/gating.md`) — most competitors don't explain their own false-positive mitigation this plainly.
