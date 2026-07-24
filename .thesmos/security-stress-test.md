# 👁 ARGUS — Adversarial Security Stress Test of Thesmos

> Red-team audit of Thesmos's own governance/security implementation.
> Auditor: God Agent Argus (Security & Threat Modeling). Date: 2026-07-20.
> Methodology: STRIDE + OWASP + CVSSv3. Every finding below was reproduced in
> isolation against the actual source — not theorized.

---

## Threat model summary

**Attack surface (entry points enumerated):**
1. `thesmos/scope.ts` — path/command allow-block enforcement (PreToolUse hook)
2. `thesmos/claude-govern.ts::runPreToolCheck` — stdin JSON → guard verdict
3. `thesmos/bin/commands/pantheon.ts::installFromPack` — untrusted `.zip` extraction via external `unzip`
4. `thesmos/rules/slopsquatting.ts` — phantom/typosquat import detection
5. `thesmos/rules/registry.ts` + `thesmos/secrets.ts` — BLOCKER content rules (SEC_001 etc.)
6. `thesmos/agent-ownership.ts` — managed-file ownership / manifest integrity
7. `.thesmos/scope.json`, `.thesmos/managed-agents.json` — governance config (agent-writable)

**Threat actor:** a rogue or prompt-injected AI agent running under the Thesmos
PreToolUse/PostToolUse hooks (the exact actor Thesmos claims to govern), plus a
malicious Pantheon-pack author.

**Highest-risk finding:** A governed agent can rewrite `.thesmos/scope.json` — its
own blast-radius limiter — because `.thesmos/` is in `allowedPaths` and the scope
file is not self-protected. One `Write` disables every subsequent scope check.

**STRIDE coverage:**

| Category | Threat surfaced | Worst finding |
|---|---|---|
| **S**poofing | Managed-marker / manifest ownership forgeable | F6 |
| **T**ampering | Agent rewrites its own scope.json; nested `.env` writable | F1, F2 |
| **R**epudiation | No audit log of *blocked* attempts or scope self-edits | F11 (gap) |
| **I**nfo Disclosure | Absolute-path traversal reads `/tmp/../etc/*`; nested `.env` | F2, F3 |
| **D**enial of Service | Destructive-command evasion (`rimraf`, `node -e fs.rmSync`) | F4 |
| **E**levation of Privilege | scope.json self-rewrite → full deny-list bypass | F1 |

---

## Findings (ranked Critical → High → Medium)

### F1 — CRITICAL — Agent can rewrite its own scope config (governance self-disable)
**CVSS 8.8 (High/Critical) · OWASP A01 Broken Access Control · Rule class: AGNT / privilege escalation**

- **Description:** `.thesmos/scope.json` and `.thesmos/managed-agents.json` are the
  governance root of trust. `scope.json` lists `.thesmos/` in `allowedPaths` and does
  **not** list `.thesmos/scope.json` (or `managed-agents.json`) in `blockedPaths`.
- **Impact:** A governed agent issues one `Write` to `.thesmos/scope.json` replacing
  `blockedPaths`/`absoluteBlockPaths`/`destructivePatterns` with `[]`. Every
  subsequent PreToolUse check loads the neutered config and allows everything —
  `.env` reads, `rm -rf`, `git push`, arbitrary paths. Blast radius: total governance
  bypass for the remainder of the session and all future sessions in the repo.
- **Exploit scenario:**
  1. Agent (prompt-injected) writes `.thesmos/scope.json` with empty deny lists — allowed, path is under `.thesmos/`.
  2. `loadScopeConfig` on the next tool call reads the attacker-controlled file (`checkScope` re-loads per call).
  3. All enforcement is now opt-out. The agent exfiltrates `.env`, force-pushes, or deletes files.
- **Remediation:** Treat governance files as immutable from the guard. In
  `isPathAllowed`, hard-block writes to a `GOVERNANCE_PROTECTED` set
  (`.thesmos/scope.json`, `.thesmos/managed-agents.json`, `.thesmos/config.json`,
  `.claude/settings.json`) **before** the allowedPaths check — no config toggle can re-enable them.
  ```ts
  const GOVERNANCE_PROTECTED = new Set([
    '.thesmos/scope.json', '.thesmos/managed-agents.json',
    '.thesmos/config.json', '.claude/settings.json',
  ]);
  if (GOVERNANCE_PROTECTED.has(relNorm)) {
    return { type: 'blocked_path',
      message: `"${filePath}" is a Thesmos governance file — self-modification by a governed agent is blocked.`,
      suggestion: 'Edit governance config manually outside the agent session.' };
  }
  ```
