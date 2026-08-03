---
id: model-routing-audit
name: Model Routing Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - audit
  - models
  - routing
  - governance
  - stewardship
enabled: true
---

# Model Routing Audit

## Purpose

Verify that every model surface in the repository agrees with the canonical registry, and that what the system *says* it ran matches what it *actually* ran.

Model drift is expensive in a way most drift is not: a stale id fails at runtime rather than at review, a wrong price silently misreports spend, and a frontier pin multiplies cost on every future invocation without anyone re-deciding.

## When to use

- A provider has published new model ids, or deprecated existing ones
- Before a release that touches routing, budgeting, or the model picker
- When reported spend does not match expected spend
- When a chat surface shows a different model than was requested
- Periodically, as a scheduled read-only sweep

## Required inputs

- Repository root
- The canonical registry (`thesmos/models/registry.ts`)
- Optionally: observed `ModelRouteDecision` records for requested-vs-effective checks
- Optionally: the installed CLI version, for minimum-version checks

## Default posture

**Read-only.** Reports drift; does not migrate. A migration is a separate, reviewed change — model changes alter cost and capability and must not be applied by an audit.

## Workflow

1. **Registry integrity first.** If the registry itself is malformed — overlapping price windows, a fallback pointing at a nonexistent profile, a profile no provider serves — every downstream comparison is meaningless. Stop and report.
2. **Scan active source** for model ids: agent frontmatter (`claude_model`, `openai_model`, `chatgpt_model`), picker/UI lists, budget tables, exporter defaults.
3. **Classify each id** against the registry: active, deprecated, retired, invalid (never existed), or absent from the registry entirely.
4. **Check generated-map agreement.** Every generated model map must equal what the catalog says, in both directions — entries present in one and not the other are drift.
5. **Check pricing provenance.** Every active model's price must resolve for today's date and carry a source URL and verified-at date. Prices without dates cannot be checked for staleness.
6. **Check fallbacks.** Every profile except the cheapest must declare a fallback that resolves.
7. **Check frontier pins.** No active agent may statically default to the frontier tier.
8. **Check requested vs effective.** For any observed decision where the runtime reported a different model than was requested, verify a fallback was recorded explaining it. An unexplained divergence is a finding.
9. **Check CLI support.** Where the registry records a verified minimum CLI version, compare against the installed version. Where no verified minimum is recorded, report `unverified` — never invent a threshold.

**Scope note:** the audit covers *active source*. Historical documents, release notes, migration fixtures, and comparison tests legitimately retain old ids. Do not rewrite history.

## Commands

```bash
# Full audit, folded into doctor (Operation Olympus D10 — extend, don't duplicate)
npx tsx thesmos/bin/cli.ts doctor

# Health score, which carries model-drift deductions
npx tsx thesmos/bin/cli.ts health

# Generated-map determinism: two consecutive runs must be byte-identical
npm run agents:export --workspace=thesmos
shasum -a 256 thesmos/generated/pantheon-models.ts extensions/vscode/src/generated/pantheon-models.ts
npm run agents:export --workspace=thesmos
shasum -a 256 thesmos/generated/pantheon-models.ts extensions/vscode/src/generated/pantheon-models.ts

# Catalog posture at a glance
grep -rho "^  claude_model: .*" thesmos/catalog/agents/ | sort | uniq -c
grep -rho "^  openai_model: .*" thesmos/catalog/agents/ | sort | uniq -c
```

## Detected drift classes

| Code | Meaning | Severity |
|---|---|---|
| `MODEL_REGISTRY_MALFORMED` | Registry self-inconsistent (overlapping windows, broken fallback, unserved profile) | BLOCKER |
| `MODEL_INVALID_ID` | Id that never existed (e.g. an invented `-pro` slug) | BLOCKER |
| `MODEL_RETIRED_ID` | Id that is no longer served | BLOCKER |
| `MODEL_AGENT_PINNED_FRONTIER` | Agent statically defaults to the frontier tier | BLOCKER |
| `MODEL_DEPRECATED_ID` | Superseded id still in active source | HIGH |
| `MODEL_UNKNOWN_ID` | Id absent from the registry | HIGH |
| `MODEL_MAP_DRIFT` | Generated map disagrees with the catalog | HIGH |
| `MODEL_EXPORT_STALE` | Agent present in one of catalog/map and not the other | HIGH |
| `MODEL_PICKER_DRIFT` | UI offers a non-registry id | HIGH |
| `MODEL_PRICING_OBSOLETE` | No price window covers today | HIGH |
| `MODEL_EFFECTIVE_MISMATCH` | Runtime reported a model other than the one requested | HIGH |
| `MODEL_CLI_TOO_OLD` | Installed CLI cannot expose the configured model | HIGH |
| `MODEL_PRICING_MISSING` | Active model with no verified pricing | MEDIUM |
| `MODEL_FALLBACK_MISSING` | Profile with no declared fallback | MEDIUM |

## Evidence contract

Report-level: registry version and content hash, agent documents scanned **and** how many declare a model, findings by severity, commands run with exit codes.

Per finding: `code`, `severity`, `file` (or `null`), `message` stating both observed and expected, `fix` naming the generator or registry edit.

## Refusal conditions

Refuse and report instead of proceeding when:

- A migration is requested. This skill audits; migrations are separate reviewed changes with cost implications.
- A generated model map would be hand-edited to resolve drift. The catalog is the source; run the generator.
- A model id would be added to the registry without a verifiable source URL and a verified-at date. An unsourced entry is a guess wearing a schema.
- A price would be recorded without an effective date, or inferred from a neighbouring model.
- A minimum CLI version would be asserted without verification.

## Output schema

```json
{
  "registryVersion": "string",
  "registryHash": "string",
  "agentsScanned": 0,
  "agentsWithModel": 0,
  "counts": { "BLOCKER": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0 },
  "findings": [{
    "code": "string",
    "severity": "BLOCKER|HIGH|MEDIUM|LOW",
    "file": "string|null",
    "message": "string",
    "fix": "string"
  }],
  "determinism": { "exportRunsCompared": 2, "byteIdentical": true },
  "commandsRun": [{ "command": "string", "exitCode": 0 }],
  "unresolvedRisks": ["string"]
}
```

## False-positive handling

- **Agents with no model pin.** Reviewer and specialist agents legitimately carry no `claude_model`. They are excluded from map-drift comparison — report the two counts separately so the exclusion is visible rather than implied.
- **Historical ids in fixtures and release notes.** Migration tests and changelogs must retain old ids. Scope the scan to active source.
- **Aliases.** A bare alias (`claude-haiku-4-5`) and its canonical dated id are the same model. Resolve aliases before flagging.
- **Same id serving two profiles.** A provider may serve frontier work with its flagship id at a higher reasoning level. Two registry entries sharing an id is correct, not duplication.
- **Introductory pricing.** A price that changes on a known future date is not drift — it is a dated window working as designed.

## Residual risk

This audit compares the repository against the registry. It cannot verify that the **registry itself** matches the provider's current published reality — that requires re-checking each `sourceUrl` and updating `verifiedAt`. A registry that has not been re-verified recently can be internally consistent and externally wrong. Treat `verifiedAt` as the expiry date on every claim in this report.

It also cannot detect a requested-vs-effective mismatch without observed runtime decisions. Absence of that finding means absence of data, not absence of mismatch.

## Related agents

- **Eunomia** — owns this skill
- **Plutus** — receives pricing and spend findings
- **Chiron** — receives routing-policy and profile-design questions
- **Kronos** — receives release-blocking model findings
