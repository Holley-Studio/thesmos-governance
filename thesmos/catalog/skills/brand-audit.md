---
id: brand-audit
name: Brand Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - brand
  - creative
  - identity
  - consistency
  - aphrodite
enabled: true
---

# Brand Audit

## Purpose

Audits brand expression across a set of assets (website, social, ads, pitch deck, emails) for visual and messaging consistency. Identifies drift from brand guidelines and prioritizes fixes by audience visibility.

## When to use

- After a rebrand (verify the rollout landed consistently)
- Before a major campaign launch
- Quarterly brand health check
- When onboarding a new design agency or freelancer
- When leadership notices "something feels off" across materials

## Required inputs

- Brand guidelines URL or file path
- 3-5 asset URLs or file paths to audit (cover different channels for maximum signal)
- Brand voice description (if formal guidelines are not available)

## Workflow steps

1. Extract brand primitives from the guidelines: primary and secondary color palette (hex values), approved typefaces and hierarchy rules, logo usage requirements (clear space, color variants, forbidden uses), photography/illustration style descriptors, and the 3-5 words that define brand tone
2. Review each asset for color adherence: flag any color that does not appear in the approved palette, and flag misuse of primary vs. accent colors
3. Review typography: check that heading and body typefaces match approved fonts, that hierarchy is respected (H1 > H2 > body size relationships), and that type is not set in unapproved weights or styles
4. Review logo usage: check clear space compliance, color variant correctness for each background, and flag any stretching, recoloring, or low-resolution instances
5. Review messaging for voice alignment: pull 3 representative sentences from each asset and score them against the brand tone words from step 1; flag sentences that are off-tone and rewrite one example per asset
6. Score each asset 1-5 on each dimension (color, typography, logo, messaging) and compute an overall brand coherence score per asset

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A brand audit matrix (assets × five dimensions with 1-5 scores), the top 5 drift violations with the specific evidence (screenshot reference, quoted sentence, or hex value), an overall brand coherence score, and a prioritized list of quick-win fixes ordered by audience visibility (highest-traffic assets first).

## Related agents

- aphrodite
- hephaestus

## Related rule packs

- @thesmos/core
