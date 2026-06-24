---
id: component-audit
name: Component Audit
type: skill
version: 1.0.0
owner: prometheus
tags:
  - components
  - ui
  - design-system
  - duplicates
enabled: true
---

# Component Audit

## Purpose

Audits the component library for duplication, inconsistency, and design system alignment: near-identical components that should be unified, components that bypass the shared UI primitives, and prop API consistency.

## When to use

- Before a component library overhaul
- When the design system team requests a duplication audit
- After a sprint that added many new UI components
- When `[ARCH_002]` duplicate_component_pattern findings appear

## Required inputs

- All component files in `components/` and `app/`
- Shared UI primitive inventory from `components/ui/`
- Design system documentation or Figma tokens

## Workflow steps

1. Run `npm run thesmos:review` to catch `[ARCH_002]` findings
2. Inventory all components and their prop APIs
3. Group components by function (buttons, inputs, cards, modals)
4. Identify groups where multiple similar components exist
5. Recommend a unified API and the deprecation path for duplicates

## Thesmos commands

```bash
npm run thesmos:review
npm run thesmos:scan
```

## Expected output

A component inventory with duplication groups, recommended consolidations, prop API harmonisation suggestions, and a migration priority list ordered by usage frequency.

## Related agents

- design-system-reviewer
- architecture-reviewer

## Related rule packs

- @thesmos/core
