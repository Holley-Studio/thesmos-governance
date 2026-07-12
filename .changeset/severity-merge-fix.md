---
"thesmos-governance": minor
---

Fix severity resolution: `mergeConfig()` now merges user `severityRules` on top of
the full default rule list instead of replacing it. Previously, any project with a
`severityRules` array in `.thesmos/config.json` silently ran up to 198
BLOCKER-declared rules at MEDIUM severity — those rules never blocked CI.

**Root cause:** `config.ts` replaced `severityRules` with the user's partial list,
then `classifySeverity()` fell back to `SEVERITY_DEFAULT = 'MEDIUM'` for every rule
not in that list, ignoring each rule's declared severity.

**First-run notice:** On the first `thesmos scan` (or any command that loads config)
after upgrading, if your config would have silenced any BLOCKER rules under the old
behavior, thesmos prints a one-time notice to stderr:

> [thesmos] ℹ️  N rules now enforce as BLOCKER that were previously silent under
> your config — see CHANGELOG.md for details.

This fires once per project and is then acknowledged via `.thesmos/.severity-fix-ack`
(gitignored, per-machine).

**Migration:** If a rule now blocking CI is one you intentionally want at a lower
severity, add an explicit override in `.thesmos/config.json`:

```json
{ "severityRules": [
  { "category": "some_blocker_category", "severity": "MEDIUM" }
] }
```

User-specified entries still win. Unspecified rules now use their registry-declared
severity instead of defaulting to MEDIUM.

**Bump rationale:** Minor, not patch — the behavioral change (previously-silent
BLOCKER rules now blocking CI) is intentional and expected after a bug fix, but has
breaking consequences for misconfigured pipelines that relied on the silent fallback.

**Deferred:** Per-rule `detect()` fixture suite (200+ fixtures) is tracked in
GitHub issue #96 and documented at `.thesmos/known-gaps/detect-fixture-suite.md`.
The regression test added here (`severity.test.ts` — `it.each` over all BLOCKER
rules with a partial user config) covers the config-merge path and would have caught
the original gap.
