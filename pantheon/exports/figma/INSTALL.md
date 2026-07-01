# Thesmos Pantheon × Figma — Install Guide

Figma's AI does **not** support custom system prompts or persistent agent instructions —
that's a Figma platform limitation, not a Thesmos one. Here are your three paths, best first.

## Track A — Cursor + Figma MCP (best: persistent gods with real Figma access)

If you use Cursor with the Figma MCP server, the Pantheon design gods run persistently
and can read and act on your actual Figma files.

1. Set up the Figma MCP server in Cursor (see figma.com/developers → Dev Mode MCP)
2. Copy the design-god rules from the `for-cursor/` folder into `.cursor/rules/`:
   - `hephaestus-design-agent.mdc` — UI/UX & design systems
   - `aphrodite-creative-agent.mdc` — creative direction & brand
   - `morpheus-animation-agent.mdc` — animation & motion
   - `artemis-photography-agent.mdc` — photography direction
   - The 10 Figma-specialist gods: `eidos-figma-orchestrator.mdc`, `techne-design-system.mdc`,
     `kairos-prototype-engineer.mdc`, `kinesis-motion-systems.mdc`, `logos-ux-research.mdc`,
     `hyle-shader-material.mdc`, `morphe-weave-workflow.mdc`, `praxis-figma-make.mdc`,
     `mnemon-context-librarian.mdc`, `ergon-code-layers.mdc`
3. Ask design questions in Cursor chat — the gods respond with full theatrical presence
   and can inspect your real Figma designs through MCP.

## Track B — Figma AI Prompt Cards (this folder)

Each `.txt` card in this folder is a session starter. Paste one at the beginning of a
Figma AI conversation to summon that god for the session.

1. Open Figma and start an AI chat
2. Open the card for the god you want (e.g. `hephaestus-figma-card.txt`)
3. Paste the entire card, replacing `[DESCRIBE YOUR TASK HERE]` with your actual task
4. The god responds in full character — banner, expertise, signature — for the whole session

Cards:

| Card | God | Use for |
|---|---|---|
| `zeus-figma-card.txt` | ⚡ Zeus | Routes between all four design gods in one session |
| `hephaestus-figma-card.txt` | 🔨 Hephaestus | Components, tokens, WCAG, layout review |
| `aphrodite-figma-card.txt` | 🎨 Aphrodite | Brand, creative direction, campaign concepts |
| `morpheus-figma-card.txt` | 🌊 Morpheus | Prototype animation, motion specs |
| `artemis-figma-card.txt` | 📷 Artemis | Imagery selection, crops, shot briefs |

Limitation: cards last for one session. New session = paste the card again.

## Track C — Figma Plugin (roadmap)

A native Thesmos Figma plugin (gods embedded directly in the Figma UI, powered by the
Claude API) is on the roadmap. Follow progress:
https://github.com/Holley-Studio/thesmos-governance/issues

---

Thesmos Pantheon · https://holley.studio/thesmos
