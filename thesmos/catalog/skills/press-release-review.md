---
id: press-release-review
name: Press Release Review
type: skill
version: 1.0.0
owner: thesmos
tags:
  - pr
  - communications
  - press
  - announcement
  - pheme
enabled: true
---

# Press Release Review

## Purpose

Reviews a press release or announcement draft before distribution. Verifies newsworthiness, headline strength, quote quality, boilerplate accuracy, and media contact completeness. Catches structural problems before wire submission or reporter briefings.

## When to use

- Before sending to a wire service (PR Newswire, Business Wire, GlobeNewswire)
- Before briefing journalists under embargo
- Before any public product, funding, or partnership announcement
- When a release feels flat but the specific problem is unclear

## Required inputs

- Draft press release (paste inline or file path)
- Target publications or journalist beats (optional — improves newsworthiness calibration)
- Embargo date and time (if applicable)

## Workflow steps

1. Newsworthiness check: does this clear the "why now?" bar (timely trigger) and the "so what?" bar (meaningful impact for the target reader)? A release about a new feature is not inherently newsworthy — the business or customer impact is; flag if neither bar is cleared and suggest an angle that might clear it
2. Headline review: is it specific (not "Company Announces Major Milestone"), active voice, jargon-free, and does it lead with the news rather than the company name?
3. First paragraph (the lede): verify it answers who, what, when, where, and why in two sentences or fewer; flag missing elements and rewrite
4. Quotes: are they attributed to a named executive? Do they sound human and add perspective not already in the body copy? Flag corporate boilerplate quotes ("We are excited to announce...") and rewrite with a specific point of view
5. Boilerplate: verify the company description is current and accurate; confirm the media contact section includes name, email, phone, and time zone; verify the embargo instructions (if any) are explicit
6. Call to action: is there exactly one, is it specific (demo link, report download, event registration), and is it reachable without a wall?

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A press release scorecard (newsworthiness, headline, lede, quotes, boilerplate, CTA — each rated pass/flag/fail), flagged sections with specific rewrites, a newsworthiness verdict with the strongest available angle, and 2-3 alternative headline options.

## Related agents

- pheme
- apollo

## Related rule packs

- @thesmos/core
