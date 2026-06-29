# Thesmos Figma Skills

Ten specialist AI Skills for Figma's AI panel — the Figma Agent Team, built to master every surface Figma 2026 offers.

## What are Figma Skills?

Figma Skills are saved instruction sets you load into the Figma AI panel. Once loaded, they give the AI panel instant access to a specialist agent — without copying a prompt every time. Each `.txt` file in this folder is a Figma Skill: copy the contents, paste into Figma AI → Add Skill, name it, and the agent is available in every session.

## How to load a Skill into Figma

1. Open Figma → click the AI panel (sparkle icon, top right)
2. Click **"Add Skill"** (or **"+"** next to Skills)
3. Copy the content of any `.txt` file from this folder
4. Paste into the Skill text field
5. Name the Skill (use the agent's name: Eidos, Techne, etc.)
6. Save — the Skill is now available in every Figma AI session

**To use:** In any Figma AI conversation, type `@[SkillName]` or select the Skill from the Skills panel before writing your prompt.

## The 10 Figma Agent Team Skills

| Skill | File | When to load |
|---|---|---|
| **Mnemon** | `mnemon.txt` | ALWAYS first — session setup, context, credit tracking |
| **Eidos** | `eidos.txt` | Multi-agent workflow orchestration |
| **Logos** | `logos.txt` | User flows, research synthesis, wireframes |
| **Techne** | `techne.txt` | Design system audit, token compliance |
| **Kairos** | `kairos.txt` | Prototype wiring, state inventory |
| **Kinesis** | `kinesis.txt` | Motion design, Figma Motion timelines |
| **Hyle** | `hyle.txt` | WebGPU shader fills and effects |
| **Morphe** | `morphe.txt` | Weave campaign image production |
| **Ergon** | `ergon.txt` | Code layers, implementation exploration |
| **Praxis** | `praxis.txt` | Figma Make + Figma Sites publishing |

## Recommended loading sequence

For a full design session, load in this order:

```
1. Mnemon  → always first (context + governance)
2. Eidos   → if you're running a multi-agent workflow
3. The specialists you need for your brief:
   - Logos   → if you need flows or research synthesis first
   - Techne  → always (audit all AI output)
   - Kairos  → if you're building a prototype
   - Kinesis → if motion is in scope
   - Hyle    → if shaders/GPU effects are in scope
   - Morphe  → if campaign imagery/Weave is in scope
   - Ergon   → if implementation questions exist
   - Praxis  → if publishing Make/Sites is the deliverable
```

For a quick single-task session, load just the relevant specialist plus Mnemon.

## Chaining agents in a session

In Figma AI, you can chain agents by switching Skills mid-conversation:

```
@Mnemon "Set up context for this session — brand file attached, 40 credits available"
→ [Mnemon confirms context pack]

@Eidos "Here's the brief: [paste brief] — route the work"
→ [Eidos decomposes and routes]

@Logos "Design the user flow for the checkout redesign"
→ [Logos produces flows]

@Techne "Audit these generated frames for token compliance"
→ [Techne runs the audit and fixes]
```

## Attaching context files

Before generation, attach these files to the Figma AI conversation (Mnemon will tell you which are needed):

- **Brand guidelines file** — colors, typography, photography style
- **Component library file** — your published Figma component library (link, don't embed)
- **Creative brief** — the specific brief for this session
- **Reference imagery** — approved visual references (labeled as reference)

## Credit guidance

| Task type | Approximate credit cost |
|---|---|
| Weave: image generation | 2–5 credits per image |
| Weave: style transfer | 3–6 credits per image |
| Shader fill/effect | 3–8 credits |
| Figma Make prototype | 5–15 credits |
| Figma Design AI (layout) | 1–3 credits |
| Figma AI text/synthesis | < 1 credit |

Always confirm available credits with Mnemon before starting a generation-heavy session.

## Using these Skills in repos (Claude Code / Cursor)

The full markdown files in `thesmos/catalog/agents/figma/` work as Claude Code or Cursor agents. Load them using your AI tool's agent/persona system and use them in design-adjacent repos:

- Reviewing design tokens exported from Figma
- Writing implementation specs from prototype handoff docs
- Reviewing motion implementation against Kinesis specs
- Writing code that matches Ergon's code layer recommendations

## More about the Figma Agent Team

Full markdown documentation: `thesmos/catalog/agents/figma/`
Team orchestration file: `thesmos/catalog/teams/figma-team.md`
