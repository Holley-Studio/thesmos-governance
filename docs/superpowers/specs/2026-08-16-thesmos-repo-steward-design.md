# Thesmos Repo Steward — Design

**Date:** 2026-08-16
**Status:** Approved, ready for implementation planning
**Scope:** `thesmos/` — PR merge engine, dependency policy, repo health, deploy gate
**Decision authority:** Local CLI + existing Thesmos GitHub Action. No hosted service.

---

## 1. Problem

Thesmos users accumulate pull requests they cannot safely land. This is observed, not
hypothesised — it was measured on Thesmos's own repositories on 2026-08-05:

| Repository | Open PRs | Mergeable without intervention |
|---|---|---|
| `thesmos-governance` | 24 | 3 |
| `HolleyStudios` | 15 | 0 |

The backlog was not caused by bad code. It was caused by five mechanical failures that a
deterministic engine can detect and, in most cases, repair:

1. **A dead required check.** CodeQL could never pass on a private repo without Code
   Security enabled. Every PR showed red for a reason unrelated to its contents. 18 PRs
   were unreviewable because of one workflow file.
2. **Invisible dependency chains.** Two stacked chains existed (`#135→#136→#137`, and
   `#140→#141→#142→#143→#144→#145`). GitHub renders these as six independent PRs. Merging
   them out of order silently pulls unreviewed parent commits into `main`.
3. **A red base under a live stack.** `#140` failed CI while five PRs stacked on top of it.
   Nothing in the GitHub UI communicates "this entire column is dead."
4. **Obsolete PRs nobody noticed.** `#9` and `#6` bumped a GitHub Action that a merged PR
   had already deleted. They were unmergeable *and* pointless, and stayed open for weeks.
5. **Dependency PR flood.** 21 of 39 open PRs were Dependabot. Ungrouped, they arrive
   faster than a solo maintainer can evaluate them.

None of these require judgment. All five are computable from data `gh` already returns.

### 1.1 Who this is for

The primary user writes code predominantly through an AI agent and has limited Git or
GitHub fluency. This is now the majority case: roughly 41% of committed code is
AI-generated, and 92% of US developers use AI tooling daily.

Two consequences shape every decision below.

**They cannot self-serve a rebase.** Documented beginner failure modes are committing an
entire agent session as one change, generic commit messages, and never pulling `main`
until conflicts are unresolvable. Any design that answers a problem with "rebase onto
main and resolve the conflict" has not solved it for this user.

**Their code needs the gate more than most.** AI-generated code carries measurably higher
defect density — on the order of 2.7× the security findings of human-written code, with
failures on basic security tests in a large fraction of samples. The population producing
the most code is the least equipped to review it. That is the wedge: not merge automation,
and not scanning, but *scanning wired directly to merge authority*.

---

## 2. Prior art

Two mature markets exist and they do not overlap.

**Merge orchestration** — Mergify, Aviator, Graphite, and open-source Kodiak. These order
and land PRs correctly, including stack-aware ordering that GitHub's native merge queue
does not support. They have no opinion about code quality: the only question they ask is
"is CI green." Commercial options run $12–21/user/month.

**Governance gating** — GitLab MR approval policies, Harness policy-as-code, Semgrep. These
block merges on finding severity. They orchestrate nothing: no ordering, no stacks, no
queue, no repair.

**Nothing occupies the intersection, and nothing targets the non-expert.** Thesmos already
owns the half that is expensive to retrofit — a deterministic severity model in which
BLOCKER never ships. That is already a merge gate. It has simply never been connected to
merge authority.

### 2.1 What we take, and from where

