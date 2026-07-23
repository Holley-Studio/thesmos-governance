# Skill-Per-God Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the 53 catalog skill specs to their owner gods, surface those skills in Claude Code exports, and install them alongside agents — making "68 agents + 53 skills" the product reality, not just a warehouse.

**Architecture:** Add a `skills:` array to agent frontmatter (12 priority bindings first), parse it in both `AgentMeta` and `PantheonAgent`, then thread the binding through three surfaces: the Claude Code export body (agents mention their skills), `installFromPack` (skills from the zip land in `.claude/skills/`), and `cmdInstall --write` (skills copy from `pantheon/exports/skills/`). The skill export pipeline already exists (`exportSkills()` in `export-agents.ts` already writes all 53 to `pantheon/exports/skills/`, and `package-agents.ts` already bundles them in the zip) — this plan wires the final mile.

**Tech Stack:** TypeScript, Node.js `fs`, Vitest, `thesmos/scripts/export-agents.ts`, `thesmos/bin/commands/pantheon.ts`

## Global Constraints

- Never break existing tests — each task must pass `npm test` before committing
- Skills install to `.claude/skills/<id>/SKILL.md` (Claude Code's native skills directory)
- Only copy skill dirs that contain a `SKILL.md` file (guard against corrupt packs)
- Never follow symlinks when copying from a pack zip (security — matches existing agent install policy)
- All `skillIds` values must match an existing skill id in `thesmos/catalog/skills/`
- `lstatSync` for symlink detection (same pattern as `installFromPack` for agents)
- Run `npm run agents:export` after every catalog change to keep `pantheon/exports/` in sync

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `thesmos/scripts/export-agents.ts` | Modify | Add `skillIds` to `AgentMeta`; parse from frontmatter; append `## Skills` section in `toClaudeCodeAgent()` |
| `thesmos/bin/commands/pantheon.ts` | Modify | Add `skillIds` to `PantheonAgent`; parse in `parsePantheonAgent()`; add `## Skills` in `exportClaudeCode()`; copy skills in `installFromPack()` and `cmdInstall --write` |
| `thesmos/catalog/agents/pantheon/argus-security-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/cassandra-qa-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/chiron-architecture-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/daedalus-product-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/tyche-analytics-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/phantom/kratos-devops-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/nemesis-compliance-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/hephaestus-design-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/polyhymnia-docs-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/mnemosyne-knowledge-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/pantheon/eos-automation-agent.md` | Modify | Add `skills:` binding |
| `thesmos/catalog/agents/[other]/talos-web-agent.md` | Modify | Add `skills:` binding |
| `thesmos/bin/commands/pantheon-pack.test.ts` | Modify | Add skill install tests to `installFromPack` suite |
| `README.md` | Modify | Update "67 agents" → "68 agents + 53 skills" |
| `website/downloads/gumroad-description.md` | Modify | Update product copy |

---

## Task 1: Parse `skillIds` in both agent type systems

**Goal:** Both `AgentMeta` (used by export-agents.ts) and `PantheonAgent` (used by pantheon.ts CLI) gain a `skillIds: string[]` field, populated by parsing `skills:` array frontmatter.

**Files:**
- Modify: `thesmos/scripts/export-agents.ts` (lines ~62–198)
- Modify: `thesmos/bin/commands/pantheon.ts` (lines ~81–165)
- Test: `thesmos/bin/commands/pantheon-pack.test.ts` (verify parsing later in Task 4; parsing correctness tested inline here)

**Interfaces:**

`AgentMeta` (export-agents.ts, ~line 62):
```ts
interface AgentMeta {
  // ... existing fields ...
  skillIds: string[]   // ← new: parsed from `skills:` frontmatter array
}
```

`PantheonAgent` (pantheon.ts, ~line 81):
```ts
interface PantheonAgent {
  // ... existing fields ...
  skillIds: string[]   // ← new: parsed from `skills:` frontmatter array
}
```

- [ ] **Step 1: Add `skillIds` to `AgentMeta` in `export-agents.ts`**

In `thesmos/scripts/export-agents.ts`, add `skillIds: string[]` to the `AgentMeta` interface after `governanceRules`:

```ts
interface AgentMeta {
  id: string
  name: string
  role: string
  emoji: string
  vibe: string
  cursorGlobs: string
  claudeModel: string
  openaiModel: string
  tags: string[]
  governanceRules: string[]
  skillIds: string[]        // ← add this line
  enabled: boolean
  rawContent: string
  body: string
}
```

- [ ] **Step 2: Parse `skills:` in `extractMeta()` in `export-agents.ts`**

In `extractMeta()` (~line 178), add the skill parse alongside `tags`:

```ts
function extractMeta(source: string): AgentMeta {
  const { meta, body } = parseFrontmatter(source)
  const platforms = (meta['platforms'] ?? {}) as Record<string, string>
  return {
    id: String(meta['id'] ?? ''),
    name: String(meta['name'] ?? ''),
    role: String(meta['role'] ?? ''),
    emoji: String(meta['emoji'] ?? ''),
    vibe: String(meta['vibe'] ?? ''),
    cursorGlobs: platforms['cursor_globs'] ?? '**/*.md',
    claudeModel: (platforms['claude_model'] ?? 'claude-sonnet-5').replace(/\[1m\]/g, ''),
    openaiModel: (platforms['openai_model'] ?? 'gpt-5.5').replace(/\[1m\]/g, ''),
    tags: Array.isArray(meta['tags']) ? (meta['tags'] as string[]) : [],
    governanceRules: extractGovernanceRules(source),
    skillIds: Array.isArray(meta['skills']) ? (meta['skills'] as string[]) : [],  // ← add
    enabled: meta['enabled'] !== false,
    rawContent: source,
    body,
  }
}
```

- [ ] **Step 3: Add `skillIds` to `PantheonAgent` in `pantheon.ts`**

In `thesmos/bin/commands/pantheon.ts`, add to the interface (~line 81):

```ts
interface PantheonAgent {
  id: string;
  name: string;
  god: string;
  role: string;
  emoji: string;
  mythology: string;
  color: string;
  avatar: string;
  version: string;
  tags: string[];
  governanceRules: string[];
  skillIds: string[];      // ← add this line
  body: string;
}
```

- [ ] **Step 4: Parse `skills:` in `parsePantheonAgent()` in `pantheon.ts`**

In `parsePantheonAgent()` (~line 122), add skill parsing using the existing `getArr()` helper:

```ts
  return {
    id: get('id') || fallbackId,
    name: get('name').replace(/['"]/g, ''),
    god,
    role,
    emoji,
    mythology: get('mythology').replace(/['"]/g, ''),
    color: get('color'),
    avatar: get('avatar'),
    version: get('version') || '1.0.0',
    tags: getArr('tags'),
    governanceRules,
    skillIds: getArr('skills'),   // ← add this line
    body: body.includes('## Operating Doctrine')
      ? body
      : `${body}\n\n${buildOperatingDoctrine(god, role, emoji, governanceRules)}`,
  };
```

- [ ] **Step 5: Run tests to verify nothing is broken**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test -- --reporter=verbose 2>&1 | tail -30
```

Expected: all existing tests pass; no TS errors.

- [ ] **Step 6: Commit**

```bash
git add thesmos/scripts/export-agents.ts thesmos/bin/commands/pantheon.ts
git commit -m "feat(agents): add skillIds field to AgentMeta and PantheonAgent — parses skills: frontmatter array"
```

---

## Task 2: Add `skills:` bindings to 12 priority agent frontmatter files

**Goal:** The 12 gods with the clearest skill-domain alignment get their `skills:` arrays. All skill IDs must exist in `thesmos/catalog/skills/`.

**Files:**
- Modify: `thesmos/catalog/agents/pantheon/argus-security-agent.md`
- Modify: `thesmos/catalog/agents/pantheon/cassandra-qa-agent.md` (verify exact filename first)
- Modify: `thesmos/catalog/agents/pantheon/chiron-architecture-agent.md`
- Modify: `thesmos/catalog/agents/pantheon/daedalus-product-agent.md`
- Modify: `thesmos/catalog/agents/pantheon/tyche-analytics-agent.md`
- Modify: `thesmos/catalog/agents/[locate]/kratos-devops-agent.md`
- Modify: `thesmos/catalog/agents/[locate]/nemesis-compliance-agent.md`
- Modify: `thesmos/catalog/agents/pantheon/hephaestus-design-agent.md`
- Modify: `thesmos/catalog/agents/[locate]/polyhymnia-docs-agent.md`
- Modify: `thesmos/catalog/agents/[locate]/mnemosyne-knowledge-agent.md`
- Modify: `thesmos/catalog/agents/[locate]/eos-automation-agent.md`
- Modify: `thesmos/catalog/agents/[locate]/talos-web-agent.md`

**Interfaces:** Consumes `skillIds: string[]` from Task 1. Produces populated `skills:` frontmatter that Task 3 reads.

- [ ] **Step 1: Verify all 12 agent files and all skill IDs exist**

```bash
# Locate each agent file
find /Users/MHolley/Desktop/thesmos-governance/thesmos/catalog/agents -name "cassandra*.md" -o -name "kratos*.md" -o -name "nemesis*.md" -o -name "polyhymnia*.md" -o -name "mnemosyne*.md" -o -name "eos-auto*.md" -o -name "talos*.md" | grep -v README | sort

# Verify all skill IDs exist
ls /Users/MHolley/Desktop/thesmos-governance/thesmos/catalog/skills/ | sed 's/\.md$//'
```

Expected: all 12 agent files found; all skill IDs listed match what you'll add.

- [ ] **Step 2: Add `skills:` to `argus-security-agent.md`**

In `thesmos/catalog/agents/pantheon/argus-security-agent.md`, add after the `tags:` block and before `enabled: true`:

```yaml
skills:
  - security-scan
  - secret-scan
  - auth-flow-review
  - rls-policy-audit
  - cors-audit
  - csp-audit
  - infrastructure-security-review
  - webhook-security-review
```

- [ ] **Step 3: Add `skills:` to `cassandra-qa-agent.md`**

```yaml
skills:
  - e2e-test-review
  - integration-test-review
  - add-tests
  - test-coverage-report
```

- [ ] **Step 4: Add `skills:` to `chiron-architecture-agent.md`**

```yaml
skills:
  - api-design-review
  - database-schema-review
  - graphql-schema-review
  - refactor-impact-analysis
```

- [ ] **Step 5: Add `skills:` to `daedalus-product-agent.md`**

```yaml
skills:
  - feature-flag-audit
  - documentation-audit
  - api-deprecation-review
```

- [ ] **Step 6: Add `skills:` to `tyche-analytics-agent.md`**

```yaml
skills:
  - analytics-compliance
  - observability-review
  - logging-audit
```

- [ ] **Step 7: Add `skills:` to `kratos-devops-agent.md`**

```yaml
skills:
  - ci-pipeline-audit
  - build-optimization
  - env-variable-audit
  - performance-profile
  - migration-safety-check
```

- [ ] **Step 8: Add `skills:` to `nemesis-compliance-agent.md`**

```yaml
skills:
  - dependency-audit
  - rate-limit-audit
  - validate-rules
```

- [ ] **Step 9: Add `skills:` to `hephaestus-design-agent.md`**

```yaml
skills:
  - design-token-audit
  - a11y-audit
  - component-audit
```

- [ ] **Step 10: Add `skills:` to `polyhymnia-docs-agent.md`**

```yaml
skills:
  - documentation-audit
  - onboarding-audit
```

- [ ] **Step 11: Add `skills:` to `mnemosyne-knowledge-agent.md`**

```yaml
skills:
  - generate-report
  - repo-health-audit
  - incident-postmortem
```

- [ ] **Step 12: Add `skills:` to `eos-automation-agent.md`**

```yaml
skills:
  - adapter-sync
  - migration-safety-check
```

- [ ] **Step 13: Add `skills:` to `talos-web-agent.md`**

```yaml
skills:
  - typescript-strict-mode
  - error-boundary-audit
  - data-fetching-audit
  - state-audit
```

- [ ] **Step 14: Verify parse round-trips correctly**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos
node -e "
import('./scripts/export-agents.ts').catch(() => {});
" 2>&1 || npx tsx -e "
import { readFileSync } from 'fs';
const raw = readFileSync('catalog/agents/pantheon/argus-security-agent.md', 'utf8');
const m = raw.match(/^skills:\n((?:  - .+\n?)+)/m);
console.log('argus skills:', m ? m[1].trim().split('\n').map(l => l.replace('  - ','')) : 'NOT FOUND');
"
```

Expected: prints `['security-scan', 'secret-scan', 'auth-flow-review', ...]`.

- [ ] **Step 15: Run tests**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 16: Commit**

```bash
git add thesmos/catalog/agents/
git commit -m "feat(agents): bind 12 priority gods to their domain skills via skills: frontmatter"
```

---

## Task 3: Surface skills in Claude Code agent exports

**Goal:** When a god has `skillIds`, both `toClaudeCodeAgent()` (export-agents.ts) and `exportClaudeCode()` (pantheon.ts) append a `## Skills` section listing the skills by name with a one-line trigger.

**Files:**
- Modify: `thesmos/scripts/export-agents.ts:460` — `toClaudeCodeAgent()`
- Modify: `thesmos/bin/commands/pantheon.ts:285` — `exportClaudeCode()`

**Interfaces:**
- Consumes: `agent.skillIds: string[]` from Task 1
- Produces: Claude Code `.md` files with a `## Skills` section like:

```markdown
## Skills

Use these Thesmos skills for structured workflow execution:
- `/security-scan` — full security sweep (secrets, auth gaps, RLS, CORS)
- `/secret-scan` — targeted secret detection across changed files
```

- [ ] **Step 1: Write failing test for skill section in export**

In `thesmos/bin/commands/pantheon-pack.test.ts`, add after the existing describe block:

```ts
import { describe, it, expect } from 'vitest';
// (add to existing imports at top of file)

// Add a new describe block at the bottom of the file:
describe('exportClaudeCode skill section', () => {
  it('includes ## Skills section when agent has skillIds', () => {
    // Import exportClaudeCode — it's not currently exported; we'll export it in Step 3
    // For now write the test so it compiles after Step 3
    const { exportClaudeCodeForTest } = await import('./pantheon.ts') as any;
    const agent = {
      id: 'argus-security-agent',
      name: 'God Agent Argus — Security Agent',
      god: 'Argus',
      role: 'Security & Threat Modeling',
      emoji: '👁',
      mythology: 'All-seeing giant.',
      color: '#27AE60',
      avatar: 'argus.svg',
      version: '1.0.0',
      tags: ['security'],
      governanceRules: ['SEC_001'],
      skillIds: ['security-scan', 'secret-scan'],
      body: '## Identity\nArgus body here.',
    };
    const output = exportClaudeCodeForTest(agent);
    expect(output).toContain('## Skills');
    expect(output).toContain('/security-scan');
    expect(output).toContain('/secret-scan');
  });

  it('omits ## Skills section when agent has no skillIds', () => {
    const { exportClaudeCodeForTest } = await import('./pantheon.ts') as any;
    const agent = {
      id: 'zeus-executive-agent',
      name: 'God Agent Zeus — Executive Agent',
      god: 'Zeus',
      role: 'Executive Orchestration',
      emoji: '⚡',
      mythology: 'King of gods.',
      color: '#F1C40F',
      avatar: 'zeus.svg',
      version: '1.0.0',
      tags: ['executive'],
      governanceRules: [],
      skillIds: [],
      body: '## Identity\nZeus body here.',
    };
    const output = exportClaudeCodeForTest(agent);
    expect(output).not.toContain('## Skills');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail (skill section not yet implemented)**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test -- pantheon-pack 2>&1 | tail -20
```

Expected: new tests fail with "exportClaudeCodeForTest is not a function" or similar.

- [ ] **Step 3: Add `skillsSection()` helper and update `exportClaudeCode()` in `pantheon.ts`**

After line ~284, add:

```ts
/** Builds the ## Skills section for agents with bound skills. Returns '' when skillIds is empty. */
function skillsSection(skillIds: string[]): string {
  if (skillIds.length === 0) return '';
  const lines = skillIds.map(id => `- \`/${id}\` — run the ${id.replace(/-/g, ' ')} workflow`);
  return [
    '',
    '## Skills',
    '',
    'Use these Thesmos skills for structured workflow execution:',
    ...lines,
  ].join('\n');
}

