# Thesmos ⇄ Ecosystem Integration Doctrine

> Canonical answer to: "How does Thesmos coexist with the popular Claude Code plugins
> (superpowers, playwright, code-review, feature-dev, …) without overlapping or depending on
> them — while staying sellable on its own?"

## Core principle: standalone-complete, composes-when-present

- **Thesmos ships with ZERO add-on dependencies.** No plugin is referenced by Thesmos code.
  (The only `playwright` strings in the codebase are *framework detection* — `detector.ts`,
  typosquat allowlists, autopilot test scaffolding — i.e. Thesmos *supports* playwright
  projects; it does not require the plugin.) A customer with **no plugins installed gets 100%
  of Thesmos**.
- **When the popular plugins are present, Thesmos composes.** It never competes for the same
  *role*. Thesmos is the **governance / gate**; the plugins are the **methodology / tools**.

"Zero overlap" is not literally achievable — both Thesmos and `code-review` *can* review code.
What we eliminate is **role collision**: every capability below has exactly one owner-by-role.

## The moat — what ONLY Thesmos does (no plugin overlaps these)

These are the sellable differentiators. No official-marketplace plugin replicates them:

1. **1,137 deterministic rules** with stable rule IDs and **severity gating** — BLOCKER findings
   block CI/merge. Plugins do heuristic, non-deterministic review; they cannot gate a pipeline
   on a rule ID.
2. **Token & cost budget enforcement** (`token-budget.ts`) — session/daily/project caps with a
   hard stop. No plugin enforces spend.
3. **Compliance rule packs** — GDPR / HIPAA / EU AI Act / PCI / SOC-adjacent. This is a
   regulatory-liability surface, not a convenience feature.
4. **The governed Pantheon** — routing, delegation, escalation, governance badges, audit trail,
   `scope.json` boundaries.
5. **Paid packs** (`dist-packs/`) — the commercial product line.

## Lane assignments — resolve every overlap by ROLE, not capability

| Capability | Thesmos owns (the gate) | Plugin owns (the tool) | Rule of the road |
|---|---|---|---|
| **Code review** | Deterministic governance + CI gating (rule IDs, BLOCKER severity), Argus/Cassandra personas, `thesmos:review` | `code-review`, `feature-dev` code-reviewer — qualitative LLM pass | Thesmos **gates**; plugin **advises**. Never treat a plugin verdict as gating truth. Run ONE qualitative reviewer, not three. |
| **Debugging** | **Asclepius** — governed persona, ERR_001/ERR_005/LOG_012 checks, output contract | `superpowers:systematic-debugging` — raw methodology | Asclepius wraps and may invoke the methodology; the governance/output contract stays Thesmos. |
| **Testing** | **Cassandra** — strategy, risk map, coverage targets | `playwright` — execution / E2E | Cleanest split, zero overlap: Cassandra **designs**, playwright **runs**. |
| **Security** | **Argus** + SEC_ rules (enforced, CI-gating) | `security-guidance` — advisory | Thesmos **enforces**; plugin **educates**. |
| **Planning** | Governance-aware playbooks + `prompt-engine` | `superpowers:writing-plans` / `brainstorming` | Draft with superpowers; keep the Zeus routing header + governance badge on delivery. |
| **Refactor / simplify** | REFACTOR playbook + `refactor-impact-analysis` skill | `code-simplifier` | Interchangeable — do NOT run both on one diff. |
| **GitHub** | **Kronos** — release/versioning governance | `github` — tool execution | Kronos **decides** the release; plugin **executes** the ops. |
| **Skill authoring** | Thesmos skill schema + `skill:create` (governed catalog skills) | `skill-creator` — native `SKILL.md` | Different formats: `skill-creator` for native `.claude/skills`; Thesmos for the governed catalog. |
| **CLAUDE.md** | `adapters` — `THESMOS:GENERATED` markers are canonical | `claude-md-management` improver | **GUARD:** improver edits **outside** the markers only. Thesmos reclaims inside-marker content on the next `adapters` run. |
| **Feature scaffolding** | Daedalus / Chiron / Metis (PRD → plan → exec, governed) | `feature-dev` | Governed personas own the gate; `feature-dev` is a tool underneath them. |

## Collision guards — the only real technical risks

1. **`claude-md-management` ⇄ `adapters`** — the improver must touch content **outside** the
   `THESMOS:GENERATED` markers only. Inside-marker edits are auto-reverted on the next
   `npm run thesmos:adapters`, so Thesmos self-heals — but a manual edit there wastes work and
   can transiently clash with the routing table that sits just above the markers.
2. **Duplicate reviewers** — you now have Thesmos rules + `code-review` + `feature-dev`
   code-reviewer + `security-guidance`. Pick **one** gate: **Thesmos rules decide CI/severity**;
   use at most one plugin reviewer for a human-style pass. Stacking reviewers produces
   conflicting verdicts and burns tokens.
3. **`superpowers` self-verification** — `verification-before-completion` can mark work done by
   matching tests to a *buggy* implementation. It **never** substitutes the human / Cassandra
   verify gate before a commit or PR. Thesmos `validate` (zero BLOCKER) + human review remain
   the exit criteria.

## When to reach for a plugin vs. stay in Thesmos

- **Multi-file feature / refactor / migration** → `superpowers` plan-first loop, gated by Thesmos.
- **Reproduce a UI or flaky bug** → `playwright` under **Asclepius** / **Cassandra**.
- **One-line fix, typo, mechanical change** → neither; the plugin ceremony is overkill.
- **Anything that must pass CI, hit a compliance rule, or respect a cost budget** → Thesmos,
  always. That is the gate no plugin owns.

## Licensing & sellability

- All ten enabled plugins are **official-marketplace** (`claude-plugins-official`, MIT-family).
- Thesmos **copies none of them** → its dual **FSL-1.1-MIT + commercial** license and the paid
  Pantheon packs are unaffected.
- **Zero add-on dependency is a sales line**, not just a fact — see the drop-in block below.

### Ready-to-drop positioning (for README / growth/SALES-STRATEGY.md)

> **Thesmos works standalone — and plays well with your stack.** It ships 1,137 governance
> rules, cost-budget enforcement, and compliance packs with **zero required add-ons**. Already
> using Superpowers, Playwright, or the official Claude Code plugins? Thesmos composes with
> them: they write and test the code, **Thesmos decides what's allowed to ship.** No lock-in,
> no dependencies, no competing reviewers — one governance gate over whatever tools you love.

## Thesmos check

LIC_001 (MIT plugins, no copyleft — sell rights intact) ✅ |
AGNT_005 (plugins via official marketplace) ✅ |
zero add-on code dependency (verified) ✅ |
CLAUDE.md marker guard documented ✅
