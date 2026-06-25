# Community Rules

This directory contains rule stubs promoted from `brain.json` via `thesmos brain:promote`.

Each file exports a `*_RULES: ThesmosRule[]` array following the same pattern as all core rule files. They are **not** active until explicitly imported in `thesmos/rules/registry.ts`.

## Promoting a rule

```bash
# 1. Propose and approve
thesmos brain:learn          # Claude proposes rules based on observed patterns
thesmos brain:evolve         # review pending proposals
thesmos brain:evolve --approve=CUSTOM_001

# 2. Scaffold the stub
thesmos brain:promote --rule=CUSTOM_001
# → writes thesmos/rules/community/CUSTOM_001.ts

# 3. Finish the stub (open the generated file)
#    - Replace TODO_REPLACE_WITH_ACTUAL_REGEX with a real pattern
#    - Add commonViolations, goodExample, badExample
#    - Set sinceVersion to the next release

# 4. Wire into the registry
#    thesmos/rules/registry.ts:
#      import { CUSTOM_001_RULES } from './community/CUSTOM_001.js';
#      // push inside THESMOS_RULES array or append after

# 5. Write a test
#    thesmos/rules/custom_001.test.ts

# 6. Bump version and CHANGELOG
```

## File naming

Files use the rule ID as the filename: `CUSTOM_001.ts`, `CUSTOM_002.ts`, etc.
The exported array name matches: `CUSTOM_001_RULES`, `CUSTOM_002_RULES`, etc.

Community rules ship with `tags: ['custom', 'community']` until they are graduated into a core rule series (e.g. `SEC_*`, `AUTH_*`) after sufficient real-world validation.
