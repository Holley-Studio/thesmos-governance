# Free Tool, Paid Pantheon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every governance rule free, make the 67-god Pantheon the paid product at $24 one-time via a physical content gate (premium agents absent from the free npm/extension distribution), and add a frictionless `pantheon:install --pack` path for buyers.

**Architecture:** The published npm tarball already excludes all Pantheon catalog agents (discovered during planning — the `files` field never included `catalog/agents/pantheon/`), so free users currently get ZERO gods and the extension's install button is broken for marketplace users. This plan (1) de-gates the rule engine, (2) ships exactly the 6 free starter gods in the tarball with a guard test, (3) adds upsell messaging with computed counts, (4) adds `--pack` install from the purchased Gumroad zip reusing the existing `agent-lifecycle` machinery, (5) adds extension CTA + pack installer, (6) flips all $79 copy to $24.

**Tech Stack:** TypeScript (Node 20, ESM, tsx dev / tsup build), vitest, VS Code extension API, esbuild.

**Spec:** `docs/superpowers/specs/2026-07-14-free-tool-paid-pantheon-design.md`

## Global Constraints

- Price everywhere: **$24 one-time** (was $79). Purchase URL: `https://holleystudio.gumroad.com/l/thesmos-pantheon`
- Free agents (canonical 6, files all in `thesmos/catalog/agents/pantheon/`): `zeus-executive-agent`, `athena-strategy-agent`, `argus-security-agent`, `apollo-content-agent`, `hephaestus-design-agent`, `hebe-support-agent`
- Marketing total: **67 gods** (68 loadable in dev incl. held-back Asclepius; user-facing counts computed from `pantheonTotal`, never hardcoded in message strings)
- CLI version after this work: **5.0.0** (changeset `major`)
- All work happens on branch `feat/agent-install-workflow` in `/Users/MHolley/Desktop/thesmos-governance`
- Run tests from `thesmos/` with `npx vitest run <file>`; full suite must stay green (3,208+ tests)
- Commit messages: Conventional Commits, `Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>` footer
- The governance PreToolUse hook may block edits mentioning secrets/patterns — if a legitimate edit is blocked, fix the trigger, don't bypass

---

### Task 1: De-gate the rule engine — all rules free for everyone

**Files:**
- Modify: `thesmos/rules/registry.ts:704-712`
- Modify: `thesmos/tiers.ts:1-18` (doc comment only)
- Modify: `thesmos/tiers.test.ts:44-49`
- Test: `thesmos/tiers.test.ts`

**Interfaces:**
- Consumes: existing `THESMOS_RULES`, `ESSENTIAL_RULES` exports (unchanged)
- Produces: `activeRulesForTier(config)` now returns ALL rules regardless of tier. Consumers `thesmos/review.ts:52` and `thesmos/claude-govern.ts:380` need no changes — they inherit the de-gate.

- [ ] **Step 1: Update the test to expect the de-gated behavior**

In `thesmos/tiers.test.ts`, replace the `activeRulesForTier` describe block (lines 44-49) with:

```typescript
describe('activeRulesForTier', () => {
  it('returns the full engine for every tier — rules are never paywalled', () => {
    expect(activeRulesForTier({ tier: 'free' }).length).toBe(THESMOS_RULES.length);
    expect(activeRulesForTier({ tier: 'premium' }).length).toBe(THESMOS_RULES.length);
    expect(activeRulesForTier({}).length).toBe(THESMOS_RULES.length);
  });
});
```

Leave the `ESSENTIAL_RULES.length` assertion at line 40 untouched (the export remains for back-compat).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run tiers.test.ts`
Expected: FAIL — `activeRulesForTier({ tier: 'free' }).length` is 288, expected 1137.

- [ ] **Step 3: De-gate `activeRulesForTier`**

In `thesmos/rules/registry.ts`, replace lines 704-712 (the comment + function) with:

```typescript
/**
 * The rules that run for a given resolved tier. Since 5.0.0 this ALWAYS
 * returns the full engine: rules are never paywalled — a security tool that
 * withholds safety rules for money is not honest, and the source is public
 * anyway. The paid product is the Pantheon agent pack (content, not code).
 * The signature keeps the config parameter for API compatibility.
 */
export function activeRulesForTier(_config: { tier?: 'free' | 'premium' }): ThesmosRule[] {
  return THESMOS_RULES;
}
```

- [ ] **Step 4: Update the `tiers.ts` header comment**

In `thesmos/tiers.ts`, replace the file doc comment (lines 2-18) with:

```typescript
/**
 * Rule tiering — legacy free/paid metadata, kept for back-compat.
 *
 * Since 5.0.0 the rule engine is 100% free: activeRulesForTier() in
 * rules/registry.ts returns every rule for every tier. The paid product is
 * the Pantheon agent pack ($24 one-time, content-gated: premium agents are
 * simply absent from the free npm distribution).
 *
 * ESSENTIAL_RULES / isEssentialRule / partitionByTier remain exported because
 * downstream tooling and the tier CLI report on the historical boundary, and
 * premiumPackPaths/hasPremiumPack still detect a purchased pack marker
 * (used to hide upsell messaging for buyers).
 */
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run tiers.test.ts`
Expected: PASS (all tests in file).

- [ ] **Step 6: Run the full suite to catch any other test asserting the old gate**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run`
Expected: PASS. If any test fails asserting 288 active rules for free tier, update that assertion to `THESMOS_RULES.length` with the same rationale as Step 1.