| Source | Mechanism | Why |
|---|---|---|
| Mergify | **Speculative verification** — test each PR against the *projected* state of `main`, not its current state | The only defence against semantic conflicts: two PRs green alone, red together |
| Graphite | **Auto-restack on modify** — amending a branch republishes every descendant | Makes stacks survivable; without it a 6-deep chain is unmaintainable by hand |
| Semgrep | **Fix, don't block** — deliver remediation as a branch, not a red X | Measurably faster resolution; for our user, a red X is a dead end |
| Semgrep Supply Chain | **Safe-upgrade analysis** — classify which bumps are safe, flag line-level breaking changes | Directly answers the stalled major-version bumps |
| GitHub Dependabot guidance | **Grouping** — one PR per ecosystem, not per package | Reported 30+/week → 2–3/week; converts triage into prevention |
| DORA 2026 | **MTTR over velocity** — deploy frequency and lead time became misleading once AI writes most code | A vibe coder posts excellent velocity while shipping vulnerabilities. Recovery is the honest metric |

---

## 3. Non-goals

Explicitly out of scope, to keep the first implementation finishable:

- **No hosted service.** No Thesmos-operated infrastructure, no stored repo write tokens.
  Everything runs on the user's machine under their own `gh` credentials.
- **No replacement for CI.** Thesmos reads check results; it does not run test suites.
- **No conflict resolution.** If Git reports a textual conflict, Thesmos explains it and
  stops. Auto-resolving conflicts for a user who cannot read a diff is unsafe.
- **No canary or percentage-based traffic shifting.** Progressive delivery tooling is
  Kubernetes-centric and irrelevant to a solo maintainer on managed hosting. The relevant
  deployment primitive here is *fast revert*, not gradual rollout.
- **No cross-repo orchestration** in v1. One repository per invocation.

---

## 4. Architecture

Four subsystems over one shared spine.

```
                    thesmos ship            ← single intent surface
                          │
        ┌────────────┬────┴───────┬──────────────┐
        │            │            │              │
   ┌────▼────┐  ┌────▼────┐  ┌────▼────┐   ┌────▼────┐
   │ 1 MERGE │  │ 2 DEPS  │  │ 3 HEALTH│   │ 4 DEPLOY│
   │ ENGINE  │  │ POLICY  │  │ MONITOR │   │  GATE   │
   └────┬────┘  └────┬────┘  └────┬────┘   └────┬────┘
        └────────────┴─────┬──────┴─────────────┘
                           │
                  ┌────────▼─────────┐
                  │  ACTION LEDGER   │  append-only record of every
                  │  + REVERT        │  autonomous act, each undoable
                  └──────────────────┘
```

The ledger is the spine. **No subsystem may take an autonomous action without first
writing an intent record to the ledger.** This is what makes unattended operation
acceptable: nothing Thesmos does while unobserved is invisible or one-way.

### 4.1 Module boundaries

New modules under `thesmos/`, each independently testable:

| Module | Responsibility | Depends on |
|---|---|---|
| `pr/graph.ts` | Build the PR dependency graph from `gh` data. Pure function: JSON in, graph out | — |
| `pr/plan.ts` | Compute merge waves from graph + check state + severity. Pure | `pr/graph` |
| `pr/execute.ts` | Perform merges via `gh`. The only module that mutates GitHub | `pr/plan`, `ledger` |
| `pr/classify.ts` | Assign a reversibility class to a PR | `deps/semver` |
| `deps/semver.ts` | Parse Dependabot titles into `{ecosystem, package, from, to, bump}` | — |
| `deps/policy.ts` | Grouping config generation and safe-upgrade analysis | `deps/semver` |
| `health/score.ts` | Compute repo health from ledger + `gh` data. Pure | `ledger` |
| `ledger.ts` | Append-only action log, digest-chained | — |
| `revert.ts` | Watch `main`, detect regression, execute revert | `ledger`, `pr/execute` |

The pure/impure split is deliberate: `graph`, `plan`, `classify`, `semver`, and `score`
are pure functions over fixtures, so the difficult logic is testable without network
access. `execute` and `revert` are the only modules that mutate anything, and they are
thin.

---

## 5. Subsystem 1 — Merge Engine

### 5.1 Dependency graph

For every open PR, `gh` supplies `baseRefName` and `headRefName`. Construct a forest:

```
node  = PR
edge  = PR.baseRefName === otherPR.headRefName   (this PR stacks on that one)
root  = PR.baseRefName === repo default branch
```

