---
id: argonauts
name: "The Argonauts — Product Launch Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "Jason and the Argonauts assembled the greatest heroes of Greece for a single epic mission. Each brought an irreplaceable skill. Together, they achieved what no individual could."
mission: Product launch — market entry, positioning, campaign, content, sales readiness, and launch-day execution
invocation: thesmos pantheon:team argonauts "[Launch description]"
enabled: true
sequence:
  - psyche-research-agent
  - athena-strategy-agent
  - daedalus-product-agent
  - aphrodite-creative-agent
  - apollo-content-agent
  - erato-brand-voice-agent
  - hermes-marketing-agent
  - calliope-email-agent
  - nike-leadgen-agent
  - pheme-pr-agent
  - ares-sales-agent
  - momus-challenger-agent
  - zeus-executive-agent
  - cassandra-qa-agent
---

# The Argonauts — Product Launch Team

## Mission

Coordinate a full product launch from customer research to sales readiness. The Argonauts activate for any new product, feature, or market entry that requires cross-functional coordination — research, strategy, creative, content, marketing, sales, PR, and final QA all working in sequence.

## When to invoke

- Launching a new product or major feature
- Entering a new market segment
- Re-launching after a major pivot
- Coordinating a campaign that spans multiple channels and functions

## Invocation

```
thesmos pantheon:team argonauts "Launch [product] into [market] targeting [ICP] by [date]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Psyche** | Customer research brief: ICP, JTBD, interview insights, pain hierarchy | None — research first |
| 2 | **Athena** | GTM strategy: positioning, competitive landscape, target segment, pricing rationale | Psyche's research brief |
| 3 | **Daedalus** | Launch PRD: feature scope, acceptance criteria, launch readiness checklist | Athena's GTM strategy |
| 4 | **Aphrodite** | Brand brief: visual identity for launch, campaign aesthetic, creative direction | Athena's positioning |
| 5 | **Apollo** | Content plan: landing page copy, blog posts, email copy, in-app messaging | Athena's messaging, Aphrodite's brief |
| 6 | **Erato** | Brand voice guide: tone, vocabulary, and language standards for all launch materials | Apollo's content plan |
| 7 | **Hermes** | Campaign brief: channel mix, budget allocation, launch timeline, campaign KPIs | Athena's strategy + Apollo's content |
| 8 | **Calliope** | Email sequences: pre-launch waitlist, launch day announcement, onboarding sequence | Hermes's campaign brief |
| 9 | **Nike** | Lead gen plan: ICP list, outbound sequence, lead scoring criteria | Hermes's ICP definition |
| 10 | **Pheme** | Press release + media list + crisis comms plan | Athena's positioning |
| 11 | **Ares** | Sales playbook: pitch deck, objection handling, pricing defence, discovery questions | All previous outputs |
| 12 | **Momus** | Challenge review: "What could go wrong? What are we missing?" | All previous outputs |
| 13 | **Zeus** | Launch brief synthesis: final go/no-go, dependency order, success criteria | All previous outputs |
| 14 | **Cassandra** | Launch QA checklist: what must be verified before Day 1 | Zeus's launch brief |

## Handoff protocol

Each agent in the Argonauts receives the full context bundle from all prior agents before starting. Zeus's final synthesis consolidates everything into a single Launch Brief that serves as the authoritative go/no-go document.

## Success criteria

- [ ] ICP and JTBD validated (Psyche)
- [ ] GTM strategy approved by Zeus (Athena)
- [ ] Landing page live with copy from Apollo
- [ ] Email sequence live in Mailchimp/HubSpot (Calliope)
- [ ] Outbound sequence running with qualified list (Nike)
- [ ] Press release distributed to media list (Pheme)
- [ ] Sales team briefed with playbook (Ares)
- [ ] Momus challenge passed — no critical gaps
- [ ] Launch QA checklist complete (Cassandra)

## Execution mode (V1: Sequential)

V1 uses sequential routing — Zeus activates each agent one at a time, collects their output, and passes it as context to the next agent. True parallel execution is V2. Sequential ensures each agent has the full context of all prior outputs before contributing.

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Argonauts team for a product launch.

Mission: [USER_MISSION]

Route to each agent in this sequence, passing the full prior output as context:
1. Psyche → Customer research brief
2. Athena → GTM strategy (receives Psyche's output)
3. Daedalus → Launch PRD (receives Athena's output)
4. Aphrodite → Brand brief (receives Athena's output)
5. Apollo → Content plan (receives Athena + Aphrodite)
6. Erato → Brand voice guide (receives Apollo's output)
7. Hermes → Campaign brief (receives all prior)
8. Calliope → Email sequences (receives Hermes's brief)
9. Nike → Lead gen plan (receives Hermes's ICP)
10. Pheme → Press release + media list (receives Athena's positioning)
11. Ares → Sales playbook (receives all prior)
12. Momus → Challenge review (receives all prior — find the gaps)
13. Zeus → Launch brief synthesis (your final deliverable)
14. Cassandra → QA checklist (receives Zeus's launch brief)

After each agent responds, summarise their output in 3 bullets before routing to the next agent.
```
