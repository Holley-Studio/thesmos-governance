---
id: competitive-landscape-analysis
name: Competitive Landscape Analysis
type: skill
version: 1.0.0
owner: thesmos
tags:
  - strategy
  - competitive
  - market
  - gtm
  - athena
enabled: true
---

# Competitive Landscape Analysis

## Purpose

Produces a structured competitive landscape for a market, product category, or specific competitor set. Covers positioning, feature gaps, pricing tiers, and messaging angles to inform GTM strategy and product decisions.

## When to use

- Before GTM planning or a market entry decision
- When a competitor launches a new product or pricing change
- Before pricing decisions or repositioning
- When entering a new customer segment

## Required inputs

- Target market or product category (1-2 sentences)
- 3-5 competitor names or URLs (optional — inferred from category if omitted)
- Your product's positioning statement

## Workflow steps

1. Frame the market category and primary customer segment — confirm the competitive set is peer-level (not aspirational or irrelevant)
2. Map each competitor by three axes: maturity (startup/growth/enterprise), pricing tier (low/mid/premium), and primary target segment
3. Score each competitor on five dimensions (1-5): product depth, market position, pricing competitiveness, messaging strength, support quality — document the evidence for each score
4. Identify white space: underserved segments, missing feature categories, pricing gaps between tiers, and messaging angles no competitor owns
5. Synthesize positioning recommendations: where to differentiate, what to avoid, and which competitor's customers are the highest-propensity targets

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A competitive matrix table (competitors × five dimensions with scores), a white-space map identifying 2-3 underserved areas, a positioning recommendation with rationale, and 3 quick-win actions (messaging change, feature priority, or pricing adjustment) that can be executed within 30 days.

## Related agents

- athena
- hermes

## Related rule packs

- @thesmos/core