Verified against live data during investigation: `#136` has `base=feat/model-routing-v5`,
which is `#135`'s head — so `#136` is `#135`'s child. Six-deep chains resolve correctly.

**Cycle detection is required.** A malformed retarget can produce a cycle; the engine must
detect it, refuse to plan, and name the PRs involved rather than looping.

### 5.2 Wave computation

A PR is **ready** when all hold:

1. Every ancestor is merged or in an earlier wave in this plan
2. `mergeStateStatus` ∈ {`CLEAN`, `BEHIND`} — `BEHIND` is auto-updatable, `DIRTY` is not
3. All required checks pass
4. Thesmos review of the merge result yields **zero BLOCKER findings**
5. It is not draft, or `--ready` was passed
6. Its reversibility class permits the requested autonomy level

Waves are assigned by topological depth, then ordered within a wave by ascending
`changedFiles` — smallest first, because small PRs are least likely to conflict with the
ones behind them and cheapest to revert.

### 5.3 Speculative verification

The mechanism that prevents semantic conflicts. For a planned wave `[A, B, C]`, do **not**
verify each against current `main`. Verify each against the projected state:

```
verify(A) against main
verify(B) against main + A
verify(C) against main + A + B
```

Implementation without a hosted service: create an ephemeral local branch, merge the
projected set into it, and run `thesmos validate` plus the repo's own typecheck/test
command against that tree. This runs on the user's machine — which is precisely why the
local-CLI architecture was chosen. A pure GitHub Action cannot easily construct these
projected states.

**Cost control.** Full speculative verification is expensive. Default to verifying only
across PRs whose changed-file sets intersect; disjoint PRs cannot semantically conflict in
any way this check would catch. Fall back to full verification with `--paranoid`.

### 5.4 Halt states

Named, loud, non-silent conditions. Each must be reported with the specific PR numbers:

| State | Meaning | Behaviour |
|---|---|---|
| `RED_BASE` | A PR with descendants has failing checks | Halt that entire column. Report the base and everything it blocks |
| `CYCLE` | Dependency cycle among PRs | Refuse to plan; name the cycle |
| `DIRTY` | True merge conflict | Skip; explain in plain language; never auto-resolve |
| `BLOCKER` | Thesmos severity gate fired | Skip; attach fix branch if one is computable |
| `OBSOLETE` | PR modifies files deleted on target | Recommend close, with the deleting commit as evidence |
| `DUPLICATE_INTENT` | Two PRs' changed-path sets overlap beyond threshold | Warn; ask which owns the change |

`RED_BASE` is the state that GitHub renders invisibly today and that cost the most time
during investigation.

### 5.5 Command surface

Expert verbs, all composable:

```
thesmos pr:queue                 # show the computed plan; never mutates
thesmos pr:merge --wave 1        # execute one wave
thesmos pr:merge --all           # execute every wave, halting on first failure
thesmos pr:fix <n>               # generate a fix branch for a blocked PR
thesmos pr:explain <n>           # plain-language: why is this stuck?
thesmos pr:tidy                  # close obsolete PRs, delete merged branches
```

---

## 6. Autonomy policy

The user elected automatic merge on green. Autonomy is bounded by **reversibility**, never
by confidence — a confident wrong merge is still wrong, whereas a cheaply-revertible one is
survivable.

### 6.1 Reversibility classes

| Class | Contents | Autonomy |
|---|---|---|
| **Reversible** | Patch bumps, dev-only deps, formatting, lockfile-only, regenerated artifacts | Auto-merge when green |
| **Recoverable** | Minor bumps, internal refactors, test-only changes, docs | Auto-merge when green, **auto-revert armed** |
| **One-way** | Major bumps, migrations, `main` force-push, `npm publish`, tag pushes, deletions, anything touching auth/payments/secrets | **Never automatic.** Always asks |

Classification is computed by `pr/classify.ts` from the semver delta, the changed-path set,
and the Thesmos rule categories triggered. When classification is *uncertain*, the PR is
treated as **one-way**. Ambiguity resolves toward asking.

A published npm package cannot be meaningfully unpublished, so publishes are one-way
regardless of how green the checks are. Reversibility is a property of the world, not of
the test suite.

