# Phase 0 — Brand, Legal, Product-Truth Baseline

**Date:** 2026-08-03
**Branch:** `chore/phase-0-brand-legal-truth`
**Base:** `feat/eunomia-repository-steward` (`ce844747`) — see §7 for why not `main`
**Status:** Baseline only. Records state *before* Phase 0 edits.

> This is an engineering and product-truth record. It is **not legal advice** and makes no
> trademark or licensing determination. Items marked ATTORNEY are isolated for counsel.

---

## 1. Repository state

| | |
|---|---|
| Branch at start | `feat/eunomia-repository-steward` |
| SHA at start | `ce844747fb768f4eb04c307b410259ea6360781e` |
| Dirty files at start | none (clean worktree) |
| `origin/main` | `1435d6a9` |

### Package manifests

| Manifest | Name | Version | `license` field |
|---|---|---|---|
| `package.json` (root) | `thesmos-helper` | **absent** | `FSL-1.1-MIT` |
| `thesmos/package.json` | `thesmos-governance` | `5.1.0` | `FSL-1.1-MIT` |
| `extensions/vscode/package.json` | `thesmos-governance-vscode` | `5.1.0` | `FSL-1.1-MIT` |

Note: PR #133 (open, not merged) bumps `thesmos` to `5.1.1`. This baseline reflects `origin/main`
lineage at `5.1.0`.

---

## 2. Baseline command results

