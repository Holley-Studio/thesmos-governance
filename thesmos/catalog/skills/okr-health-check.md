---
id: okr-health-check
name: OKR Health Check
type: skill
version: 1.0.0
owner: thesmos
tags:
  - strategy
  - okr
  - alignment
  - planning
  - athena
enabled: true
---

# OKR Health Check

## Purpose

Assesses whether OKRs are well-formed, measurable, and strategically aligned. Flags aspirational-but-unactionable Key Results, vanity metrics disguised as outcomes, and missing leading indicators.

## When to use

- Quarterly OKR planning (before the set is locked)
- Mid-quarter check-in when OKRs feel disconnected from daily work
- When a team reports that OKRs are not driving behavior change
- Before presenting OKRs to leadership or investors

## Required inputs

- Current OKR list (pasted inline or file path)
- Company or team strategy statement (1-2 sentences describing the direction this quarter)

## Workflow steps

1. Check each Objective: is it outcome-framed (a state of the world) or output-framed (a list of tasks)? Flag output-framed Objectives and rewrite as outcomes
2. Verify each Key Result: does it have a specific numeric target, a unit of measurement, and a date? Flag any KR missing one of these three components
3. Score strategic alignment for each KR on a 1-5 scale: does hitting this KR directly advance the strategy statement? Flag anything below 3
4. Identify vanity metrics — activity metrics (calls made, emails sent, features shipped) that do not measure customer or business outcomes — and propose outcome substitutes
5. Identify missing KRs: read the strategy statement and ask what must be true for it to succeed that no current KR tracks — surface those gaps as candidate additions

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

An OKR health scorecard (each Objective and KR rated on well-formedness, measurability, and strategic alignment), a list of flagged KRs with suggested rewrites, missing KR candidates, and a summary of leading vs. lagging indicator balance.

## Related agents

- athena
- daedalus

## Related rule packs

- @thesmos/core
