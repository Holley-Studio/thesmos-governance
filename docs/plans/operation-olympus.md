# Operation Olympus — Master Execution Ledger

> **Single source of truth for the Olympus program.** Do not create competing planning docs.
> Update this file after every PR. A fresh session should be able to resume from §12 alone.
>
> Created 2026-07-27. Status: **Phase 0 / 0A / 0B complete. PR 1 (Council Contract) NOT STARTED.**
>
> The pre-Olympus work has been split into four independent draft PRs off `origin/main`:
> **#121** Billing Guardian · **#122** config repair hatch (supersedes #115) ·
> **#123** BLOCKER fixture coverage · **#124** this ledger.
> None are merged. Council Contract work begins only after this ledger is merged or explicitly
> approved as the canonical plan.

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
| 1 | `feat/council-contract` | **NOT STARTED** ← next |
| 2 | `feat/mission-graph-runtime` | blocked on PR1 review |
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
5. **Four draft PRs (#121–#124) are awaiting independent review and are unmerged.** Long-lived
   divergence is exactly what caused the §3.1 near-miss; do not let it recur.
6. **Windows/Linux behavior is unverified.** All work was executed on macOS/arm64. PR #122's Windows
   path semantics are asserted in unit tests but **not executed on Windows**. Cross-platform CI is
   PR 11 scope.

---

## 12. Exact next action

**Execute PR 1 — Council Contract Foundation.** Nothing of PR 1 has been written yet.

**Precondition:** start only after this ledger (#124) is merged or explicitly approved as the
canonical plan. Branch from the **latest** `origin/main` at that time — **not** from #121/#122/#123:

```bash
git checkout -b feat/council-contract origin/main
```

Scope (see the Operation Olympus brief for the full type sketch):

1. `CouncilAgentContract` types — versioned schema, conservative defaults, `AgentMode`
   (`primary|subagent|all`), `PermissionDecision` (`allow|ask|deny`), modelPolicy, permissions,
   limits, scope, risk, evidence, handoff, provenance.
2. A **backward-compatible compiler** from existing `CatalogFrontmatter` + body → contract, honoring
   D2/D4/D6.
3. A deterministic **validator** with stable error codes.
4. Typed `AgentHandoff` envelope.
5. CLI: extend `thesmos agents:list` with `--primary` / `--specialists`; add `agent:show`,
   `agent:validate`, `agents:validate`; all mutations `--dry-run`, atomic, rollback-safe, audited.
6. Prove the contract on: the 8 primary roles, Zeus, Argus, Athena, Hephaestus, Themis, and **one
   external user-owned agent fixture**. Do **not** migrate all 67 specialists — document the process.
7. Tests for all 21 categories in the brief (valid primary, valid subagent, hidden specialist,
   migration, missing/invalid/unsafe permissions, limits, evidence, provenance, duplicate IDs,
   external vs managed, determinism, stable hashing, no secret serialization, Windows + POSIX paths,
   adapter compatibility, round-trip, **no roster payload regression**).

**Out of scope for PR 1:** mission graph, any Pantheon Chat UI, model intelligence, records, packs,
checkpoints, indexing, browser, incidents, release proof. Do not bundle later phases.

**Validation required before `READY FOR INDEPENDENT REVIEW`:** the full command battery in the brief
with **exact counts reported**, plus `git diff --check` and `git status --short`. Nothing merged,
tagged, published, or released.

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

**Deferred:** all of PR 1–11. Merging any of #121–#124 (independent review required). Disposition of
the 29 scanner gaps. Nothing has been merged, tagged, published, or released.
