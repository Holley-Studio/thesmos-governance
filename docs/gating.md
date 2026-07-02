# The Thesmos Gate Contract

This page is the single source of truth for **when Thesmos blocks a merge and
when it doesn't**. Every gate — `thesmos validate`, `thesmos ci`, and the PR
Review GitHub Action — follows the same policy. If two gates ever disagree,
that's a bug; file it.

## The one-sentence contract

> A pull request is blocked only by **sufficiently confident findings on lines
> it actually changed** (or files it added) that you haven't already accepted —
> everything else is reported, never blocking.

## The pipeline every finding passes through

1. **File filters** — files in `ignoredFolders` (segment match) or
   `reviewIgnorePaths` (prefix match) are never reviewed. Generated regions
   between `<!-- THESMOS:GENERATED START/END -->` markers are stripped before
   rules run, so rules can't fire on their own documentation.

2. **Rules** — 1,137 detections. Each rule carries a **confidence tier**:
   - `high` — near-certain proof (committed secret, disabled TLS verification)
   - `medium` — a shape heuristic that can misfire (an `exec()` template
     literal whose interpolants might be constants)
   - `low` — keyword/presence signals that suggest rather than demonstrate

3. **Inline suppressions** — a `// thesmos-disable-next-line <rule> -- reason:
   <why> -- owner: @who` comment on the line above a finding removes it in
   every gate. Suppressions require a reason; expired ones (past their
   `expires:` date) stop working. `thesmos suppressions:audit` reports unused,
   expired, and blanket suppressions.

4. **Baseline** — `.thesmos/baseline.json` is your accepted-debt ledger
   (`thesmos baseline:create` / `baseline:update`). Baselined findings are
   suppressed from gates and from default `review` output (`--no-baseline` to
   see everything). Fingerprints are content-based, so they survive line
   shifts. `thesmos doctor` warns when the baseline is over 30 days stale.

5. **Diff partition (PR action only)** — findings are split into:
   - **NEW** — on a line this PR changed, in a file this PR added, or
     attached to a required file that doesn't exist (missing compliance
     artifacts gate as NEW by design). Only NEW findings can block.
   - **PRE-EXISTING** — everything else in touched files. Reported in a
     collapsed summary section, never blocking.
   Files whose patch GitHub omits (large/binary) are treated as fully changed
   — fail-closed, because file size is author-selectable.

6. **Confidence gate** — findings below `gate.minConfidence` (default
   `medium`) report with a `[low-confidence]`-style tag but never flip the
   exit code. Raise to `high` if heuristic blocks annoy you; lower to `low`
   if you want everything to gate.

7. **Severity gate** — what remains fails the pipeline per `failOnSeverity`
   (default: BLOCKER) and warns per `warnOnSeverity` (default: HIGH).

## Escape hatches, ranked by preference

| Situation | Use |
|---|---|
| The finding is wrong for THIS line, forever | inline suppression with a reason |
| Legacy debt you'll pay down later | `thesmos baseline:create` / `update` |
| The rule doesn't apply to this repo at all | `disabledRules` in config |
| A subtree intentionally contains detection patterns | `reviewIgnorePaths` |
| Heuristic rules block too eagerly | `gate.minConfidence: "high"` |

## Tamper visibility

A PR that modifies `.thesmos/baseline.json` or `.thesmos/config.json` gets an
unmissable warning at the top of its review summary — reviewers always see
when the gate's own controls changed. For stronger protection, add
`.thesmos/` to CODEOWNERS.
