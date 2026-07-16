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

## Sequence rationale

1. **Demeter** — account health, success plan, expansion readiness
2. **Hestia** — CX and retention program design
3. **Hebe** — support / onboarding execution detail
4. **Tyche** — KPIs that prove retention is working
5. **Plutus** — LTV, expansion economics, payback
6. **Momus** — kills vanity health scores and soft churn denial

## Output the team owes

- Health score model with leading indicators (not lagging NPS alone)
- Success plan or QBR outline for the named account/segment
- Retention play with kill criteria
- Support/onboarding fixes that cut time-to-value
- Expansion path with economic justification
- Momus challenge: "what would make this customer leave anyway?"
