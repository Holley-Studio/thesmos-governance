# Operation Olympus — Master Execution Ledger

> **Single source of truth for the Olympus program.** Do not create competing planning docs.
> Update this file after every PR. A fresh session should be able to resume from §12 alone.
>
> Created 2026-07-27. Status: **Phase 0 / 0A / 0B complete. PR 1 (Council Contract) IMPLEMENTED —
> draft PR open, awaiting independent review.** See §14.
>
> The pre-Olympus work was split into four independent draft PRs off `origin/main`:
> **#121** Billing Guardian · **#122** config repair hatch (supersedes #115) ·
> **#123** BLOCKER fixture coverage · **#124** this ledger.
> **#124 merged 2026-07-27 as `1a495e8`**, satisfying the PR 1 precondition. #121–#123 remain open.

---

## 1. North-star product definition

Thesmos does not compete on the number of models, providers, agents, or visual effects.

> **Thesmos governs agent execution.
> The Pantheon supplies specialized intelligence.
> Pantheon Chat is the governed mission-control surface.**

Agent work must be safe, explainable, reviewable, recoverable, evidence-backed, model-aware,
billing-aware, cross-platform, drift-resistant, and understandable to a normal user.

The differentiator is **execution trust**: permission clarity, proof of work, provenance, recovery,
and truthful product claims. Not "another coding chat".

---

## 2. Verified repository state (2026-07-27)

Everything in this section was verified by command in this session, not carried over from a report.

| Item | Value |
|---|---|
| `origin/main` | `d89b7c87f94cd213ce179a0cd89532fd8586501a` |
| Package version | `5.1.0` |
| Node / npm | v22.23.1 / 10.9.8 |
| Platform | macOS Darwin 25.5.0 arm64 |

### 2.1 Test evidence (measured, with counts)

| Suite | Result |
|---|---|
| `thesmos` (proof-gate tree) | **119 files / 4108 tests — all passing** |
| `thesmos` (billing branch) | **119 files / 3723 tests — all passing** |
| `extensions/vscode` (billing branch) | **16 files / 189 tests — all passing** |
| BLOCKER fixture harness | **419 tests — all passing** (was 75 failing at session start) |
| `thesmos:validate` | exit 0 — 7 TECH_DEBT, 0 BLOCKER, 44 baseline suppressed |
| `thesmos:doctor` | 39/39 checks pass |

Not yet run this session: `actions/pr-review` suites, `npm run ci`, VSIX packaging, packed-consumer
tests, cross-platform matrix. These are Olympus PR 11 scope.

### 2.2 Open PRs (verified via `gh`, 2026-07-27)

| # | Title | State | Mergeable | Disposition |
|---|---|---|---|---|
| 120 | bump lightningcss-linux-x64-gnu | open | MERGEABLE | dependabot — out of scope |
| 119 | bump lightningcss-linux-x64-musl | open | MERGEABLE | dependabot — out of scope |
| 115 | config repair hatch for failClosed deadlock | **open draft** | MERGEABLE | **superseded** — see §3.2 |
| 112 | Phase 8 score honesty + 5.1.0 release prep | **open draft** | CONFLICTING | **superseded** — see §3.3 |
| 110 | bump @changesets/cli | open | UNKNOWN | dependabot — out of scope |
| 109 | bump typescript-tooling group | open | MERGEABLE | dependabot — out of scope |

---

## 3. Phase 0A — repository hygiene gate (COMPLETE)

### 3.1 Billing-Aware Budget Guardian — ISOLATED ✅

**Finding:** the billing work existed in **two diverged copies**. `fix/billing-aware-budget-guardian`
(`cb97343`, branched from `origin/main`) was ~75 minutes newer than the uncommitted working-tree copy
and had never been merged back. The working-tree copy silently lacked:

1. the `dispatchPrompt()` **choke-point** billing check — without it, an approved/skipped dispatch
   order or a resumed session bypasses a metered ceiling reached mid-turn;
2. the `confidence === 'verified'` gate on the subscription exemption — without it an *inferred*
   subscription disables monetary enforcement;
3. verified-metered evaluated **before** inference;
4. `apiKeySource` reset on provider switch;
5. `budgetEnforcementPaths.test.ts` — 9 dispatch-path enforcement tests;
6. the `Uri.joinPath` mock those tests depend on.

**Resolution:** the branch version of all divergent files was restored, verified byte-identical, and
the audit-ledger corrections committed to the branch as `82c6457`. The billing work was then removed
from the proof-gate working tree, leaving two clean, disjoint, independently green branches.

