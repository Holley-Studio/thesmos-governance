---
"thesmos-governance": patch
---

False-positive fixes for client-component detection and stale guidance text:

- **SEC_001 / IMPORT_005 now verify directive position.** A `'use client'`
  string anywhere in a file no longer marks it as a client component — the
  directive must be the first non-comment statement, exactly as Next.js
  requires. Test fixtures, scanner sources, and docs containing the string
  no longer trip `admin_client_in_browser` or `server_module_in_client`.
  New helper: `isClientComponentFile()` in `secrets.ts`, with tests.
- **Retired bracket-notation guidance scrubbed.** `vibe_hardcoded_secret`'s
  suggestion and the `hardcoded_credentials`/`vibe_hardcoded_secret` good
  examples still recommended `process['env' as 'env']['VAR']` — they now
  recommend standard `process.env` reads via a schema-validated env module,
  matching the ENV_001 rework.
