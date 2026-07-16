# Pantheon Audit — 2026-07-16

Verdict: **Strong foundation, uneven install/docs, and a few structural misses that capped real-world usefulness.** After this pass: Cursor install is one command, team councils match how users work, thin Ares specialists match Hermes-tier depth, and Zeus routing covers engineering/AI domains that were previously invisible.

## What Thesmos already did well

- **Governed specialists** with output contracts, methodology, voice, and identity banners — far above generic persona prompts.
- **Operating Doctrine + Anti-Drift** injected at load time (identity does not rot mid-thread).
- **Teams CLI** (`pantheon:team`) with sequential Zeus prompts — rare and valuable.
- **Reference-quality gods** (Hermes, Aphrodite, Talos, Zeus) already had failure modes, diagnosis, judgment, and embedded examples.
- **Free/paid boundary** is explicit (`free-agents.json`) — product clarity is good.

## Setup gaps found (this repo / Cursor)

| Gap | Impact | Fix |
|---|---|---|
| `.thesmos/registry.json` agents `[]` | Pantheon "not installed" despite AGENTS.md listing gods | `pantheon:install --all --write --cursor` |
| Only `.cursor/rules/thesmos.mdc` present | Cursor users got governance, not specialists | `--cursor` install path |
| `pantheon/exports/cursor/` had 5 stale `.mdc` | Kit docs claimed 34–38 | Full re-export |
| Cursor setup doc outdated (34/38 counts) | User confusion | Rewrote `thesmos/docs/setup/cursor.md` |
| `pantheon/AGENTS.md` still said 21 agents / Iris | Docs drift | Rewrote — Artemis, teams, free/paid boundary |
| Division IDs wrong (`aether-ai-agent`, `clio-casestudy-agent`, Figma slugs) | Broken team/UI references | Fixed `divisions.json` |

## Accuracy / helpfulness scorecard (pre-fix)

| Area | Score | Notes |
|---|---|---|
| Agent prompt craft (top tier) | 8.5/10 | Hermes/Aphrodite-class is world-class |
| Agent prompt craft (floor) | 6/10 | Ares trio + some specialists lacked diagnosis/examples |
| Zeus routing coverage | 5/10 | Missed web/devops/AI/QA/payments entirely |
| Team councils for common jobs | 6/10 | Had Forge/Muses/Argonauts; missing Creative/Marketing/Web/Sales named packs |
| Cursor install UX | 3/10 | Manual copy + stale docs |
| Docs consistency | 4/10 | 21 vs 43 vs 68 counts depending on file |
| Governance rules engine | 9/10 | Differentiator; keep |

Overall pre-fix product grade: **B−** (excellent cores, weak packaging). Post-fix target: **A−**.

## Misses vs world-class agent systems (2026 research)

Patterns from production agent stacks (Claude Code / Cursor / multi-agent literature):

1. **Diagnose → plan → execute → reflect** — Thesmos had execute+reflect; diagnosis was uneven → fixed for Ares + standardized.
2. **Checkable done-when contracts** — present in good agents; now required in `AGENT_QUALITY_STANDARD.md`.
3. **Progressive disclosure** — still a miss: long agent bodies always load; future: skill packs per methodology.
4. **Verifiable end-state for code agents** — Talos has test scaffolds; could go further with mandatory "commands to prove it".
5. **Team packs matching user jobs** — users think "marketing team", not "muses"; Caduceus / Creative Atelier / Bronze Guard / Phalanx added.
6. **Honest badges** — Operating Doctrine already requires this; keep enforcing in reviews.

## New team councils shipped

| Team | Slug | Job |
|---|---|---|
| Creative Atelier | `creative-atelier` | Brand + design + motion + photo/video + copy |
| Caduceus | `caduceus` | Full marketing / GTM system |
| Bronze Guard | `bronze-guard` | Web app shipping (leaner than Forge) |
| Phalanx | `phalanx` | Sales formation (Ares cluster + Nike) |
| Harvest | `harvest` | Customer success & retention |
| Aegis | `aegis` | Security, compliance, legal, AI ethics |

Existing teams retained: Olympian Council, Muses, Forge, Argonauts, Furies, Figma team.

## Agent upgrades in this pass

- `ares-deal-strategy-agent` → v1.1.0 — constraints, failure modes, diagnosis, judgment, embedded example
- `ares-discovery-agent` → v1.1.0 — same
- `ares-pipeline-agent` → v1.1.0 — same
- `aphrodite-creative-agent` → v1.1.0 — Iris→Artemis delegation fix
- Zeus `DOMAIN_ROUTING` expanded for web, devops, AI, QA, SEO, payments, Figma, etc.
- Cursor export now includes `globs` + emoji description
- `pantheon:install --cursor` writes `.cursor/rules/<id>.mdc`

## Recommended next upgrades (not all done here)

1. Bring every Pantheon god to ≥12/16 on the quality rubric (batch upgrade script).
2. Regenerate `pantheon/AGENTS.md` from catalog (kill Iris / "21 agents").
3. Add eval harness: fixed prompts → score output-contract compliance.
4. Progressive disclosure: move long methodology into `catalog/skills/` loaded on trigger.
5. Cursor "Skills" / AGENTS native format when Cursor's agent schema stabilizes further.
6. Wire VS Code extension division chips to new `team` fields in `divisions.json`.

## How to use after merge

```bash
npx thesmos-governance pantheon:install --all --write --cursor
npx thesmos-governance pantheon:team
```
