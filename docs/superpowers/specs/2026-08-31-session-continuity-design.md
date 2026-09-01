# Session Continuity — Design

**Date:** 2026-08-31
**Status:** Approved for planning
**Workstream:** W1 of 2 (W2 — Visible Council — is specified separately)

## The problem, stated as evidence

A session opened on this repository on 2026-08-31 and found:

- local `main` **14 commits behind** `origin/main`, and 5 commits ahead with work already superseded upstream
- `.thesmos/report.json` **39 days stale** (limit: 7)
- `.thesmos/baseline.json` **61 days stale** (limit: 30)
- `.thesmos/context.md` dated 2026-07-23, naming the **wrong project** (`thesmos-helper`), and containing two headings and no content

None of this was surfaced by Thesmos. It was found by hand, after the fact.

The cause is structural, not incidental. Thesmos ships hooks for `PreToolUse`,
`PostToolUse`, and `Stop` — it governs actions *during* a session. It has no
`SessionStart` handler, so nothing establishes ground truth *before* work
begins. `thesmos/hooks.ts` covers git hooks (`pre-commit`, `pre-push`,
`commit-msg`) and is unrelated.

The same gap explains the stale capsule. `context-capsule.ts` already generates
`.thesmos/context.md` correctly and is well-designed for the job. Nothing ever
invokes it, and nothing reads it. `CLAUDE.md` instruction #1 says "Read
`.thesmos/context.md`", which delegates enforcement to model compliance rather
than to the harness. A rule the harness does not enforce is a suggestion.

**What this design adds:** the session lifecycle Thesmos is missing, so that
what the repository knows is true at the moment work starts, and what a session
learns survives into the next one.

## Scope

In scope:

- `SessionStart` — assess and inject repository and artifact ground truth
- `PreCompact` — persist the context capsule before compaction discards detail
- `SessionEnd` — refresh the capsule for the next session
- Configuration surface, defaulted so that an unconfigured repository behaves correctly

Out of scope (deliberately):

- The Visible Council deliberation engine and roster (W2, separate spec)
- Any change to `PreToolUse` / `PostToolUse` / `Stop` behavior
- Automatic remediation. This design **reports and instructs**; it does not
  rebase, reset, or scan on the user's behalf. Acting on a stale repository
  without being asked is a larger and riskier decision than reporting it.

## Architecture

Four modules, one new subcommand, and adapter wiring. The split exists so that
the decision logic is pure and therefore testable without a git repository, a
filesystem, or a running session.

### `thesmos/session/gather.ts` — I/O

Collects `FreshnessInputs` under a hard time budget (400ms total):

- git: current branch, upstream, behind/ahead counts, dirty-file count, whether
  the branch is protected per config
- filesystem: `mtime` of `report.json`, `baseline.json`, `context.md`, and the
  `FETCH_HEAD` marker that dates the last fetch

**Constraint: this module never touches the network.** Behind/ahead counts are
read from cached remote-tracking refs (`git rev-list --count HEAD..@{u}`), which
cost ~45ms. A fetch costs an unbounded network round trip and has no place in a
path that blocks session startup.

Every individual probe is independently failable. A probe that throws or exceeds
its slice contributes nothing and does not prevent the others from reporting.

### `thesmos/session/freshness.ts` — pure assessment

`assessFreshness(inputs, thresholds) → FreshnessReport`

No I/O. Maps inputs to per-signal severity and a single headline. Because it is
pure, the entire staleness matrix — fresh, stale, behind, ahead, diverged,
dirty, detached HEAD, no upstream, not a repository — is unit-testable as a
table, with no fixture repositories to construct or maintain.

### `thesmos/session/render.ts` — presentation

`renderSessionContext(report, maxBytes) → string`

Produces the `additionalContext` payload. Budgeted to ~1200 bytes by default.

The budget is a correctness property, not a preference. `context-capsule.ts`
already documents the reasoning: quality degrades as context fills, and a
session-start notice that crowds out the rules it exists to support is a net
loss. Rendering degrades by dropping whole low-severity sections in a fixed
order, never by truncating mid-sentence.

### `thesmos-guard session-start` — hook entry

