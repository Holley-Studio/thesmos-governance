---
name: i18n-audit
description: Audits the application for i18n completeness — missing translation keys for new UI strings, hardcoded locale-sensitive values, missing RTL support, and locale coverage gaps.
---

# Internationalisation Audit

## Purpose

Audits the application for i18n completeness: missing translation keys for new UI strings, hardcoded locale-sensitive values, missing RTL support, and locale coverage gaps.

## When to use

- Before launching in a new locale or language
- When a localisation bug is reported
- i18n sprints preparing for market expansion
- After adding new UI components

## Required inputs

- Translation key files (e.g. `messages/en.json`)
- UI component files with string content
- List of supported locales

## Workflow steps

1. Extract all user-facing strings from changed UI components
2. Check each string against the base locale key file for a corresponding key
3. Identify keys present in the base locale but missing in other locale files
4. Check date, number, and currency formatting for `Intl` API usage
5. Review layout for RTL breakage in `dir="rtl"` scenarios
6. Produce a translation coverage matrix per locale

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

An i18n coverage report: untranslated strings, missing keys per locale, hardcoded locale-sensitive values, and RTL layout issues. Includes a translation coverage percentage per supported locale.

## Related agents

- localization-reviewer
- content-reviewer

## Related rule packs

- @thesmos/core
