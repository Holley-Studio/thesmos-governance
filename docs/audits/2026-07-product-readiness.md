# Product Readiness Audit — 2026-07

**Repository:** Holley-Studio/thesmos-governance  
**Baseline commit:** `4b8827180d941a4eea23a793da0c684db4b388fb`  
**Audit branch:** `feat/trust-execution-hardening`  
**Audit date:** 2026-07-23  
**Honest readiness score at baseline:** **3 / 10**  
(Not production-ready. Core tests pass, but compliance, CI governance, MCP packaging, and orchestration claims are not evidence-backed.)

### Phase 1 remediation (2026-07-23)

False-assurance blockers for compliance / score / MCP / CI path are fixed on this branch (`feat/trust-execution-hardening`): shared `assurance.ts` (empty/missing evidence → `INCOMPLETE`, never 100), `compliance:report` reads `.thesmos/report.json`, CI uses `dist/cli.js` with SARIF fail-closed policy + `test:coverage`, `mcp --stdio` alias + version/agent counts from `catalog/product-facts.json` (license **FSL-1.1-MIT**, no pricing invented). See `docs/plans/thesmos-production-hardening.md` Phase 1.

---

## Method

1. Checked out baseline commit; created `feat/trust-execution-hardening`.
2. Ran install, typecheck, build, tests, CLI JSON diagnostics, compliance reports, MCP command probes, audit, double-build hashes.
3. Code-inspected CI, compliance, MCP, autopilot, builders against master-prompt suspicions.
4. Classified each finding: **confirmed product defect** | test portability | environment limitation | documentation drift | unverified.

Artifacts under `/tmp/thesmos-p0/` (session-local).

---

## Self-assessment reproduction

| Command | Observed | Exit | Matches prior report? |
|---------|----------|------|------------------------|
| `health --json` | score **69**, grade **C**, 147 drift events | 0 | Yes |
| `score --json` | score **68**, grade **D**; components health 69, **compliance 100**, **coverage 0** | 0 | Yes |
| `ci --json` | **`pass: true`** despite health C / 147 drift (threshold effectively soft) | 0 | Yes |
| `doctor --json` | **`pass: false`** (stale report 11d > 7d) | **0** | Yes — exit contract broken |
| `agents:doctor --strict` | **68** `registry_inconsistency` | **2** | Yes |
| `catalog:validate` | README frontmatter warnings; prints **OK (60 agents, 53 skills)** | **0** | Yes — soft success |
| `context:health --json` | 80/B; context.md **180h** stale | 0 | Yes |

---

## Blocker table (reproduced)

