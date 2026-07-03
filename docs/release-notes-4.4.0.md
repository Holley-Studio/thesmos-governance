# thesmos-governance 4.4.0 — Release Notes

> Publish checklist for the user (account-bound steps). Claude pre-staged everything below;
> each step is one command. This release supersedes the accidental `latest` regression.

## Why 4.4.0

npm publish history: 4.0.0 → 4.3.0 shipped 2026-06-25, then **1.5.0 was published
2026-07-01 and captured the `latest` dist-tag** — fresh installs currently get 1.5.0.
4.4.0 is the first version that supersedes everything published, restoring normal
semver update flow for users on 4.3.0.

## Publish steps (in order)

```bash
# 1. Immediate triage — repoint latest without republishing (fixes new installs NOW):
npm dist-tag add thesmos-governance@4.3.0 latest

# 2. Deprecate the stray 1.5.0 so update tooling stops suggesting it:
npm deprecate thesmos-governance@1.5.0 "Accidental publish from a stale checkout — use 4.x. Latest: 4.4.0."

# 3. Publish 4.4.0 from this repo (after the headcount PR merges to main):
npm run build:lib && cd thesmos && npm publish
```

## What's in 4.4.0 (vs 4.3.0)

- **Roster truth: 67 specialist agents** (59 gods; 6 gods carry multiple roles).
  Phantom god Iris removed from `pantheon-map.json`, `divisions.json`, and all routing
  docs — photography routes to **Artemis** everywhere, matching the actual shipped agent.
- **All marketing/doc surfaces reconciled to 67** (was a stale "66"; `thesmos/README.md`'s
  ancient "38" pending the same sweep).
- **Stale "1,075 rules" citations fixed to 1,137** in Pantheon exports and their two
  catalog sources (Polyhymnia, Erato).
- Known issue documented in `docs/roadmap.md`: `pantheon:export` regeneration is
  destructively out of sync with shipped exports — do not regen until sources are
  recovered (the 4.1–4.3 generator work appears published-but-uncommitted).

## Caveat before step 3

Local repo was at 4.0.0 while npm has 4.3.0 — meaning the 4.1–4.3 source changes are
NOT in this repo. Publishing 4.4.0 from this tree may **remove** whatever shipped in
4.1–4.3. Before publishing, diff the built package against 4.3.0:

```bash
cd /tmp && npm pack thesmos-governance@4.3.0 && tar xf thesmos-governance-4.3.0.tgz
# compare package/dist against this repo's fresh build output
```

If 4.3.0 contains code this repo lacks, recover it first (check other machines/checkouts
for the uncommitted 4.1–4.3 work) — otherwise 4.4.0 is a silent regression for CLI users.
