---
id: furies
name: "The Furies — Revenue Rescue Team"
type: team
version: 1.0.0
owner: thesmos-pantheon
mythology: "The Erinyes — Alecto, Megaera, and Tisiphone — were the goddesses of retribution. They pursued wrongdoers without rest, without mercy, without distraction. In business, the Furies pursue the one thing that actually matters: revenue."
mission: Revenue rescue — diagnose falling revenue, repair churn, fix pipeline, and restore growth trajectory
invocation: thesmos pantheon:team furies "[Revenue problem description]"
enabled: true
sequence:
  - tyche-analytics-agent
  - hestia-cx-agent
  - ares-sales-agent
  - hermes-marketing-agent
  - plutus-finance-agent
  - momus-challenger-agent
  - nike-leadgen-agent
---

# The Furies — Revenue Rescue Team

## Mission

Diagnose and fix a revenue problem: falling MRR, high churn, stalled pipeline, broken unit economics, or a campaign that stopped converting. The Furies don't ask "what's going right?" — they find what's broken and fix it.

## When to invoke

- MRR is declining month over month
- Churn is above 5% monthly
- Pipeline has stalled and deals aren't closing
- CAC has increased without a corresponding increase in LTV
- A marketing campaign stopped converting and you don't know why
- You're below revenue target with no clear explanation

## Invocation

```
thesmos pantheon:team furies "[Describe the revenue problem — include current metrics if known]"
```

## Team composition (sequential routing order)

| Step | Agent | Deliverable | Dependency |
|---|---|---|---|
| 1 | **Tyche** | Revenue diagnostic: MRR trend, churn cohort, pipeline velocity, CAC/LTV analysis | Data access — requires metrics |
| 2 | **Hestia** | CX audit: churn reasons (exit interview themes), NPS detractors, onboarding drop-off points | Tyche's churn cohort |
| 3 | **Ares** | Sales audit: pipeline stage conversion rates, lost deal reasons, objection patterns | Tyche's pipeline data |
| 4 | **Hermes** | Marketing audit: campaign performance, channel mix, messaging resonance vs. ICP | Tyche's acquisition data |
| 5 | **Plutus** | Unit economics review: CAC by channel, LTV by cohort, payback period, revenue per seat | Tyche's financial data |
| 6 | **Momus** | Challenge review: "What's the real cause? Are we treating symptoms or root causes?" | All prior outputs |
| 7 | **Nike** | Pipeline repair plan: outbound sequences, ICP re-targeting, lead re-engagement | Ares + Hermes findings |

## Handoff protocol

Tyche goes first — data before diagnosis. Every subsequent agent builds on Tyche's diagnostic. Momus reviews all findings before Nike executes any repair, to prevent investing in the wrong fix.

## Success criteria

- [ ] Revenue decline root cause identified (Tyche)
- [ ] Churn cause attributed (Hestia) — onboarding, product, value, support
- [ ] Pipeline gap located (Ares) — stage, persona, objection
- [ ] Marketing channel with highest ROI identified (Hermes)
- [ ] Payback period and LTV/CAC ratio current (Plutus)
- [ ] Momus challenge passed — no misattributed causes
- [ ] Nike outbound plan running within 48 hours of Furies session

## Zeus orchestration prompt

```
You are God Agent Zeus, orchestrating The Furies team for revenue rescue.

Revenue problem: [USER_MISSION]

Route in this exact sequence:
1. Tyche → Revenue diagnostic with available metrics
2. Hestia → CX audit focused on churn signals (receives Tyche's data)
3. Ares → Sales pipeline audit (receives Tyche's pipeline data)
4. Hermes → Marketing performance audit (receives Tyche's acquisition data)
5. Plutus → Unit economics review (receives all Tyche financial data)
6. Momus → Challenge: are we treating the real cause or symptoms? (receives all prior)
7. Nike → Pipeline repair plan (receives Ares + Hermes findings)

After all agents respond, deliver a Revenue Rescue Summary: top 3 root causes ranked by impact, and the 3 actions to take in the next 7 days.
```