**Shipped as [PR #121](https://github.com/Holley-Studio/thesmos-governance/pull/121)** — draft, off
`origin/main`, containing no Proof Gate or Olympus work. **Not merged.**

### 3.2 PR #115 — config repair hatch → CLOSED as superseded ✅

Its behavior was **reimplemented and hardened**, then isolated onto `fix/config-repair-hatch` and
opened as **[PR #122](https://github.com/Holley-Studio/thesmos-governance/pull/122)**. The
replacement swaps #115's plain string `===` compare for: exact `config.json` basename, parent dirs
that must `realpath` to the same real directory, and refusal of a **symlinked** config file. #115
does no `realpath`, so a symlinked `.thesmos/config.json` would be followed to an arbitrary
out-of-repo write while governance is disabled. Covered by 11 unit tests + 8 spawned-guard
integration tests.

PR #115 was closed with a factual comment linking #122.

### 3.3 PR #112 — score honesty + release prep → recommend CLOSE as superseded

Verified against `main`: the `score` command, `governance-log.ts`, `execution-receipt.ts`,
`agents-federation.ts`, the permissionBridge `/tmp` socket fix, and 5.1.0 release prep are **all
already on `main`**. Its `slopsquatting.ts` rewrite would **regress** `main` (main has diverged
past it by −107 lines). It is CONFLICTING.

Cleanly salvageable, as a separate small PR — **not** Olympus scope:
- `commit-lint`: `execFileSync` + `-m` alias (replaces `execSync('git commit -F ...')`);
- `governance-log.test.ts` (absent on `main`).

PR #112 was closed as superseded, with the two salvageable items tracked in a dedicated follow-up
issue rather than blindly cherry-picked — both need independent verification against current `main`.

### 3.4 Proof Gate 5.2 — kept separate ✅

Phase 2 scanner-fixture work was isolated onto `hardening/proof-gate-blocker-fixtures` and opened as
**[PR #123](https://github.com/Holley-Studio/thesmos-governance/pull/123)** — draft, off
`origin/main`, containing no config-repair, billing, or Olympus changes. It is **green**, so it does
not contaminate an Olympus baseline. Full detail:
[`docs/audits/2026-07-25-proof-gate-5.2.md`](../audits/2026-07-25-proof-gate-5.2.md).

Carry-over that Olympus must **not** silently inherit: **29 BLOCKER rules cannot detect their own
documented violations**, recorded in a self-healing `KNOWN_RULE_GAPS` ledger. Olympus must not claim
scanner completeness while those stand.

---

## 4. Verified current capabilities

Verified by inspection this session — file paths and line counts are real.

| Capability | Where | State |
|---|---|---|
| Deterministic rule engine | `thesmos/rules/**`, `review.ts` | Mature. 200+ BLOCKER rules, 419-test fixture harness. |
| Guard / pre-tool governance | `claude-govern.ts` (891 lines), `scope.ts` (571) | Mature. Hardened config-repair hatch pending in PR #122. |
| Agent catalog | `catalog.ts`, `thesmos/catalog/agents/` (45 files) | Markdown + YAML frontmatter; `CatalogFrontmatter` = id, name, type, version, owner, tags, enabled. |
| Agent ownership | `agent-ownership.ts` | **Strong.** `managed`/`external`/`adopted`, origin, status, content hashing, managed markers, `.thesmos/managed-agents.json`. |
| Agent lifecycle | `agent-lifecycle.ts` (358) | Present. |
| Execution receipts | `execution-receipt.ts` + tests | Present — Olympus PR 5 must extend, not duplicate. |
| Governance log | `governance-log.ts` | Present — same. |
| Health / doctor | `health.ts` (477), `doctor.ts` (560) | Present; 39 checks. |
| MCP server | `mcp-server.ts` (829) | Present. |
| Billing guardian | PR #121 | Complete, green, unmerged. |
| Checkpoints | extension `checkpointManager` | Present (shadow-git). |
| Config schema | `config.schema.json` (422) | Extended on billing branch. |

---

## 5. Verified gaps (what Olympus must build)

1. **No typed agent contract.** Frontmatter carries `governance.rules`, `delegates_to`, `reports_to`,
   `platforms.*`, but there is **no** declared permission model, step/child limits, risk tier,
   evidence requirement, or typed handoff. Nothing machine-checks what an agent may do.
2. **No primary/subagent distinction.** All 68 gods are peers; the routing table in `CLAUDE.md` is
   prose, not an enforced contract. A user picking from 68 gods is the anti-pattern §7 rejects.
3. **No mission graph.** Dispatch is informal and sequential; no dependencies, no scheduler, no
   durable task state, no reconciliation of stale running nodes.
4. **No typed handoff envelope.** Agent results are prose.
5. **No evidence enforcement.** An agent saying "done" counts as done.
6. **Model routing is keyword-based** (`dispatchAdvisor`), not evidence-backed.
7. **No Council Record.** Receipts and governance logs exist but are not unified into a verifiable,
   resumable, forkable mission record.
8. **Scanner honesty gap** — §3.4.

---

## 6. Kilo adoption matrix

Sources: [Agent Permissions](https://kilo.ai/docs/customize/agent-permissions),
[Custom Subagents](https://kilo.ai/docs/customize/custom-subagents),
[Agent Manager](https://blog.kilo.ai/p/agent-manager-run-multiple-agents).

Kilo is MIT-licensed. **No Kilo code is imported and no Kilo product text is reproduced.** Concepts
only; all implementation is original and built around Thesmos' governance model.

| Capability | Kilo approach | Current Thesmos state | Adopt | Adapt | Reject | Reason |
|---|---|---|---|---|---|---|
| Primary vs subagent | `mode: primary \| subagent \| all`; subagents reachable via Task tool / `@mention` | none — all agents peers | ✅ | | | Directly solves the 68-god picker problem. Same three-value semantics. |
| Permission decisions | `allow` / `ask` / `deny` per tool | binary allow/block in guard | | ✅ | | Adopt the three values; **adapt** default. Kilo's last-match-wins is footgun-prone — Thesmos uses **deny-wins + explicit unknown**, never silent broad allow. |
| Permission scoping | glob patterns per tool | `scope.ts` path rules | | ✅ | | Extend existing scope model rather than add a parallel one. |
| Rule precedence | **last matching rule wins** | n/a | | | ✅ | Rejected. A later broad rule can silently widen access. Thesmos: most-restrictive-wins, order-independent, deterministic. |
| Step limits | `steps` caps agentic iterations | none | ✅ | | | Needed for cost and runaway containment. |
| Subagent delegation | `permission.task` gates which subagents are invocable; denied ones vanish from the tool description | none | | ✅ | | Adopt gating. **Adapt:** also cap `maximumChildren` / `maximumParallelChildren`; children may never widen inherited permissions. |
| Worktree isolation | each agent gets its own git worktree + branch | worktrees used ad hoc | | ✅ | | Adopt for write-heavy parallel tasks; **adapt** to require explicit permission, disk/port awareness, and recording in the mission. |
| Parallel sessions | multiple concurrent agents | none | | ✅ | | Adopt with a hard cap (default 3, never >5) and file-scope overlap exclusion. |
| No shared parent/child memory | clean failure domains | n/a | ✅ | | | Good isolation property; keeps handoffs explicit and auditable. |
| Model override per agent | `provider/model-id`, inherits caller's | keyword advisor | | ✅ | | Adopt inheritance; **adapt** to evidence-backed routing (PR 4). |
| Agent discovery | `kilo agent list` | `thesmos agents:list` | | ✅ | | Extend existing command with `--primary` / `--specialists` flags — do not add duplicate commands. |
| Markdown + frontmatter agents | `.kilo/agents/*.md`, filename = name | `thesmos/catalog/agents/*.md` with `id` | ✅ | | | Already aligned. Keep `id` as canonical (filename-as-identity is fragile). |
| `.env` special-casing | broad read approvals cannot bypass `.env` prompts | secret rules exist | ✅ | | | Strong idea — a broad grant must never silently cover secret-class files. |
| Marketplace install | remote install of agents/packs | none | | | ✅ | Rejected until PR 6's trust model (provenance, hash, signature, preview, rollback) exists. No remote auto-install. |
| Semantic code indexing | always-on indexing | none | | | ✅ | Rejected as always-on. PR 8 only: opt-in, local-first, provenance-tagged, deletable. |
| Browser automation | general browsing | Playwright MCP available | | ✅ | | **Adapt** to governed *verification* (PR 9), not free browsing. Localhost default; external needs approval. |
| Session resume / fork | supported | partial (session history) | | ✅ | | Adapt into Council Records (PR 5) with no inherited approval for new dangerous actions. |
| Shared extension/CLI core | one portable core | duplicated logic | ✅ | | | Directly matches the architecture standard "no duplicate decision logic across CLI and extension". |

**Why Thesmos remains differentiated:** Kilo optimizes for *capable parallel execution*. Thesmos
optimizes for *provable governed execution* — deterministic rules, fail-closed permissions, evidence
contracts, provenance, and truthful claims. Adopting Kilo's ergonomics does not change that axis.

---

## 7. Intentional product boundaries (explicit rejections)

Not built during Olympus, by decision: hosted model-credit gateway; token reselling; hundreds of
unverified models; public unreviewed marketplace; cloud session sharing; Slack or mobile execution;
autonomous merging; autonomous production deployment; hidden self-replicating agent sessions;
unlimited parallel agents; an agent picker containing every god; always-on remote code indexing; an
opaque memory database; automatic `.env` copying; and "10/10" / "production-ready" claims without
evidence.

---

## 8. Product simplicity decision

Users choose among **8 primary roles**, not 68 gods:

`build · plan · debug · review · security · design · growth · operations`

Mythology remains the specialist identity underneath — e.g. *Security Review — powered by Argus ·
Themis · Athena*. Zeus stays mission classifier, policy router, graph approver, escalation authority,
and final synthesis — **not** a verbose ceremonial bottleneck.

---

## 9. PR dependency graph

```
PR1 council-contract ──┬─> PR2 mission-graph-runtime ──┬─> PR3 pantheon-mission-control
                       │                               ├─> PR5 council-records ──> PR7 checkpoint-evolution
                       │                               └─> PR9 browser-evidence
                       ├─> PR4 model-intelligence
                       └─> PR6 governed-packs
PR8 project-intelligence   (independent, opt-in)
PR10 incident-health       (depends on PR1 decision contract)
PR11 release-proof         (last; gates the distributed artifact)
```

One focused branch per PR. Create a branch only when its prerequisite is ready or merged.

| PR | Branch | Status |
|---|---|---|
| 1 | `feat/council-contract` | **IMPLEMENTED — draft PR open, awaiting review** (§14) |
| 2 | `feat/mission-graph-runtime` | **unblocked once PR1 is reviewed** ← next |
| 3 | `feat/pantheon-mission-control` | blocked on PR2 |
| 4 | `feat/model-intelligence` | blocked on PR1 |
| 5 | `feat/council-records` | blocked on PR2 |
| 6 | `feat/governed-packs` | blocked on PR1 |
| 7 | `feat/checkpoint-evolution` | blocked on PR5 |
| 8 | `feat/project-intelligence` | independent |
| 9 | `feat/browser-evidence` | blocked on PR2 |
| 10 | `feat/incident-health` | blocked on PR1 |
| 11 | `hardening/release-proof` | last |

---

## 10. Architectural decisions (binding)

- **D1.** `.thesmos` stays the canonical governed source of truth. Claude/Cursor/Codex/Gemini/Copilot
  adapters remain **generated, thin** outputs. Never hand-edit generated files.
- **D2.** The Council Contract is **compiled** from existing frontmatter + registry data. Agent
  Markdown stays human-readable. No mass rewrite of 68 agents to prove the contract.
- **D3.** Permission resolution is **most-restrictive-wins and order-independent** — explicitly
  rejecting Kilo's last-match-wins. Unknown permission state resolves to `ask`/`deny`, **never**
  silent broad allow.
- **D4.** Missing *optional* metadata gets conservative defaults; missing *safety-critical* metadata
  is a validation failure, not a default.
- **D5.** Agent files must never inject executable configuration. No secrets serialized into
  contracts.
- **D6.** Contract compilation is **deterministic** and content-hashed; versioned with migration.
- **D7.** **No roster injection.** The full agent list must never enter model context — discovery is
  on-demand (metadata only; full instructions load when selected).
- **D8.** User-owned / external agents are never overwritten. Ownership rules stay authoritative.
- **D9.** Fail closed where a safe recovery path exists; fail **advisory** where hard failure would
  create a repair deadlock (the config-repair-hatch precedent).
- **D10.** Extend existing commands with flags rather than adding duplicates.

---

## 11. Unresolved risks

1. **29 BLOCKER rules cannot detect their own documented violations** (§3.4). Olympus must not claim
   scanner completeness. Disposition undecided.
2. **Two `return`-vs-`continue` scan-abort bugs** (`STATE_012`, `GDPR_007`) — one non-matching file
   aborts scanning of all remaining files.
3. **`GDPR_007` has no PII check at all** — flags every Sentry call as BLOCKER.
4. **Cross-platform gates cannot be executed on this host** (macOS/arm64 only). Any such work is
   "implemented; not yet executed on platform X" — never "tested on X".
5. **Three draft PRs (#121–#123) are awaiting independent review and are unmerged** (#124 merged).
   Long-lived divergence is exactly what caused the §3.1 near-miss; do not let it recur.
6. **Windows/Linux behavior is unverified.** All work was executed on macOS/arm64. PR #122's Windows
   path semantics, and PR 1's, are asserted in unit tests but **not executed on Windows**.
   Cross-platform CI is PR 11 scope.
7. **PR 1 leaves 128 of 128 shipped agents on compatibility-compiled metadata** (§14.7). They are
   governed and safe, but their safety-critical fields are Thesmos's conservative baseline rather
   than an author's declared intent. Enrichment is incremental and explicitly not PR 1 scope.
8. **Role classification is heuristic** (§14.3). It is deterministic and tag-weighted, but a
   mis-tagged agent lands in the wrong role — visibly, in `agents:list`, not silently.

---

## 12. Exact next action

**PR 1 is implemented** (§14) and open as a draft. **PR 2 is implemented** (§15) and open as a
draft. Neither is merged.

**Precondition 1 for PR 2 was waived by the repository owner, not satisfied.** PR 1 (#126) had
zero submitted reviews when PR 2 began, and still has none. The owner was shown that evidence,
reaffirmed twice ("can we merge 126 on main and kickoff the next steps", then "do it"), and PR 2
proceeded on that instruction. This is recorded rather than smoothed over: if review of #126 later
changes the contract's shape, PR 2's runtime is the thing that pays for it, and whoever picks this
up should know the risk was taken deliberately rather than missed.

The merge of #126 itself could not be performed — `gh pr ready` and `gh pr merge` are blocked by
the local tool-permission gate. PR 2 therefore took the path §12/2 prescribes for the unmerged
case: branched from `origin/main` (`1a495e8`) and rebased onto `feat/council-contract`, never
forked from it. **When #126 merges, rebase `feat/mission-graph-runtime` onto `main`** and its diff
reduces to `thesmos/mission/` plus the two touched files.

**Next: PR 3 — Council Records**, on branch `feat/council-records`.

**Preconditions for PR 3, all of which must hold before a branch is created:**

1. **#126 and the PR 2 draft are both merged, or both reviewed.** PR 3 persists what PR 2
   produces; building a record format against two unreviewed schemas compounds the risk that
   §12 has already taken once.
2. **Branch from the latest `origin/main` at that time.** Same rule as before — never fork from
   `feat/mission-graph-runtime`.
3. **The mission state schema is treated as frozen for the record format**, or PR 3 owns the
   migration. `MISSION_SCHEMA_VERSION` is `1.0.0` and `missionStateHash()` is content-addressed;
   a record written against one shape must not silently re-hash under another.
4. **`.thesmos/config.json` is still guard-protected.** Unchanged.

**Scope for PR 3** (from §5/§9 — do not expand): durable, content-addressed records of what a
mission did — no UI, no model intelligence, no marketplace.

**Out of scope, still:** Pantheon Chat redesign, model intelligence, governed packs, checkpoints,
semantic indexing, browser automation, incident systems, unified health, release proof.

---

## 13. Completed / deferred

**Completed:** Phase 0 audit (verified against remote, not assumed); Phase 0A hygiene; Phase 0B this
ledger; two pre-existing threads finalized (billing guardian reconciliation; Proof Gate Phase 2 —
fixture failures 75 → 0, harness 419 green, 29 scanner gaps recorded); and the branch-isolation
split into four independently reviewable draft PRs.

| PR | Branch | Scope |
|---|---|---|
| [#121](https://github.com/Holley-Studio/thesmos-governance/pull/121) | `fix/billing-aware-budget-guardian` | Billing Guardian |
| [#122](https://github.com/Holley-Studio/thesmos-governance/pull/122) | `fix/config-repair-hatch` | Config repair hatch (supersedes #115) |
| [#123](https://github.com/Holley-Studio/thesmos-governance/pull/123) | `hardening/proof-gate-blocker-fixtures` | BLOCKER fixture coverage |
| [#124](https://github.com/Holley-Studio/thesmos-governance/pull/124) | `docs/operation-olympus-ledger` | This ledger (docs-only) |

**Deferred:** PR 3–11. Merging any of #121–#123, #126, and the PR 2 draft (independent review
required for each). Disposition of the 29 scanner gaps. The `unhandled_promise_rejection`
heuristic defect recorded in §14.9, which PR 2 re-confirmed independently (§15.7). Nothing has
been tagged, published, or released.

**Merged since:** #124 (this ledger) as `1a495e8`, which satisfied the PR 1 precondition.

---

## 14. PR 1 — Council Contract Foundation (implemented, awaiting review)

Branch `feat/council-contract`, off `origin/main` at `1a495e8`. Draft PR — **not merged**.

### 14.1 What was built

A narrow module family under `thesmos/council/`, plus one CLI command file. Nothing else in the
repo changed except three CLI wiring files.

| Module | Responsibility |
|---|---|
| `contract.ts` | Versioned types, role/mode/decision enums, hard limit ceilings, stable serialization |
| `matching.ts` | Host-independent path and command normalization, glob matcher, dangerous-shape table |
| `permissions.ts` | Resolution, inheritance, escalation detection, stable decision codes |
| `baselines.ts` | Conservative per-role/per-mode permission, limit, and risk baselines |
| `evidence.ts` | Role-aware evidence categories and handoff field mapping |
| `roles.ts` | The eight roles, their leads, and deterministic tag-weighted classification |
| `sanitize.ts` | Untrusted-text handling, secret redaction, machine-path redaction |
| `compiler.ts` | Frontmatter + ownership + registry → contract |
| `validate.ts` | Deterministic validation with stable codes |
| `handoff.ts` | Typed `AgentHandoff`, normalization, validation, Markdown rendering |
| `load.ts` | Discovery → compilation bridge |

### 14.2 Permission-resolution decision (D3, implemented)

**Most restrictive wins; order-independent.** `deny > ask > allow`. Unmatched → `ask`.
Unparsable restriction → `deny`. A child may narrow inherited permissions and can never widen
them, structurally — the combinator is `mostRestrictive`, so no child rule shape produces a laxer
result than its parent.

Two decisions worth recording because they are not obvious:

- **Restrictive rules match case-insensitively; permissive rules match exactly.** A deny written
  as `src/*.env` must still hold for `SRC/PROD.ENV` on a case-insensitive volume, while case
  folding must never *widen* an allow.
- **Command rules are matched as text.** No shell parsing, no operator splitting, no variable
  expansion. A contract that wants to reason about `a && b` must say so.

### 14.3 Classification

Tag-weighted scoring, not first-match, with the free-text `role:` and `description:` lines
contributing at half weight. First-match would file Themis (legal, contracts, **compliance**, tos,
nda) under Security; weighted scoring files it under Operations. Ties break on the fixed role
order. Unclassifiable agents fall back to `operations` — chosen because its baseline grants the
least — and the fallback is recorded as a compile note.

Reading `description:` matters more than it looks: exported Claude-format agent documents carry no
`tags:`, so without it every exported agent collapsed into the fallback role.

### 14.4 Evidence and handoff model

Eight role-aware baselines, mechanically asserted to be distinct
(`evidenceBaselinesAreDistinct()`), because a shared list would be easy to write and worth nothing.
`AgentHandoff` v1.0.0 is normalized (dedup, sort, path-fold, redact) then validated; a handoff
claiming `complete` without its contract's required evidence is reported **and** downgraded to
`partial`, so a caller reading only the status still cannot be misled.

### 14.5 Compatibility strategy (D2/D4)

Declaring contract metadata is opt-in via flat `council_*` frontmatter keys — flat because the
catalog's frontmatter parser is a line-based YAML subset that flattens nesting.

`provenance.derivation` records **intent, not outcome**. An author who declares any `council_*` key
owns every safety-critical field; a partial declaration stays `explicit` and fails validation.
An earlier iteration relabelled partial declarations as `compatibility`, which made
`COUNCIL_MISSING_SAFETY_METADATA` unreachable — caught by the CLI exit-code test, not by review.

### 14.6 Agents proven

128 contracts compiled from the shipped catalog, **0 errors**. Explicitly asserted: Zeus, Argus,
Athena, Hephaestus, Themis; all eight role leads selectable (`mode != subagent`, `hidden: false`);
every primary role covered; and one external user-owned agent fixture that stays external,
unmodified on disk, and absent from the ownership manifest.

### 14.7 Not migrated

**All 128** remain compatibility-compiled — their safety-critical fields are the conservative role
baseline, not declared intent. This is the documented migration path, not an oversight: PR 1's
mandate was to govern the existing roster without rewriting it. `thesmos agents:validate --migration`
reports exactly which agents and which fields, and writes nothing.

### 14.8 Tests

**314 new tests** across 11 files; full workspace **4,024 passing** (128 files).

| Suite | Tests |
|---|---|
| `council/matching.test.ts` | 48 |
| `council/validate.test.ts` | 49 |
| `council/handoff.test.ts` | 33 |
| `council/compiler.test.ts` | 32 |
| `council/sanitize.test.ts` | 31 |
| `council/catalog-proof.test.ts` | 29 |
| `council/adapter-context.test.ts` | 29 |
| `council/permissions.test.ts` | 27 |
| `bin/commands/council.test.ts` | 22 |
| `council/load.test.ts` | 14 |

Other suites: `extensions/vscode` 93, `actions/pr-review` 108, `thesmos:validate` exit 0
(7 TECH_DEBT, 0 BLOCKER), `thesmos:doctor` 39/39, `thesmos:ci-check` 20/20.

**Where these actually executed.** Locally on macOS/arm64, and in CI on **ubuntu-latest across Node
20.x / 22.x / 24.x** — all 13 PR checks green on `a7fd205`. The `Guard (Windows)` job runs
`guard.cross-platform.test.ts` only; **no council test has executed on Windows.** The Windows path
assertions in `matching.test.ts` are pure-function tests that never touch `node:path` or the
filesystem, so they are semantic coverage of Windows *semantics* — not a Windows run.

### 14.9 Security review

| Vector | Finding |
|---|---|
| Broad later rule overriding a deny | **Not possible.** Order-independent; proven across every permutation of a rule set. |
| Child expanding parent permissions | **Not possible** structurally; `detectPermissionEscalation` also reports attempts, conservatively. |
| Missing metadata becoming allow | **No.** Unmatched → `ask`; missing channel → validation error; baseline never grants `edit`. |
| Malformed pattern failing open | **No.** Unparsable restriction → `deny`; unparsable grant → ignored. |
| Windows form bypassing a POSIX-tested deny | **No.** Separators, drive letters, and UNC prefixes fold before matching; restrictive rules also fold case. |
| External agent auto-adopted | **No.** Compilation is read-only; ownership comes from the manifest. Managed-namespace files absent from the manifest stay external. |
| Duplicate normalized id silently replacing an agent | **No.** `COUNCIL_ID_DUPLICATE` is an error; loading dedups by documented precedence. |
| Source path escaping the repo | **No.** Absolute paths are relativized or reduced to a basename; `..` and absolute forms are validation errors. |
| Frontmatter injecting executable config | **No.** Only known keys are read; unknown keys are ignored entirely. |
| Untrusted Markdown altering permission semantics | **No.** Permissions come from `council_*` keys and the baseline; body text is never parsed for policy. |
| Description breaking generated adapter structure | **No.** Markers, comment terminators, fences, and HTML are neutralized; descriptions are single-line and length-capped. |
| Control sequences reaching a terminal or webview | **No.** ANSI sequences and C0/C1 controls are stripped from every displayed field. |
| Secrets serialized into contracts/reports/handoffs | **No.** Redaction on emission, plus `COUNCIL_SECRET_SERIALIZED` / `HANDOFF_SECRET_SERIALIZED` as an independent second gate. Council patterns are asserted to be a superset of `CONFIG_DEFAULTS.secretPatterns` so the two lists cannot drift. |
| Absolute machine paths exposed | **No.** Home paths keep their shape with the username removed; unrelated absolute paths degrade to a basename. |
| Resource abuse | **Bounded.** Pattern length 512, target 4096, 64 segments, 256 chars per segment, 8 globstars; steps ≤ 200, children ≤ 16, parallel ≤ 8, timeout ≤ 1h. The segment-length cap was added specifically to bound intra-segment backtracking. |
| One malformed agent failing the catalog | **No.** Compilation never throws; unreadable documents are reported in `unreadable`, not swallowed. |

**Residual risk:** cross-platform behavior is asserted semantically on macOS/arm64 — the Windows
path tests are pure-function tests that do not touch `node:path` or the filesystem, so they prove
*semantics*, not Windows execution. That remains PR 11 scope (§11.6).

### 14.9a Thesmos reviewing itself — findings against this PR

The Governance Review action ran on PR #126 and produced **9 BLOCKER, 109 HIGH, 214 other**.
Recorded here because dogfooding results are evidence, not an embarrassment to hide.

**The 9 BLOCKERs were real and are fixed.** All were `secret_in_diff` on this PR's own test
fixtures — the fake credentials that prove redaction works. The rule was right: a literal `ghp_…`
in a test file is indistinguishable from a leaked token to every scanner that reads this repo, and
a repo full of "expected" secret alarms is one where the alarm stops meaning anything. Fixtures are
now assembled from a prefix and a body at runtime (`a7fd205`), which exercises the identical string
while leaving nothing credential-shaped in source. **No baseline entry, no suppression.**

**Most of the 109 HIGH are false positives from one heuristic**, and this is a scanner signal worth
acting on separately:

| Category | Count | Assessment |
|---|---|---|
| `unhandled_promise_rejection` | 79 | **False positive.** `NODE` rule matches any indented `identifier(` in a file that contains `async function` anywhere above it. It fires on `mkdirSync`, `writeFileSync`, `process.stdout.write`, `lines.push` — all synchronous. |
| `debt_exported_function_no_test` | ~20 | Partly fair. Most are covered indirectly through the suites that exercise them; some are barrel re-exports. |
| `timing_attack_comparison` | 7 | **False positive.** Flags `===` on content hashes and ids. These are integrity comparisons, not authentication — there is no secret to leak by timing. |
| `debt_exponential_loop` | 1 | **False positive.** `validate.ts` iterates channels × rules × patterns, all bounded by `MATCH_LIMITS`. |
| "imported but not used" (notice) | ~8 | **False positive.** Every one is a `type` import consumed in a type position. |

Nothing here was contorted to satisfy a heuristic, and nothing was baselined. The
`unhandled_promise_rejection` heuristic producing 79 false positives on a single PR is a defect
worth its own change — **not** bundled into a contract PR, and explicitly not fixed here, because
loosening a HIGH rule's detection inside an unrelated PR is how real findings get lost.

### 14.10 Prompt-context protection (D7)

`thesmos/council/adapter-context.test.ts` fails if any compiled-contract payload or roster listing
reaches a generated adapter: no agent named individually, no contract field name, no permission
pattern, no evidence category, the 8KB generated-section budget intact for all six targets, and
adapter output that does not grow when the roster does. Adapters remain thin and deterministic,
and user content outside the generated markers is preserved.

---

## 15. PR 2 — Mission Graph Runtime (implemented, awaiting review)

Branch `feat/mission-graph-runtime`, based on `origin/main` (`1a495e8`) and rebased onto
`feat/council-contract` per §12/2. One new module, `thesmos/mission/`, plus two touched files.

### 15.1 What it builds

| File | Responsibility |
|---|---|
| `mission/types.ts` | `Mission`, `MissionTask`, `MissionGraph`, `MissionState`, `MISSION_CODES`, issue sorting |
| `mission/graph.ts` | DAG construction, cycle detection, deterministic topological order and execution layers |
| `mission/limits.ts` | Minimum-wins bound combination, `StepBudget`, ceiling clamping |
| `mission/authority.ts` | Task→contract binding, `authorizeTaskAction`, escalation reporting |
| `mission/state.ts` | Content-addressed mission id and state hash, status rollup |
| `mission/create.ts` | Request → validated `Mission` |
| `mission/execute.ts` | The runtime: ordered execution, budget charging, delegation, handoff validation |
| `mission/index.ts` | Internal barrel |

### 15.2 The public API decision (§12/3 — settled)

**The runtime stays CLI-internal. `council/` is still not exported from `thesmos/index.ts`, and
`tsconfig.build.json`'s include list is unchanged.**

The decision rests on how the build actually works, not on preference. `thesmos` builds with
`tsup`, not `tsc`, from three entries: `index.ts` (`dts: true` — the published library), and the
two bin entries (`dts: false`). Because tsup bundles by following imports, and
`bin/commands/council.ts` imports `../../council/*.ts` directly, **`council/` already ships inside
`dist/cli.js` today**. What it is not in is `dist/index.d.ts`.

Four reasons to leave it that way:

1. **No consumer needs it.** The only cross-workspace import of the published library is one
   symbol — `stripGeneratedRegions`, in `actions/pr-review/src/github.ts:15`. The VS Code
   extension does not import the library at all; it drives the CLI.
2. **The CLI already has full access.** Exporting buys the mission runtime nothing it lacks.
3. **The cost is permanent.** Exporting the barrel adds ~150 symbols to `dist/index.d.ts` on a
   published `v5.1.0` package — a semver commitment to a contract that is one day old and that
   PR 3 is likely to move.
4. **The asymmetry favours waiting.** Exporting later is a minor bump; un-exporting later is a
   breaking change.

Revisit when a consumer outside the CLI actually needs programmatic access — not before.

### 15.3 A task can never exceed its mission

Every authority question goes through one call: `resolveInheritedPermission(mission.permissions,
contract.permissions, channel, target)`. There is no second resolver, and no path that consults an
agent's policy alone. Because the combinator is `mostRestrictive`, the property is structural
rather than tested-into-place — no rule an agent can write produces a laxer result than its
mission.

Two consequences worth stating, both pinned by tests:

- **`ask` is not permission.** `TaskAuthorization.permitted` is true only for an outright `allow`.
- **Silence does not inherit.** A mission that allows `edit:**` does not grant `edit` to an agent
  whose own policy is silent — silence resolves to `ask`, and `mostRestrictive(allow, ask)` is
  `ask`. Permission is the intersection of two grants, never the mission's grant alone.

`detectPermissionEscalation` runs at bind time and reports every place a contract claims more than
its mission. Those are **warnings, not errors**: the resolver has already made the widening
impossible at execution time, so an escalation is an authoring smell — a rule that will never fire
— and failing the mission on it would punish an author for a claim the runtime already neutralized.

### 15.4 Bounds

Bounds combine by minimum, in the same spirit as the permission resolver, so combination is
order-independent — `effectiveTaskLimits(a, b)` equals `effectiveTaskLimits(b, a)`, asserted
directly. Missions clamp into `COUNCIL_LIMIT_CEILINGS`; contracts clamp into their mission.

`.thesmos/config.json` is guard-protected and was not touched. Absent, malformed, zero, negative,
`NaN`, and infinite limits all fall back to the published ceiling rather than to zero — a
malformed limit must not silently disable a task.

Delegation is bounded three ways: `maximumChildren` per task (over-delegation truncates and
reports, so the tasks that fit still run), `maximumParallelChildren` per wave, and a hard
`MAX_DELEGATION_DEPTH` of 16 on the parent chain. Delegated ids are checked against every id the
mission knows about, not only the ones that have already executed.

### 15.5 Determinism

Nothing in a hashed structure reads a clock, a random source, or an environment value.

- **Mission ids** are `sha256:<hex>` over a normalized projection that deliberately excludes
  everything derived — order, layers, depth. Reordering the declared task list, reordering a
  `dependsOn` array, or padding the goal with whitespace does not mint a new mission.
- **State hashes** sort tasks, child ids, and issues before hashing. Asserted explicitly: two runs
  whose tasks *finish in opposite orders* produce the same state hash. Tasks in a wave may run
  concurrently, but results are folded back in sorted id order and the budget is charged in that
  same order, so scheduling cannot leak into the outcome.
- One hasher — `contentHash` from `agent-ownership.ts`, the same `sha256:<hex>` the contracts use.
  No second hash format was introduced.

### 15.6 Handoffs

Every task's return value is normalized through `normalizeHandoff` and validated with
`validateHandoff`, given the executing contract and the known agent roster. A handoff claiming
`complete` without the evidence its role requires is recorded at its `effectiveStatus`, not the
status it asserted — and because a dependency is only satisfied by `complete`, a downgraded task
does not unblock what waits on it. That is asserted directly: a thin handoff downgrades to
`partial` and its dependent is skipped rather than run.

A handoff naming a different task fails the task outright. A runner that throws is recorded as a
failed task and the mission continues, so one broken agent cannot take down the report for
everything that did work. Absolute machine paths are stripped via the `root` option, reusing
`council/sanitize` rather than reimplementing redaction.

### 15.7 Findings against PR 2

`thesmos review --base=main --severity=BLOCKER`: **0 BLOCKER**. Nothing baselined, nothing
suppressed, no rule disabled. This branch's own commits touch 15 files — the new `mission/` module,
`council/adapter-context.test.ts`, and this ledger. No baseline, config, or suppression file is
among them.

Because #126 is unmerged, `--base=main` reports PR 1 and PR 2 together: **499 findings (169 HIGH,
56 MEDIUM, 267 LOW, 7 TECH_DEBT)**. PR 1 alone accounts for 341 of them (§14.9).

**The scanner caught one real defect, and it was fixed at the cause.**
`promise_all_no_error_handling` on `mission/execute.ts` was correct: the `try` guarded only the
runner call, leaving the dependency check, upstream assembly, and context construction outside it.
A throw from any of those would have rejected the enclosing `Promise.all` and propagated out of
`executeMission`, destroying the report for every task that had already succeeded — exactly the
behaviour the executor documents that it will never exhibit. Fixed by guarding the whole callback
body, plus a wave-level backstop, with two tests pinning the contract. This is the governance
engine finding a genuine bug in the runtime built to be governed by it, which is the outcome
dogfooding is for.

**Everything else is the §14.9 heuristic, re-derived independently.** Before writing any code, PR 2
read the source at every flagged site on PR 1 rather than trusting the labels, and reached §14.9's
conclusion by itself: `unhandled_promise_rejection` fires on `expect(...)`, `it('…', async () => {`
and `*Sync` fs calls; `timing_attack*` fires on the loop variable `key` and on the *function name*
`sanitizeToken`. In `mission/`, the same rules fire on `issues.push(...)` and on
`sanitizeToken(input.parentTaskId, 64)`; `debt_exponential_loop` fires on `orderTasks`, which is
Kahn's algorithm at O(V+E) with `Map`-backed lookups, not O(n²).

**A new datum on the heuristic's blast radius,** worth carrying into the fix: adding a single line
containing `Promise.reject(` to `mission/execute.test.ts` raised that one file's
`unhandled_promise_rejection` count from ~8 to 41, and the branch total from 127 HIGH to 169. Every
one of the 41 is an `expect(...)`, an `it('…', async () => {`, or an awaited call, and all of them
sit *below* the added line. The rule appears to treat one async marker as poisoning the remainder
of the file. The test was not contorted to avoid it — §14.9's reasoning holds, and loosening a HIGH
rule inside an unrelated PR is how real findings get lost.

### 15.8 Prompt-context protection, extended (D7)

`council/adapter-context.test.ts` gains a second boundary: a real mission is created, executed, and
its identifiers, intents, goal, handoff summaries, commands, risks, and state hash are asserted
absent from all six generated adapters. Adapter output is byte-identical whether or not a mission
has run, and mission-runtime vocabulary (`MISSION_`, `missionId`, `taskId`, `stepsUsed`,
`parentTaskId`, `AGENT_HANDOFF`, …) never appears. A mission is richer than a contract; if it
reached prompt context, every session would pay for state belonging to one run.

### 15.9 Verification

| Gate | Result |
|---|---|
| `npm run typecheck` | clean — `thesmos`, `actions/pr-review`, `extensions/vscode` |
| `npm test` | **4134 passed / 4134**, 133 files |
| `npm run build` | clean — all three workspaces |
| `npm run thesmos:validate` | 7 findings, all TECH_DEBT — **0 BLOCKER** |
| `npm run thesmos:doctor` | 39 checks, all passed |
| `npm run thesmos:ci-check` | 20 checks, all passed |
| `thesmos review --base=main --severity=BLOCKER` | **0 BLOCKER** |
| `git diff --check` | clean |
| `git status --short` | clean |

**107 tests are new**: 95 across the five `mission/` suites, 12 added to
`council/adapter-context.test.ts` (32 → 44).

One caveat on the review gate, stated because it nearly produced a false clean: `thesmos review
--base=main` resolves changed files from the **commit range**, so an uncommitted or untracked
module is invisible to it. The first run of this branch's review reported zero findings against
`mission/` for exactly that reason. The numbers in §15.7 are from a run after the module was
committed. Anyone verifying this branch should commit first, then review.

**Windows was not executed.** The Windows CI job runs only `guard.cross-platform.test.ts`. Path
semantics in `mission/` are asserted in unit tests on this platform, not on Windows. That remains
PR 11 scope, exactly as §14.8 said of PR 1.

### 15.10 What PR 2 deliberately did not do

No CLI command, no Chat UI, no model intelligence, no Council Records, no persistence. The runtime
is a library with a task-runner seam (`TaskRunner`) that a later PR fills. `executeMission` never
invokes a model — it schedules, authorizes, bounds, and validates, and calls whatever runner it is
given. That seam is what keeps model intelligence out of PR 2 while leaving PR 3 somewhere to
stand.