### 6.2 Auto-revert

The mechanism that makes automatic merging defensible.

**The watcher cannot live in the CLI.** A local poll dies when the laptop sleeps, and a
safety guarantee that depends on the user keeping a terminal open is not a guarantee. The
watcher is therefore the *Action* half of the hybrid architecture — this is the specific
job that justifies the split:

| Half | Job | Why it must be there |
|---|---|---|
| **Local CLI** | Build projected trees for speculative verification | Needs a real working tree; an Action cannot cheaply construct arbitrary merge states |
| **GitHub Action** | Watch `main`, execute reverts | Must survive a closed laptop |

```
CLI, at merge time:
  fsync { pr, mergeCommit, timestamp, class, watch: armed } to ledger
  then perform the merge          # ledger-before-action, always

Action (`thesmos-watch.yml`), on push to default branch:
  if head check suite fails
     AND a ledger entry marks a Thesmos merge within the last N commits:
        culprit  = newest armed Thesmos merge in the failing range
        open revert PR, merge it
        append revert to ledger
        report loudly: what, why, and how to re-land

CLI, on next run:
  reconcile — replay ledger against actual branch state,
  surface any revert that happened while the user was away
```

Defaults: N = 5 commits, one revert attempt per incident. If a revert itself fails,
autonomy halts entirely and demands human attention — it must never thrash.

Because the ledger is committed to the repository, the Action and the CLI share one source
of truth without any Thesmos-operated service holding state.

**Auto-revert never applies to one-way actions**, because they were never automatic.

### 6.3 Kill switch

`thesmos autonomy off` halts all unattended action immediately and persists across runs.
A single `AUTONOMY_DISABLED` sentinel is checked before any mutation. This must be
impossible to miss in the docs.

---

## 7. Subsystem 2 — Dependency Policy

Backlog reduction is mostly *prevention*, not triage.

**Grouping.** Generate a `dependabot.yml` grouping config: dev dependencies in one PR,
production dependencies by major version in another, security patches always separate and
never delayed. Reported effect elsewhere: 30+ PRs/week → 2–3.

**Classification.** `deps/semver.ts` parses Dependabot titles (`bump X from 1.2.3 to
1.3.0`) into a structured bump. This drives the reversibility class directly.

**Safe-upgrade analysis.** For major bumps — the ones that stall — fetch the changelog and
report *specifically* what breaks, at line level where determinable, rather than "this is a
major, be careful." This is the single highest-value piece of Subsystem 2 and the reason
eight bumps sat untouched for weeks.

---

## 8. Subsystem 3 — Health Monitor

Deliberately **not** a velocity dashboard. Velocity metrics are actively misleading for
this user: an AI-assisted solo developer trivially posts excellent deploy frequency while
accumulating defects.

Tracked signals:

| Signal | Source | Why |
|---|---|---|
| **MTTR** | Ledger: red `main` → green `main` | The one DORA metric that survived the AI era |
| **Is `main` green right now** | Check suite on default branch | Binary, honest, immediately actionable |
| **BLOCKER debt** | `thesmos scan` | Findings that must never ship, currently shipped |
| **PR age p50/p90** | `gh` | Rising age predicts conflict pain |
| **Stale branches** | Merged or >90d untouched | Cleanup target |
| **Dependency lag** | Deps policy | Security exposure |

Health is reported as named states — `HEALTHY`, `DEGRADED`, `AT_RISK` — with the specific
causes listed. **No composite 0–100 score.** A single number invites optimisation of the
number; naming the actual defect invites fixing the defect.

---

## 9. Subsystem 4 — Deploy Gate

Runs before any release action (tag push, `npm publish`, extension publish).

Refuses when: `main` is not green; BLOCKER findings exist; the ledger holds an unreconciled
auto-revert; product-facts or generated artifacts are stale; required license files are
absent.

Because Thesmos's own release path is CI-only via tag push, the gate's job is to refuse to
*create the tag*. It never needs registry credentials — which keeps the local-first
guarantee intact.

---

## 10. User experience

