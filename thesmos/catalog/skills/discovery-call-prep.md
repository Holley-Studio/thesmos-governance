---
id: discovery-call-prep
name: Discovery Call Prep
type: skill
version: 1.0.0
owner: thesmos
tags:
  - sales
  - discovery
  - meddpicc
  - qualification
  - ares
enabled: true
---

# Discovery Call Prep

## Purpose

Prepares a discovery call brief for a specific prospect. Covers company research, pain hypothesis, MEDDPICC gap map, and tailored open-ended questions. Ensures reps enter every call with a point of view, not a blank slate.

## When to use

- Before any first discovery call
- Before re-engaging a stalled deal (update with what's changed)
- Before a QBR or executive sponsor meeting
- Before a competitive displacement call

## Required inputs

- Prospect company name
- Known use case or pain (if any — can be blank for cold outbound)
- Deal stage
- Prior call notes (optional)

## Workflow steps

1. Gather company context: industry, approximate headcount, recent funding or news signals, likely tech stack based on job postings or public integrations, and any public statements about strategic priorities
2. Hypothesize the top 3 pain points this prospect is most likely experiencing based on their profile, industry, and deal stage — rank them by probability and articulate the business impact of each
3. Map MEDDPICC: for each letter (Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion, Competition), state what is known, what is unknown, and the risk if it stays unknown
4. Prepare exactly 5 open-ended discovery questions that target the biggest MEDDPICC gaps — each question should be designed to surface pain, not pitch product
5. Form an economic buyer hypothesis: who likely owns the budget for this purchase, what is their primary success metric, and what would make them champion this internally?

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A one-page call brief containing: company snapshot (3-5 bullets), top 3 pain hypotheses with business impact, MEDDPICC gap map (known / unknown / risk), 5 tailored discovery questions, and an economic buyer hypothesis with their likely success metric.

## Related agents

- ares
- nike

## Related rule packs

- @thesmos/core