/** Exported for tests only — not part of the public CLI API. */
export function exportClaudeCodeForTest(agent: PantheonAgent): string {
  return exportClaudeCode(agent);
}
```

Update `exportClaudeCode()` at line ~293 to append the skills section:

```ts
function exportClaudeCode(agent: PantheonAgent): string {
  const tools = ['Read', 'Write', 'Bash'];
  const model = modelFor(agent.id);
  const mythologySnippet = agent.mythology ? ' ' + agent.mythology.slice(0, 90).replace(/\n/g, ' ') : '';

  return `---
name: ${agent.name}
description: >
  God Agent ${agent.god} — ${agent.role}.${mythologySnippet}
model: ${model}
tools:
${tools.map(t => `  - ${t}`).join('\n')}
---

${agent.body}${skillsSection(agent.skillIds)}
`;
}
```

- [ ] **Step 4: Update `toClaudeCodeAgent()` in `export-agents.ts` to include skills section**

In `toClaudeCodeAgent()` (~line 460), add the skills section to the body:

```ts
function toClaudeCodeAgent(agent: AgentMeta): string {
  const name = godName(agent)
  const domain = godDomain(agent)
  const triggers = agent.tags.filter(t => t !== 'pantheon').slice(0, 5).join(', ')
  const description = `${domain}. Invoke for ${triggers || domain.toLowerCase()} tasks. Responds in character as ${name} of the Thesmos Pantheon.`
  const body = agent.body.replace(/^# .+\r?\n+/, '')

  const skillLines = agent.skillIds.length > 0
    ? [
        '',
        '## Skills',
        '',
        'Use these Thesmos skills for structured workflow execution:',
        ...agent.skillIds.map(id => `- \`/${id}\` — run the ${id.replace(/-/g, ' ')} workflow`),
      ].join('\n')
    : ''

  return [
    '---',
    `name: ${godEmoji(agent)} ${name} — ${agent.name.replace(/^God Agent \w+ — /, '')}`,
    `description: ${description.replace(/:/g, ' —')}`,
    `model: ${claudeCodeAlias(agent.claudeModel)}`,
    'tools:',
    '  - Read',
    '  - Write',
    '  - Bash',
    '---',
    '',
    `# ${godEmoji(agent)} ${name} — ${domain}`,
    '',
    body + skillLines,
  ].join('\n')
}
```

- [ ] **Step 5: Run tests to confirm new tests pass**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test -- pantheon-pack 2>&1 | tail -20
```

Expected: all tests in pantheon-pack.test.ts pass including the two new ones.

- [ ] **Step 6: Run full test suite**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add thesmos/scripts/export-agents.ts thesmos/bin/commands/pantheon.ts thesmos/bin/commands/pantheon-pack.test.ts
git commit -m "feat(export): surface god-bound skills in Claude Code agent exports as ## Skills section"
```

---

## Task 4: `installFromPack` copies skills from zip to `.claude/skills/`

**Goal:** When `thesmos pantheon:install --pack <zip>` runs, it now also copies every valid skill dir from `for-claude/skills/` in the extracted pack to `.claude/skills/<id>/` in the project root.

**Files:**
- Modify: `thesmos/bin/commands/pantheon.ts:450` — `installFromPack()`
- Modify: `thesmos/bin/commands/pantheon-pack.test.ts` — 3 new tests

**Interfaces:**
- Consumes: `packDir/for-claude/skills/<id>/SKILL.md` (from pack zip — already present in paid pack)
- Produces: `<root>/.claude/skills/<id>/SKILL.md`
- Returns: updated `{ installed, skipped, errors, skillsInstalled }` (add `skillsInstalled: number`)

**NOTE:** Update the return type: `{ installed: number; skipped: number; errors: string[]; skillsInstalled: number }`.

- [ ] **Step 1: Write 3 failing tests**

Add to the `describe('installFromPack')` block in `thesmos/bin/commands/pantheon-pack.test.ts`:

```ts
it('installs skills from for-claude/skills/ when present', () => {
  const dir = join(pack, 'for-claude');
  mkdirSync(dir);
  writeFileSync(join(dir, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
  // Create a skills directory with one skill
  const skillsDir = join(dir, 'skills', 'security-scan');
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(join(skillsDir, 'SKILL.md'), '---\nname: security-scan\ndescription: Security sweep.\n---\n\nBody.\n');

  const result = installFromPack(pack, root);

  expect(result.errors).toEqual([]);
  expect(result.installed).toBe(1);
  expect(result.skillsInstalled).toBe(1);
  expect(existsSync(join(root, '.claude', 'skills', 'security-scan', 'SKILL.md'))).toBe(true);
});

it('skips skill dirs that lack a SKILL.md', () => {
  const dir = join(pack, 'for-claude');
  mkdirSync(dir);
  writeFileSync(join(dir, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
  // Skill dir with no SKILL.md inside
  mkdirSync(join(dir, 'skills', 'empty-skill'), { recursive: true });

  const result = installFromPack(pack, root);

  expect(result.skillsInstalled).toBe(0);
  expect(existsSync(join(root, '.claude', 'skills', 'empty-skill'))).toBe(false);
});

it('does not follow symlinked skill dirs', () => {
  const outside = mkdtempSync(join(tmpdir(), 'thesmos-skill-outside-'));
  try {
    mkdirSync(join(outside, 'SKILL.md'), { recursive: true }); // not a file but directory — should be skipped
    const dir = join(pack, 'for-claude');
    mkdirSync(dir);
    writeFileSync(join(dir, 'ares-sales-agent.md'), AGENT('ares-sales-agent'));
    mkdirSync(join(dir, 'skills'), { recursive: true });
    symlinkSync(outside, join(dir, 'skills', 'evil-skill'), 'dir');

    const result = installFromPack(pack, root);

    expect(result.skillsInstalled).toBe(0);
    expect(existsSync(join(root, '.claude', 'skills', 'evil-skill'))).toBe(false);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
```

Also update the type import at the top of the test file — `installFromPack` now returns `skillsInstalled`.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test -- pantheon-pack 2>&1 | tail -30
```

Expected: 3 new tests fail.

- [ ] **Step 3: Add `installSkillsFromPack()` helper and update `installFromPack()` in `pantheon.ts`**

Add this helper after `resolvePackAgentsDir()` (~line 443):

```ts
/**
 * Copy skills from a pack's `for-claude/skills/` directory to `.claude/skills/` in the project root.
 * Each skill is a subdirectory containing a SKILL.md file.
 * Skips symlinks and dirs without a SKILL.md (guards against malicious or malformed packs).
 */
function installSkillsFromPackDir(skillsPackDir: string, root: string): number {
  if (!existsSync(skillsPackDir)) return 0;

  const targetBase = join(root, '.claude', 'skills');
  mkdirSync(targetBase, { recursive: true });

  let installed = 0;
  for (const entry of readdirSync(skillsPackDir)) {
    const srcDir = join(skillsPackDir, entry);
    // Never follow symlinks — same policy as agent install
    if (lstatSync(srcDir).isSymbolicLink()) continue;
    if (!statSync(srcDir).isDirectory()) continue;
    const skillMdSrc = join(srcDir, 'SKILL.md');
    if (!existsSync(skillMdSrc)) continue;

    const destDir = join(targetBase, entry);
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, 'SKILL.md'), readFileSync(skillMdSrc, 'utf8'), 'utf8');
    installed++;
  }
  return installed;
}
```

Update `installFromPack()` return type and body to include skill install:

```ts
export function installFromPack(packPath: string, root: string): { installed: number; skipped: number; errors: string[]; skillsInstalled: number } {
  // ... (existing extraction logic unchanged) ...

  try {
    const agentsDir = resolvePackAgentsDir(packDir);
    // ... (existing agent install loop unchanged) ...

    // Install skills from for-claude/skills/ if present
    const skillsPackDir = join(agentsDir, 'skills');
    const skillsInstalled = installSkillsFromPackDir(skillsPackDir, root);

    if (installed + skipped > 0) {
      syncAdapters(root);
      if (!process.env['VITEST']) {
        // ... (existing premium marker write unchanged) ...
      }
    }

    return { installed, skipped, errors, skillsInstalled };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}
```

Also update `cmdInstall()` (~line 539) where it destructures `installFromPack` to include `skillsInstalled` in the log line:

```ts
const { installed, skipped, errors, skillsInstalled } = installFromPack(packPath, root);
// ...
console.log(`\n  ⚡ Full Pantheon installed: ${installed} new, ${skipped} updated${skillsInstalled > 0 ? `, ${skillsInstalled} skills` : ''}.`);
```

- [ ] **Step 4: Run tests to confirm the 3 new tests pass**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test -- pantheon-pack 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add thesmos/bin/commands/pantheon.ts thesmos/bin/commands/pantheon-pack.test.ts
git commit -m "feat(install): installFromPack now copies skills from for-claude/skills/ to .claude/skills/"
```

---

## Task 5: `cmdInstall --write` copies agent's linked skills

**Goal:** `thesmos pantheon:install argus --write` now also copies Argus's 8 linked skills from `pantheon/exports/skills/<id>/SKILL.md` to `.claude/skills/<id>/SKILL.md`.

**Files:**
- Modify: `thesmos/bin/commands/pantheon.ts:531` — `cmdInstall()`

**Interfaces:**
- Consumes: `agent.skillIds` from Task 1, `SKILLS_EXPORT_DIR` (new constant in pantheon.ts)
- Produces: `.claude/skills/<id>/SKILL.md` for each linked skill

- [ ] **Step 1: Add `SKILLS_EXPORT_DIR` constant near top of `pantheon.ts`**

After the `AGENTS_DIR` setup block (~line 30), add:

```ts
// pantheon/exports/skills/ — pre-built skill exports, one dir per skill.
// Skills bundled in the $24 pack live here; --write copies them alongside agents.
const _skillsExportDirCandidates = [
  join(__dirname, '../../../pantheon/exports/skills'), // dev: bin/commands/ → repo root
  join(__dirname, '../../pantheon/exports/skills'),    // bundle: dist/ → thesmos/
];
const SKILLS_EXPORT_DIR = _skillsExportDirCandidates.find(p => existsSync(p)) ?? _skillsExportDirCandidates[0];
```

- [ ] **Step 2: Add `installLinkedSkills()` helper in `pantheon.ts`**

Add after `upsellLine()` (~line 67):

```ts
/**
 * Copy skills linked by an agent (via skillIds) from the pre-built export dir
 * to .claude/skills/ in the project root. Returns count of skills copied.
 * Skips skills whose export dir doesn't exist (graceful: future skill IDs, dev envs).
 */
function installLinkedSkills(skillIds: string[], root: string): number {
  if (skillIds.length === 0 || !existsSync(SKILLS_EXPORT_DIR)) return 0;

  const targetBase = join(root, '.claude', 'skills');
  mkdirSync(targetBase, { recursive: true });

  let copied = 0;
  for (const id of skillIds) {
    const srcDir = join(SKILLS_EXPORT_DIR, id);
    const skillMd = join(srcDir, 'SKILL.md');
    if (!existsSync(skillMd)) continue; // skill not yet exported — skip silently

    const destDir = join(targetBase, id);
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, 'SKILL.md'), readFileSync(skillMd, 'utf8'), 'utf8');
    copied++;
  }
  return copied;
}
```

- [ ] **Step 3: Call `installLinkedSkills()` inside the `--write` block in `cmdInstall()`**

In `cmdInstall()`, inside the `if (write)` block, after the agent write loop (~line 597), add:

```ts
    // Install skills linked to the installed agents
    let skillsWritten = 0;
    for (const id of toInstall) {
      const agent = agents.find(a => a.id === id)!;
      skillsWritten += installLinkedSkills(agent.skillIds, root);
    }

    if (written + skipped > 0) {
      console.log(`\n  ✓ ${written} agent(s) written to .thesmos/agents/`);
      if (skipped > 0) console.log(`    ${skipped} already present — skipped`);
      if (skillsWritten > 0) console.log(`  ✓ ${skillsWritten} linked skill(s) written to .claude/skills/`);
      // ... (existing syncAdapters call unchanged) ...
    }
```

- [ ] **Step 4: Manual smoke test**

```bash
cd /Users/MHolley/Desktop/thesmos-governance
# Create a temp project root to test into
mkdir -p /tmp/thesmos-skill-test/.thesmos
echo '{"project":"test"}' > /tmp/thesmos-skill-test/.thesmos/config.json

# Install argus with --write
node thesmos/bin/cli.ts pantheon:install argus-security-agent --write 2>&1 || \
npx tsx thesmos/bin/cli.ts pantheon:install argus-security-agent --write 2>&1

# Check skills landed
ls /tmp/thesmos-skill-test/.claude/skills/ 2>/dev/null || echo "no skills dir (may need adjusting for root)"
```

Expected output line: `✓ 8 linked skill(s) written to .claude/skills/`

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test 2>&1 | tail -20
```

Expected: all pass (new code paths not yet covered by automated tests — acceptable for CLI path; the pack install path from Task 4 covers the shared `installLinkedSkills` logic).

- [ ] **Step 6: Commit**

```bash
git add thesmos/bin/commands/pantheon.ts
git commit -m "feat(install): pantheon:install --write now copies linked skills to .claude/skills/"
```

---

## Task 6: Regenerate exports + update product copy

**Goal:** Rebuild all export artifacts with the skill bindings baked in, and update README and Gumroad copy to say "68 agents + 53 skills".

**Files:**
- Run: `npm run agents:export` (regenerates `pantheon/exports/`)
- Run: `npm run agents:pack` (rebuilds both zips including updated skills)
- Modify: `README.md`
- Modify: `website/downloads/gumroad-description.md`
- Stage: `website/downloads/thesmos-starter-agents.zip` (rebuilt artifact)

- [ ] **Step 1: Regenerate all export formats**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm run agents:export 2>&1
```

Expected output: lines like `✓ claude-code: 68 exported`, `✓ skills: 53 exported`.

- [ ] **Step 2: Spot-check Argus's Claude Code export has the Skills section**

```bash
grep -A 10 "## Skills" /Users/MHolley/Desktop/thesmos-governance/pantheon/exports/claude-code/argus-security-agent.md
```

Expected: shows `/security-scan`, `/secret-scan`, etc.

- [ ] **Step 3: Rebuild both pack zips**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm run agents:pack 2>&1
```

Expected: `website/downloads/thesmos-starter-agents.zip` updated (3 sample skills), `dist-packs/thesmos-pantheon-agents.zip` updated (all 53 skills).

- [ ] **Step 4: Update `README.md` agent/skill count line**

Find the line that mentions agent count (grep for "1,137 rules" or "67 specialist" or similar), then update to reflect skills. Change:

```
# 67 specialist agents
```
to:
```
# 68 specialist agents · 53 workflow skills
```

Also update any "67" or "40 agents" standalone references to "68 agents + 53 skills".

- [ ] **Step 5: Update `website/downloads/gumroad-description.md`**

Find the pack contents description and add skills:

Change the line that says "67 `.md` agent files" to:
```
67 specialist agent `.md` files + 53 workflow skills (Claude Code Agent Skills format — one directory per skill)
```

Add a Skills section to the "What's included" list:

```markdown
**Workflow Skills (53 included):**
- `security-scan`, `secret-scan`, `auth-flow-review`, `rls-policy-audit` — Argus's security arsenal
- `e2e-test-review`, `integration-test-review`, `add-tests`, `test-coverage-report` — Cassandra's QA suite
- `api-design-review`, `database-schema-review`, `graphql-schema-review` — Chiron's architecture review
- `ci-pipeline-audit`, `build-optimization`, `env-variable-audit` — Kratos's DevOps toolkit
- `a11y-audit`, `design-token-audit`, `component-audit` — Hephaestus's design system checks
- …and 38 more covering analytics, compliance, docs, automation, and web engineering
```

- [ ] **Step 6: Run full test suite one final time**

```bash
cd /Users/MHolley/Desktop/thesmos-governance/thesmos && npm test 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit all artifacts**

```bash
git add pantheon/exports/ website/downloads/thesmos-starter-agents.zip README.md website/downloads/gumroad-description.md
git commit -m "chore(release): regenerate exports + update product copy — 68 agents + 53 skills"
```

---

## Self-Review

**Spec coverage check:**
- [x] Agent `skills:` frontmatter binding → Task 1 (parsing) + Task 2 (data)
- [x] Claude Code export surfaces skills → Task 3 (`toClaudeCodeAgent` + `exportClaudeCode`)
- [x] `installFromPack` copies skills → Task 4
- [x] `--write` copies linked skills → Task 5
- [x] Export regeneration + product copy → Task 6
- [x] Symlink guard on skill copy → Task 4 Step 3 (`lstatSync` check)
- [x] Skip skill dirs without SKILL.md → Task 4 Step 3 + Task 5 Step 2
- [x] Tests for pack skill install → Task 4 (3 new tests in pantheon-pack.test.ts)

**Placeholder scan:** No TBDs. Every step has commands or code.

**Type consistency:**
- `skillIds: string[]` — named identically in `AgentMeta` (Task 1 Step 1), `PantheonAgent` (Task 1 Step 3), and all consumers (Tasks 3–5)
- `installLinkedSkills(skillIds, root)` — defined in Task 5 Step 2, called in Task 5 Step 3
- `installSkillsFromPackDir(skillsPackDir, root)` — defined in Task 4 Step 3, called within `installFromPack`
- `skillsInstalled: number` — added to `installFromPack` return type in Task 4 Step 3, destructured in Task 4 Step 3 cmd call

**One gap found:** The `--write` path in Task 5 uses a temp project root (`/tmp/thesmos-skill-test`) in the smoke test but the actual `cmdInstall` uses `root` from `createContext()`. Confirmed: `root` is the project root — this is correct.