- **Evidence:** `thesmos/scope.ts:226–239` (allowedPaths gate, no governance carve-out);
  `.thesmos/scope.json` (`.thesmos/` in allowedPaths; scope.json absent from blockedPaths);
  `thesmos/scope.ts:323` (`loadScopeConfig` re-read every call — no integrity pin).

---

### F2 — CRITICAL — `absoluteBlockPaths` bypassed by traversal in absolute input
**CVSS 8.6 · OWASP A01 / A05 · Rule class: SEC_009 path traversal (Thesmos's own SEC_009 does not cover itself)**

- **Description:** `isPathAllowed` checks absolute inputs with raw `absPath.startsWith(blocked)`
  and **never normalizes** an absolute input path. `/tmp/../etc/shadow` does not start with
  `/etc/`, passes the absolute-block loop, and resolves on disk to `/etc/shadow`.
- **Impact:** The agent can read/write any file the process user owns by prefixing a
  non-blocked directory then traversing: `/tmp/../etc/...`, `/Users/x/allowed/../../.ssh/id_rsa`.
  Also `/private/etc/passwd`, `/var/root/*`, and `~/.ssh/*` are simply not in the default
  `absoluteBlockPaths` list at all.
- **Exploit scenario (reproduced):** absolute inputs are passed through unresolved —
  ```
  /etc/../etc/passwd     → check string "/etc/../etc/passwd"     (matches /etc/, blocked — but pointless)
  /tmp/../etc/shadow     → check string "/tmp/../etc/shadow"     → ALLOWED, resolves to /etc/shadow
  /Users/MHolley/.ssh/id_rsa → ALLOWED (not in list at all)
  ```
- **Remediation:** Resolve absolute inputs before the block check and compare on the
  resolved real path; also symlink-resolve. In `isPathAllowed`:
  ```ts
  const absPath = resolve(isAbsolute(filePath) ? filePath : join(root, filePath)); // resolve() collapses ../
  ```
  Then compare `absPath` (now canonical) against `absoluteBlockPaths`, and add
  `~/.ssh/`, `/private/etc/`, `/var/root/`, `homedir()` sensitive dirs. Prefer an
  **allowlist-under-root** model: reject any absolute write whose resolved path is not
  under `resolve(root)` unless explicitly opted in.
- **Evidence:** `thesmos/scope.ts:138` (`isAbsolute(filePath) ? filePath : resolve(...)` — no
  `resolve()` on the absolute branch); `thesmos/scope.ts:143–151` (raw `startsWith`);
  reproduced: `/tmp/../etc/shadow` ⇒ ALLOWED.

---

### F3 — HIGH — Nested `.env` / `*.key` files evade `blockedPaths`
**CVSS 7.5 · OWASP A05 Security Misconfiguration · Rule class: SEC_003 secret exposure**

- **Description:** `blockedPaths` patterns are anchored with `^` after converting glob→regex
  (`.env` → `^\.env`). The pattern is tested against `relPath`/`relNorm`, both of which for a
  nested file begin with the directory (`src/.env`). Anchored `^\.env` therefore matches
  **only root-level** `.env`. `src/.env`, `config/.env`, `packages/api/.env.production`,
  and any nested secret file are ALLOWED.
- **Impact:** An agent writes or overwrites secrets in any subdirectory `.env`; the
  file-read side (`Read` is not scoped at all — see F8) means nested secrets are freely
  readable. Also `^\.env` is a prefix match, so `.environment`, `.envrc-notes` match
  (over-block) while the real target is under-blocked.
- **Exploit scenario (reproduced):**
  ```
  .env              → BLOCKED
  .env.production   → BLOCKED  (root)
  src/.env          → ALLOWED  <-- BYPASS
  config/.env.local → ALLOWED  <-- BYPASS
  app.env           → ALLOWED
  ```
- **Remediation:** Use path-segment glob matching (basename-aware), not a single anchored
  prefix regex. Match each blocked glob against **every** path segment and the basename:
  ```ts
  import { minimatch } from 'minimatch'; // or a vetted matcher
  const segments = relNorm.split('/');
  const base = segments.at(-1)!;
  const hit = config.workspace.blockedPaths.some(g =>
    minimatch(relNorm, g, { dot: true }) ||
    minimatch(relNorm, `**/${g}`, { dot: true }) ||
    minimatch(base, g, { dot: true }));
  ```
  Change defaults to `['**/.env', '**/.env.*', '**/*.pem', '**/*.key', ...]`.
- **Evidence:** `thesmos/scope.ts:187–190` (anchored `^${pattern}` prefix match); reproduced above.

---

### F4 — HIGH — Destructive-command allowlist trivially evaded
**CVSS 7.1 · OWASP A04 Insecure Design · Rule class: SEC_016 shell injection / DoS**

- **Description:** `checkCommand` blocks a fixed list of literal substrings (`rm -rf`, `dd if=`)
  plus one `rm` regex. Equivalent destructive commands that don't contain those exact
  tokens pass. There is no coverage for indirect deletion.
- **Impact:** Agent destroys files despite `allowDelete:false`:
  ```
  npx rimraf /data                                   → ALLOWED
  node -e 'require("fs").rmSync("/data",{recursive:true})' → ALLOWED
  perl -e 'unlink glob "/*"'                          → ALLOWED
  find . -delete                                      → ALLOWED
  ```
  (All reproduced.) Blast radius: full data loss under the process user.
- **Exploit scenario:** Agent, blocked from `rm -rf`, emits `node -e '...rmSync...'` — no
  destructive pattern matches, `allowDelete` gate only looks for a leading `rm` token.
- **Remediation:** This is fundamentally a denylist-of-strings, which cannot be made
  complete. Shift to an **allowlist of command binaries** per scope (default-deny for
  Bash), OR at minimum add the high-frequency indirect vectors (`rimraf`, `rm` anywhere in
  a pipe, `find … -delete`, `fs.rm`/`rmSync`/`unlink`, `shutil.rmtree`, `truncate`, `>`
  redirection to tracked files) and require human confirmation for any `node -e`/`python -c`/
  `perl -e`/`eval`-style inline interpreters. Denylist is a stopgap; document residual risk.
- **Evidence:** `thesmos/scope.ts:246–309` (literal `.includes()` + single `rm` regex);
  reproduced evasions above.

---

### F5 — HIGH — SEC_001 (admin-client-in-browser) is a literal substring check
**CVSS 7.4 · OWASP A02 / A05 · Rule: SEC_001 (self-referential — Thesmos's own BLOCKER is weak)**

- **Description:** `hasAdminClientInClientFile` = `isClientComponentFile(content) &&
  content.includes('supabase/admin')`. It matches one import-path substring only.
- **Impact:** The BLOCKER that claims to stop service-role-key leakage to the browser is
  bypassed by any admin client not imported from a path literally containing `supabase/admin`:
  ```
  'use client'; import { supabaseAdmin } from '@/lib/db-admin';                 → NOT flagged
  'use client'; const admin = createClient(url, process.env.SERVICE_ROLE_KEY);  → NOT flagged
  ```
  (Both reproduced false-negative.) A real service-role leak ships to the bundle uncaught.
- **Remediation:** Detect the *capability*, not one path string. Flag a `use client` file that
  references any of: a service-role env token (`SERVICE_ROLE`, `SUPABASE_SERVICE_ROLE_KEY`),
  `createClient(` bound to such a token, `auth.admin.`, or an import whose local name matches
  `/admin|serviceRole/i`. Combine signals; keep BLOCKER only when a service-role sink is present.
- **Evidence:** `thesmos/secrets.ts:90–92`.

---

### F6 — HIGH — Ownership is asserted by an in-repo manifest an agent can write
**CVSS 6.8 · OWASP A01 Broken Access Control · Rule class: AGNT_027 audit-trail integrity**

- **Description:** `managed-agents.json` is the sole ownership authority (`isManagedPath`).
  It lives under `.thesmos/` (agent-writable, see F1). The manifest validates path-key
  *shape* (`isSafeManifestPathKey` — good, rejects traversal/absolute/null-byte) but nothing
  prevents a governed agent from **deleting** a record to claim a managed file, or adding
  records to shadow-claim ownership.
- **Impact:** Agent removes a file's managed record → the managed-path write-block in
  `scope.ts:156–174` no longer fires → agent freely edits a Thesmos-managed agent spec,
  then adapter-sync silently loses/overwrites canonical content. Conversely it can forge
  a `<!-- THESMOS:MANAGED -->` marker (parser trusts marker text) to mislead tooling.
- **Remediation:** (a) Add `.thesmos/managed-agents.json` to `GOVERNANCE_PROTECTED` (F1).
  (b) Store an HMAC/signature over the manifest keyed by a value outside the repo
  (e.g. `~/.thesmos` or CI secret) so in-repo edits are detectable. (c) Treat the marker as a
  hint, never as proof (the code comment already says this — enforce it: cross-check hash).
- **Evidence:** `thesmos/agent-ownership.ts:317–319` (ownership = manifest membership);
  `:136–155` (marker parsed from untrusted content); manifest path under agent-writable `.thesmos/`.

---

### F7 — HIGH — Pack extraction relies on external `unzip` for zip-slip defense (no app-level check)
**CVSS 6.5 (High on vulnerable unzip builds) · OWASP A08 Software/Data Integrity · Rule class: SEC_025 file-upload traversal**

- **Description:** The recent fix `4382943` correctly rejects **symlink** entries
  (`lstatSync(...).isSymbolicLink()`), closing the symlink-read vector. But `installFromPack`
  shells out to `execFileSync('unzip', ['-o','-q', packPath, '-d', tempDir])` and does
  **no post-extraction validation** that extracted files stay within `tempDir`. Zip-slip
  defense is delegated entirely to whatever `unzip` is on PATH.
- **Impact / status:** On this host (Info-ZIP 6.00, macOS) `../` entries are sanitized —
  **not exploitable here** (reproduced: traversal entries landed inside the target). But
  busybox `unzip`, some older/patched Info-ZIP builds, and Windows unzip variants have
  historically honored `../`. On such a host a malicious Pantheon pack writes outside
  `tempDir` (e.g. into `~/.claude/agents/` or `~/.ssh/`). This is a **defense-in-depth gap**,
  not a confirmed exploit on the audited platform.
- **Exploit scenario (host-dependent):** Attacker publishes a pack containing
  `../../../../.claude/agents/thesmos/zeus.md` → on a permissive unzip, overwrites a trusted
  managed agent with an injected system prompt. Prompt-injection persistence.
- **Remediation:** Do not trust the extractor. After extraction, walk the tree and assert
  every real path is under `resolve(tempDir)`; refuse the pack otherwise. Better: replace the
  `unzip` shell-out with an in-process, path-validating extractor (`yauzl`/`adm-zip` with
  per-entry `resolve(dest, entry)` containment check), removing the PATH dependency and the
  `is unzip installed?` failure mode.
  ```ts
  for (const abs of walk(tempDir)) {
    if (!resolve(abs).startsWith(resolve(tempDir) + sep))
      throw new Error(`Pack escaped extraction dir: ${abs}`);
  }
  ```
- **Evidence:** `thesmos/bin/commands/pantheon.ts:641` (external `unzip`, no containment check);
  symlink fix at `:657, :595, :599` (covers symlinks only). Reproduced: unzip-6.00 sanitizes ../.

---

### F8 — MEDIUM — `Read` is never scoped; enforcement is Write/Edit/Bash only
**CVSS 5.9 · OWASP A01 · Rule class: AGNT data-access**

- **Description:** `checkScope` handles `Write`, `Edit`, `Bash`. There is no case for `Read`,
  `Grep`, `Glob`, or MCP file-read tools. `blockedPaths`/`allowedPaths` therefore constrain
  *writing* secrets but not *reading* them.
- **Impact:** An agent reads `.env`, `*.key`, nested secrets, or `/etc/*`-adjacent files and
  exfiltrates them (e.g. into a committed file or a network call) without tripping scope.
  Combined with F3 (nested `.env` unblocked) the read exposure is broad.
- **Remediation:** Extend `checkScope` to a `READ_TOOLS` set (`Read`, `Grep`, `Glob`, and
  MCP fs readers) and run `blockedPaths`/`absoluteBlockPaths` against the read target. Secrets
  should be unreadable, not merely unwritable.
- **Evidence:** `thesmos/scope.ts:321–339` (only Write/Edit/Bash branches);
  `thesmos/claude-govern.ts:588` (`toolName !== 'Write' && 'Edit'` → allow, no Read path).

---

### F9 — MEDIUM — SLOP phantom/typosquat detection: barrel/re-export & unicode gaps
**CVSS 5.3 · OWASP A08 Supply Chain · Rule: SLOP_001/004/009**

- **Description:** Real, well-designed rules — but with evadable edges:
  1. **Re-export / barrel laundering:** SLOP_004 flags a *direct* import of a known phantom.
     Import the phantom in an *unchanged* file (or via a local barrel `export * from './x'`)
     and the changed-file scan never sees the phantom package token. `--base` hunk-scoping
     (commit `295c143`) further narrows what's inspected.
  2. **Typosquat allowlist unicode:** SLOP_009 skips `KNOWN_LEGIT_PACKAGES.has(pkg)` and
     `pkg.startsWith('@')`. A homoglyph name (`redаct` with Cyrillic а) is neither in the
     allowlist nor within ASCII edit-distance ≤2 of the Latin original, so it can slip the
     distance check while visually reading as legitimate. `editDistance` is codepoint-based,
     no NFKC/confusable normalization.
  3. **Scoped typosquats unchecked:** SLOP_009 hard-`continue`s on `@`-scoped names, so
     `@types/no:de` style scope typosquats bypass distance analysis entirely.
- **Impact:** A hallucinated/squatted dependency can be introduced without a BLOCKER firing,
  defeating the flagship "no other tool catches this" claim in specific evasion cases.
- **Remediation:** (a) NFKC-normalize + confusable-map package names before compare
  (`he`-style or `unicode-confusables`), and BLOCKER on any non-ASCII character in a bare
  npm package name. (b) Run SLOP scans over the full dependency-import graph, not only
  changed hunks, for the phantom/typosquat classes. (c) Apply edit-distance to the
  scope-stripped name of `@`-scoped packages too.
- **Evidence:** `thesmos/rules/slopsquatting.ts:791` (`pkg.startsWith('@')` → skip),
  `:796` (allowlist skip), `:197–211` (`editDistance`, no unicode normalization),
  `:536–555` (SLOP_004 scans only `changedFiles`).

---

### F10 — MEDIUM — Guard's own patterns false-positive on security tooling (usability → bypass pressure)
**CVSS 4.3 · OWASP A04 · operational finding**

- **Description:** During this very audit, `checkCommand`'s literal `rm -rf` substring match
  blocked three legitimate actions: writing a JS probe file containing `"rm -rf"` in a string
  literal, and a heredoc/cleanup command. `cmd.includes('rm -rf')` matches inside quotes,
  comments, commit messages, and doc strings.
- **Impact:** High false-positive rate on any command that merely *mentions* a destructive
  pattern (`git commit -m "removes rm -rf usage"`). Chronic false positives train operators to
  set `failClosed:false` or widen `allowedPaths` — degrading the whole control. Security theatre risk.
- **Remediation:** Tokenize the command (respecting quotes) before matching; match on the
  command *word* in argument position, not on raw substring. Ignore matches inside quoted
  strings and after `#`. Report FP rate as a tracked metric.
- **Evidence:** `thesmos/scope.ts:250–256` (`cmd.includes(pattern)` raw substring);
  observed live: guard blocked `Write` of `/tmp/cmd-probe.mjs` and a heredoc during this audit.

---

## Test gap analysis

Confirmed **untested** attack vectors (no coverage in `scope.test.ts`,
`agent-ownership.test.ts`, `agent-federation-stress.test.ts`, `pantheon-pack.test.ts`):

1. **Absolute-path traversal** — `/tmp/../etc/shadow`, `~/.ssh/id_rsa`, `/private/etc/passwd`
   never tested against `absoluteBlockPaths` (F2). `scope.test.ts:92` only tests plain `/etc/`.
2. **Nested `.env` / secret bypass** — no test asserts `src/.env`, `config/.env.local` are
   blocked (F3). Current tests only exercise root-level `.env`.
3. **Governance-file self-modification** — no test asserts a Write to `.thesmos/scope.json`
   or `.thesmos/managed-agents.json` is blocked (F1, F6).
4. **Destructive-command equivalents** — no test for `rimraf`, `node -e fs.rmSync`,
   `perl unlink`, `find -delete` (F4).
5. **SEC_001 aliased/inline service-role** — `secrets.test.ts` tests only `supabase/admin`
   literal; no renamed-module or inline `createClient(service_role)` case (F5).
6. **Read-tool scoping** — no test that reading a blocked path is denied (F8, because it isn't).
7. **Zip-slip containment** — `pantheon-pack.test.ts` covers symlinks (post-fix) but **not**
   `../`-traversal entries with a post-extraction containment assertion (F7).
8. **SLOP unicode/barrel evasion** — no homoglyph package test, no re-export laundering test (F9).
9. **False-positive corpus** — no test asserting `git commit -m "...rm -rf..."` is allowed (F10).

---

## New rules recommended for the Thesmos catalog

Thesmos should govern its *own* class of weaknesses. Proposed additions:

| Proposed ID | Severity | Category | Rationale |
|---|---|---|---|
| **AGNT_038** | BLOCKER | `agent_governance_file_self_write` | A governed agent writing `.thesmos/scope.json` / `managed-agents.json` / `config.json` or `.claude/settings.json` — self-disable of controls (F1, F6). |
| **AGNT_039** | HIGH | `scope_blocklist_prefix_anchored` | Deny-list glob compiled to an anchored `^` prefix regex — nested-path bypass (F3). Lint any glob→regex that anchors without `**/`. |
| **AGNT_040** | HIGH | `abs_block_no_realpath` | Absolute-path deny check that compares before `resolve()`/`realpath` — traversal bypass (F2). |
| **SEC_046** | HIGH | `denylist_command_string_match` | Destructive-command enforcement by raw substring rather than tokenized word match — evasion + FP (F4, F10). |
| **SLOP_016** | BLOCKER | `slop_unicode_confusable_pkg` | npm package name containing non-ASCII / confusable codepoints — homoglyph typosquat (F9). |
| **ARCH_ZIP_001** | HIGH | `archive_extract_no_containment` | Archive extracted (shell `unzip`/tar) without a post-extraction path-containment assertion — zip-slip on permissive extractors (F7). |

---

## Residual risk statement

**After the recommended fixes:**

- **F1/F6 (governance self-write)** — fully closable via a hard-coded `GOVERNANCE_PROTECTED`
  set enforced *before* any config-driven allow logic. Residual: a user who edits governance
  files manually is trusted by design — acceptable.
- **F2/F3 (path bypass)** — closable with `realpath` + segment-glob matching; residual risk is
  the eternal denylist-completeness problem, mitigated by moving to allowlist-under-root.
- **F4/F10 (command denylist)** — **cannot be reduced to zero.** A string/token denylist of
  destructive shell commands is inherently incomplete against `node -e`/`python -c`/inline
  interpreters. Residual risk remains HIGH until Bash moves to a binary allowlist model. This
  is the single most important architectural gap: **document it explicitly; do not claim
  "destructive commands are blocked" — claim "a known set is blocked."**
- **F5 (SEC_001)** — capability-based detection closes the demonstrated bypasses; residual is
  obfuscated dynamic imports (`import(fromVar)`), inherently hard for static analysis.
- **F7 (zip-slip)** — closable and platform-independent once containment is asserted in-process.
  Until then, risk is host-dependent (LOW on Info-ZIP 6.00, HIGH on permissive extractors).
- **F8 (read scoping)** — closable by extending `checkScope` to read tools.
- **F9 (SLOP evasion)** — normalization + full-graph scan closes the confirmed cases; residual
  is novel package-naming attacks not yet in research corpora — accept and revisit quarterly.

**Verdict:** Thesmos's security posture is **genuinely above baseline** — the symlink fix, the
`resolveSafePath`/`isSafeManifestPathKey` traversal guards on the manifest, null-byte rejection,
fail-closed defaults, and the SLOP ruleset are real, well-built controls, and the guard
demonstrably fired on *me* three times during this audit (working dogfood). But it is **not yet
"proven groundbreaking"**: F1 (scope self-rewrite), F2 (absolute traversal), and F4 (command
denylist evasion) are exploitable today by exactly the actor Thesmos exists to govern. The
manifest/traversal hardening in `agent-ownership.ts` was applied thoroughly; the *same rigor
has not reached `scope.ts`*. Fix F1, F2, F3, F5 before any "proven" claim. Reframe F4 honestly.

*Non-negotiable order:* **F1 → F2 → F3 → F5 → F7 → F4/F8/F9/F10.**
F1 and F2 are the ones an attacker starts from.

---
*Reproductions performed against source at commit `4382943` on 2026-07-20. Every "reproduced"
claim was executed in isolation; F7 was confirmed non-exploitable on this host (Info-ZIP 6.00)
and flagged as host-dependent defense-in-depth. No exploit code is included — scenarios are
conceptual per Argus constraints.*

— Argus | Security & Threat Modeling
Thesmos check: SEC_001 ⚠️ (F5 bypass) | SEC_009 ⚠️ (F2 absolute traversal) | SEC_025 ⚠️ (F7 host-dependent) | AGNT_007 ⚠️ (F1 self-write) | SEC_016 ⚠️ (F4 denylist evasion)
