---
id: design-token-audit
name: Design Token Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - design-system
  - tokens
  - ui
  - consistency
enabled: true
---

# Design Token Audit

## Purpose

Audits the codebase for design token usage: hardcoded colour, spacing, or typography values that should reference the token system, and token definitions that are no longer used by any component.

## When to use

- After a design system token update
- When components diverge visually from the design spec
- Design system migration sprints
- Accessibility reviews where colour contrast needs verification

## Required inputs

- Design token definitions (`tailwind.config.ts`, `styles/tokens.css`, CSS variables)
- UI component files with styling
- WCAG contrast targets for text colours

## Workflow steps

1. Run `npm run thesmos:review` to find `[STYLE_001]` hardcoded colour violations
2. Map each hardcoded value to the closest design token
3. Identify tokens defined in the token file but not used in any component
4. Check colour pairs (text + background) for WCAG contrast compliance
5. Produce a migration plan for components with hardcoded values

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A token audit report: hardcoded value → recommended token mapping, list of unused tokens (candidates for removal), contrast ratio checks for key colour pairs, and a prioritised migration list.

## Related agents

- design-system-reviewer
- accessibility-reviewer

## Related rule packs

- @thesmos/core
