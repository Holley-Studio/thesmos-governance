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

**PR 1 is implemented** (§14) and open as a draft awaiting independent review. It is not merged.

**Next: PR 2 — Mission Graph Runtime**, on branch `feat/mission-graph-runtime`.

**Preconditions for PR 2, all of which must hold before a branch is created:**

1. **PR 1 has been independently reviewed.** PR 2 consumes `CouncilAgentContract`,
   `AgentHandoff`, and `resolvePermission` directly; building on an unreviewed contract means
   reworking the runtime if review changes the shape.
2. **Branch from the latest `origin/main` at that time** — not from `feat/council-contract`, and
   not from #121/#122/#123. If PR 1 has merged, `main` already carries it; if it has not, PR 2
   must rebase onto it rather than fork it.
3. **The public API question is settled.** PR 1 deliberately did *not* export `council/` from
   `thesmos/index.ts`, to keep the published surface unchanged. PR 2 needs programmatic access, so
   its first decision is whether to export the barrel (and add it to `tsconfig.build.json`'s
   include list) or to keep the runtime CLI-internal.
4. **`.thesmos/config.json` is still guard-protected.** Any runtime configuration PR 2 wants must
   be designed as absent-key defaults, not as a config edit.

**Scope for PR 2** (from §5/§9 — do not expand): a mission graph that turns a request into a
DAG of tasks, each bound to one compiled contract, executing under resolved permissions with
bounded steps and delegation, producing typed handoffs. No Chat UI, no records, no model
intelligence.

**Out of scope, still:** Pantheon Chat redesign, model intelligence, Council Records, governed
packs, checkpoints, semantic indexing, browser automation, incident systems, unified health,
release proof.

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

**Deferred:** PR 2–11. Merging any of #121–#123 (independent review required). Disposition of
the 29 scanner gaps. Nothing has been tagged, published, or released.

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

### 14.10 Prompt-context protection (D7)

`thesmos/council/adapter-context.test.ts` fails if any compiled-contract payload or roster listing
reaches a generated adapter: no agent named individually, no contract field name, no permission
pattern, no evidence category, the 8KB generated-section budget intact for all six targets, and
adapter output that does not grow when the roster does. Adapters remain thin and deterministic,
and user content outside the generated markers is preserved.
