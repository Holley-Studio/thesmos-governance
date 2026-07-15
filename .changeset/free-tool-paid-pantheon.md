---
"thesmos-governance": major
---

**5.0: The tool is free. The gods are $24.**

Every governance rule is now free for everyone — the complete 1,137-rule
engine, every framework pack, every compliance pack (GDPR/HIPAA/EU AI
Act/DORA). `activeRulesForTier()` returns the full engine regardless of
tier (BREAKING for anyone depending on the free-tier restriction).

The paid product is the **Full Pantheon** — all 67 specialist agents,
**$24 one-time** (was $79), content-gated: premium agents are physically
absent from the free npm distribution rather than honor-system-gated.

New:
- The npm tarball now ships the 6 free starter gods (Zeus, Athena, Argus,
  Apollo, Hephaestus, Hebe) — previously it shipped ZERO pantheon agents,
  so the free tier was broken for real npm installs.
- `thesmos pantheon:install --pack <zip|dir>` — one-command install of the
  purchased Gumroad pack: extracts, validates, installs all agents,
  regenerates adapters, drops the purchase marker. Idempotent; re-download
  + re-run is the update channel.
- `pantheon:list` / `pantheon:install` show computed god counts and a $24
  upsell only when running on the free distribution.
- `pack-gate.test.ts` guards the content gate in CI — premium agents can
  never silently leak into the tarball again.
