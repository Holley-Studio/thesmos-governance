---
id: a11y-audit
name: Accessibility Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - accessibility
  - a11y
  - wcag
  - audit
enabled: true
---

# Accessibility Audit

## Purpose

Audits the application for WCAG 2.1 AA compliance: keyboard navigation, screen reader compatibility, colour contrast, focus management, form label associations, and ARIA attribute correctness.

## When to use

- Before a public product launch
- When an accessibility complaint is received
- Periodic accessibility reviews (quarterly)
- After major UI component changes

## Required inputs

- Changed or audited UI component files
- Design system colour token definitions
- ARIA usage in component JSX

## Workflow steps

1. Identify all UI components in the changed files
2. Check for missing ARIA labels on interactive elements
3. Verify form inputs have associated `<label>` elements or `aria-label`
4. Check colour usage against WCAG 4.5:1 contrast ratio for normal text
5. Verify keyboard navigation with `tabIndex` and `onKeyDown` handlers
6. Run `npm run thesmos:review` for `[STYLE_001]` findings on hardcoded colours

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

An accessibility findings report with WCAG criterion references, affected elements, current vs. required values, and code-level fixes. Findings are prioritised by impact on users with disabilities.

## Related agents

- accessibility-reviewer
- design-system-reviewer

## Related rule packs

- @thesmos/core