- [ ] **Step 7: Commit**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add thesmos/rules/registry.ts thesmos/tiers.ts thesmos/tiers.test.ts
git commit -m "feat(tiers)!: de-gate the rule engine — every rule free for every tier

BREAKING CHANGE: activeRulesForTier() now returns the full engine
regardless of tier. The paid product is the Pantheon agent pack, not rules.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Canonical `free-agents.json` — single source of truth for the free/paid boundary

**Files:**
- Create: `thesmos/catalog/free-agents.json`
- Modify: `thesmos/scripts/package-agents.ts:44-56` (replace `FREE_AGENT_IDS` literal with a read of the JSON)
- Create: `thesmos/catalog/free-agents.test.ts`

**Interfaces:**
- Produces: `thesmos/catalog/free-agents.json` with shape:
  ```json
  { "freeAgentIds": string[], "pantheonTotal": number, "storeUrl": string, "priceUsd": number }
  ```
  Consumed by Task 3 (files field guard test), Task 4 (upsell message), Task 5 (--pack marker), and `package-agents.ts`.

- [ ] **Step 1: Write the failing test**

Create `thesmos/catalog/free-agents.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, 'free-agents.json'), 'utf8'),
) as { freeAgentIds: string[]; pantheonTotal: number; storeUrl: string; priceUsd: number };

describe('free-agents.json', () => {
  it('declares the 6 canonical free gods', () => {
    expect(manifest.freeAgentIds).toEqual([
      'zeus-executive-agent',
      'athena-strategy-agent',
      'argus-security-agent',
      'apollo-content-agent',
      'hephaestus-design-agent',
      'hebe-support-agent',
    ]);
  });

  it('every free agent ID has a real catalog file', () => {
    for (const id of manifest.freeAgentIds) {
      const path = join(__dirname, 'agents', 'pantheon', `${id}.md`);
      expect(existsSync(path), `missing catalog file for free agent: ${id}`).toBe(true);
    }
  });

  it('carries the pricing facts the CLI and store surfaces read', () => {
    expect(manifest.pantheonTotal).toBe(67);
    expect(manifest.priceUsd).toBe(24);
    expect(manifest.storeUrl).toBe('https://holleystudio.gumroad.com/l/thesmos-pantheon');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run catalog/free-agents.test.ts`
Expected: FAIL — `free-agents.json` does not exist (ENOENT).

- [ ] **Step 3: Create the manifest**

Create `thesmos/catalog/free-agents.json`:

