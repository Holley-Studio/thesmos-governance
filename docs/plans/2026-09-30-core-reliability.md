# September 2026 core reliability review

This review improves the Thesmos engine that the Pantheon desktop uses. Changes are local and unreleased. Existing desktop, provider, channel, and knowledge-desk work is preserved. No commit, push, merge, package publication, or installed desktop replacement was performed.

## Concrete behavior changes

| Area | Previous behavior | Result |
| --- | --- | --- |
| Evidence | Parsed JSON could be malformed structurally; partial reads could hide older events | Validated records, explicit integrity diagnostics, full selected history |
| Evaluation | Runtime totals could include events outside the chosen period | Governance, receipts, activity, and metrics use the same time window |
| Receipts | Caller identifiers and untyped fields reached file writes | Portable identifier and structural validation before writes; chronology determines the latest receipt |
| Memory recall | Missing query identity could expose a record bound to a client or repository | Bound identities require an exact match |
| Memory proposals | An approval-required result could be persisted; matching text could cross client boundaries | Only accepted proposals persist; deduplication and supersession respect the namespace and evaluated sensitivity |
| Memory storage | Read/modify/replace operations could overwrite a concurrent writer | An exclusive directory lock covers each mutation; a six-process test retains all 72 successful writes |
| Damaged memory | Rewriting a partially readable record file could lose malformed rows | Reads report damage; mutations stop until the original file is preserved and repaired |
| Embeddings | Non-finite, stale, or incompatible vectors could influence ranking | Invalid vectors are rejected or excluded; lexical recall remains available |
| Commit helper | Shell execution and message handling were fragile | Git argument arrays and stdin preserve literal messages; blocking findings prevent the wizard from committing |
| Windows | Native separators and process wrappers broke scanner ignores and tests | Portable repository paths and appropriate Node/process invocation |
| Rule precision | Schema checks, synchronous calls, regex methods, comments, or existing tests were misclassified | Targeted positive and negative regression cases; no rule or baseline was disabled to obtain a pass |

The Windows CI job now runs the complete core test suite and typecheck. GitHub-hosted execution remains unobserved until these changes are integrated and pushed through an authorized release workflow. Core build artifacts were regenerated locally; committed action and extension bundles were not rebuilt.

## Verification and release gates

The baseline on this checkout had nine failing test files and 21 failing tests. New failing regression cases reproduced additional evidence, memory, and rule-precision problems before their fixes. The latest machine-readable test results and audit output are retained with the local review deliverable.

Before release:

1. Review the owned-file changes separately from the existing desktop/provider work. Reconcile this branch with current main without overwriting either body of work.
2. Re-run typechecks, core build, full core tests and coverage, action tests, extension tests, and desktop tests on the integration result.
3. Review full source findings rather than relying on a scan-only or BLOCKER-only pass. Test-reference findings can describe indirect coverage poorly; confirm actual tests and fix genuine gaps.
4. Complete GitHub-hosted Windows and Linux CI. Build and verify the action/extension release bundles from the approved source before distributing them.
5. Exercise the updated engine in the OHW pilot, retain source-backed task/evidence updates, and measure actual completion, correctness, review effort, latency, and model usage. Publish or replace installed software only through an explicitly authorized release.

## Known limits and follow-up

- Issue #96 remains open. The registry has 1,137 rules and 219 declared BLOCKER rules; the dedicated BLOCKER fixture harness has 10 explicit fixtures. The other 209 require proof. Tests elsewhere do not automatically satisfy that acceptance criterion. PR #123 is related work to review, not an integrated result.
- Issue #125 is implemented locally, with dedicated governance-log tests and literal commit-message regressions. It remains open until review and integration.
- The working branch was 14 commits ahead and 14 behind origin/main when inspected. Existing desktop/mission pull requests overlap; a blind merge or cherry-pick is inappropriate.
- The production dependency audit is clean after compatible updates. A low-severity esbuild development-server advisory remains through tsup's 0.27 dependency constraint. Track a compatible upstream/tooling update; a clean production audit does not mean the development tree is advisory-free.
- JSONL remains a local, unsigned, linear-scan store. Large histories need measured performance work; the current change prioritizes complete evidence over an arbitrary tail cutoff.
- Lock recovery is manual and conservative. An abandoned `.thesmos/memory/.write.lock` is not automatically stolen. Inspect its owner, verify the writer has stopped, preserve the store, and repair through an intentional recovery procedure.
- This is not a server authorization boundary or a multi-file transactional database. Session/agent access control, encrypted backups, adversarial review, and recovery drills remain separate concerns.
- The current tests do not certify a subscription provider's terms, entitlement, availability, desktop packaging, Google Drive scheduling, or end-to-end business outcomes.

## Business operating model

Keep the canonical Studio and client task lists in Google Drive. Use curated, source-linked local Markdown snapshots for approved context, with exact client identity attached to every recall. Let Ollama handle suitable local extraction and drafting; use authenticated CLI or API providers according to their actual entitlement for higher-complexity work. An agent proposal is not a business decision: preserve validation, approval, evidence, and delivery review as explicit steps. Production changes and client-facing delivery need the workflow's authorized human approval.

Measure the Pantheon by completed, reviewed business work rather than agent count. Start with the OHW audit-to-remediation-to-verification loop, reusable deliverable checklists, and reliable task reconciliation before expanding unattended execution.
