# Thesmos Pantheon — Agent Directory

Governed AI specialists for strategy, creative, marketing, sales, product, engineering, and trust. Catalog source: `thesmos/catalog/agents/`. Install into Cursor with:

```bash
npx thesmos-governance pantheon:install --all --write --cursor
```

**Counts:** 6 free starters ship in the public npm tarball; the full Pantheon pack is ~68 agents (see `thesmos/catalog/free-agents.json`). Root `AGENTS.md` lists the gods wired into this dogfood repo after install.

---

## Free starter pack

| Agent | God | Role |
|---|---|---|
| `zeus-executive-agent` | Zeus | Executive orchestration |
| `athena-strategy-agent` | Athena | Business strategy & GTM |
| `argus-security-agent` | Argus | Security & threat modeling |
| `apollo-content-agent` | Apollo | Content & copywriting |
| `hephaestus-design-agent` | Hephaestus | UI/UX & design systems |
| `hebe-support-agent` | Hebe | Product support & onboarding |

---

## Team councils (high-value packs)

Invoke with `thesmos pantheon:team <slug> "[mission]"`:

| Team | Slug | Job |
|---|---|---|
| Creative Atelier | `creative-atelier` | Brand + design + motion + photo/video + copy |
| Caduceus | `caduceus` | Full marketing / GTM system |
| Bronze Guard | `bronze-guard` | Web app shipping (leaner than Forge) |
| The Forge | `forge` | Full eng launch incl. DevOps |
| The Phalanx | `phalanx` | Sales formation (Ares cluster + Nike) |
| The Harvest | `harvest` | Customer success & retention |
| The Aegis | `aegis` | Security, compliance, legal, AI ethics |
| The Muses | `muses` | Content factory |
| The Argonauts | `argonauts` | Full product launch |
| The Furies | `furies` | Revenue rescue |
| Olympian Council | `olympian-council` | Irreversible strategy decisions |
| Figma Agent Team | `figma-team` | Figma design intelligence |

List all: `thesmos pantheon:team`

---

## Domain coverage (primary gods)

| Function | Primary | Supporting |
|---|---|---|
| Executive & Strategy | Zeus, Athena | Momus, Metis |
| Marketing | Hermes | Apollo, Erato, Calliope, Nike, Tyche, Pheme |
| Sales | Ares (cluster) | Nike, Heracles |
| Creative & Brand | Aphrodite | Erato, Artemis, Morpheus, Dionysus, Hephaestus |
| Design & UX | Hephaestus | Aphrodite, Psyche, Talos |
| Web / App | Talos | Chiron, Cassandra, Argus, Kratos |
| Product | Daedalus | Metis, Psyche |
| Customer Success | Demeter, Hestia | Hebe, Tyche |
| Trust & Compliance | Argus, Nemesis | Themis, Dike |
| Analytics | Tyche, Pythia | — |
| Legal / Finance | Themis, Plutus | — |

Photography direction is **Artemis** (not Iris).

---

## Quality bar

Every God Agent should meet `thesmos/catalog/AGENT_QUALITY_STANDARD.md` (≥12/16): diagnose before deliver, checkable output contracts, failure modes with diagnostics, embedded gold example, honest delegation.

---

## Platform exports

Free starter exports live under `pantheon/exports/{cursor,claude-code,chatgpt,gemini}/` (force-tracked). Full per-platform trees are paid pack content (`pantheon/exports/**` gitignored).

| Platform | Path | Notes |
|---|---|---|
| Cursor | `exports/cursor/*.mdc` | → `.cursor/rules/` |
| Claude Code | `exports/claude-code/*.md` | YAML frontmatter sub-agents |
| ChatGPT | `exports/chatgpt/*-chatgpt.txt` | ≤8K + knowledge companions |
| Gemini | `exports/gemini/*-gemini.txt` | Gem instructions |

---

## Authoring

- Catalog: `thesmos/catalog/agents/` (+ `pantheon/`, `figma/`)
- Teams: `thesmos/catalog/teams/`
- Setup: `thesmos/docs/setup/cursor.md`
- Audit: `docs/pantheon-audit-2026-07-16.md`

See [GUIDE.md](GUIDE.md) for installation and [CONTRIBUTING.md](CONTRIBUTING.md) to add an agent.
