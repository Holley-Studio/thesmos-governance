---
id: content-brief-review
name: Content Brief Review
type: skill
version: 1.0.0
owner: thesmos
tags:
  - content
  - copywriting
  - seo
  - brief
  - apollo
enabled: true
---

# Content Brief Review

## Purpose

Reviews a content brief or draft before production begins. Verifies audience clarity, angle originality, SEO intent match, word-count fit, and brand voice alignment. Catches structural problems before a writer invests hours in the wrong direction.

## When to use

- Before writing starts (brief review mode)
- Before publishing or handing off to design (draft review mode)
- When a piece feels off but the specific problem is unclear

## Required inputs

- Content brief or draft (paste inline or file path)
- Target keyword if this is an SEO piece
- Audience persona name or description

## Workflow steps

1. Confirm the target audience is specific enough to guide tone decisions — "marketers" is too broad; "B2B SaaS marketing managers at 50-500 person companies" is actionable; flag vague audience definitions
2. Assess angle originality — search-match the topic mentally against what already ranks or exists; does this piece have a differentiated point of view or is it a restatement of the consensus?
3. For SEO pieces, verify keyword intent match: is the piece format (listicle, guide, comparison, landing page) aligned with what searchers clicking that keyword actually want?
4. Review the headline for specificity (does it make a clear promise?) and value proposition (does it answer "why read this instead of the other ten results"?); flag generic headlines
5. Flag brand voice deviations using the stated persona — identify specific sentences that are too formal, too casual, jargon-heavy, or off-tone, and rewrite each flagged line

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A brief scorecard rated across five dimensions (audience specificity, angle originality, SEO intent match, headline strength, brand voice alignment), a pass/revise/reject verdict with rationale, and specific edit suggestions for each flagged item.

## Related agents

- apollo
- psyche

## Related rule packs

- @thesmos/core
