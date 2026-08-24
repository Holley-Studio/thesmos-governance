---
id: dead-code-audit
name: Dead Code Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - audit
  - hygiene
  - dependencies
  - stewardship
enabled: true
---

# Dead Code Audit

## Purpose

Report unused files, exports, and dependencies in an npm workspace using a module-graph tool, and separate **unreferenced** (provable) from **dead** (not provable by static analysis).

This skill **never deletes anything.** Its output is a reviewed report, because the gap between "no static references" and "safe to remove" is where outages live.

## When to use

- Bundle size or install time has grown without an obvious cause
- After a large refactor or feature removal, to find orphaned modules
- Before a major version, to identify removable surface area
- Periodically, tracked as a regression metric rather than a one-off cleanup

## Required inputs

- Repository root and the workspace layout (this repo: `thesmos`, `actions/pr-review`, `extensions/vscode`)
- **The dynamic-reachability allowlist** — required, not optional:
  - CLI entrypoints declared in `package.json` `bin`
  - Files loaded by glob, dynamic `import()`, or string-built paths
  - Generated files and their generators
  - Packaging assets (`files` arrays, `.vscodeignore`, `.npmignore` inverses)
  - Test fixtures referenced only by pattern
- The previous report, when tracking regressions

If the allowlist is not supplied, produce the report but mark every finding `CONFIDENCE: LOW` and state that no allowlist was applied.

## Tooling

Use **Knip**, or an equivalent module-graph analyser that understands npm workspaces. Do not invent a tool. If Knip is not present in the repository, report that as a prerequisite rather than substituting a hand-rolled grep — a grep-based "dead code" claim is not evidence.

```bash
# Verify the tool is actually available before claiming results
npx knip --version

# Workspace-aware run, JSON for machine consumption
npx knip --reporter json

# Narrow passes
npx knip --include files
npx knip --include exports
npx knip --include dependencies
```

## Default posture

**Read-only, report-only.** Deletion is never performed by this skill, under any authorisation. A deletion is a separate, reviewed change with its own test evidence.

## Workflow

1. **Confirm tooling.** Verify the analyser exists and record its version. Without it, stop and report the prerequisite.
2. **Apply the allowlist** before interpreting anything. Findings that intersect the allowlist are annotated `REACHABLE_DYNAMICALLY` and excluded from the actionable set.
3. **Classify each remaining finding**: `UNREFERENCED_FILE`, `UNUSED_EXPORT`, `UNUSED_DEPENDENCY`, `UNLISTED_DEPENDENCY`.
4. **Cross-check exports against the public API.** An export unused *internally* may be the package's published surface — check `index.ts` re-exports and the `exports` map in `package.json`.
5. **Test-sensitivity check.** For each candidate, ask whether any test would fail if it were removed. If no test covers it, that is itself a finding for Cassandra.
6. **Compare to the previous report.** New entries are a regression; resolved entries are progress. Report the delta, not just the absolute list.
7. **Produce the report.** Never a patch, never a deletion.

## Evidence contract

Per finding: `type`, `path`, `symbol` (for exports), `reason the tool flagged it`, `allowlist intersection`, `test coverage present (yes/no)`, `confidence`.

Report-level: tool name and version, exact command, exit code, allowlist applied (or the explicit statement that none was), counts by type, delta vs previous report, unresolved risks.

## Refusal conditions

Refuse and report instead of proceeding when:

- Deletion is requested. This skill does not delete — route to a reviewed change.
- No dynamic-reachability allowlist is available AND the caller wants actionable conclusions rather than a raw report.
- The module-graph tool is absent. Report the prerequisite; do not substitute grep and present the result as equivalent.
- A finding lies inside generated output. The generator owns that file; deleting its output is meaningless.

## Output schema

```json
{
  "tool": { "name": "knip", "version": "string", "command": "string", "exitCode": 0 },
  "allowlistApplied": true,
  "findings": [{
    "type": "UNREFERENCED_FILE|UNUSED_EXPORT|UNUSED_DEPENDENCY|UNLISTED_DEPENDENCY",
    "path": "string",
    "symbol": "string|null",
    "reachableDynamically": false,
    "testCoverage": true,
    "confidence": "HIGH|MEDIUM|LOW"
  }],
  "counts": { "unreferencedFiles": 0, "unusedExports": 0, "unusedDependencies": 0 },
  "delta": { "new": 0, "resolved": 0, "comparedAgainst": "string|null" },
  "unresolvedRisks": ["string"],
  "recommendation": "report-only — deletions require a separate reviewed change"
}
```

## False-positive handling

Module-graph tools are blind to four reachability classes. Each is a known false-positive source, not a tool defect:

1. **CLI entrypoints** — reached via `package.json` `bin`, never imported.
2. **Dynamic imports** — `import(someVariable)` or string-built paths defeat static resolution.
3. **Generated files** — written by a generator, sometimes consumed only at runtime.
4. **Packaging assets** — templates, schemas, and fixtures shipped by a `files` array but never imported.

A fifth, subtler case: **an export that is the package's public API**. It is unused *within* the repo by design; removing it is a breaking change for consumers.

## Residual risk

A clean report does **not** mean the code is reachable — only that this tool found references. Conversely, a flagged item is not proven dead. This skill narrows where a human should look; it does not replace the human. Any claim stronger than "unreferenced by static analysis, with allowlist X applied" is unsupported.

## Related agents

- **Eunomia** — owns this skill
- **Cassandra** — receives the coverage gaps surfaced in step 5
- **Chiron** — receives findings that imply a boundary or public-API decision
- **Kronos** — receives dependency changes that affect packaging or release
