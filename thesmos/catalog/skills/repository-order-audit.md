---
id: repository-order-audit
name: Repository Order Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - audit
  - hygiene
  - governance
  - stewardship
enabled: true
---

# Repository Order Audit

## Purpose

Establish whether a repository still tells the truth about itself: that documented counts match generated truth, that generated artifacts match their sources, that referenced commands and paths still exist, and that every file has a reason to be present.

This is **not** a tidying pass. It produces evidence-backed findings about claims a repository makes and cannot currently support.

## When to use

- A documented count is suspected of being stale ("the README says 67, the map says 68")
- After a migration, rename, or large merge, to detect orphaned and duplicated files
- Before a release, to verify the repository's self-description is accurate
- When root-level clutter has accumulated and nobody can say what is safe to remove
- Periodically, as a scheduled read-only sweep

## Required inputs

- Repository root (absolute path)
- The list of generated paths and, for each, the command that produces it
- The list of hand-authored release artifacts that must never be modified (CHANGELOG, version fields, migration notes)
- Whether the run is **read-only** (default) or **mutation-authorised**, and if authorised, the exact scope

If the generated-path list is not supplied, derive it from `GENERATED`/`DO NOT EDIT` header markers and report the derivation as an assumption.

## Default posture

**Read-only.** This skill reports; it does not change files. Mutation requires an explicit authorised scope AND a checkpoint (commit or stash) taken beforehand.

## Workflow

1. **Inventory.** Count files by classification — authored, generated, vendored, untracked — recording the command for each number.
2. **Collect self-claims.** Extract every mechanically checkable claim: documented counts, referenced commands, referenced paths, version strings.
3. **Resolve generated truth.** For each claim, identify the command that produces the authoritative value.
4. **Compare.** Diff claim against truth. Every mismatch becomes a finding with both values and the command.
5. **Detect structural disorder.** Duplicate basenames across directories, files unreferenced by any manifest, root-level entries not matching the repo's own conventions, directories with no README and no referencing code.
6. **Check generated freshness.** Re-run each generator into a scratch location and compare bytes. Drift is a finding against the artifact, and the fix is always the generator.
7. **Classify ambiguity.** Any artifact with no referencing code AND no explanation is `UNEXPLAINED`, never `DEAD`.
8. **Rank by reversibility.** Order recommendations cheapest-to-undo first.

## Commands

```bash
# Inventory
git ls-files | wc -l
git status --porcelain=v1 | grep '^??'

# Generated-artifact freshness (byte comparison, two consecutive runs)
npm run agents:export --workspace=thesmos
shasum -a 256 thesmos/generated/*.ts extensions/vscode/src/generated/*.ts

# Governance state
npm run thesmos:catalog:validate --workspace=thesmos
npx tsx thesmos/bin/cli.ts doctor
npx tsx thesmos/bin/cli.ts health
npx tsx thesmos/bin/cli.ts drift

# Duplicate basenames across the tree
git ls-files | xargs -n1 basename | sort | uniq -d
```

## Evidence contract

Every finding carries: `id`, `severity`, `path`, `claim`, `evidence command`, `proposed action`, `owner agent`.

The report additionally carries: files reviewed, commands run with exit codes, test results (or `not executed on <platform>`), files changed (`none — read-only audit` unless authorised), unresolved risks, recommended next actions, and per-group confidence.

## Refusal conditions

Refuse and report instead of proceeding when:

- Deletion is requested for a file whose reachability cannot be proven, including via `bin` entrypoints, dynamic imports, globs, or packaging manifests.
- The requested change would edit a generated artifact directly rather than through its generator.
- The requested change touches hand-authored release history (CHANGELOG entries, published version records).
- The action would make a check pass without changing the underlying condition (refreshing a baseline, regenerating a stale report) — this removes the alarm, not the fire.
- Mutation is requested without an authorised scope or without a checkpoint.

## Output schema

```json
{
  "inventory": [{ "classification": "string", "count": 0, "command": "string" }],
  "findings": [{
    "id": "EU-000",
    "severity": "BLOCKER|HIGH|MEDIUM|LOW|TECH_DEBT",
    "path": "string",
    "claim": "string",
    "evidenceCommand": "string",
    "proposedAction": "string",
    "ownerAgent": "string",
    "classification": "STALE|DUPLICATE|UNEXPLAINED|DRIFT|BROKEN_REFERENCE"
  }],
  "commandsRun": [{ "command": "string", "exitCode": 0 }],
  "testResults": "string",
  "filesChanged": ["string"],
  "unresolvedRisks": ["string"],
  "recommendedNextActions": [{ "action": "string", "ownerAgent": "string", "reversibility": "one-command|reviewed|irreversible" }],
  "confidence": [{ "group": "string", "level": "HIGH|MEDIUM|LOW", "reason": "string" }]
}
```

## False-positive handling

- **Count mismatch that is not an error.** A documented number may legitimately describe a different population (authored superset vs exported subset). Always state which population a number claims to count before calling it wrong.
- **Duplicate basename that is intentional.** `index.ts` in many directories is a convention, not duplication. Compare content hashes, not names alone.
- **Unreferenced-but-live.** Files reached via `package.json` `bin`, glob loaders, config strings, or packaging assets appear unreferenced to every static tool. Require an allowlist before treating absence of references as evidence.
- **Untracked-but-wanted.** Local scratch directories may be deliberate. Untracked means unversioned, not unwanted.

## Residual risk

This skill verifies claims that are mechanically checkable. It cannot determine intent: whether an unexplained file *should* exist is a question for the author or for Mnemosyne. It also cannot verify behaviour on platforms it did not execute on — those must be reported as `not executed`, never inferred.

## Related agents

- **Eunomia** — owns this skill
- **Mnemosyne** — receives unexplained artifacts for institutional-memory resolution
- **Kronos** — receives branch, PR, and release-sequencing findings
- **Chiron** — receives structural findings that are really architecture decisions
