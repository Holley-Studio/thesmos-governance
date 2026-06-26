# Thesmos Rule Packs

Add local rule pack definitions here. Rule packs group related rules for installation.

## How to add a local rule pack

1. Create a directory: `.thesmos/rules/<pack-id>/`
2. Add a `pack.json` manifest and a `rules.ts` (or `rules.js`) file
3. Reference the pack ID in `.thesmos/registry.json`

## Built-in packs (Phase 2)

Future releases will ship built-in rule packs:

- `@thesmos/core` — fundamental rules (always included)
- `@thesmos/web` — modern web application rules
- `@thesmos/security` — security-focused rules
- `@thesmos/nextjs` — Next.js-specific rules
- `@thesmos/supabase` — Supabase-specific rules
- `@thesmos/design-system` — design token enforcement
- `@thesmos/accessibility` — a11y rules
- `@thesmos/performance` — performance rules