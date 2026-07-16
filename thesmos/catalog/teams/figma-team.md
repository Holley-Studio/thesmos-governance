---
id: figma-team
name: "The Figma Agent Team — Design Intelligence Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "Ten Greek philosophical concepts — Mnemon, Eidos, Logos, Techne, Kairos, Kinesis, Hyle, Morphe, Ergon, Praxis — assembled as the world's most comprehensive Figma AI specialist team. Where the Thesmos Pantheon governs business operations, the Figma Agent Team governs design operations: every surface, every workflow, every capability Figma 2026 offers."
mission: World-class Figma design production — from context loading through generative imagery, motion systems, shader materials, code exploration, prototype engineering, and publishing governance.
invocation: thesmos pantheon:team figma-team "[Design brief or Figma task description]"
enabled: true
sequence:
  - mnemon-context-librarian
  - eidos-figma-orchestrator
  - logos-ux-research
  - techne-design-system
  - kairos-prototype-engineer
  - kinesis-motion-systems
  - hyle-shader-material
  - morphe-weave-workflow
  - ergon-code-layers
  - praxis-figma-make
---

# The Figma Agent Team — Design Intelligence Team

## Mission

Master every surface and capability of Figma's 2026 AI system — from initial context loading through generative imagery, motion design, shader materials, code-on-canvas exploration, interactive prototype engineering, and publishing governance. The Figma Agent Team is the most capable Figma AI specialist team on the planet, optimized for professional design production at scale.

## When to invoke

- Starting a Figma project that requires AI-assisted design production
- Producing a design campaign across multiple formats and surfaces
- Exploring implementation directions with code layers before engineering commits
- Publishing a Figma Site or Make prototype for stakeholder review
- Running a Figma AI session that involves multiple agent domains (motion + system + generative)
- Onboarding a team to Figma AI's 2026 capabilities
- Quarterly design system audit with AI-assisted production

## Invocation

```
thesmos pantheon:team figma-team "[Describe the Figma design task — product, brief, deliverables, timeline]"
```

