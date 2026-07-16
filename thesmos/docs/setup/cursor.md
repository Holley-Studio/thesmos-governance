# Cursor Setup Guide

Cursor loads project AI rules from `.cursor/rules/*.mdc`. Thesmos installs two layers:

1. **Governance adapter** — `.cursor/rules/thesmos.mdc` (from `thesmos adapters`)
2. **God Agents** — one `.mdc` per agent (`alwaysApply: false`, invoke by name)

## One-command install (recommended)

From your project root (with `thesmos-governance` available):

```bash
# Register + write agents + regenerate adapters + install Cursor rules
npx thesmos-governance pantheon:install --all --write --cursor
```

This writes:

- `.thesmos/registry.json` — active agent IDs
- `.thesmos/agents/*.md` — agent bodies for adapters / Claude Code
- `.cursor/rules/thesmos.mdc` — governance rules (via adapters)
- `.cursor/rules/<agent-id>.mdc` — every God Agent as a Cursor rule

## Manual / kit install

If you purchased the Pantheon kit:

```bash
thesmos pantheon:install --pack <path-to-zip-or-folder>
thesmos pantheon:install --all --write --cursor
```

Or copy exported rules from a kit:

```bash
mkdir -p .cursor/rules
cp pantheon/exports/cursor/*.mdc .cursor/rules/
thesmos adapters --targets cursor   # keep thesmos.mdc current
```

## Invoke an agent

In Cursor chat:

```
Using Argus, review this API route for OWASP vulnerabilities.
```

```
⚡ Zeus — route this: we need a launch campaign and a landing page.
```

```
thesmos pantheon:team creative-atelier "Brand refresh for our developer tool"
thesmos pantheon:team caduceus "GTM for v3 launch"
thesmos pantheon:team bronze-guard "Build the billing settings page in Next.js"
thesmos pantheon:team phalanx "Score and advance the Acme enterprise deal"
```

Agent rules use `alwaysApply: false` so they do not flood every chat. Zeus routing (in CLAUDE.md / AGENTS.md / governance adapters) still suggests the right specialist.

## Choose your power mode (token-saving vs god power)

Use Pantheon mode to control ceremony and token usage:

```bash
# Normal mode (default): conservative, token-saving
thesmos pantheon:mode normal

# God Power mode: full Zeus ceremony + council style
thesmos pantheon:mode god

# Check current mode
thesmos pantheon:mode
```

Mode is stored in `.thesmos/config.json` as `power: "lean"` (normal) or `power: "god"` (god power).

## Team councils (high-value packs)

| Team | Slug | Use when |
|---|---|---|
| Creative Atelier | `creative-atelier` | Brand + design + motion + photo/video + copy |
| Caduceus | `caduceus` | Full marketing / GTM system |
| Bronze Guard | `bronze-guard` | Web feature shipping (app layer) |
| The Forge | `forge` | Full engineering launch (product → ship) |
| The Phalanx | `phalanx` | Sales deal + pipeline motion |
| The Muses | `muses` | Content factory |
| Olympian Council | `olympian-council` or `council` | Irreversible strategy decisions |
| The Furies | `furies` | Revenue rescue |
| The Argonauts | `argonauts` | Full product launch |
| Figma Team | `figma-team` | Figma design-system workflow |
| Harvest | `harvest` | Customer success & retention |
| Aegis | `aegis` | Compliance & legal guard |

List teams: `thesmos pantheon:team`

## Tips

- **Private / licensed projects:** commit `.cursor/rules/` so the team shares the same Pantheon.
- **This public repo:** only free starter agent rules are tracked; paid `.mdc` files are gitignored — run `--cursor` locally or install from the Pantheon pack.
- Re-run `pantheon:install --all --write --cursor` after upgrading `thesmos-governance`.
- Keep `thesmos.mdc` — it is the governance layer; do not delete it when pruning agent rules.
- Quality bar for authors: `thesmos/catalog/AGENT_QUALITY_STANDARD.md`
- Team councils: `creative-atelier`, `caduceus`, `bronze-guard`, `phalanx`, `harvest`, `aegis`, plus Forge / Muses / Argonauts / Furies / Olympian Council.

## Support

Email [hello@holley.studio](mailto:hello@holley.studio) with setup questions.
