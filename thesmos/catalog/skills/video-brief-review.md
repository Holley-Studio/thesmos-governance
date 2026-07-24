---
id: video-brief-review
name: Video Brief Review
type: skill
version: 1.0.0
owner: thesmos
tags:
  - video
  - production
  - creative
  - brief
  - dionysus
enabled: true
---

# Video Brief Review

## Purpose

Reviews a video brief or script before production begins. Verifies concept clarity, audience and platform fit, duration appropriateness, hook strength, call-to-action focus, and production feasibility for the stated budget. Prevents expensive reshoots caused by under-specified briefs.

## When to use

- Before shooting begins
- Before sending a brief to a production vendor for a quote
- Before approving a production budget
- When a video brief has gone through multiple rounds without alignment

## Required inputs

- Video brief or script (paste inline or file path)
- Target platform and placement (YouTube organic, LinkedIn feed, paid pre-roll, website hero, trade show loop, etc.)
- Budget tier (lo-fi / mid / high-end)

## Workflow steps

1. Concept clarity test: can someone describe what happens in this video in a single sentence? If the brief requires three sentences or a list of "and also..." items, the concept is not focused enough — flag and suggest a single-sentence logline
2. Audience and platform fit: different platforms have fundamentally different viewer intent (YouTube = lean-in, TikTok = lean-back, LinkedIn = professional context, paid pre-roll = interruption); check that the format, tone, and pacing assumption in the brief match how the target audience uses this specific platform
3. Duration check: benchmark appropriate duration against platform + funnel stage (awareness ads: 15-30s; consideration content: 1-3 min; educational/tutorial: 3-10 min); flag briefs that are undershooting or overshooting, and give the rationale
4. Hook audit: read or watch the first 3 seconds — does it create tension, surprise, or a strong visual that earns continued attention? A logo or product shot in second one is a hook failure; rewrite the hook if flagged
5. CTA review: identify all calls to action in the brief — flag if there are zero (no direction given to the viewer) or more than one (confused viewer); verify the single CTA is specific and achievable from the platform context
6. Production feasibility: for each budget tier, check whether the brief's requirements (locations, cast, motion graphics, animation, VO, music licensing) are realistic; flag specific line items that exceed typical tier costs and suggest lo-fi alternatives

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A brief scorecard rated across six dimensions (concept clarity, platform fit, duration, hook, CTA, production feasibility), a pass/revise verdict with rationale, specific feedback and suggested rewrites per flagged section, and 2-3 hook rewrite options for the first 3 seconds.

## Related agents

- dionysus
- morpheus

## Related rule packs

- @thesmos/core
