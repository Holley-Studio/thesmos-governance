# Thesmos Production Hardening — Persistent Plan

> Operation: **Trust Execution Hardening**  
> Branch: `feat/trust-execution-hardening`  
> Baseline commit: `4b8827180d941a4eea23a793da0c684db4b388fb`  
> Started: 2026-07-23  
> Power tier: lean · Lead: Chiron (architecture) + Argus (trust) + Kratos (release)

## Constraints (non-negotiable)

- Do **not** push, open PRs, publish, release, change pricing/licensing, force-push, or perform remote writes without explicit user approval.
- Do **not** weaken tests, thresholds, fail-closed behavior, or mask failures (`|| true`, discarded stderr, fake PASS).
- Do **not** add more Pantheon agents until routing/execution/eval work.
- Prefer small reviewable commits after each completed phase checkpoint.

## Phase status

| Phase | Name | Status | Owner |
|-------|------|--------|-------|
| 0 | Reproduce baseline + blocker table | **COMPLETE** | Lead |
| 1 | Eliminate false assurance (compliance / CI / MCP / facts) | **IN PROGRESS** | Trust + Release |
| 2 | Make Claude execution safe | PENDING | Runtime |
| 3 | Real Pantheon runtime (registry / router / DAG) | PENDING | Runtime |
| 4 | Repair builders | PENDING | Lead |
| 5 | Observability + evaluations | PENDING | Runtime |
| 6 | Release engineering | PENDING | Release |

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-23 | Branch name `feat/trust-execution-hardening` (user-specified) | Overrides cloud `cursor/*-5394` template for this assignment |
| 2026-07-23 | No push / no PR until user approves | Explicit in master prompt |
| 2026-07-23 | Phase 1 before any runtime work | Release-blocking false assurance first |
| 2026-07-23 | Sequential execution (no parallel worktrees this session) | Single agent; avoid lockfile/manifest conflicts |

## Phase 0 evidence summary

See `docs/audits/2026-07-product-readiness.md` for full blocker table.

Reproduced at baseline `4b88271`:

| Signal | Result | Classification |
|--------|--------|----------------|
| `health --json` | 69 / C · 147 drift | confirmed product defect (low health) |
| `score --json` | 68 / D · compliance **100** · coverage **0** | confirmed false assurance |
| `ci --json` | `pass: true` at threshold 60 | confirmed weak gate |
| `doctor --json` | `pass: false` · **exit 0** | confirmed product defect |
| `agents:doctor --strict` | **68** registry inconsistencies · exit 2 | confirmed product defect |
| `catalog:validate` | frontmatter warnings · **exit 0** · “OK (60 agents…)” | confirmed product defect |
| `context:health` | 80/B · stale context 180h | confirmed drift |
| Core tests | 3305 passed | OK |
| Action / VS Code tests | 108 / 64 passed | OK |
| `test:coverage` | **fails** — missing `@vitest/coverage-v8` | confirmed product defect |
| Double build hashes | match (cli/index/guard) | OK for core dist |
| `git diff` after build | clean | OK (committed action/ext bundles not rebuilt) |
| `npm audit --omit=dev` | 1 high (`brace-expansion`) | confirmed supply-chain |
| CI `dist/bin/cli.js` | **missing** — actual is `dist/cli.js` | confirmed BLOCKER |
| MCP `mcp --stdio` | unknown command · docs/package advertise it | confirmed BLOCKER |
| Compliance SOC2/GDPR | 100% with empty/wrong cache | confirmed BLOCKER |

## Phase 1 workstreams (current)

### 1A — Assurance model (Trust)

- [ ] Add `thesmos/assurance.ts` shared result model (`PASS|FAIL|INCOMPLETE|ERROR`)
- [ ] Wire CLI `compliance:report` to load `.thesmos/report.json` (not wrong `scan-cache.json`)
- [ ] Remove empty-scan → 100% paths in CLI + MCP + eval
- [ ] Zero evaluated rules → `INCOMPLETE`, never PASS/100
- [ ] Strict/CI exit nonzero for FAIL/INCOMPLETE/ERROR
- [ ] Tests: missing/empty/pass/fail/partial/stale/malformed/zero-rules/parity

### 1B — CI enforcement (Release)

- [ ] Fix CLI path to `dist/cli.js`
- [ ] Remove `|| true` and stderr discard on validate
- [ ] Emit/validate SARIF; fail policy after upload attempt
- [ ] Run `test:coverage` + enforce thresholds; add `@vitest/coverage-v8`
- [ ] Fail when structured `pass: false`
- [ ] Add strict doctor / registry / catalog / facts gates (named, honest)

### 1C — MCP (Trust)

- [ ] Ship documented command (`mcp --stdio` alias → `mcp:serve`)
- [ ] Version from package.json
- [ ] Agents from registry; scoped counts
- [ ] No stdout logging in stdio mode
- [ ] Handshake / tools/list / call / error tests (+ packed smoke)

### 1D — ProductFacts (Lead)

- [ ] Generated versioned facts artifact
- [ ] Consumers: CLI help, MCP, score, docs generators
- [ ] CI freshness check
- [ ] **STOP** if pricing/licensing conflict needs product decision

## Files changed (cumulative)

| Phase | Files |
|-------|-------|
| 0 | `docs/plans/thesmos-production-hardening.md`, `docs/audits/2026-07-product-readiness.md` |

## Commands executed (Phase 0)

```text
npm ci                                          → 0 (5 vulns: 1 low, 4 high full; 1 high prod)
npm run typecheck --workspace=thesmos           → 0
npm run build --workspace=thesmos               → 0
npm test --workspace=thesmos                    → 0 (3305)
npm run test:coverage --workspace=thesmos       → FAIL (@vitest/coverage-v8 missing)
npm run typecheck --workspace=actions/pr-review → 0
npm run typecheck --workspace=extensions/vscode → 0
npm test --workspace=actions/pr-review          → 0 (108)
npm test --workspace=extensions/vscode          → 0 (64)
node dist/cli.js health|score|ci|doctor|…       → see audit
npm pack --dry-run                              → 0
double build sha256                             → match
git diff --exit-code after build                → 0
```

## Known blockers requiring user decision

None yet for Phase 1 code. Pricing/licensing canonical source TBD when ProductFacts hits contradictions.

## Remaining work

Phases 1–6 per master prompt. Next exact action: implement `assurance.ts` + compliance CLI/MCP wiring + failing tests that prove empty evidence ≠ PASS.

## Next exact action

Implement Phase 1A shared assurance model and fix compliance false-green paths; update this plan after the first green assurance test suite.