```json
{
  "$comment": "Single source of truth for the free/paid Pantheon boundary. freeAgentIds ship in the npm tarball (see package.json files + pack-gate.test.ts); everything else is content-gated behind the paid pack. pantheonTotal is the marketed god count used in upsell copy.",
  "freeAgentIds": [
    "zeus-executive-agent",
    "athena-strategy-agent",
    "argus-security-agent",
    "apollo-content-agent",
    "hephaestus-design-agent",
    "hebe-support-agent"
  ],
  "pantheonTotal": 67,
  "storeUrl": "https://holleystudio.gumroad.com/l/thesmos-pantheon",
  "priceUsd": 24
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run catalog/free-agents.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Point `package-agents.ts` at the manifest**

In `thesmos/scripts/package-agents.ts`, replace the `FREE_AGENT_IDS` literal (lines 44-56, the `new Set([...])` block) with:

```typescript
// Canonical free/paid boundary — single source of truth shared with the CLI
// (catalog/free-agents.json ships in the npm tarball; see pack-gate.test.ts).
// Zeus orchestrator variants and marketing meta-agents are pack-build-only
// additions on top of the canonical 6.
const freeAgentsManifest = JSON.parse(
  readFileSync(resolve(__dirname, '../catalog/free-agents.json'), 'utf-8'),
) as { freeAgentIds: string[] }
const FREE_AGENT_IDS = new Set([
  ...freeAgentsManifest.freeAgentIds,
  // Zeus orchestrators are the front door to the Pantheon — always free
  'zeus-pantheon-orchestrator',
  'zeus-receptionist',
  'zeus-figma-card',
])
```

(`readFileSync` and `resolve` are already imported in this file — verify at the top before adding duplicate imports.)

- [ ] **Step 6: Verify the packaging script still builds**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx tsx scripts/package-agents.ts --help 2>&1 | head -5 || npx tsx -e "import('./scripts/package-agents.ts')" 2>&1 | head -5`
Expected: the script loads without a module/parse error (it may complain about missing export dirs — that's fine; we only care that the manifest wiring parses and resolves).

- [ ] **Step 7: Commit**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add thesmos/catalog/free-agents.json thesmos/catalog/free-agents.test.ts thesmos/scripts/package-agents.ts
git commit -m "feat(catalog): free-agents.json — canonical free/paid Pantheon boundary

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Ship the 6 free gods in the npm tarball + pack-gate guard test

**Files:**
- Modify: `thesmos/package.json` (`files` array)
- Create: `thesmos/pack-gate.test.ts`

**Interfaces:**
- Consumes: `catalog/free-agents.json` (Task 2)
- Produces: published tarball contains exactly the 6 free god .md files (plus their `-README.md` companions), `catalog/pantheon-map.json`, and `catalog/free-agents.json`; zero premium agent files. `pantheon:install --all` on a real npm install now installs exactly the free gods.

- [ ] **Step 1: Write the failing pack-gate test**

Create `thesmos/pack-gate.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const manifest = JSON.parse(
  readFileSync(join(__dirname, 'catalog', 'free-agents.json'), 'utf8'),
) as { freeAgentIds: string[] };

// `npm pack --dry-run --json` lists exactly what would be published.
let packedFiles: string[] = [];

beforeAll(() => {
  const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: __dirname,
    encoding: 'utf8',
    // prepublishOnly does NOT run for pack --dry-run; this is metadata only.
  });
  const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
  packedFiles = parsed[0]!.files.map((f) => f.path);
}, 60_000);

describe('npm tarball content gate', () => {
  it('ships every free god (the free tier must actually work)', () => {
    for (const id of manifest.freeAgentIds) {
      expect(packedFiles).toContain(`catalog/agents/pantheon/${id}.md`);
    }
  });

  it('ships the manifests the CLI needs for counts and upsell', () => {
    expect(packedFiles).toContain('catalog/free-agents.json');
    expect(packedFiles).toContain('catalog/pantheon-map.json');
  });

  it('ships ZERO premium agents — the content gate is physical', () => {
    const freeSet = new Set(manifest.freeAgentIds.flatMap((id) => [
      `catalog/agents/pantheon/${id}.md`,
      `catalog/agents/pantheon/${id}-README.md`,
    ]));
    const leaked = packedFiles.filter(
      (p) =>
        (p.startsWith('catalog/agents/pantheon/') ||
         p.startsWith('catalog/agents/figma/') ||
         /^catalog\/agents\/[^/]+\.md$/.test(p)) &&
        !freeSet.has(p),
    );
    expect(leaked, `premium agents leaked into the tarball: ${leaked.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run pack-gate.test.ts`
Expected: FAIL — the "ships every free god" and "ships the manifests" tests fail (files not in the current `files` allowlist). The "zero premium" test passes already.

- [ ] **Step 3: Add the free files to `package.json` `files`**

In `thesmos/package.json`, replace the `files` array with:

```json
"files": [
  "dist/",
  "catalog/agents/reviewers/",
  "catalog/agents/pantheon/zeus-executive-agent.md",
  "catalog/agents/pantheon/zeus-executive-agent-README.md",
  "catalog/agents/pantheon/athena-strategy-agent.md",
  "catalog/agents/pantheon/athena-strategy-agent-README.md",
  "catalog/agents/pantheon/argus-security-agent.md",
  "catalog/agents/pantheon/argus-security-agent-README.md",
  "catalog/agents/pantheon/apollo-content-agent.md",
  "catalog/agents/pantheon/apollo-content-agent-README.md",
  "catalog/agents/pantheon/hebe-support-agent.md",
  "catalog/agents/pantheon/hebe-support-agent-README.md",
  "catalog/agents/pantheon/hephaestus-design-agent.md",
  "catalog/agents/pantheon/hephaestus-design-agent-README.md",
  "catalog/profiles/",
  "catalog/skills/",
  "catalog/free-agents.json",
  "catalog/pantheon-map.json",
  "presets/",
  "README.md",
  "CHANGELOG.md",
  "config.schema.json",
  "LICENSE-COMMERCIAL.md"
]
```

Note: npm silently skips listed files that don't exist — if a `-README.md` companion is missing for some god, the test in Step 1 only requires the agent `.md` itself, so this is safe.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run pack-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add thesmos/package.json thesmos/pack-gate.test.ts
git commit -m "feat(pack): ship the 6 free gods in the npm tarball, guard the content gate

The published package previously shipped ZERO pantheon agents (free tier
was broken for real npm users) and the gate had no regression guard.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 4: Upsell messaging + computed counts in the pantheon CLI

**Files:**
- Modify: `thesmos/bin/commands/pantheon.ts` (top-of-file constants ~line 31, `cmdList` ~line 365, `cmdInstall` end of `--write` branch ~line 436)

**Interfaces:**
- Consumes: `catalog/free-agents.json` (Task 2), resolved via the existing `AGENTS_DIR` candidates pattern
- Produces: `loadFreeAgentsManifest(): { freeAgentIds: string[]; pantheonTotal: number; storeUrl: string; priceUsd: number } | null` (module-local helper, also used by Task 5)

- [ ] **Step 1: Add the manifest loader**

In `thesmos/bin/commands/pantheon.ts`, after the `MEMORY_DIR_REL` constant (line 31), add:

```typescript
// Pricing/boundary facts for upsell copy — shipped in the tarball next to the
// catalog. Null (silently, no upsell shown) if the file is missing (dev trees
// that predate it, or exotic installs).
interface FreeAgentsManifest {
  freeAgentIds: string[];
  pantheonTotal: number;
  storeUrl: string;
  priceUsd: number;
}

function loadFreeAgentsManifest(): FreeAgentsManifest | null {
  const candidates = [
    join(__dirname, '../../catalog/free-agents.json'), // dev: bin/commands/ → thesmos/
    join(__dirname, '../catalog/free-agents.json'),    // bundle: dist/ → thesmos/
  ];
  const path = candidates.find(p => existsSync(p));
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as FreeAgentsManifest;
  } catch {
    return null;
  }
}

// One-line upsell shown when the install is running on the free distribution.
// Returns null when the full pantheon is present (or facts are unavailable).
function upsellLine(installedGodCount: number): string | null {
  const m = loadFreeAgentsManifest();
  if (!m || installedGodCount > m.freeAgentIds.length) return null;
  return `  ${installedGodCount} of ${m.pantheonTotal} gods installed. The full Pantheon — ` +
    `${m.pantheonTotal} specialists orchestrated by Zeus — is $${m.priceUsd} (one-time):\n` +
    `  ${m.storeUrl}\n`;
}
```

- [ ] **Step 2: Compute the `cmdList` header count**

In `cmdList` (line ~365), replace:

```typescript
  console.log('\n  THE THESMOS PANTHEON — 40 Governed AI Business Agents\n');
```

with:

```typescript
  console.log(`\n  THE THESMOS PANTHEON — ${agents.length} Governed AI Business Agents\n`);
```

(`agents` is already the first parameter of `cmdList` — mirror how `cmdStatus` uses it.)

- [ ] **Step 3: Add the upsell to `cmdList` and `cmdInstall`**

In `cmdList`, immediately before the final `console.log()` of the function (after the "Install all:" / "Export:" footer lines), add:

```typescript
  const upsell = upsellLine(agents.length);
  if (upsell) console.log(upsell);
```

In `cmdInstall`, inside the `if (write)` branch, after the adapter-sync `try/catch` block (after line ~435, before the `if (errors.length > 0 && written + skipped === 0) process.exit(1);` line), add:

```typescript
    const upsell = upsellLine(agents.length);
    if (upsell) console.log(upsell);
```

- [ ] **Step 4: Verify by running the CLI in dev (dev tree has all 68 agents → NO upsell)**

Run: `cd /Users/MHolley/Desktop/thesmos-governance && npx tsx thesmos/bin/cli.ts pantheon:list 2>/dev/null | tail -6`
Expected: footer shows `Total: 68 agents` and NO upsell block (dev has the full catalog, 68 > 6).

- [ ] **Step 5: Verify the upsell fires on a simulated free install**

Run:

```bash
cd /tmp && rm -rf thesmos-free-sim && mkdir thesmos-free-sim && cd thesmos-free-sim
# Simulate the published layout: dist bundle + only free catalog files
npm pack /Users/MHolley/Desktop/thesmos-governance/thesmos --silent
tar xzf thesmos-governance-*.tgz && cd package
node dist/cli.js pantheon:list 2>/dev/null | tail -8
```

Expected: `THE THESMOS PANTHEON — 6 Governed AI Business Agents` header, and the upsell block `6 of 67 gods installed… $24 (one-time)` in the footer.
(If `dist/` is stale, run `npm run build` in `thesmos/` first.)

- [ ] **Step 6: Run the full suite**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add thesmos/bin/commands/pantheon.ts
git commit -m "feat(pantheon): computed agent counts + \$24 upsell on free installs

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 5: `pantheon:install --pack <zip|dir>` — install the purchased pack

**Files:**
- Modify: `thesmos/bin/commands/pantheon.ts` (`cmdInstall` line ~378, new `installFromPack` function)
- Create: `thesmos/bin/commands/pantheon-pack.test.ts`

**Interfaces:**
- Consumes: `installAgent(input: AgentLifecycleInput): AgentLifecycleResult` and `syncAdapters(root: string)` from `thesmos/agent-lifecycle.ts` (`AgentLifecycleInput = { content, sourcePath, targetId?, force?, dryRun?, noSync?, root }`); `isIgnoredAgentFile(filename: string): boolean` from the same module; `loadFreeAgentsManifest()` from Task 4.
- Produces: `export function installFromPack(packPath: string, root: string): { installed: number; skipped: number; errors: string[] }` (exported for tests). Buyer UX: `thesmos pantheon:install --pack ~/Downloads/thesmos-pantheon-agents.zip`.

**Pack layout fact (from `scripts/package-agents.ts`):** the paid zip contains platform dirs — agent .md files live in `for-claude/` (1:1 with the catalog, Claude Code frontmatter: `name:` + `description:`), plus non-agent files (`INSTALL.md`, `PANTHEON.md`, `AGENTS.md`, `hooks/` subdir) and a `premium/pack.json` marker. The installer must scan non-recursively and skip anything that isn't a valid agent file.

- [ ] **Step 1: Write the failing tests**

Create `thesmos/bin/commands/pantheon-pack.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installFromPack } from './pantheon.ts';

