# Known Gap: Per-rule detect() fixture suite for BLOCKER rules

**Tracked:** https://github.com/Holley-Studio/thesmos-governance/issues/96  
**Filed:** 2026-07-12  
**Related fix:** `.changeset/severity-merge-fix.md`, `thesmos/severity.test.ts`

## What's missing

The Phase 3 severity-resolution regression test (`severity.test.ts`) covers the
config merge path: it asserts that all 200+ BLOCKER-declared rules resolve to
BLOCKER after merging a partial user config. This would have caught the original
198-rule silent-downgrade gap.

What it does NOT test: that each rule's `detect()` function actually fires and
produces a BLOCKER-level finding when its pattern is present in code. This is
the deeper, detect-path guarantee.

## What a complete fixture suite would look like

For each rule in `THESMOS_RULES` where `severity === 'BLOCKER'`:

1. A minimal code snippet that reliably triggers `detect()` for that rule
2. A test that runs `detect()` on the snippet with `CONFIG_DEFAULTS.severityRules`
3. An assertion that at least one finding has `severity === 'BLOCKER'`
4. The test should fail if `detect()` returns no findings (catches pattern drift)

Example structure:
```typescript
const BLOCKER_FIXTURES: Record<string, { language: string; code: string }> = {
  hardcoded_credentials: {
    language: 'ts',
    code: `const API_KEY = "sk-abc123definitelyarealkey12345";`,
  },
  sql_injection: {
    language: 'ts',
    code: 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);',
  },
  // ... 200+ more
};
```

## Why it's out of scope for this fix

Writing 200+ reliable per-rule fixture snippets is a standalone sprint:
- Each rule has different pattern matching logic and language targets
- Fixtures must trigger the rule without triggering adjacent rules (noise)
- Some rules require multi-line or multi-file context
- The detect() functions vary widely in how they match patterns

The severity-resolution fix (the actual reported gap) does not depend on this
suite. Bundling fixture authoring into this PR would delay shipping the fix.

## Acceptance criteria (see GitHub issue #96)

- [ ] Fixture for every rule where `r.severity === 'BLOCKER'` in `THESMOS_RULES`
- [ ] Each fixture produces ≥1 finding from `detect()` with `severity === 'BLOCKER'`
- [ ] Test fails if `detect()` returns no findings
- [ ] Fixtures are minimal — least code that reliably triggers the rule
- [ ] Suite runs in CI alongside `severity.test.ts`
