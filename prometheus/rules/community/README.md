# Community Rules

This directory contains rule stubs promoted from `brain.json` via `prometheus brain:promote`.

Each file exports a `*_RULES: PrometheusRule[]` array following the same pattern as all core rule files. They are **not** active until explicitly imported in `prometheus/rules/registry.ts`.

## Promoting a rule

```bash
# 1. Propose and approve
prometheus brain:learn          # Claude proposes rules based on observed patterns
prometheus brain:evolve         # review pending proposals
prometheus brain:evolve --approve=CUSTOM_001

# 2. Scaffold the stub
prometheus brain:promote --rule=CUSTOM_001
# → writes prometheus/rules/community/CUSTOM_001.ts

# 3. Finish the stub (open the generated file)
#    - Replace TODO_REPLACE_WITH_ACTUAL_REGEX with a real pattern
#    - Add commonViolations, goodExample, badExample
#    - Set sinceVersion to the next release

# 4. Wire into the registry
#    prometheus/rules/registry.ts:
#      import { CUSTOM_001_RULES } from './community/CUSTOM_001.js';
#      // push inside PROMETHEUS_RULES array or append after

# 5. Write a test
#    prometheus/rules/custom_001.test.ts

# 6. Bump version and CHANGELOG
```

## File naming

Files use the rule ID as the filename: `CUSTOM_001.ts`, `CUSTOM_002.ts`, etc.
The exported array name matches: `CUSTOM_001_RULES`, `CUSTOM_002_RULES`, etc.

Community rules ship with `tags: ['custom', 'community']` until they are graduated into a core rule series (e.g. `SEC_*`, `AUTH_*`) after sufficient real-world validation.