A fourth subcommand in `thesmos/bin/thesmos-guard.ts`, alongside
`check | budget-check | drift`. Reads the hook envelope from stdin
(`session_id`, `cwd`, `source`, `transcript_path`), gathers, assesses, renders,
and emits:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "…"
  }
}
```

## Three wire-format constraints

These are load-bearing. Each is already documented or proven in
`thesmos/claude-govern.ts`; this design inherits them rather than rediscovering
them.

**1. Never call `process.exit()` after writing hook JSON.**
On POSIX, a hook's stdout is a pipe and writes are asynchronous. An immediate
`process.exit()` after `write()` truncates the JSON mid-flush and corrupts the
hook's own output. The emitter sets `process.exitCode = 0` and returns, letting
the process exit naturally once the event loop drains
(`claude-govern.ts` §`emitAskDecision`).

**2. The background fetch must not hold the event loop open.**
This is a direct consequence of (1). Because the process exits only when the
loop drains, a spawned child that keeps it alive would hang session startup —
precisely the failure this hook exists to prevent. The fetch is therefore
spawned `detached: true`, `stdio: 'ignore'`, and `.unref()`'d. A regression test
asserts the process exits promptly with a fetch in flight.

**3. `exit 0 + JSON` and `exit codes alone` are distinct signaling modes and must
not be mixed.**
Exit 2 causes Claude Code to ignore stdout entirely. `session-start` always
exits 0, emitting either a JSON payload or nothing at all.

## Fail-open — a deliberate inversion

Every other guard path in Thesmos fails **closed**: when governance cannot
determine whether an action is safe, the action is refused. That is correct for
`PreToolUse`, where the cost of wrongly allowing exceeds the cost of wrongly
blocking.

`session-start` inverts this and fails **open**, including when
`failClosed: true` is configured.

The reasoning: this hook authorizes nothing. It observes and reports. A failure
to observe cannot make an action unsafe — it can only leave the session as
uninformed as it is today, which is the status quo this design improves on. A
session that *refuses to start* because a staleness probe threw is a broken
tool, and its failure mode is catastrophic rather than protective.

This inversion is stated in the module docstring so it reads as a decision
rather than an oversight, and a test asserts it holds under `failClosed: true`.

## The network problem, handled honestly

The hook cannot fetch, so on a repository whose refs were last fetched days ago,
`behind` is *unknown*, not zero. Reporting `0 behind` from a stale cached ref
would be a false statement of fact — exactly the failure mode this repository's
conventions reject elsewhere.

The resolution is to report the uncertainty and act on it:

1. The notice states staleness **and its own confidence**: "`origin/main` last
   fetched 3 days ago — behind-count may be stale; fetch before relying on
   branch state."
2. A detached background fetch is fired, so the *next* turn has current refs.
3. A marker file prevents spawning a fetch on every session in a burst.

Turn one is honest about what it does not know. Turn two knows. Neither pretends.

## The other half: chats falling behind

`PreCompact` is where "chats never fall behind" is actually solved. Compaction
discards detail by design; if nothing durable is written first, everything the
session learned is lost. The `PreCompact` handler regenerates the context
capsule from current repository state before that happens, so the post-compaction
context is seeded with fact rather than summary.

`SessionEnd` does the same for the next session. Both are fail-open and both
reuse `context-capsule.ts` unchanged — this design supplies the missing trigger,
not a replacement.

## Configuration

All keys are optional and defaulted. An unconfigured repository gets correct
behavior; `.thesmos/config.json` is guard-protected against agent edits, and
this design does not require editing it to function.

```json
"session": {
  "start":     { "enabled": true, "backgroundFetch": true, "maxBytes": 1200 },
  "staleness": { "reportDays": 7, "baselineDays": 30, "fetchHours": 12 }
}
```

`reportDays` and `baselineDays` default to the thresholds `thesmos doctor`
already enforces, so the two surfaces cannot disagree about what "stale" means.

## Failure modes

Every row resolves to *the session starts normally*.

| Condition | Behavior |
|---|---|
| Not a git repository | Report artifact staleness only; omit the repo section |
| No upstream / detached HEAD | Report branch state; omit behind/ahead |
| Gather exceeds 400ms | Emit what completed; drop the rest |
| Malformed or absent config | Use defaults; never raise `ConfigLoadError` from this path |
| Any thrown error | Emit nothing; `exitCode = 0` |
| `failClosed: true` | Still fails open (see above) |
| Rendered payload exceeds budget | Drop whole low-severity sections in fixed order |

## Testing

| Suite | Covers |
|---|---|
| `freshness.test.ts` | Pure assessment matrix — fresh, stale, behind, ahead, diverged, dirty, detached HEAD, no upstream, not-a-repo. No I/O. |
| `render.test.ts` | Byte budget under pathological input (200 dirty files, 300-char branch name); stable section ordering; degradation drops sections, never truncates mid-sentence |
| `session-start.test.ts` | Wire contract — valid JSON envelope; exit 0 on every failure mode; no stdout corruption; **process exits promptly with a background fetch in flight**; fails open under `failClosed: true` |
| `session-lifecycle.test.ts` | `PreCompact` and `SessionEnd` regenerate the capsule; both fail open |
| Cross-platform | Follows the existing `guard.cross-platform.test.ts` pattern |

The background-fetch exit test is the one most likely to catch a real
regression, because the failure it guards against — a hung session start — is
both severe and easy to reintroduce.

## Success criteria

- [ ] A session opened on a repository N commits behind reports that at startup
- [ ] A session opened with a stale `report.json` or `baseline.json` reports it, with the refresh command
- [ ] Behind-counts derived from stale refs are labeled as uncertain, never asserted as fact
- [ ] Session startup is never blocked, delayed beyond the budget, or failed by this hook
- [ ] `PreCompact` writes a current capsule before compaction
- [ ] `.thesmos/context.md` reflects the actual project, refreshed automatically
- [ ] Unconfigured repositories get correct behavior with no config edit

## What this does not solve

- **It reports; it does not remediate.** A stale repository stays stale until a
  human or an explicitly instructed agent acts. This is intentional.
- **A first fetch is always one turn behind.** Unavoidable without blocking
  startup on the network. Mitigated by labeling the uncertainty.
- **Cross-session memory beyond the capsule** — durable learning across sessions
  is Mnemosyne's domain (PRs #141–#143), not this design's.
