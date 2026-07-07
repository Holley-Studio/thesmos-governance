---
'thesmos-governance': minor
---

AGNT_037 (1M context window governance) is now a hard BLOCKER gate instead of an advisory HIGH lint. Enabling a `[1m]` model variant or `context-1m` beta header without explicit `"context1M": { "allow1M": true }` in `.thesmos/config.json` now blocks the Write/Edit governance hook and fails CI, instead of only printing a warning. The matcher is scoped to live config contexts (model assignments, `anthropic-beta` values) so it does not fire on prose/documentation mentioning `[1m]`.