const AGENT = (id: string) => `---
name: ${id}
description: Test agent ${id} for pack install
---

# ${id}

Test body.
`;

let root: string;
let pack: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-pack-root-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
  writeFileSync(join(root, '.thesmos', 'config.json'), '{"project":"t"}');
  pack = mkdtempSync(join(tmpdir(), 'thesmos-pack-src-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(pack, { recursive: true, force: true });
});

describe('installFromPack', () => {
  it('installs every agent from a for-claude/ pack directory', () => {
    const dir = join(pack, 'for-claude');
    mkdirSync(dir);
    writeFileSync(join(dir, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    writeFileSync(join(dir, 'tyche-analytics-agent.md'), AGENT('tyche-analytics-agent'));
    // Non-agent files that must be skipped, not errored on:
    writeFileSync(join(dir, 'INSTALL.md'), '# How to install\nNo frontmatter here.');
    writeFileSync(join(dir, 'PANTHEON.md'), '# Routing map\nNo frontmatter here.');
    mkdirSync(join(dir, 'hooks'));

    const result = installFromPack(pack, root);

    expect(result.errors).toEqual([]);
    expect(result.installed).toBe(2);
    expect(existsSync(join(root, '.thesmos', 'agents', 'ares-sales-agent.md'))).toBe(true);
    expect(existsSync(join(root, '.thesmos', 'agents', 'tyche-analytics-agent.md'))).toBe(true);
  });

  it('accepts a bare directory of agent files (no for-claude wrapper)', () => {
    writeFileSync(join(pack, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    const result = installFromPack(pack, root);
    expect(result.installed).toBe(1);
  });

  it('is idempotent — re-running updates in place without errors', () => {
    writeFileSync(join(pack, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    const first = installFromPack(pack, root);
    const second = installFromPack(pack, root);
    expect(first.installed).toBe(1);
    expect(second.errors).toEqual([]);
    expect(second.installed + second.skipped).toBe(1);
  });

  it('throws an actionable error for a missing path', () => {
    expect(() => installFromPack(join(pack, 'nope'), root)).toThrow(/not found/i);
  });

  it('throws an actionable error when the pack contains no agents', () => {
    writeFileSync(join(pack, 'notes.txt'), 'hi');
    expect(() => installFromPack(pack, root)).toThrow(/no agent/i);
  });

  it('registers installed agents in registry.json', () => {
    writeFileSync(join(pack, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    installFromPack(pack, root);
    const reg = JSON.parse(readFileSync(join(root, '.thesmos', 'registry.json'), 'utf8')) as { agents?: string[] };
    expect(reg.agents).toContain('ares-sales-agent');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run bin/commands/pantheon-pack.test.ts`
Expected: FAIL — `installFromPack` is not exported from `./pantheon.ts`.

- [ ] **Step 3: Implement `installFromPack` + wire the `--pack` flag**

In `thesmos/bin/commands/pantheon.ts`:

(a) Extend the fs import (line 12) with `rmSync`, `mkdtempSync`, `statSync`, and add `import { tmpdir, homedir } from 'node:os';` and `import { execFileSync } from 'node:child_process';` and extend the agent-lifecycle import (line 20) to `import { addAgentToRegistry, syncAdapters, installAgent, isIgnoredAgentFile } from '../../agent-lifecycle.ts';`

(b) Add above `cmdInstall`:

```typescript
// ── pantheon:install --pack ───────────────────────────────────────────────────

/** True when a file parses as a Claude Code agent (frontmatter with name+description). */
function isAgentFileContent(content: string): boolean {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!fm) return false;
  return /^name:\s*\S/m.test(fm[1]!) && /^description:\s*\S/m.test(fm[1]!);
}

/** Resolve the agents directory inside an extracted pack (for-claude/ preferred). */
function resolvePackAgentsDir(packDir: string): string {
  const direct = join(packDir, 'for-claude');
  if (existsSync(direct)) return direct;
  // Zips often extract into a single top-level folder — look one level down.
  for (const entry of readdirSync(packDir)) {
    const nested = join(packDir, entry, 'for-claude');
    if (existsSync(nested)) return nested;
  }
  return packDir;
}

/**
 * Install every agent found in a purchased Pantheon pack (extracted directory
 * or .zip). Exported for tests. Throws on missing path / empty pack; individual
 * agent failures are collected, not fatal.
 */
export function installFromPack(packPath: string, root: string): { installed: number; skipped: number; errors: string[] } {
  if (!existsSync(packPath)) {
    throw new Error(`Pack not found: ${packPath}\nDownload it from your Gumroad library, then re-run with the correct path.`);
  }

  let packDir = packPath;
  let tempDir: string | null = null;

  if (statSync(packPath).isFile() && packPath.endsWith('.zip')) {
    tempDir = mkdtempSync(join(tmpdir(), 'thesmos-pack-'));
    try {
      execFileSync('unzip', ['-o', '-q', packPath, '-d', tempDir]);
    } catch {
      rmSync(tempDir, { recursive: true, force: true });
      throw new Error(
        `Could not extract ${packPath} automatically (is \`unzip\` installed?).\n` +
        `Extract it manually, then run: thesmos pantheon:install --pack <extracted-folder>`,
      );
    }
    packDir = tempDir;
  }

  try {
    const agentsDir = resolvePackAgentsDir(packDir);
    const candidates = readdirSync(agentsDir)
      .filter(f => f.endsWith('.md') && !isIgnoredAgentFile(f))
      .map(f => ({ file: f, content: readFileSync(join(agentsDir, f), 'utf8') }))
      .filter(({ content }) => isAgentFileContent(content));

    if (candidates.length === 0) {
      throw new Error(
        `No agent files found in ${agentsDir}.\n` +
        `Expected the Gumroad pack layout (a for-claude/ folder of agent .md files).`,
      );
    }

    let installed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const { file, content } of candidates) {
      try {
        const result = installAgent({
          content,
          sourcePath: join(agentsDir, file),
          force: true,   // pack installs update in place — Gumroad re-downloads ARE the update channel
          noSync: true,  // one adapter sync at the end, not per agent
          root,
        });
        if (result.registryResult === 'added') installed++;
        else skipped++;
      } catch (err) {
        errors.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (installed + skipped > 0) {
      syncAdapters(root);
      // Back-compat purchase marker (hides upsell, honors legacy tier checks).
      const markerDir = join(homedir(), '.thesmos', 'premium');
      mkdirSync(markerDir, { recursive: true });
      writeFileSync(
        join(markerDir, 'pack.json'),
        JSON.stringify({ product: 'thesmos-pantheon', installedAt: new Date().toISOString(), source: 'pantheon:install --pack' }, null, 2),
      );
    }

    return { installed, skipped, errors };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
```

(Field name verified against `thesmos/agent-lifecycle.ts:50-56`: `AgentLifecycleResult.registryResult` is `'added' | 'already-present' | 'dry-run'`.)

(c) At the top of `cmdInstall` (after `const write = flag(flags, 'write');`, line ~381), add:

```typescript
  const packPath = flags['pack'] as string | undefined;
  if (packPath) {
    try {
      const { installed, skipped, errors } = installFromPack(packPath, root);
      if (errors.length > 0) {
        console.error(`\n  ✗ ${errors.length} agent(s) failed:\n`);
        for (const e of errors) console.error(`    ${e}`);
      }
      console.log(`\n  ⚡ Full Pantheon installed: ${installed} new, ${skipped} updated.`);
      console.log('  Adapters regenerated. The gods are at your service.\n');
      if (errors.length > 0 && installed + skipped === 0) process.exit(1);
    } catch (err) {
      console.error(`\n  ✗ ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
    return;
  }
```

Also update the usage message at line ~385-386 to include the new flag:

```typescript
    console.error('  Usage: thesmos pantheon:install [agent-id...] [--all] [--write] [--pack <zip|dir>]');
    console.error('  --write  also write agent files to .thesmos/agents/ and regenerate adapters');
    console.error('  --pack   install the purchased Full Pantheon pack (Gumroad zip or extracted folder)');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run bin/commands/pantheon-pack.test.ts`
Expected: PASS (6 tests). Note: tests write `~/.thesmos/premium/pack.json` as a side effect — acceptable on a dev machine (it's the developer's own purchase marker), but if it bothers you, gate the marker write behind `process.env['VITEST'] === undefined`.

- [ ] **Step 5: Run the full suite**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add thesmos/bin/commands/pantheon.ts thesmos/bin/commands/pantheon-pack.test.ts
git commit -m "feat(pantheon): install --pack <zip|dir> — one-command purchased-pack install

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 6: Extension — "Unlock Full Pantheon" CTA + pack installer command

**Files:**
- Modify: `extensions/vscode/package.json` (commands, viewsWelcome)
- Modify: `extensions/vscode/src/extension.ts` (register two commands next to the existing `thesmos.installAgents` registration)

**Interfaces:**
- Consumes: CLI `thesmos pantheon:install --pack <path>` (Task 5)
- Produces: commands `thesmos.unlockPantheon` (opens Gumroad) and `thesmos.installPantheonPack` (file picker → terminal). No API consumed by later tasks.

- [ ] **Step 1: Declare the commands in `extensions/vscode/package.json`**

In the `contributes.commands` array, after the `thesmos.installAgents` entry, add:

```json
{
  "command": "thesmos.unlockPantheon",
  "title": "Unlock Full Pantheon ($24)",
  "category": "Thesmos Agents",
  "icon": "$(star-full)"
},
{
  "command": "thesmos.installPantheonPack",
  "title": "Install Pantheon Pack…",
  "category": "Thesmos Agents",
  "icon": "$(package)"
}
```

- [ ] **Step 2: Add the CTA to the agents view welcome**

In `contributes.viewsWelcome`, add an entry for the agents view (match the existing `view` id used by `thesmos.installAgents` in `contributes.menus.view/title` — it is `thesmos.agentsView`):

```json
{
  "view": "thesmos.agentsView",
  "contents": "**Starter gods installed?** The free tier ships 6 gods — Zeus, Athena, Argus, Apollo, Hephaestus, and Hebe.\n\n[⚡ Install Starter Agents](command:thesmos.installAgents)\n\n**The Full Pantheon** — all 67 specialists, $24 one-time, yours forever.\n\n[Unlock Full Pantheon ($24)](command:thesmos.unlockPantheon)\n\n[Install Pantheon Pack…](command:thesmos.installPantheonPack)\n\nAlready bought? Download the zip from your Gumroad library, then use Install Pantheon Pack."
}
```

If a `viewsWelcome` entry for `thesmos.agentsView` already exists, merge this content into it rather than adding a duplicate (VS Code shows all matching entries stacked — one entry is cleaner).

- [ ] **Step 3: Register the commands in `extensions/vscode/src/extension.ts`**

Find the existing `vscode.commands.registerCommand('thesmos.installAgents', …)` registration and add these two siblings immediately after it:

```typescript
vscode.commands.registerCommand('thesmos.unlockPantheon', () => {
  void vscode.env.openExternal(
    vscode.Uri.parse('https://holleystudio.gumroad.com/l/thesmos-pantheon'),
  );
}),

vscode.commands.registerCommand('thesmos.installPantheonPack', async () => {
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Install Pantheon Pack',
    filters: { 'Pantheon Pack': ['zip'] },
    title: 'Select the downloaded thesmos-pantheon-agents.zip (or its extracted folder)',
  });
  const path = picked?.[0]?.fsPath;
  if (!path) return;
  const terminal = vscode.window.createTerminal({
    name: 'Thesmos: Install Pantheon Pack',
    iconPath: new vscode.ThemeIcon('package'),
  });
  terminal.show();
  terminal.sendText(`npx thesmos pantheon:install --pack "${path.replace(/"/g, '\\"')}"`);
}),
```

- [ ] **Step 4: Update the `thesmos.installAgents` modal copy for the new boundary**

In the same file, the `thesmos.installAgents` handler shows a modal that currently says "writes 40+ AI agent definition files". Update the message string to:

```typescript
'Install Starter Agents — this writes the 6 free Pantheon agents (Zeus, Athena, Argus, Apollo, Hephaestus, Hebe) to .thesmos/agents/ ' +
'and regenerates .claude/agents/ so they are available as Claude Code subagents. ' +
'The Full Pantheon (67 gods, $24 one-time) is available via "Unlock Full Pantheon".',
```

and change the confirm button label from `'Install Agents'` to `'Install Starter Agents'` (both in the `showInformationMessage` call and the `if (choice !== …)` check).

- [ ] **Step 5: Build and verify**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/extensions/vscode && node esbuild.mjs && npx tsc --noEmit 2>&1 | head -5`
Expected: clean build, no type errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add extensions/vscode/package.json extensions/vscode/src/extension.ts extensions/vscode/dist/
git commit -m "feat(extension): Unlock Full Pantheon CTA + Install Pantheon Pack command

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 7: Flip every price surface — $79 → $24, rules-free copy

**Files:**
- Modify: `thesmos/catalog/pricing.json:14` (priceUsd 79 → 24, notes)
- Modify: `thesmos/bin/commands/tier.ts` (free-tier output block)
- Modify: `thesmos/scripts/package-agents.ts` (two `$79` references: lines ~362 comment, ~688 console message)
- Modify: `website/pricing.html` (meta description, og:description, JSON-LD `"price"`, hero paragraph, buy-price, honor-system FAQ)
- Modify: `website/vs.html:508` (tier price)
- Modify: `website/downloads/gumroad-description.md:57` and `website/downloads/gumroad-description.html:257`

**Interfaces:**
- Consumes: nothing from other tasks (pure copy)
- Produces: consistent $24 / rules-free messaging everywhere. Verified by a repo-wide grep.

- [ ] **Step 1: `pricing.json`**

In `thesmos/catalog/pricing.json`, change the `full-pantheon` tier to:

```json
{
  "id": "full-pantheon",
  "name": "Full Pantheon",
  "priceUsd": 24,
  "model": "one-time",
  "notes": "One-time purchase, lifetime updates via Gumroad re-download. No subscription. Every governance rule is free — this buys the 67-god agent pack.",
  "purchaseUrl": "https://holleystudio.gumroad.com/l/thesmos-pantheon"
}
```

and the `essentials` tier `notes` to:

```json
"notes": "Free forever — the COMPLETE 1,137-rule engine (every framework, every compliance pack) plus 6 starter agents. FSL-1.1-MIT (→ MIT 2030)."
```

- [ ] **Step 2: `tier.ts` free-tier copy**

In `thesmos/bin/commands/tier.ts`, replace the `else` (free) block of `cmdTier` with:

```typescript
  } else {
    lines.push('🜃 Thesmos — FREE');
    lines.push(`   ALL ${THESMOS_RULES.length} rules active — the complete engine is free. Every framework,`);
    lines.push('   every compliance pack, every BLOCKER. Rules are never paywalled.');
    lines.push('');
    lines.push('   The Full Pantheon — 67 specialist agents orchestrated by Zeus —');
    lines.push(`   is $24, one-time, yours forever:  ${UPGRADE_URL}`);
    lines.push('   Already bought? thesmos pantheon:install --pack <downloaded-zip>');
  }
```

Also update the `--json` branch: `active` should be `THESMOS_RULES.length` unconditionally (rules are no longer tier-gated):

```typescript
      active: THESMOS_RULES.length,
```

- [ ] **Step 3: `package-agents.ts` price references**

Line ~362: change the comment `// The $79 Full Pantheon bundle ships premium/pack.json` to `// The $24 Full Pantheon bundle ships premium/pack.json`.
Line ~688: change `console.log('  1. Upload dist-packs/thesmos-pantheon-agents.zip to Gumroad as the Full Pantheon product ($79)')` to `($24)`.
Also grep the file for any other `79`: `grep -n '79' thesmos/scripts/package-agents.ts` and update price contexts (ignore incidental numbers like line counts).

- [ ] **Step 4: Website + Gumroad description copy**

Apply these edits (exact old → new):

`website/pricing.html`:
- Meta description (line 7) → `"Thesmos is free — the complete 1,137-rule governance engine, every compliance pack, and 6 starter agents, source-available under FSL-1.1-MIT. One $24 one-time purchase adds all 67 Pantheon agents exported for every LLM — lifetime updates included. No subscriptions."`
- og:description (line 20) → `"Free: the complete 1,137-rule engine + 6 starter agents. One $24 one-time purchase: all 67 Pantheon agents for every LLM, lifetime updates included. No subscriptions."`
- JSON-LD (line 50): `"price": "79"` → `"price": "24"`
- Hero paragraph (line 370) → `<p>Thesmos ships free — the complete 1,137-rule governance engine, every framework pack, every compliance pack, and 6 starter agents, source-available under FSL-1.1-MIT. One $24 one-time purchase adds all 67 Pantheon agents exported for every LLM, with lifetime updates. No subscription. No monthly tribute owed to the gods — pay once, deploy everywhere.</p>`
- Buy price (line 500): `$79 <span>one-time</span>` → `$24 <span>one-time</span>`
- Honor-system FAQ (line 559) → `No — and we'd rather tell you than have you find out yourself. Every governance rule is free; the $24 purchase is for the Pantheon agent pack — content we wrote, packaged for every platform, with lifetime updates via re-download. The premium agents simply aren't in the free download. No license server, no phone-home, no runtime key: buy it once and the files are yours.`

`website/vs.html` line 508: `$79 <span>one-time</span>` → `$24 <span>one-time</span>`

`website/downloads/gumroad-description.md` line 57: replace `**$79**` with `**$24**` (keep the rest of the sentence).
`website/downloads/gumroad-description.html` line 257: replace `Full Pantheon — $79, one time.` with `Full Pantheon — $24, one time.`

- [ ] **Step 5: Verify no stale $79 remains in product surfaces**

Run: `cd /Users/MHolley/Desktop/thesmos-governance && grep -rn '\$79' thesmos/ website/ extensions/ --include='*.ts' --include='*.html' --include='*.md' --include='*.json' | grep -v node_modules | grep -v dist/`
Expected: no output (growth/ internal strategy docs are intentionally out of scope).

- [ ] **Step 6: Run the full suite + commit**

Run: `cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npx vitest run`
Expected: PASS.

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add thesmos/catalog/pricing.json thesmos/bin/commands/tier.ts thesmos/scripts/package-agents.ts website/pricing.html website/vs.html website/downloads/gumroad-description.md website/downloads/gumroad-description.html
git commit -m "feat(pricing)!: \$24 Full Pantheon, every rule free — all surfaces

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Changeset (major → 5.0.0), README copy, final verification

**Files:**
- Create: `.changeset/free-tool-paid-pantheon.md`
- Modify: `thesmos/README.md` (pricing/tier section — locate with grep)

**Interfaces:**
- Consumes: everything above
- Produces: release-ready branch; `changeset version` will produce 5.0.0

- [ ] **Step 1: Write the changeset**

Create `.changeset/free-tool-paid-pantheon.md`:

```markdown
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
```

- [ ] **Step 2: Update README pricing copy**

Run: `grep -n '79\|Essentials\|premium' /Users/MHolley/Desktop/thesmos-governance/thesmos/README.md | head -20` to locate the pricing/tier section. Replace claims that rules are premium-gated with the new boundary, matching this copy (adapt to the section's existing formatting):

> **Free, forever:** the complete 1,137-rule engine — every framework pack, every compliance pack, every BLOCKER — plus 6 starter agents (Zeus, Athena, Argus, Apollo, Hephaestus, Hebe).
> **Full Pantheon — $24, one-time:** all 67 specialist agents for every LLM platform, lifetime updates via re-download. `thesmos pantheon:install --pack <zip>` after purchase: https://holleystudio.gumroad.com/l/thesmos-pantheon

- [ ] **Step 3: Full verification**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos
npx tsc --noEmit && npx vitest run
cd ../extensions/vscode && node esbuild.mjs && npx tsc --noEmit
```

Expected: everything green.

- [ ] **Step 4: Commit and push**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
git add .changeset/free-tool-paid-pantheon.md thesmos/README.md
git commit -m "docs: 5.0 changeset + README — free tool, \$24 Pantheon

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin feat/agent-install-workflow
```

---

### Task 9: Release (manual gates — requires the user)

**Files:** none (operational)

- [ ] **Step 1: Version + build**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos
npx changeset version   # → 5.0.0
npm run build && npx vitest run
git add -A ../.changeset package.json CHANGELOG.md && git commit -m "chore(release): thesmos-governance@5.0.0

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 2: npm publish** — needs the user's npm granular token (2FA-bypass) from the earlier conversation:

```bash
npm publish --access public
```

Expected: `+ thesmos-governance@5.0.0`.

- [ ] **Step 3: Rebuild + upload the Gumroad pack** (zip now carries the $24 copy):

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm run agents:pack
```

Then (manual, in browser): upload `dist-packs/thesmos-pantheon-agents.zip` to the Gumroad product, **change the product price to $24**, then:

```bash
npm run gumroad:sync
```

- [ ] **Step 4: Extension release**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/extensions/vscode
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='4.10.0';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n');"
node esbuild.mjs && npx vsce publish --no-dependencies
```

- [ ] **Step 5: Merge** — update PR #101 (or merge branch → main per repo flow), push everything.

---

## Self-Review Notes

- **Spec coverage:** de-gate rules → Task 1; tarball gate → Tasks 2-3 (adapted: the spec's prepack/postpack stripping is unnecessary — planning discovered the tarball already excludes ALL pantheon agents, so the work is *additive* via explicit `files` entries + guard test; spec's intent "premium agents physically absent, free gods present, regression-guarded" is fully met); upsell message → Task 4; `--pack` → Task 5; extension CTA/installer → Task 6; $24 reprice + Gumroad → Tasks 7, 9; 5.0.0 → Task 8; copy flip → Tasks 7-8.
- **Deviation from spec (documented):** spec assumed the free gods were already shipping and premium needed stripping. Reality is inverted (nothing ships). The `files`-allowlist approach replaces prepack/postpack — less machinery, same guarantee, enforced by `pack-gate.test.ts`.
- **Type consistency:** `installFromPack` return `{ installed, skipped, errors }` used consistently in Task 5 test/impl/CLI wiring; `FreeAgentsManifest` shape matches `free-agents.json` in Tasks 2/4; `AgentLifecycleResult.registryResult` field name verified against source (`agent-lifecycle.ts:53`).
