---
id: muses
name: "The Muses — Content Factory Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "The nine Muses were the divine inspirations for all creative and intellectual pursuits — poetry, music, history, astronomy, dance. Every great work of art, literature, or science was said to flow from the Muses. In Thesmos, the Muses produce content at industrial scale."
mission: Content production — strategy, writing, brand voice, email, video, and distribution working in concert
invocation: thesmos pantheon:team muses "[Content brief or campaign description]"
enabled: true
sequence:
  - hermes-marketing-agent
  - apollo-content-agent
  - erato-brand-voice-agent
  - calliope-email-agent
  - pheme-pr-agent
  - dionysus-video-agent
  - polyhymnia-docs-agent
---

# The Muses — Content Factory Team

## Mission

Produce a coordinated content campaign across all channels and formats — from strategy through distribution. The Muses handle any content deliverable that requires more than one medium: blog + email + social + video + PR + documentation.

## When to invoke

- Launching a content marketing campaign
- Producing a product announcement across multiple channels
- Building a thought leadership series
- Creating onboarding content (docs + email + video)
- Quarterly content calendar planning

## Invocation

```
thesmos pantheon:team muses "[Describe the content campaign — topic, audience, goal, timeline]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Hermes** | Content strategy: audience, messaging pillars, channel mix, content calendar structure | None — strategy first |
| 2 | **Apollo** | Written content: blog posts, landing page copy, social captions, SEO-optimized articles | Hermes's content strategy |
| 3 | **Erato** | Brand voice application: review all Apollo copy against brand voice guidelines, refine | Apollo's drafts |
| 4 | **Calliope** | Email sequence: convert campaign into MJML email templates, nurture sequences | Apollo's copy + Hermes's timeline |
| 5 | **Pheme** | PR angle: press release, journalist pitch, social amplification plan | Hermes's strategy + Apollo's content |
| 6 | **Dionysus** | Video brief: YouTube scripts, LinkedIn video concept, short-form hooks | Apollo's copy + Hermes's strategy |
| 7 | **Polyhymnia** | Documentation: technical how-tos, API guides, or onboarding docs that support the campaign | Apollo's content + product context |

## Handoff protocol

Hermes defines the strategy and audience before any content is written. Apollo produces the core written content that all other agents adapt. Erato reviews before distribution. All agents work from the same audience definition and messaging pillars established by Hermes in Step 1.

## Success criteria

- [ ] Content strategy approved with channel mix and calendar (Hermes)
- [ ] 3+ long-form pieces written and reviewed (Apollo + Erato)
- [ ] Email sequence drafted in MJML (Calliope)
- [ ] Press release or journalist pitch ready (Pheme)
- [ ] Video brief approved and scripts drafted (Dionysus)
- [ ] Supporting docs live or in review (Polyhymnia)

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Muses content production team.

Content campaign: [USER_MISSION]

Route in this sequence:
1. Hermes → Content strategy and messaging pillars
2. Apollo → Written content production (receives Hermes's strategy)
3. Erato → Brand voice review and refinement of Apollo's drafts
4. Calliope → Email sequence in MJML (receives Erato-approved copy)
5. Pheme → PR angle and press release (receives Hermes + Apollo)
6. Dionysus → Video brief and scripts (receives Apollo's copy)
7. Polyhymnia → Technical documentation supporting the campaign

Deliver a Content Production Summary: all deliverables listed, status of each, and the distribution calendar.
```