**Also available as individual Skills in Figma AI:**
```
Load: Eidos / Techne / Kinesis / Hyle / Morphe / Ergon / Praxis / Logos / Kairos / Mnemon
→ Figma AI panel → Add Skill → paste from thesmos/figma-skills/[agent].txt
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Mnemon** | Context pack: files attached, Skills loaded, credit budget, publishing policy | None — context first, always |
| 2 | **Eidos** | Workflow map: brief decomposition, agent routing, credit estimate, QA gate plan | Mnemon's context confirmation |
| 3 | **Logos** | UX strategy, user flows, wireframes, research synthesis (if research needed) | Eidos's routing assignment |
| 4 | **Techne** | Design system compliance audit: token review, missing states, library conformance | Logos's wireframes or any generated frames |
| 5 | **Kairos** | Prototype spec, state inventory, interaction map, engineering handoff package | Techne-approved frames + Logos's flows |
| 6 | **Kinesis** | Motion language, animation specs, Figma Motion timelines, reduce-motion alternatives | Kairos's interaction map |
| 7 | **Hyle** | Shader prompts, parameter schemas, material library, brand usage rules | Eidos's credit approval + Techne's color tokens |
| 8 | **Morphe** | Weave workflow map, campaign imagery batch, QA rubric, asset batch plan | Eidos's credit approval + Logos's direction |
| 9 | **Ergon** | Code layer prototypes, implementation direction comparison, engineering recommendation | Kairos's interaction model |
| 10 | **Praxis** | Published Make prototype or Figma Site, publishing checklist, prompt log, production backlog | All upstream outputs + Mnemon's governance confirmation |

## Handoff protocol

**Mnemon establishes context before any generation.** Context pack must be confirmed complete (files attached, Skills loaded, credit budget acknowledged, publishing policy documented) before Eidos opens the session.

**Eidos routes the work.** Eidos receives Mnemon's context confirmation and the user's brief, decomposes the brief into agent tasks, and sequences the workflow. Not every brief requires all 10 agents — Eidos's routing table specifies which agents are invoked for this session.

**Logos, Techne, and Kairos are the structure layer.** Logos defines what to build (flows, wireframes). Techne ensures it conforms to the system. Kairos makes it interactive and testable. These three run before any generative agent produces imagery.

**Kinesis, Hyle, and Morphe are the expression layer.** These agents produce visual output (motion, materials, campaign imagery) after the structure layer has been approved. This sequence prevents expensive credit spend on generation that doesn't fit the approved structure.

**Ergon is the code-proximity layer.** Ergon runs when implementation questions exist that design cannot answer — invoked by Eidos when the brief contains "which library" or "which approach" decisions.

**Praxis closes the loop.** Praxis is the last agent — it publishes only after all upstream agents have signed off. Praxis also generates the prompt log and make-to-production backlog that make this session's work reusable.

## Success criteria

- [ ] Context pack complete and confirmed (Mnemon)
- [ ] Workflow map approved by human decision-maker (Eidos)
- [ ] User flows reviewed and approved before generation starts (Logos)
- [ ] All AI-generated frames pass design system token audit (Techne)
- [ ] Prototype covers all required states and test scenarios (Kairos)
- [ ] Motion specs applied and reduce-motion alternatives documented (Kinesis)
- [ ] Shaders have parameter schemas and brand usage rules (Hyle)
- [ ] Weave workflow documented and QA rubric defined before generation (Morphe)
- [ ] Code layer direction comparison delivered with engineering recommendation (Ergon)
- [ ] Publishing checklist complete, named approver confirmed, governance record created (Praxis)

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Figma Agent Team.

Design brief: [USER_MISSION]

Route in this sequence (skip steps not required by the brief):
1. Mnemon → Prepare context pack: which files to attach, Skills to load, credit budget, publishing policy
2. Eidos → Decompose the brief into Figma AI tasks and produce the workflow map
3. Logos → If UX research or flow design is needed: user flows, wireframes, research synthesis
4. Techne → Run design system compliance audit on all Logos/generated frames
5. Kairos → Wire the interaction prototype: state inventory, interaction map, engineering handoff
6. Kinesis → Apply motion language: timeline specs, transition configs, reduce-motion alternatives
7. Hyle → Design shader materials if needed: prompts, parameters, brand usage rules
8. Morphe → Build Weave workflows if imagery generation is needed: batch plan, QA rubric
9. Ergon → Code layer explorations if implementation direction questions exist
10. Praxis → Publish Make prototype or Figma Site: publishing checklist, prompt log, production backlog

Deliver a Design Production Summary: all deliverables listed, credit spend vs. budget, publishing governance status, and make-to-production backlog.
```

## Figma Skills quick-load

Each agent is available as a standalone Figma Skill. Load in Figma AI panel → Add Skill:

| Agent | Skill file | Use when |
|---|---|---|
| Mnemon | `thesmos/figma-skills/mnemon.txt` | Starting any AI session |
| Eidos | `thesmos/figma-skills/eidos.txt` | Orchestrating a multi-agent workflow |
| Logos | `thesmos/figma-skills/logos.txt` | Defining flows, synthesizing research |
| Techne | `thesmos/figma-skills/techne.txt` | Auditing AI output for system compliance |
| Kairos | `thesmos/figma-skills/kairos.txt` | Wiring interactive prototypes |
| Kinesis | `thesmos/figma-skills/kinesis.txt` | Designing motion and animation |
| Hyle | `thesmos/figma-skills/hyle.txt` | Creating shader materials and GPU effects |
| Morphe | `thesmos/figma-skills/morphe.txt` | Running Weave campaign production |
| Ergon | `thesmos/figma-skills/ergon.txt` | Exploring implementation with code layers |
| Praxis | `thesmos/figma-skills/praxis.txt` | Publishing Make prototypes and Figma Sites |
