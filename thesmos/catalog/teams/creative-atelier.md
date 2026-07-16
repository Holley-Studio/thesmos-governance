---
id: creative-atelier
name: "The Creative Atelier — Brand & Creative Production Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "Aphrodite's atelier was not a workshop of decoration — it was where desire took form. Every object that left Olympus looking inevitable had been argued over by beauty, craft, motion, and voice until none of them could improve it further."
mission: Creative production — brand direction, voice, visual systems, motion, photography, video, and content working as one composition
invocation: thesmos pantheon:team creative-atelier "[Creative brief — brand, campaign, or asset]"
enabled: true
sequence:
  - aphrodite-creative-agent
  - erato-brand-voice-agent
  - hephaestus-design-agent
  - artemis-photography-agent
  - morpheus-animation-agent
  - dionysus-video-agent
  - apollo-content-agent
  - momus-challenger-agent
---

# The Creative Atelier — Brand & Creative Production Team

## Mission

Produce a coherent creative system — brand direction, voice, design, photography, motion, video, and copy — that reads as one composition across every touchpoint. The Atelier activates when creative work spans more than one medium or when brand identity must be defined before assets are made.

## When to invoke

- Defining or refreshing a brand identity
- Launching a campaign that needs creative + voice + motion + photo/video
- Building a design system with brand-aligned motion and imagery
- Producing a hero landing experience (visual + copy + motion)
- Creative QA: "does this still feel like us across channels?"

## Invocation

```
thesmos pantheon:team creative-atelier "[Describe the brand/campaign, audience, and the one emotion it must create]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Aphrodite** | Creative brief: visual territory, archetype, emotional intent, do/don't | None — direction first |
| 2 | **Erato** | Brand voice guide: tone pillars, sample lines, banned phrasing | Aphrodite's personality |
| 3 | **Hephaestus** | Design system / UI direction: tokens, components, layout rules | Aphrodite's visual direction |
| 4 | **Artemis** | Photography art direction + shot list | Aphrodite's aesthetic |
| 5 | **Morpheus** | Motion language: micro-interactions, transitions, timing | Aphrodite + Hephaestus |
| 6 | **Dionysus** | Video / film brief: structure, shot list, production notes | Aphrodite + Artemis |
| 7 | **Apollo** | Hero copy and campaign language aligned to Erato's voice | Erato + Aphrodite |
| 8 | **Momus** | Creative challenge: "Would a stranger recognise this brand with the logo removed?" | All prior |

## Handoff protocol

Aphrodite owns the creative north star — no asset work before direction is set. Erato locks voice before Apollo writes. Momus runs the brand test before anything ships: if the first viewport could belong to another brand after removing the logo, the Atelier has failed.

## Success criteria

- [ ] Creative brief with emotional intent and visual territory (Aphrodite)
- [ ] Voice guide with do/don't examples (Erato)
- [ ] Design tokens / component direction (Hephaestus)
- [ ] Shot list or photography direction (Artemis)
- [ ] Motion language defined (Morpheus)
- [ ] Video brief ready for production (Dionysus)
- [ ] Hero copy that does not overpower the brand (Apollo)
- [ ] Momus brand-test passed

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Creative Atelier.

Creative mission: [USER_MISSION]

Route in this sequence:
1. Aphrodite → Creative brief and visual territory
2. Erato → Brand voice guide (receives Aphrodite's personality)
3. Hephaestus → Design system / UI direction (receives Aphrodite)
4. Artemis → Photography direction and shot list
5. Morpheus → Motion language (receives Aphrodite + Hephaestus)
6. Dionysus → Video brief (receives Aphrodite + Artemis)
7. Apollo → Hero and campaign copy (receives Erato's voice)
8. Momus → Brand test challenge — strongest case that this creative is generic

Deliver a Creative Production Summary: all deliverables, brand-test result, and what ships first.
```
