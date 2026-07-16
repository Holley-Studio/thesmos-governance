---
id: caduceus
name: "The Caduceus — Marketing Growth Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "Hermes carried the caduceus — the staff that opened roads, markets, and mouths. Marketing is not content alone: it is the road between a stranger and a customer, paved with message, channel, proof, and measurement."
mission: Marketing growth — strategy, ICP, content, email, SEO, social, PR, and measurement as one GTM system
invocation: thesmos pantheon:team caduceus "[Marketing goal — launch, growth, or funnel problem]"
enabled: true
sequence:
  - hermes-marketing-agent
  - nike-leadgen-agent
  - apollo-content-agent
  - erato-brand-voice-agent
  - calliope-email-agent
  - psyche-seo-agent
  - nike-social-agent
  - pheme-pr-agent
  - tyche-analytics-agent
  - momus-challenger-agent
---

# The Caduceus — Marketing Growth Team

## Mission

Build and run a full marketing system: positioning and channel strategy, ICP and pipeline motion, content, email, SEO, social, PR, and measurement. The Caduceus activates when marketing work is a *system* (not a single blog post) — launches, funnel rebuilds, and growth motions that must compound.

## When to invoke

- Product or feature launch GTM
- Rebuilding a broken acquisition funnel
- Defining channel mix and budget allocation
- Building a content + email + SEO engine
- Diagnosing "we publish a lot but pipeline is flat"

## Invocation

```
thesmos pantheon:team caduceus "[Goal, audience, current metrics if known, and budget/time constraints]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Hermes** | GTM / campaign strategy: message, channels, phases, north-star metric | None — strategy first |
| 2 | **Nike (leadgen)** | ICP + outbound / pipeline motion tied to Hermes's audience | Hermes's ICP |
| 3 | **Apollo** | Core written assets: landing, blog, ads, social captions | Hermes's messaging |
| 4 | **Erato** | Voice consistency pass on all Apollo copy | Apollo's drafts |
| 5 | **Calliope** | Email / nurture sequences in MJML-ready structure | Erato-approved copy |
| 6 | **Psyche SEO** | Organic growth plan: keywords, content clusters, technical SEO | Hermes + Apollo |
| 7 | **Nike (social)** | Social / community growth plan | Hermes + Apollo |
| 8 | **Pheme** | PR / earned media angle | Hermes + Apollo |
| 9 | **Tyche** | Measurement framework: KPIs, dashboards, experiment design | All prior |
| 10 | **Momus** | Challenge: vanity metrics, channel spray, unvalidated message | All prior |

## Handoff protocol

Hermes defines the one north-star metric and messaging pillars before any asset is produced. Tyche instruments success before budget scales. Momus kills vanity-metric briefs. Apollo does not invent positioning — he executes Hermes's framework in Erato's voice.

## Success criteria

- [ ] Strategy with one north-star metric and channel mix (Hermes)
- [ ] ICP and pipeline motion defined (Nike leadgen)
- [ ] Core copy produced and voice-checked (Apollo + Erato)
- [ ] Email sequence drafted (Calliope)
- [ ] SEO and social plans attached (Psyche SEO + Nike social)
- [ ] PR angle ready if earned media matters (Pheme)
- [ ] KPI framework with instrumentation (Tyche)
- [ ] Momus challenge addressed (no vanity-metric success definition)

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Caduceus marketing team.

Marketing mission: [USER_MISSION]

Route in this sequence:
1. Hermes → GTM strategy, messaging pillars, channel mix, north-star metric
2. Nike Leadgen → ICP and pipeline motion
3. Apollo → Core written assets from Hermes's framework
4. Erato → Brand voice review of Apollo's drafts
5. Calliope → Email / nurture sequences
6. Psyche SEO → Organic growth plan
7. Nike Social → Social / community plan
8. Pheme → PR / earned media (if relevant; otherwise note skip)
9. Tyche → Measurement framework and experiment design
10. Momus → Challenge vanity metrics and unvalidated messaging

Deliver a Marketing System Brief: strategy, assets, calendar, and how we know it worked in 30/60/90 days.
```