| ID | Finding | Evidence | Severity | Class |
|----|---------|----------|----------|-------|
| **P0-01** | Empty/missing scan yields green compliance | `mcp-server.ts:526-533` `makeEmptyScan()` + `total>0?…:100`; CLI `compliance.ts:167` empty fallback | BLOCKER | confirmed product defect |
| **P0-02** | Zero evaluated rules → 100% | `compliance.ts:412,586`; MCP `:533,:581` | BLOCKER | confirmed product defect |
| **P0-03** | GDPR report “all passed” without real scan walk | `compliance.ts:158-168,233` reads wrong cache → empty → 100% | BLOCKER | confirmed product defect |
| **P0-04** | `compliance:report` reads `.thesmos/scan-cache.json` not `report.json` / `.scan-cache.json` | `compliance.ts:159`; real cache `incremental-cache.ts:44-45` | HIGH | confirmed product defect |
| **P0-05** | Eval with 0 enforced events → complianceScore 100 | `governance-log.ts:203-206` | HIGH | confirmed product defect |
| **P0-06** | CI invokes `dist/bin/cli.js` (does not exist); real entry `dist/cli.js` | `.github/workflows/ci.yml:86`; reproduced `Cannot find module …/dist/bin/cli.js` | BLOCKER | confirmed product defect |
| **P0-07** | Validate failures masked `2>/dev/null \|\| true` | `ci.yml:86` | HIGH | confirmed product defect |
| **P0-08** | SARIF upload `continue-on-error: true`; empty SARIF likely | `ci.yml:88-94` | HIGH | confirmed product defect |
| **P0-09** | Coverage uploaded without `test:coverage`; provider missing | `ci.yml:63-65,96-111`; `vitest --coverage` → `ERR_MODULE_NOT_FOUND @vitest/coverage-v8` | HIGH | confirmed product defect |
| **P0-10** | Docs/package advertise `mcp --stdio`; CLI only has `mcp:serve` | `package.json` mcp.args; `.mcp.json`; `cli.ts` → `unknown command "mcp"` exit 0 | BLOCKER | confirmed product defect + docs drift |
| **P0-11** | MCP SERVER_INFO version `1.0.0` vs package `5.0.0` | `mcp-server.ts:60-63` | MEDIUM | confirmed product defect |
| **P0-12** | Agent counts disagree (40 hardcoded / 43 AGENTS.md / 60 catalog validate / map 59+) | multiple surfaces | MEDIUM | confirmed product defect |
| **P0-13** | `pantheon:orchestrate` writes brief; no real agent execution | `bin/commands/pantheon.ts` orchestrate path | HIGH | confirmed product defect |
| **P0-14** | Autopilot `dependsOn` is prompt text; sequential loop | `autopilot/executor.ts:195-196,272-283` | HIGH | confirmed product defect |
| **P0-15** | Claude adapter defaults `--dangerously-skip-permissions` | `autopilot/adapters.ts:6-11,72-74` | HIGH | confirmed product defect |
| **P0-16** | Builders generate `agent:run` which does not exist | `builder/generators/agent.ts:142-143`; `build.ts:328-329` | HIGH | confirmed product defect |
| **P0-17** | RAG generator: Anthropic embeddings + TODO / not implemented | `builder/generators/rag.ts` | HIGH | confirmed product defect |
| **P0-18** | Compliance report footer claims **v3.6.0** while package is **5.0.0** | SOC2/GDPR report footers | MEDIUM | confirmed product defect |
| **P0-19** | `doctor`/`compliance` misuse can exit 0 on failure/error paths | doctor pass:false exit 0; wrong `--framework` flag still exit 0 | HIGH | confirmed product defect |
| **P0-20** | Production advisory: `brace-expansion` high | `npm audit --omit=dev` | HIGH | confirmed supply-chain |

---

## What is healthy (do not regress)

- Core typecheck + build succeed.
- Core tests: **3305** pass; action **108**; VS Code **64**.
- Double-build SHA-256 for `dist/cli.js`, `dist/index.js`, `dist/thesmos-guard.js` **identical**.
- Clean `git diff` after core rebuild (committed action/extension bundles not rebuilt in this pass).
- Cross-platform guard present (`dist/thesmos-guard.js`); Windows CI job exists.
- `npm pack --dry-run` produces `thesmos-governance-5.0.0.tgz`.

---

## Remediation tracking

| ID | Phase | Status |
|----|-------|--------|
| P0-01–05, P0-18–19 | 1A Assurance | **DONE** (2026-07-23) |
| P0-06–09 | 1B CI | **DONE** (2026-07-23) |
| P0-10–12 | 1C MCP + 1D Facts | **DONE** (2026-07-23) |
| P0-15 | 2 Execution safety | **DONE** (2026-07-23) — default-off; opt-in `autopilot.dangerouslySkipPermissions` |
| P0-13–14 | 3 Pantheon runtime | TODO |
| P0-16–17 | 4 Builders | TODO |
| P0-20 | 6 Release / deps | TODO |

---

## Acceptance vs baseline

At baseline commit, none of the master-prompt acceptance gates 14–27 passed. Phase 1 remediates false-assurance gates for compliance/CI/MCP/facts on this branch; remaining gates (health ≥90/A, Claude execution safety, Pantheon runtime, builders, etc.) remain open.

**Do not claim production-ready, fully compliant, or 10/10.**

---

## Next remediation step

Phase 3: real Pantheon runtime — registry / router / DAG execution (P0-13, P0-14).
