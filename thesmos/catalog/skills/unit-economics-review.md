---
id: unit-economics-review
name: Unit Economics Review
type: skill
version: 1.0.0
owner: thesmos
tags:
  - finance
  - unit-economics
  - cac
  - ltv
  - plutus
enabled: true
---

# Unit Economics Review

## Purpose

Audits the unit economics of a product or business model — CAC, LTV, payback period, gross margin, and contribution margin by segment. Identifies the biggest risk factor and the highest-leverage improvement lever.

## When to use

- Before fundraising (investors will ask these questions)
- When CAC is rising and the cause is unclear
- When evaluating a pricing change or new GTM motion
- During a quarterly business review
- Before launching a new channel or customer segment

## Required inputs

- CAC (by channel if available, blended if not)
- LTV or ARPU + monthly churn rate
- Gross margin percentage
- Average contract value (B2B) or average order value (B2C)
- Sales cycle length

## Workflow steps

1. Calculate LTV:CAC ratio — flag if below 3:1 (SaaS benchmark); for transactional businesses use appropriate vertical benchmark; document the formula used so assumptions are transparent
2. Calculate payback period in months — flag if greater than 18 months for B2B SaaS or 12 months for B2C; identify whether the driver is high CAC, low ACV, or thin margin
3. Compute contribution margin per unit: ACV × gross margin − direct customer success costs; flag if contribution margin is negative on any segment
4. Stress-test key assumptions: what happens to payback period and LTV:CAC if CAC doubles? If churn increases 20%? If gross margin compresses 10 points? Surface which assumption the model is most sensitive to
5. Identify the single biggest lever: is the problem primarily a CAC problem (channel efficiency, sales motion), an LTV problem (churn, expansion revenue, pricing), or a margin problem (COGS, hosting, support costs)?

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A unit economics dashboard table (CAC, LTV, LTV:CAC, payback period, contribution margin — with benchmarks), a health assessment highlighting what is on-track vs. at-risk, a sensitivity table showing model behavior under stress, the single biggest risk factor, and the top 3 levers to improve the model ranked by impact vs. effort.

## Related agents

- plutus
- tyche

## Related rule packs

- @thesmos/core
