---
id: partnership-brief
name: Partnership Brief
type: skill
version: 1.0.0
owner: thesmos
tags:
  - bd
  - partnerships
  - business-development
  - heracles
enabled: true
---

# Partnership Brief

## Purpose

Produces a structured partnership brief for an inbound or outbound business development opportunity. Covers strategic fit, value exchange, customer overlap, risk assessment, and a proposed structure — giving both parties a shared document to react to in the first meeting.

## When to use

- Before a first partner meeting (arrive with a brief, not a blank agenda)
- Before drafting an MOU or partnership term sheet
- When evaluating whether a channel, integration, or co-marketing opportunity is worth pursuing
- When leadership asks "should we do this partnership?"

## Required inputs

- Partner company name
- Partnership type (channel / integration / co-marketing / reseller / OEM)
- Known overlap or opportunity (1-2 sentences — can be a hypothesis)

## Workflow steps

1. Strategic fit score (1-5): does this partnership accelerate our core growth motion (reach new buyers, reduce CAC, expand LTV) or does it primarily serve a side objective? Flag anything below 3 as a distraction risk and document the reasoning
2. Value exchange: for each party, list concretely what they contribute (distribution, technology, brand, content, data, revenue) and what they receive — then check for asymmetry; a partnership where one side gets significantly more than it gives is unstable
3. Customer overlap: estimate the size of the overlapping customer segment — what is the addressable intersection, and what percentage of each company's customer base lives in it? Larger overlap = higher co-sell potential but also higher conflict risk
4. Risk assessment across four dimensions: competitive risk (could partner become a competitor?), IP risk (are we exposing proprietary methods?), contractual risk (exclusivity, revenue minimums, auto-renewal), revenue dependency risk (what happens to our business if this partnership ends?)
5. Proposed structure: recommend the partnership model (co-sell, referral fee, OEM, white-label, integration listing) with a rough term outline — duration, key commitments from each side, success metrics, and exit conditions

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A one-page partnership brief: strategic fit score with rationale, value exchange table (what we give / what we get), customer overlap estimate, risk matrix (four dimensions rated low/medium/high), proposed partnership structure with term outline, and recommended next steps.

## Related agents

- heracles
- athena

## Related rule packs

- @thesmos/core