Every command below was executed on the branch base. **All passed.**

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck --workspace=thesmos` | 0 | — |
| `npm run typecheck --workspace=extensions/vscode` | 0 | — |
| `npm run typecheck --workspace=actions/pr-review` | 0 | — |
| `npm run build --workspace=thesmos` | 0 | dist + DTS built |
| `npm test --workspace=thesmos` | 0 | 136 files / 4564 tests |
| `npm run thesmos:catalog:validate --workspace=thesmos` | 0 | OK (129 agents, 66 skills) |
| `npm run generate:product-facts --workspace=thesmos` | 0 | v5.1.0 · 1137 rules · 59 agents |
| `npx tsx thesmos/bin/cli.ts validate` | 0 | 7 TECH_DEBT, 0 BLOCKER |
| `npm pack --dry-run --workspace=thesmos` | 0 | 183 files, `thesmos-governance-5.1.0.tgz` |

**Generated-artifact drift:** regenerating `product-facts.json` changes only `generatedAt`
(1 line). No count drift within the generator's own definition. The problem is not that the
generator is broken — it is that **its definition of "agent" is one of seven in the repo** (§3).

### Known pre-existing flakiness (not introduced by Phase 0)

`thesmos/compliance-assurance.test.ts` and `thesmos/claude-govern.test.ts` intermittently fail with
`Error: Test timed out in 5000ms` under full-suite parallel load. Both spawn subprocesses; both pass
in isolation. A clean run is 4564/4564.

---

## 3. Product-fact truth: seven populations, zero labels

This is the central product-truth defect. Every number below is *correct for what it counts*, and
**none of them states which population it counts.**

### Computed populations

| Population | Count | Authoritative source |
|---|---|---|
| Gods in the routing map | **59** | `catalog/pantheon-map.json` → `gods` |
| Utility agents in the routing map | **7** | `catalog/pantheon-map.json` → `utilityAgents` |
| Routable total (gods + utility) | **66** | derived |
| Catalog agents with a `claude_model` pin (exported set) | **69** | `catalog/agents/**` frontmatter |
| Catalog unique agent ids (incl. ~60 reviewers with no model pin) | **129** | `catalog/agents/**` |
| Free starter agents | **6** | `catalog/free-agents.json` → `freeAgentIds` |
| Held-back agents (exist, not routable, not announced) | **1** | `catalog/holdbacks.json` |
| Skills | **66** | `catalog/skills/*.md` |

### Claimed counts on public and internal surfaces

| Surface | Claim | Matches which population? |
|---|---|---|
| `product-facts.json` → `agentCount` | **59** | gods only — excludes 7 utility agents |
| `free-agents.json` → `pantheonTotal` | **67** | **nothing computed** |
| `thesmos/README.md` ×4 (lines 70, 113, 171, 216) | **67 God Agents** | **nothing computed** |
| `CLAUDE.md:200`, `AGENTS.md:693` | **68** | stale (was 68 before Eunomia; now 69) |
| `AGENTS.md:42` | **43** | stale by a wide margin |

**Findings:**

- `67` is the marketed number and it corresponds to **no computed population**. It is the number
  used in paid upsell copy (`Full Pantheon Grid (67 agents — $24 one-time)`).
- `product-facts.agentCount` (59) silently excludes the 7 utility agents, so the "canonical" fact
  under-reports the routable roster by 12%.
- Four surfaces disagree; three are stale.
- **Regression introduced by PR #136 (mine):** `eunomia-repository-steward-agent` was added to the
  catalog and the generated model map (69) but **not** to `pantheon-map.json`. Zeus therefore
  cannot route to it. This must be fixed in Phase 0 or #136.

### Commercial configuration

| Fact | Value | Source | Verified? |
|---|---|---|---|
| Price | `24` USD | `free-agents.json` → `priceUsd` | **UNVERIFIED** — see below |
| Store URL | `https://holleystudio.gumroad.com/l/thesmos-pantheon` | `free-agents.json` | not checked (no external contact) |
| Billing model | one-time | README copy | not machine-encoded |
| Free tier | 6 starter agents | `free-agents.json` | computed ✅ |

**Price is UNVERIFIED and must remain so in this phase.** The authoritative commercial source is
Gumroad, which is external. The mission forbids contacting third parties or changing Gumroad
products. Per the stop condition, price is recorded as `unverified` and generated marketing must be
blocked from publishing a number until a human confirms it.

---

## 4. Naming and trademark exposure (inventory only)

Full classification is in `PHASE_0_NAMING_INVENTORY.md`. Summary of exposure found in this repo:

| Name | Where | Risk | Phase 0 action |
|---|---|---|---|
| **Nike** | `nike-leadgen-agent`, `nike-social-agent`, generated exports, public copy | Famous commercial trademark | **Rename + legacy alias** |
| **Pantheon** | Product tier (`Pantheon Pro`), product (`Pantheon Chat`), CLI namespace, agent collective | Active WebOps/governance software company (pantheon.io) | Demote from tier/product name; keep CLI namespace |
| **Thesmos** | Master brand | Active dev-tool ecosystem (`thesmos.sh`, `github.com/thesm-os`) incl. MCP/AI-agent tooling | Mark `provisional_pending_legal_clearance` |
| **Zeus Forge** | Builder product name | — | → `Thesmos Builder` |
| Atlas, Iris | Other Holley Studio products | Out of scope per brief | Record only |
| Apollo, Zeus, Athena, Argus, … | Narrative personas | Mythological, generally weak marks | Classify as `narrative_persona` |

---

## 5. Licensing status

| Surface | Current claim |
|---|---|
| `LICENSE` | Modified FSL text with a **fixed 2030 / four-year** conversion |
| `package.json` ×3 | SPDX identifier `FSL-1.1-MIT` |
| `product-facts.json` | `"license": "FSL-1.1-MIT"` |
| Marketing copy | referenced as FSL |

**Mismatch:** standard `FSL-1.1-MIT` ([SPDX](https://spdx.org/licenses/FSL-1.1-MIT.html)) converts
**each release on its second anniversary**. This repository's LICENSE uses a **fixed four-year /
2030** conversion. Declaring the SPDX identifier `FSL-1.1-MIT` while shipping different terms is a
factual inaccuracy in package metadata and in marketing.

**ATTORNEY DECISION REQUIRED.** Phase 0 does not rewrite the license. See
`docs/legal/LICENSE_REVIEW_REQUIRED.md`.

`npm pack --dry-run` reports 183 files; whether the tarball actually contains the referenced
LICENSE is tested in Phase 0 (WS5).

---

## 6. Model identifiers

Model routing was substantially delivered in **PR #135** (`thesmos/models/`): a provider-neutral
registry with logical profiles, verified ids, dated pricing, fallbacks, and an audit folded into
`doctor`/`health`.

Current state on this base:

| Profile | Anthropic | OpenAI |
|---|---|---|
| `fast-mechanical` | `claude-haiku-4-5-20251001` | `gpt-5.6-luna` |
| `balanced-agentic` | `claude-sonnet-5` | `gpt-5.6-terra` |
| `deep-reasoning` | `claude-opus-5` | `gpt-5.6-sol` |
| `frontier-long-horizon` | `claude-fable-5` | `gpt-5.6-sol` @ `max` |

Catalog posture: 65 agents on Sonnet 5, 4 on Opus 5 (Zeus, Athena, Argus, Chiron), **0 on Fable**.

**Remaining WS4 gaps for Phase 0** (delta against the mission's requirements):

1. Raw model ids still live in agent frontmatter (`platforms.claude_model`). The mission asks to
   remove them "wherever possible" in favour of routing aliases.
2. `ModelRouteDecision` exposes reason codes but **not** a complexity score or an estimated cost
   tier, both of which the mission requires in the explainability contract.
3. Fable's gate exists (long-horizon + recorded approval) but there is no explicit
   **documented complexity threshold** constant.

---

## 7. Branch topology decision

Phase 0 is branched from `feat/eunomia-repository-steward`, **not** `origin/main`. Measured reason:

| Workstream | Files it must touch | Already modified by #135/#136 |
|---|---|---|
| WS7 (fictional credentials) | all agent catalog docs | **69** |
| WS2 (Nike) | `nike-leadgen-agent.md`, `nike-social-agent.md` | **both** |
| WS4 (model registry) | `thesmos/models/**` | **entire module** |
| WS3 (product facts) | `product-facts.json` | none ✅ |

Branching from `main` would put Phase 0 in direct conflict with 69 agent files plus the whole model
module. Stacking is the smaller conflict surface. Phase 0 therefore targets
`feat/eunomia-repository-steward` and inherits PRs #135 and #136.

---

## 8. Baseline verdict

The **engineering** baseline is green: every documented command exits 0.

The **product-truth** baseline is not. Seven agent populations, four disagreeing public claims, a
marketed count (67) matching nothing computed, an unverified price, a license identifier that does
not match the shipped terms, and a famous trademark used as a public agent name.

No claim of correctness is made for any surface until the corresponding Phase 0 workstream lands.
