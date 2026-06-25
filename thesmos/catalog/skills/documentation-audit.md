---
id: documentation-audit
name: Documentation Audit
type: skill
version: 1.0.0
owner: thesmos
tags:
  - documentation
  - readme
  - jsdoc
  - completeness
enabled: true
---

# Documentation Audit

## Purpose

Audits documentation completeness: exported API surface without JSDoc, changed signatures without updated docs, new environment variables not in `.env.example`, and README sections that reference removed functionality.

## When to use

- Before publishing a new package version
- Documentation sprints
- Onboarding reviews
- After major refactors that changed the public API

## Required inputs

- `index.ts` barrel exports
- `README.md` content
- `.env.example` content
- Changed function signatures

## Workflow steps

1. List all exported symbols from `index.ts`
2. Check each export for JSDoc presence (description, params, returns)
3. Compare README command examples against current `package.json` scripts
4. Check changed function signatures against documentation
5. Verify new env vars in code are in `.env.example`
6. Check CHANGELOG.md is up to date for the current version

## Thesmos commands

```bash
npm run thesmos:review
```

## Expected output

A documentation gap report: undocumented exports, outdated README sections, missing env var documentation, and changelog gaps. Prioritised by: public API (highest) → README → CHANGELOG → internal docs.

## Related agents

- documentation-reviewer
- onboarding-reviewer

## Related rule packs

- @thesmos/core
