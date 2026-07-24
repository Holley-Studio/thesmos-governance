# SDD Progress — living-council-ux (2026-07-22)

Plan: docs/superpowers/plans/2026-07-22-living-council-ux.md
Branch: main
Start commit: 9dda0a6

## Tasks
- [x] Task 1: Controller — turn summary UiItem type and push logic (commits 9dda0a6..699ec4a, review clean)
- [x] Task 2: Webview — UiItem sync, card renderer, shimmer and summary CSS (commits 699ec4a..0fa7e52, review clean; dist built in this commit)
- [x] Task 3: Build and end-to-end verification (dist built in Task 2 commit; exit-handler fix commit db757f0; final review clean — Minor: empty claudeModel cosmetic only, no fix required; E2E manual)

## Ledger

---

# SDD Progress — Phase A Truth & Safety Baseline (2026-07-22)

Plan: docs/superpowers/plans/2026-07-22-phase-a-truth-safety-baseline.md
Branch: feat/phase-a-truth-safety-baseline → merged to main at ff0fd4a
Start commit: db757f0

## Tasks
- [x] Task 1: Product Manifest + Drift Test (commits 1f82955..33bbdae; 4/4 tests pass)
- [x] Task 2: ReviewResult Type — Return Structured Engine Errors (commits e12f2c9..c4ace8c; 84/84 pass)
- [x] Task 3: Gate & CLI Validate Fail Closed on Engine Errors (commit d25b339; exits 2 on engineErrors)
- [x] Task 4: MCP Compliance Tools — Real Scan (commit ab39f18; NOT_ASSESSED on missing scan)
- [x] Task 5: CI SARIF Required (commit d2f5ec7; sarif-shape.test.ts 6/6)
- [x] Task 6: End-to-End Regression Proofs (commit 1ec26a7; 3368/3368 pass)
- [x] Task 7: Autopilot Recoverable Execution (commits 67df554+f050758; 9 tests)
- [x] Task 8: VS Code Checkpoint Security (commit e00e122; 88/88 tests)
- [x] Task 9: Codex Contract Tests + Safe Defaults (commit 69a0783; 92/92 tests)
- [x] Task 10: Truthful Commands (commits 6b0a834+c36c657; upgrade→not_configured)
- [x] Task 11: BLOCKER detect() Fixture Harness (commit ff0fd4a; 10 fixtures; 20/20 tests)

## Final Review
Whole-branch review (db757f0..ff0fd4a): Ready to merge. 3397/3400 pass (3 pre-existing guard failures).
Merged to main: 2026-07-23.

## Ledger (Phase A)
Task 1: complete (commits 1f82955..33bbdae, review clean)
Task 2: complete (commits e12f2c9..c4ace8c, review clean)
Task 3: complete (commit d25b339, review clean)
Task 4: complete (commit ab39f18, review clean)
Task 5: complete (commit d2f5ec7, review clean)
Task 6: complete (commit 1ec26a7, review clean)
Task 7: complete (commits 67df554..f050758, review clean)
Task 8: complete (commit e00e122, review clean)
Task 9: complete (commit 69a0783, review clean)
Task 10: complete (commits 6b0a834+c36c657, review clean)
Task 11: complete (commit ff0fd4a, review clean)

---

# SDD Progress — Phase 0: Trust Repair (2026-07-23)

Plan: docs/superpowers/plans/2026-07-23-phase-0-trust-repair.md
Branch: feat/phase-0-trust-repair
Start commit: ff0fd4a

## Tasks
- [ ] Task 1: MCP Startup Fix (.mcp.json + mcp.test.ts)
- [ ] Task 2: Evidence-Based Compliance Status (mcp-server.ts staleness guard + compliance.test.ts)
- [ ] Task 3: Remove Permission Bypass (adapters.ts + adapters.test.ts)
- [x] Task 4: Complete Product Manifest (generate-manifest.mjs + product-manifest.json + manifest.test.ts)
- [x] Task 5: Build.ts Truthfulness (agent:run fix + anthropic embedding + skill frontmatter)

## Ledger (Phase 0)
Task 1: complete (commit 1eae80c, review clean — added 'mcp' CLI alias + 4 startup tests, 3401/3404 pass)
Task 2: complete (commit 54b35c2, review clean — staleness guard MAX_SCAN_AGE_MS, COMPLIANT/NON_COMPLIANT status, 6 tests, 3407/3410 pass)
Task 3: complete (commit ec5dc0b, inline review clean — removed --dangerously-skip-permissions, 2 tests, 3409/3412 pass)
Task 4: complete (commit 0ee46be, review clean — countBlockerRules() dynamic + fallback, toolCount:13, pricing.tiers, 7/7 tests, 3412/3415 pass)
Task 5: complete (commit 9433c4e, review clean — agent:run removed, anthropic embedding removed, name: frontmatter added, 3/3 tests, 3415/3418 pass)

## Final Review
Whole-branch review (ff0fd4a..HEAD): One blocker found (criterion 3 — .mcp.json not modified, governance constraint). Fixed in commit bb4fb8a (mcp.test.ts pins args[1]==='mcp' + governance comment). Re-review: blocker cleared. All 9 acceptance criteria met. 3418/3421 pass (3 pre-existing guard.cross-platform failures, unrelated).
