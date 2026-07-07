---
'thesmos-governance': minor
---

New rule tiering engine. The free CLI now runs a 289-rule Essentials set (every BLOCKER plus the complete AI-code safety net — VIBE/AI/SLOP rule families); the remaining 848 rules unlock via a distribution-gated premium pack marker (`~/.thesmos/premium/pack.json` or a project's `.thesmos/premium/pack.json`), or explicitly via `config.tier` / the `THESMOS_TIER` environment variable. New `thesmos tier` command reports the active tier and rule counts (supports `--json`).
