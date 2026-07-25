---
id: shot-list-review
name: Shot List Review
type: skill
version: 1.0.0
owner: thesmos
tags:
  - photography
  - creative
  - shoot
  - art-direction
  - artemis
enabled: true
---

# Shot List Review

## Purpose

Reviews a photography shot list or creative brief before a shoot. Verifies coverage completeness, styling consistency, technical specifications, lighting and location clarity, and usage rights planning. Prevents on-set chaos and post-shoot asset gaps.

## When to use

- Before a brand shoot or product photography session
- Before an editorial or campaign assignment
- Before booking talent, locations, or equipment
- When the shot list has grown organically and may have gaps or conflicts

## Required inputs

- Shot list or creative brief (paste inline or file path)
- Brand guidelines or moodboard reference (URL or file path)
- Intended usage for the assets (web, print, social, paid ads — list all channels)

## Workflow steps

1. Coverage check: map the shot list against the required asset library for each stated usage channel — for web: hero (16:9), feature images, headshots; for social: square and vertical crops of key moments; for ads: clean-background product isolations; for print: high-resolution detail shots; flag any required asset type that is missing from the list
2. Styling consistency: is there a single defined aesthetic across all shots? Check for a named reference (photographer, campaign, film) or a specific mood board — "clean and modern" is not specific enough; flag ambiguous styling direction and ask for 3 visual references per aesthetic claim
3. Technical specs audit: for each intended usage, verify that the shot list specifies required resolution (minimum DPI for print, minimum pixel dimensions for digital), aspect ratio (and whether crop room is needed), and file format (RAW for flexibility, JPEG for delivery speed); flag missing specs per channel
4. Lighting and location: check that every shot has a specified lighting setup (natural, studio strobe, continuous, golden hour) and a confirmed or contingency location — "TBD" on either is a schedule risk; flag and request confirmation
5. Usage rights planning: check whether the brief addresses model releases (required for any identifiable person in commercial use), property releases (required for interiors, art, or branded environments), exclusivity period (how long before assets can be reused or licensed), and image licensing scope (web-only vs. all-media)

## Thesmos commands

```bash
npm run thesmos:scan
```

## Expected output

A shot list scorecard (coverage, styling consistency, technical specs, lighting/location, usage rights — each rated complete/partial/missing), a list of missing shots by usage channel, a list of styling ambiguities with requests for specific references, a technical spec checklist per channel, and a pre-shoot clarifications list of questions that must be answered before the shoot date is confirmed.

## Related agents

- artemis
- aphrodite

## Related rule packs

- @thesmos/core
