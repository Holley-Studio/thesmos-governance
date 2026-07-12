# Thesmos Pantheon — Changelog

All notable changes to the Pantheon agent bundles and tooling. Buyers get every
update free, forever — re-download from your Gumroad library.

## 2026-07 — Argus Awakens (severity resolution fix)

### Fixed

**Severity resolution gap** — found: internal Momus challenger audit, 2026-07-12.

Any project with a `severityRules` array in `.thesmos/config.json` was silently
running up to 198 BLOCKER-declared rules at MEDIUM severity. Those rules were not
blocking CI. They appeared in scan output but at the wrong severity level, and
`evaluateGovernFindings()` filtered them out before the exit-code check.

**Root cause:** `mergeConfig()` in `config.ts` replaced the full 212-entry severity
default with the user's partial override list. Any rule not in that list fell back to
`SEVERITY_DEFAULT = 'MEDIUM'` in `classifySeverity()`, ignoring the rule's own
declared severity.

**The fix:** `mergeConfig()` now merges user `severityRules` on top of all registered
rule defaults. User overrides still win. Rules not mentioned in your config now run
at their registry-declared severity. This is implemented as `mergeSeverityRules()` in
`config.ts` — a Map-based merge where user entries overwrite base entries and the
remainder of the 212+ base entries are preserved.

**What this means in practice:**
- Rules you have explicitly configured: no change.
- Rules you have NOT configured: previously ran at MEDIUM, now run at their declared
  severity. For the 198 rules that declare BLOCKER, this means they now block CI.
- If any of those 198 rules fire on your codebase, you'll see new CI failures on
  the first scan after upgrading. Findings were already being reported; only the
  severity and CI gate behavior change.

**First-run notice:** On the first command after upgrading, if your config silences
any BLOCKER rules under the old behavior, you'll see a one-time message on stderr:

> [thesmos] ℹ️  N rules now enforce as BLOCKER that were previously silent under
> your config — see CHANGELOG.md for details.

**To verify the fix yourself:** Remove all entries from `severityRules` in your
`.thesmos/config.json` (or delete the array entirely), run `thesmos scan`, and
confirm that BLOCKER-declared rules still produce BLOCKER findings. Before this fix,
they produced MEDIUM findings with no config entries.

**Regression test added:** `thesmos/severity.test.ts` — `it.each` over all 200+
BLOCKER-declared rules, asserting each resolves to BLOCKER after merging with a
partial user config. This test would have caught the original 198-rule gap.

**Deferred:** Per-rule `detect()` fixture suite is tracked in
[issue #96](https://github.com/Holley-Studio/thesmos-governance/issues/96) and
documented at `.thesmos/known-gaps/detect-fixture-suite.md`.

---

## 2026-07 — Sovereign Gate

### Changed

- **Pricing consolidated to two tiers.** The Founders Pack and Agencies Pack
  ($49 each, introduced in Olympus Rising below) are retired. There are now
  only two ways to run Thesmos: the free **Essentials** tier (289 rules — every
  BLOCKER plus the full AI-code safety net — and 5 starter agents) or the
  **Full Pantheon** ($79, one time) — the complete 1,137-rule engine and all 67
  agents exported for every LLM, with lifetime updates. Existing Founders/Agencies
  buyers keep their agent rosters and are grandfathered into Full Pantheon
  updates at no extra cost.
- **The rule engine itself is now tiered**, not just the agent packs — the free
  CLI ships 289 Essentials rules; the $79 purchase unlocks the remaining 848.

## 2026-07 — Olympus Rising

### New
- **Codex support** — full Pantheon for OpenAI Codex via AGENTS.md convention (`for-codex/`)
- **OpenAI Assistants API definitions** regenerated for all 67 agents on `gpt-5.5`
- **Vertical packs** — Founders Pack (15 gods) and Agencies Pack (13 gods)
- **Pantheon Council** — free public GPT with 5 starter gods and full routing theater
- **Council Decision Cards** — shareable council verdicts in every Zeus orchestrator
- **Routing modes** — auto / confirm / off, switchable in VS Code ("Thesmos: Pantheon Routing Mode")
- **Delegation rules pack** — AGNT_031–037 governance rules incl. the 1M-context cost guard

### Upgraded
- All 67 agents re-tuned for **Claude 5 family (Fable 5, Sonnet 5)** and **GPT-5.5**
- Claude Code exports now use native subagent frontmatter (name/description/model/tools) — agents register correctly in `/agents`
- Every export gains an **Operating Doctrine** (epistemic-stance framing + explicit output specification)
- VS Code extension 1.7.0 — routing-mode command, 1M-context warning badge, Pantheon funnel in Agent Activity panel

## 2026-07 — Feel the Gods

- Theatrical presence across all platforms: Zeus routing headers, council reports, Anti-Drift Protocol v2
- Zeus orchestrators for ChatGPT (+13 knowledge clusters), Claude.ai Projects (+3 council bundles), Gemini (Receptionist), Copilot
- Figma prompt cards · Claude Code buyer bundle (PANTHEON.md + live activity hooks)
- VS Code extension 1.6.0 — 3-level god tree, progress verbs, status-bar routing chain