The vocabulary must not leak. No "rebase", "queue", "topological", "speculative".

```
$ thesmos ship

  Looked at 24 open pull requests.

  ✓ Merged 3 for you           updated 3 packages, all tests passed
                               → undo any of these with: thesmos undo

  ⏸ 6 are waiting on others    they build on each other, so they go in order
                               → next 2 unlock once #135 lands

  ✗ 1 is stuck                 #137 — its product facts are out of date
                               → I can fix this: thesmos pr:fix 137

  ⚠ 1 needs you                #140 is failing, and 5 others are built on top of it
                               → nothing above it can move until it's fixed

  ⚠ 2 need a decision          major version updates — these can break things
                               → thesmos pr:explain 14

  Repo health: DEGRADED — main is green, but 2 BLOCKER findings are on main.
```

Principles: state what happened before what is blocked; always give the next command; never
present a dead end; name the specific PR, never "some PRs".

---

## 11. Error handling

| Failure | Response |
|---|---|
| `gh` absent or unauthenticated | Detect at start, explain install/auth, exit non-zero |
| GitHub API rate limit | Back off; report remaining quota; never partially execute a wave |
| Network loss mid-wave | Ledger records intent before action, so recovery is resumable |
| Merge succeeds, ledger write fails | Ledger write is fsync'd *before* the merge call; a merge with no ledger entry is impossible |
| Concurrent Thesmos runs | Lockfile in `.thesmos/`, stale-lock expiry, second run refuses |
| Revert fails | Halt all autonomy, demand human attention, never retry blindly |

---

## 12. Testing

Following the repo's existing Vitest patterns.

**Pure-function fixtures.** `graph`, `plan`, `classify`, `semver`, and `score` are tested
against recorded `gh` JSON. The two real chains found on 2026-08-05 become permanent
fixtures — a 6-deep stack with a red base is a better test case than anything synthesised.

Required cases:

1. Six-deep chain orders correctly
2. Red base halts its whole column, and only that column
3. Cycle is detected, not looped
4. Speculative verification catches a planted semantic conflict
5. One-way class never auto-merges, including when green
6. Uncertain classification resolves to one-way
7. Auto-revert fires on red `main` and reverts the right commit
8. Failed revert halts autonomy
9. Kill switch blocks every mutation path
10. No mutation occurs without a preceding ledger entry
11. Obsolete PR (touches deleted files) is detected
12. Ledger is digest-stable and append-only
13. Concurrent runs cannot double-merge
14. Windows/macOS/Linux path handling

Fake clocks throughout. No retries masking flakes.

---

## 13. Security and privacy

Local-first, consistent with existing Thesmos guarantees. No Thesmos-operated service, no
stored credentials — `gh`'s existing auth is used and never read. The ledger records PR
numbers, SHAs, and outcomes; never diffs, source, or secrets. Ledger lives in `.thesmos/`
and is git-ignored. No telemetry leaves the machine.

---

## 14. Phasing

| Phase | Delivers | Value on landing |
|---|---|---|
| **1** | Ledger + revert + merge engine (graph, plan, execute, classify) | Clears the existing backlog; the only phase that must be perfect |
| **2** | Dependency policy: grouping, semver, safe-upgrade analysis | Stops the flood at source |
| **3** | Health monitor | Honest MTTR-based reporting |
| **4** | Deploy gate | Release safety |

Phase 1 standing alone is already a product nobody else sells: a stack-aware merge queue
gated on governance severity, running locally for free.

---

## 15. Open questions

1. **Speculative verification cost.** Path-intersection heuristic is proposed; needs
   validation against the real chains before committing to it as the default.
2. **Revert culprit attribution.** With several merges inside one watch window, "newest
   first" is a heuristic. Bisection is correct but slow. Phase 1 uses the heuristic and
   reports uncertainty honestly.
3. **Draft PRs.** Currently excluded unless `--ready`. Most of the observed backlog was
   drafts, so this default may be wrong in practice.
4. **Changelog fetching** for safe-upgrade analysis needs network access, which sits
   awkwardly beside the local-first guarantee. Proposed: opt-in, explicit, cached.
