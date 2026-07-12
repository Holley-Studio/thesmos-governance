---
"thesmos-governance": minor
---

Three false-positive/staleness fixes reported from real-world repos:

- **ENV_001 reworked.** The old rule demanded the meaningless obfuscation `process['env' as 'env']['VAR']` at BLOCKER severity — a pattern with no security value that also breaks bundler inlining. It is now a LOW maintainability rule recommending a central, schema-validated env module; `NEXT_PUBLIC_*` and `NODE_ENV` reads are fully exempt (bundlers require the literal dot form to inline them), the central `env.ts` module itself is exempt, and the bracket-notation auto-fixer was removed. Free-tier rule count shifts 289 → 288 (ENV_001 is no longer a BLOCKER, so it moves to the premium set).
- **Supabase anon key false positive.** NEXT_047 and VERCEL_002 no longer flag public-by-design keys (`*ANON_KEY*`, `*PUBLISHABLE*`, `*PUBLIC_KEY*`, `*SITE_KEY*`) stored under `NEXT_PUBLIC_` — the Supabase anon key, Stripe publishable key, and captcha site keys are meant to ship to the browser.
- **Health score no longer freezes.** `thesmos health` (and the VS Code status bar that calls it) now computes from a fresh in-memory scan instead of the last saved `report.json`, so the score reflects the repo as it is now — previously it silently never changed until someone re-ran `thesmos scan`.
