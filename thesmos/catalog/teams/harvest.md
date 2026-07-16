---
id: harvest
name: "The Harvest — Customer Success & Retention Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "Demeter did not celebrate the planting — she celebrated the harvest. Customer success is the same discipline: seed carefully, tend ruthlessly, and know which accounts will feed next season."
mission: Customer success — health scoring, retention, expansion, support playbooks, and CX as one retention system
invocation: thesmos pantheon:team harvest "[Account, segment, or churn problem]"
enabled: true
sequence:
  - demeter-cs-agent
  - hestia-cx-agent
  - hebe-support-agent
  - tyche-analytics-agent
  - plutus-finance-agent
  - momus-challenger-agent
---

# The Harvest — Customer Success & Retention Team

## Mission

Protect and grow revenue after the sale: health scores, retention plays, expansion paths, support onboarding, and CX measurement. The Harvest activates when churn risk is real, QBRs need structure, or a segment's lifetime value is slipping.

## When to invoke

- Preventing churn for a segment or named account
- Building a customer health score or QBR pack
- Designing onboarding / support playbooks that reduce time-to-value
- Expansion / upsell motions grounded in usage and unit economics
- Diagnosing why NPS or retention dropped

## Invocation

```
thesmos pantheon:team harvest "[Account or segment, current health signal, and the retention outcome you need]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Demeter** | Health score model, success plan, expansion readiness | None — account truth first |
| 2 | **Hestia** | Retention program, CX playbook, onboarding fixes | Demeter's health model |
| 3 | **Hebe** | Support/onboarding runbook, FAQ gaps, escalation paths | Hestia's CX plan |
| 4 | **Tyche** | Retention KPIs, cohort views, leading indicators | Demeter + Hestia |
| 5 | **Plutus** | LTV, expansion economics, payback on save plays | Tyche's metrics |
| 6 | **Momus** | Challenge review — vanity scores, soft churn denial | All prior outputs |

## Handoff protocol

Demeter establishes account truth before Hestia designs programs. Hebe translates CX into executable support/onboarding steps. Tyche defines how success is measured; Plutus grounds expansion in unit economics. Momus is mandatory before any retention play ships — if the health score cannot predict churn, the team stops and fixes the model.

## Success criteria

- [ ] Health score model with leading indicators (Demeter)
- [ ] Success plan or QBR outline for the named account/segment (Demeter)
- [ ] Retention play with kill criteria (Hestia)
- [ ] Support/onboarding fixes that cut time-to-value (Hebe)
- [ ] KPI dashboard spec with cohort views (Tyche)
- [ ] Expansion path with economic justification (Plutus)
- [ ] Momus challenge passed — no vanity metrics or denial of soft churn

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Harvest — Customer Success & Retention Team.

Mission: [USER_MISSION]

Route in this sequence, passing full prior context to each agent:
1. Demeter → Health score model, success plan, expansion readiness
2. Hestia → Retention program and CX playbook (receives Demeter)
3. Hebe → Support/onboarding runbook (receives Hestia)
4. Tyche → Retention KPIs and cohort measurement (receives Demeter + Hestia)
5. Plutus → LTV and expansion economics (receives Tyche)
6. Momus → Challenge review — what would make this customer leave anyway?

Deliver a Retention Action Brief: prioritized saves, expansion paths, metrics to watch, and what must ship in the next 30 days.
```
