# Operation Eunomia — Phase 0 Baseline

**Date:** 2026-08-03
**Scope:** Repository stewardship agent (Eunomia) + model registry / routing modernization.
**Status:** Baseline only. No source files changed at the time of writing.

This document records verified state *before* implementation so that every later claim in
Operation Eunomia can be checked against a fixed reference point.

---

## 1. Verified SHAs and worktree state

| Ref | SHA | Note |
|---|---|---|
| `origin/main` | `1435d6a98bf0f078010e1d6ca31f377b7e7fd1dc` | Base of every open PR |
| local `main` (HEAD) | `f5882ba9423fcb4612524be7d132b3a2c447c990` | **5 commits ahead of `origin/main`, 0 behind** |

`git rev-list --left-right --count HEAD...origin/main` → `5	0`.

### The five unpushed local commits

| Commit | Subject | Also in `origin/release/v5.1.1` (PR #133)? |
|---|---|---|
| `f5882ba9` | docs(spec): Pantheon Chat discoverability design | **No** — unpushed, unowned by any PR |
| `46ff8930` | chore: regenerate product-facts.json for v5.1.1 | Yes |
| `9d456e79` | chore: release thesmos-governance@5.1.1 | Yes |
| `ee0de884` | chore(docker): improve Dockerfile layer caching | Yes |
| `47bc7a79` | fix(STATE_012): scanner abort + typed-decl gap | Yes |

**Consequence:** local `main` is effectively `origin/release/v5.1.1` plus one unpushed doc commit.
Branching Operation Eunomia from local `HEAD` would silently bundle the v5.1.1 release into
every new PR. **All new branches are cut from `origin/main`.**

### Uncommitted / untracked local work (preserved, not touched)

- `M .thesmos/savings.jsonl` — runtime ledger, modified locally.
- `?? journal/` — untracked directory.
- Two untracked files whose **names contain literal newlines and shell fragments**, e.g.
  `valid:, verifyRecords(o).valid);\nwriteFileSync(p, orig,utf8);…` — artifacts of a botched
  heredoc. These are root-level clutter and are recorded here as *evidence for the
  `repository-order-audit` skill*, not deleted. Deleting ambiguous files is explicitly
  outside Eunomia's authority.

---

## 2. Open pull requests and overlap

| PR | Branch | Head | Draft | Merge state | Domain |
|---|---|---|---|---|---|
| #121 | `fix/billing-aware-budget-guardian` | `82c6457e` | draft | BEHIND | Budget Guardian billing awareness |
| #122 | `fix/config-repair-hatch` | `2a28f452` | draft | BEHIND | Config repair hatch |
| #123 | `hardening/proof-gate-blocker-fixtures` | `80bc4fbd` | draft | BEHIND | BLOCKER rule fixtures |
| #129 | `feat/council-records` | `27a72e69` | draft | CLEAN | Durable Council Records |
| #130 | `feat/pantheon-experience` | `a911c715` | draft | CLEAN | Pantheon Chat experience |
| #132 | `ci/release-vscode-workflow` | `9e75a50e` | ready | CLEAN | VS Code release pipeline |
| #133 | `release/v5.1.1` | `46ff8930` | ready | CLEAN | v5.1.1 release |

Also open: #134, #120, #119, #110 (all Dependabot).

### The decisive overlap finding

Workstream 3 (Pantheon Chat model truth) requires files that **do not all exist on any single
branch**. Verified with `git cat-file -e <ref>:<path>`:

| File | `origin/main` | PR #130 | PR #121 |
|---|:--:|:--:|:--:|
| `chat/claudeSession.ts` | ✅ | ✅ | ✅ |
| `chat/chatViewProvider.ts` | ✅ | ✅ | ✅ |
| `chat/webview/chat.ts` | ✅ | ✅ | ✅ |
| `chat/savingsLedger.ts` | ✅ | ✅ | ✅ |
| `chat/dispatchAdvisor.ts` | ✅ | ✅ | ✅ |
| `chat/providerManager.ts` | ✅ | ✅ | ✅ |
| `chat/assistantRouting.ts` | ❌ | ✅ | ❌ |
| `chat/turnCards.ts` | ❌ | ✅ | ❌ |
| `chat/streamProtocol.ts` | ❌ | ✅ | ❌ |
| `usage/subscriptionUsage.ts` | ❌ | ✅ | ❌ |
| `chat/billingContext.ts` | ❌ | ❌ | ✅ |
| `chat/budgetPolicy.ts` | ❌ | ❌ | ✅ |

Mapping the mission's WS3 requirements onto that table:

- "turn summary must use the actual effective model" → `turnCards.ts` — **PR #130 only**
- "agent bubbles distinguish catalog default from runtime model" → `assistantRouting.ts` — **PR #130 only**
- "actual model reported by the session init event" → `streamProtocol.ts` — **PR #130 only**
- "preserve turn-idempotency and single-card work" → **PR #130 only**
- "subscription mode must not hard-block on estimated API cost" → `budgetPolicy.ts` — **PR #121 only**

**No base contains both sets.** WS3 cannot be delivered whole in one PR without merging #121
and #130 together, which the mission forbids. This drives the PR topology in §5.

---

## 3. Model IDs found in active source

### Anthropic — verified current baseline

Verified against the bundled `claude-api` skill catalog (`shared/models.md`, cached 2026-06-24)
and the mission brief. Both agree.

| Model | Canonical ID | Context | Max output | Input $/1M | Output $/1M |
|---|---|---|---|---|---|
| Fable 5 | `claude-fable-5` | 1M | 128K | 10.00 | 50.00 |
| Opus 5 | `claude-opus-5` | 1M | 128K | 5.00 | 25.00 |
| Sonnet 5 | `claude-sonnet-5` | 1M | 128K | 3.00 (2.00 intro → 2026-08-31) | 15.00 (10.00 intro) |
| Haiku 4.5 | `claude-haiku-4-5` (full: `claude-haiku-4-5-20251001`) | 200K | 64K | 1.00 | 5.00 |

### OpenAI — verified current baseline

Verified by fetching `https://developers.openai.com/api/docs/guides/latest-model` on 2026-08-03.

| Role | ID | Note |
|---|---|---|
| Flagship | `gpt-5.6-sol` | `gpt-5.6` is an alias for this |
| Balanced | `gpt-5.6-terra` | |
| High-volume | `gpt-5.6-luna` | |

Reasoning effort levels supported across all GPT-5.6 variants: `none`, `low`, `medium`,
`high`, `xhigh`, `max`. A **`pro` reasoning mode** exists — it is a *reasoning setting*, not a
model slug. There is no `gpt-5.6-pro` model.

### What is actually in the repository today

| Surface | Path | Current contents |
|---|---|---|
| Agent frontmatter (`claude_model`) | `thesmos/catalog/agents/**/*.md` | 61 × `claude-sonnet-5`, 3 × `claude-opus-4-8`, 3 × `claude-fable-5`, 1 × `claude-haiku-4-5` |
| Agent frontmatter (`openai_model`) | same | 66 × `gpt-5.5`, 1 × `gpt-5.5-pro`, 1 × `gpt-5.5-instant` |
| Agent frontmatter (`chatgpt_model`) | same | 68 × `gpt-4o` |
| Generated map | `thesmos/generated/pantheon-models.ts` | 68 entries; byte-identical to the extension copy |
| Generated map (extension) | `extensions/vscode/src/generated/pantheon-models.ts` | identical |
| Advisory constants | `thesmos/advise.ts:51-55` | `fast: claude-haiku-4-5-20251001`, `mid: claude-sonnet-4-6`, `top: claude-opus-4-8`, `creative: claude-fable-5` |
| Advisory Codex constants | `thesmos/advise.ts:124,139,150` | `gpt-5.5-instant`, `gpt-5.5-pro`, `gpt-5.5` |
| Cost table | `thesmos/token-budget.ts:51-65` | 12 entries, all pre-5 generation |
| Savings formula (core) | `thesmos/savings.ts:83-86` | `estimateTierSaving` |
| Savings formula (extension) | `extensions/vscode/src/chat/savingsLedger.ts:63-72` | duplicate of the above |

### Non-default agent model assignments (the migration targets)

| Agent | Current `claude_model` |
|---|---|
| `argus-security-agent` | `claude-opus-4-8` |
| `athena-strategy-agent` | `claude-opus-4-8` |
| `zeus-executive-agent` | `claude-opus-4-8` |
| `daedalus-product-agent` | `claude-fable-5` |
| `plutus-finance-agent` | `claude-fable-5` |
| `themis-legal-agent` | `claude-fable-5` |
| `artemis-photography-agent` | `claude-haiku-4-5` |

---

## 4. Findings carried into implementation

Each is a concrete, verified defect against the authoritative baseline in §3.

| # | Finding | Location | Severity |
|---|---|---|---|
| F1 | Three agents statically default to Fable 5 | catalog frontmatter (Daedalus, Plutus, Themis) | High |
| F2 | Three agents pinned to superseded `claude-opus-4-8` | Zeus, Athena, Argus | High |
| F3 | Artemis pinned to Haiku purely because the domain is visual | `artemis-photography-agent` | High |
| F4 | Haiku ID is the bare alias `claude-haiku-4-5`, not the canonical dated ID used elsewhere in the same repo | catalog vs `advise.ts` | Medium |
| F5 | `advise.ts` mid tier is `claude-sonnet-4-6` — a superseded generation | `advise.ts:53` | High |
| F6 | `advise.ts` emits `gpt-5.5-pro` — an **invented "pro" model slug**; `pro` is a reasoning mode, not a model | `advise.ts:139` | High |
| F7 | Every `openai_model` / `chatgpt_model` in the catalog is a superseded generation (`gpt-5.5`, `gpt-4o`) | catalog frontmatter | High |
| F8 | Cost table prices Opus at $15/$75; verified Opus 5 and Opus 4.8 are $5/$25 | `token-budget.ts:54` | High |
| F9 | Cost table prices Haiku 4.5 at $0.25/$1.25; verified is $1.00/$5.00 (4×/4× understated) | `token-budget.ts:55` | High |
| F10 | Unknown model IDs silently fall back to a **Sonnet 4.6** price rather than reporting unknown | `token-budget.ts:94` | High |
| F11 | `estimateTierSaving` treats Fable as equivalent to the Opus baseline (`/opus\|fable/` → `undefined`), so Fable's higher cost tier is invisible | `savings.ts:85` | High |
| F12 | The savings formula is duplicated verbatim in core and extension with no shared source | `savings.ts` + `savingsLedger.ts` | Medium |
| F13 | Keyword-percentage routing sends *any* creative/customer-facing plan to the creative flagship with no approval gate | `advise.ts:132-143` | High |
| F14 | `CouncilModelPolicy.preferredProfiles` is `string[]` with no canonical profile vocabulary | `council/contract.ts:176-183` | Medium |
| F15 | **Documented agent counts disagree across four files** | see below | Medium |
| F16 | Root-level clutter: untracked files with newline-embedded shell fragments in their names | repo root | Low |

### F15 detail — measured count drift

| Source | Claimed count |
|---|---|
| `AGENTS.md:42` | 43 |
| `AGENTS.md:693`, `CLAUDE.md:200` | 68 |
| `thesmos/README.md:171,216` | 67 |
| `thesmos/catalog/product-facts.json` (`agentCount`) | 59 |
| `thesmos/generated/pantheon-models.ts` (generated truth) | 68 |

Four documents, four different numbers. This is the canonical example of what
`repository-order-audit` must detect mechanically.

---

## 5. Generated vs canonical files

| Artifact | Canonical source | Generator | Hand-editable? |
|---|---|---|---|
| `thesmos/generated/pantheon-models.ts` | `thesmos/catalog/agents/**/*.md` (`platforms.claude_model`) | `scripts/export-agents.ts --format=models` | **No** |
| `extensions/vscode/src/generated/pantheon-models.ts` | same | same (writes both targets) | **No** |
| `extensions/vscode/src/generated/pantheon-sidebar.ts` | catalog + `modelFor()` | `export-agents.ts` | **No** |
| `pantheon/exports/**` | catalog | `export-agents.ts` | **No** (gitignored, local-only) |
| `thesmos/catalog/product-facts.json` | catalog + rules | `scripts/generate-product-facts.ts` | **No** |
| `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` generated blocks | `.thesmos/` | `thesmos adapters` | **Only outside `THESMOS:GENERATED` markers** |
| `extensions/vscode/dist/**`, `actions/pr-review/dist/**` | TypeScript sources | `npm run build` | **No** |

---

## 6. Existing repo-health mechanisms (reuse targets, per Olympus D10)

| Mechanism | Path | What it already covers |
|---|---|---|
| `thesmos doctor` | `thesmos/doctor.ts` | Required files, package scripts, adapter files/portability/sync, report freshness, baseline freshness, config validity, IDE dirs, GitHub workflow + secrets |
| `thesmos health` | `thesmos/health.ts` | Graded score (A+–F) with deductions/bonuses; CI gates at ≥ 90 |
| `thesmos catalog:validate` | CLI | Catalog schema validation |
| `thesmos drift` | `thesmos/drift.ts` | Drift detection |
| Council validation | `thesmos/council/validate.ts` | Council contract validation |
| Existing skills | `thesmos/catalog/skills/` | 63 skills incl. `repo-health-audit`, `dependency-audit`, `adapter-sync`, `pr-review`, `final-hardening-pass` |
| CI | `.github/workflows/ci.yml` | Ubuntu matrix + `guard-windows` job + `typecheck` rollup |

**Decision:** the model audit **extends `doctor`/`health` rather than adding a parallel command**,
per Operation Olympus D10.

---

## 7. Verification command order (from `.github/workflows/ci.yml`)

This repo has **no lint step**. The real order, taken from CI step names:

```
npm ci
npm run typecheck --workspace=thesmos            # "Typecheck (core)"
npm run typecheck --workspace=extensions/vscode  # "Typecheck (vscode extension)"
npm run build --workspace=thesmos                # "Build"
npm run typecheck --workspace=actions/pr-review  # "Typecheck (pr-review action)"
npm test --workspace=thesmos                     # "Test"
npm run test:coverage --workspace=thesmos        # "Test coverage"
npm run build --workspace=extensions/vscode      # "Build (vscode extension)"
npm run test --workspace=extensions/vscode       # "Test (vscode extension)"
npm test --workspace=actions/pr-review           # "Test (pr-review action)"
npm run build --workspace=actions/pr-review      # "Build (pr-review action)"
# then: governance SARIF scan, product-facts freshness, thesmos ci gate (health ≥ 90)
```

Windows coverage exists only as the `guard-windows` job (build + guard tests), not the full matrix.

---

## 8. Known limitations of this baseline

- **Windows/Linux CI is not executed locally.** Any cross-platform claim in this operation will
  be reported as "not executed on platform" unless a CI run is observed.
- **Anthropic pricing is read from the bundled `claude-api` skill catalog (cached 2026-06-24)**,
  not fetched live from `platform.claude.com`. Sonnet 5 carries an introductory price that
  expires 2026-08-31 — 28 days from this baseline — so the registry must carry effective dates
  rather than a bare number.
- **OpenAI context/output limits and pricing were not verified.** The fetched page confirmed IDs,
  roles, the alias, and reasoning levels only. Registry entries for OpenAI will therefore carry
  verified IDs with explicitly unknown limits/pricing rather than invented values.
- **The 169 `.md` files under `thesmos/catalog/agents/` do not equal the 68 exported agents.**
  The exporter filters on `enabled` and `holdbacks.json`. The audit must *compute* the count from
  the generator rather than assert any of the four numbers currently documented.
- `pantheon/exports/` is gitignored and local-only; export byte-stability is proven against the
  tracked generated artifacts, not the gitignored export tree.

---

## 9. PR topology decision

Driven by §2 (no base holds all WS3 files) and by the fact that **adding Eunomia mutates the same
generated `pantheon-models.ts` that the model migration rewrites** — two sibling branches off
`main` would conflict with each other on a generated artifact.

| PR | Branch | Base | Carries |
|---|---|---|---|
| 1 | `feat/model-routing-v5` | `origin/main` | WS1 registry, WS2 routing, WS4 catalog migration, WS3 *engine* (pricing/savings/unknown-cost), audit extension of doctor/health |
| 2 | `feat/eunomia-repository-steward` | **stacked on PR 1** | WS5 Eunomia, WS6 skills, WS7 stewardship |
| 3 | `feat/pantheon-chat-model-truth` | **stacked on PR #130 head `a911c715`** | WS3 *UI* — deferred, documented follow-up |

Measured conflict surface:

- PR 1 ∩ PR #130 = **∅** (#130 touches no core model file).
- PR 1 ∩ PR #121 = `thesmos/token-budget.ts` — one file; #121 is already BEHIND and owes a rebase.
- PR 1 ∩ PR 2 = ∅ by construction (stacked).
- PR 3 ∩ PR #130 = intentional (stacked on its head, preserving turn-idempotency work).

The `budgetPolicy.ts` hard-block requirement belongs to PR #121's file and is recorded as a
follow-up note against that PR rather than reimplemented.

---

## 10. Constraints held for the duration

- No merge, no publish, no tag, no PR closed, no PR marked ready.
- Local `main`'s five unpushed commits and all untracked work are left exactly as found.
- Generated files are changed only by running their generators.
- No "bug-free" / "fully verified" / "production-ready" claim without matching command output.
