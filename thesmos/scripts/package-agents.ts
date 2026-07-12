#!/usr/bin/env node
/**
 * Thesmos Agent Packager.
 * Bundles exported agent files into downloadable ZIPs — two tiers only
 * (Operation Sovereign Gate retired the $49 Founders/Agencies verticals):
 *
 *   website/downloads/thesmos-starter-agents.zip — 6 free agents, all platforms
 *   dist-packs/thesmos-pantheon-agents.zip        — ALL agents + the premium
 *     engine unlock (premium/pack.json — flips the CLI from the 288-rule free
 *     Essentials tier to the full 1,137-rule engine). Paid, Gumroad only.
 *
 * The paid bundle is NOT committed to the repo or served from the public
 * website — Gumroad is the only distribution channel for it (see Operation
 * Clear Temple). The starter ZIP is the only one that ships from
 * website/downloads/.
 *
 * Usage:
 *   tsx scripts/package-agents.ts
 *   npm run agents:pack
 */

import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const EXPORTS_DIR  = resolve(__dirname, '../../pantheon/exports')
const SKILLS_EXPORT_DIR = resolve(__dirname, '../../pantheon/exports/skills')
const DOWNLOADS_DIR = resolve(__dirname, '../../website/downloads')
const DIST_PACKS_DIR = resolve(__dirname, '../../dist-packs')
const TMP_DIR      = resolve(__dirname, '../../.tmp-pack')

const FREE_AGENT_IDS = new Set([
  'zeus-executive-agent',
  'athena-strategy-agent',
  'argus-security-agent',
  'apollo-content-agent',
  'hephaestus-design-agent',
  // Zeus orchestrators are the front door to the Pantheon — always free
  'zeus-pantheon-orchestrator',
  'zeus-receptionist',
  'zeus-figma-card',
  // Support is never paywalled — Hebe ships free in every tier
  'hebe-support-agent',
])

// ── God-drop holdbacks ────────────────────────────────────────────────────────
// Agents whose catalog/exports exist but whose DROP IS NOT COMPLETE — not in
// pantheon-map.json (Zeus can't route to them), not in the decreed roster
// count, not announced. Excluded from every bundle so the shipped artifact
// matches the marketed "67 agents" exactly. To complete a drop: add the god to
// pantheon-map.json, update the roster decree + all count surfaces (see
// docs/roadmap.md), announce it, THEN remove the holdback.
const HOLDBACK_AGENT_IDS = [
  'asclepius-debugging-agent', // committed in #73, exports generated 2026-07-05, drop never finished
]

const isHeldBack = (id: string): boolean =>
  HOLDBACK_AGENT_IDS.some((h) => id.startsWith(h))

// Starter (free) bundle teaser — 3 broadly appealing skills out of the full
// 53. The paid Full Pantheon bundle ships all of them.
const STARTER_SAMPLE_SKILL_IDS = new Set([
  'a11y-audit',
  'ci-pipeline-audit',
  'add-tests',
])

const PLATFORM_MAP: Array<{ srcDir: string; destDir: string; ext: string; guide: string }> = [
  {
    srcDir: 'claude-code',
    destDir: 'for-claude',
    ext: '.md',
    guide: `# Installing Thesmos Agents in Claude Code — Full Experience

Five steps give you the complete theatrical Pantheon: Zeus routing announcements
in chat, the live god tree in the VS Code sidebar, the routing chain in the
status bar, and a zero-cost Pantheon status line in your terminal prompt.

## Step 1 — Install the agents

1. In your project root, create a directory: .claude/agents/
2. Copy the .md files you want into .claude/agents/
   Quick install (all agents): cp *.md /path/to/your/project/.claude/agents/
3. Restart Claude Code — the agents appear automatically

## Step 2 — Enable Zeus routing announcements

Paste the contents of PANTHEON.md (in this folder) into your project's CLAUDE.md.
Zeus will now announce every routing decision with a theatrical header before
any god responds.

## Step 3 — Wire the live activity feed (VS Code users)

1. Copy hooks/agent-activity.cjs into your project's .claude/hooks/
2. Merge hooks/settings-snippet.json into your project's .claude/settings.json
   (create the file with exactly that content if it doesn't exist — this also
   wires the Step 5 status line below)

Every god dispatch now streams into .thesmos/agent-activity.jsonl.

## Step 4 — Install the VS Code extension

Install the .vsix from the for-vscode/ folder (Cmd+Shift+P → "Install from VSIX").
The Agent Activity panel shows Zeus dispatching gods live, and the status bar
displays the routing chain (⚡ Zeus → 👁 Argus) while they work.

## Step 5 — See the gods in your terminal status line (zero API cost)

1. Copy hooks/statusline-pantheon.sh into your project's .claude/
2. Confirm .claude/settings.json has the "statusLine" key from
   hooks/settings-snippet.json (Step 3 merges this automatically)

Your terminal prompt now shows ⚡ Zeus → 👁 Argus · inspecting the perimeter…
while a god is dispatched, and falls back to your branch + model when idle.
This reads the local activity log only — no network calls, no LLM cost.

Learn more: https://docs.anthropic.com/claude-code/agents
`,
  },
  {
    srcDir: 'claude-project',
    destDir: 'for-claude-ai',
    ext: '.txt',
    guide: `# Installing Thesmos Agents in Claude.ai Projects

## The Zeus Orchestrator (recommended — full Pantheon in one project)

1. Go to claude.ai → Projects → New Project
2. Open zeus-pantheon-orchestrator-claude-project.txt and paste its contents
   into the project's custom instructions
3. Upload the council bundle(s) as project knowledge:
   - council-business.txt — strategy, sales, marketing, finance, analytics
   - council-creative.txt — content, brand, photo, motion, video, PR
   - council-build.txt — security, product, design, legal, 3D, QA
   Upload one council for a focused project, or all three for the full Pantheon.
4. Ask anything. Zeus routes, and the right god answers in full character.

## Individual agents (single-god projects)

Paste any agent's .txt file directly into a project's custom instructions for
maximum depth in one domain.
`,
  },
  {
    srcDir: 'figma',
    destDir: 'for-figma',
    ext: '.txt',
    guide: '', // figma exports ship their own INSTALL.md — copied as-is below
  },
  {
    srcDir: 'openai-assistants',
    destDir: 'for-openai-api',
    ext: '.json',
    guide: `# Thesmos Agents via the OpenAI Assistants API

Each .json file is a ready-to-create assistant definition (name, instructions,
model, metadata).

## Create an assistant with curl

curl https://api.openai.com/v1/assistants \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "OpenAI-Beta: assistants=v2" \\
  -d @argus-security-agent-openai-assistant.json

## Or with the openai SDK (Node)

import OpenAI from 'openai';
import { readFileSync } from 'node:fs';
const openai = new OpenAI();
const def = JSON.parse(readFileSync('argus-security-agent-openai-assistant.json', 'utf8'));
const assistant = await openai.beta.assistants.create(def);

Learn more: https://platform.openai.com/docs/assistants
`,
  },
  {
    srcDir: 'chatgpt',
    destDir: 'for-chatgpt',
    ext: '.txt',
    guide: `# Installing Thesmos Agents as Custom GPTs in ChatGPT

## The Zeus Pantheon Orchestrator (recommended — full Pantheon in ONE GPT)

1. Go to https://chatgpt.com/gpts/editor and click "Create a GPT" → "Configure"
2. Paste the contents of zeus-pantheon-orchestrator-chatgpt.txt into "Instructions"
3. Under "Knowledge", upload the cluster files from the knowledge/ subfolder
   (all 13, or just the domains you work in)
4. Name it "Zeus — Thesmos Pantheon" and save as PRIVATE
5. Ask anything. Zeus announces the routing, and the right god answers in
   full character — banner, expertise, signature.

IMPORTANT: Keep this GPT private ("Only me"). The knowledge files contain the
full agent specifications and can be extracted by anyone with access.

## Individual agent GPTs (maximum depth in one domain)

Each god ships as a PAIR of files — a short Instructions file (under
ChatGPT's 8,000-character limit) plus a "-knowledge.txt" companion with the
god's complete methodology, output contract, and tools. Both are needed.

1. Create a GPT → Configure
2. Paste the agent's short file (e.g. argus-security-agent-chatgpt.txt) into
   "Instructions"
3. Under "Knowledge", upload that same agent's "-knowledge.txt" companion
   (e.g. argus-security-agent-chatgpt-knowledge.txt)
4. Name it after the agent and save as PRIVATE — the knowledge file is the
   full paid specification

## Tips

- Individual GPTs give the deepest single-domain expertise
- The Zeus orchestrator gives the routed multi-god experience
- Both can coexist — use Zeus for mixed work, specialists for deep dives

Learn more: https://help.openai.com/en/articles/8554397-creating-a-gpt
`,
  },
  {
    srcDir: 'chatgpt-clusters',
    destDir: 'for-chatgpt/knowledge',
    ext: '.txt',
    guide: `# Zeus GPT Knowledge Files

Upload these cluster files to the Zeus Pantheon Orchestrator GPT under
"Knowledge" (see ../INSTALL.md). Each file contains the complete expertise
specifications for one domain cluster — every section header carries the god's
identity so retrieved passages always stay in character.

Upload all 13 for the full Pantheon, or only the domains you work in.
`,
  },
  {
    srcDir: 'gemini',
    destDir: 'for-gemini',
    ext: '.txt',
    guide: `# Installing Thesmos Agents as Gemini Gems

Each .txt file in this folder contains instructions for one Gemini Gem.
Gemini runs ONE Gem per conversation — there is no in-chat multi-agent routing.
Install the Zeus Receptionist to get theatrical routing between your Gems.

## Start here: the Zeus Receptionist

1. Go to https://gemini.google.com/gems/new
2. Paste the contents of zeus-receptionist-gemini.txt into "Instructions"
3. Name it "Zeus — Pantheon Receptionist" and save
4. Bring any task to Zeus first — he identifies the right god, sharpens your
   prompt, and tells you which Gem to open

## Installing the god Gems

1. Create a New Gem
2. Paste the agent's .txt file into "Instructions"
3. Name it after the agent (e.g. "Argus — Security Agent") and save

NOTE: If a Gem's instructions field truncates the file (some accounts enforce
shorter limits), paste the file up to and including the "## Anti-Drift Protocol"
section header, then the protocol itself — identity and expertise survive.

Learn more: https://support.google.com/gemini/answer/14949803
`,
  },
  {
    srcDir: 'cursor',
    destDir: 'for-cursor',
    ext: '.mdc',
    guide: `# Installing Thesmos Agents in Cursor

Each .mdc file in this folder is a Cursor rule file.

## How to install

1. In your project root, create: .cursor/rules/
2. Copy the .mdc files you want into .cursor/rules/
3. Cursor loads them automatically — no restart needed

## Quick install (all agents)

cp *.mdc /path/to/your/project/.cursor/rules/

## Per-agent install

Each .mdc file has alwaysApply: false by default. Agents activate when
you mention their domain or explicitly call them in Cursor Chat.

Learn more: https://docs.cursor.com/context/rules-for-ai
`,
  },
  {
    srcDir: 'copilot',
    destDir: 'for-copilot',
    ext: '.md',
    guide: `# Installing Thesmos Agents with GitHub Copilot

Each .md file in this folder contains instructions for GitHub Copilot.

## How to install

1. Open your project's .github/copilot-instructions.md
   (Create it if it doesn't exist)
2. Open the .md file for the agent you want
3. Copy the agent instructions and paste them into copilot-instructions.md

## Multi-agent setup

You can combine multiple agents in copilot-instructions.md. Each agent's
section is separated by a horizontal rule. We recommend starting with Zeus
to enable orchestration, then adding the specialists you need most.

## VS Code Custom Instructions

Alternatively, in VS Code:
1. Open Settings (Cmd/Ctrl + ,)
2. Search for "GitHub Copilot: Instructions"
3. Paste agent instructions directly

Learn more: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot
`,
  },
  {
    srcDir: 'codex',
    destDir: 'for-codex',
    ext: '.md',
    guide: `# Installing Thesmos Agents in OpenAI Codex

Codex (CLI and IDE) reads AGENTS.md convention files for workspace instructions.

## How to install

1. Copy AGENTS.md (in this folder) to your repository root
2. Create an agents/ directory at your repository root
3. Copy the agent .md files into agents/

Quick install:
  cp AGENTS.md /path/to/your/repo/
  mkdir -p /path/to/your/repo/agents
  cp *-agent.md /path/to/your/repo/agents/

## How it works

AGENTS.md makes Zeus the executive orchestrator of your Codex sessions — every
task gets a theatrical routing header, and the matched god's full specification
is read from agents/ before responding.

Learn more: https://agents.md
`,
  },
]

// ── Premium engine unlock ─────────────────────────────────────────────────────
// The $79 Full Pantheon bundle ships premium/pack.json — the distribution-gated
// marker tiers.ts looks for (~/.thesmos/premium/pack.json or a project's
// .thesmos/premium/pack.json). Its presence flips the CLI from the free
// 288-rule Essentials tier to the full 1,137-rule engine. No license server,
// no key validation — buying IS the unlock (see thesmos/tiers.ts).

const PREMIUM_INSTALL_GUIDE = `# Unlock the Full Engine — 1,137 rules

The free Thesmos CLI runs the 288-rule Essentials tier (every BLOCKER + the
complete AI-code safety net). This folder unlocks the rest — all frameworks,
the compliance packs (GDPR / HIPAA / EU AI Act / DORA), and every quality and
performance rule.

## One-time setup (~10 seconds)

\`\`\`bash
mkdir -p ~/.thesmos/premium
cp pack.json ~/.thesmos/premium/pack.json
\`\`\`

That's it — every Thesmos install on this machine now runs the full engine.
Verify with:

\`\`\`bash
npx thesmos tier
\`\`\`

You should see: ⚡ Thesmos — PREMIUM (full engine) · 1137 rules active.

## Per-project alternative

Prefer to unlock a single repo instead of the whole machine? Copy pack.json
into that project's \`.thesmos/premium/\` directory instead.

## CI

Set \`THESMOS_TIER=premium\` in your CI environment, or commit the project-level
\`.thesmos/premium/pack.json\` to your (private) repo.

---

Thank you for buying Thesmos. Lifetime updates — re-download anytime from your
Gumroad library. Questions: holley42@yahoo.com
`

const ROOT_README = (agentCount: number, tier: 'starter' | 'pantheon'): string => `# Thesmos ${tier === 'starter' ? 'Starter Pack' : 'Full Pantheon'} — Agent Bundle

${tier === 'starter'
  ? `This package contains **6 free starter agents** from the Thesmos Pantheon.
These are the best agents to start with — Zeus orchestrates, Athena strategises,
Argus handles security, Apollo writes, and Hephaestus designs.`
  : `This package contains **${agentCount} agents** from the complete Thesmos Pantheon —
every specialist, every domain, every platform — plus the **premium engine
unlock** that flips the free 288-rule Essentials CLI to the full 1,137-rule
engine. Start with premium/INSTALL.md (10 seconds), then deploy the gods.`}

## What's inside

| Folder | Platform | File type |
|---|---|---|
${tier === 'pantheon' ? '| premium/ | Full-engine unlock — 288 → 1,137 rules (see premium/INSTALL.md) | .json |\n' : ''}| for-claude/ | Claude Code (+ PANTHEON.md routing & live activity hooks) | .md |
| for-claude-ai/ | Claude.ai Projects (Zeus orchestrator + council bundles) | .txt |
| for-chatgpt/ | ChatGPT Custom GPTs (Zeus orchestrator + knowledge files) | .txt |
| for-gemini/ | Gemini Gems (+ Zeus Receptionist) | .txt |
| for-cursor/ | Cursor rules | .mdc |
| for-copilot/ | GitHub Copilot | .md |
| for-figma/ | Figma AI prompt cards | .txt |
| for-openai-api/ | OpenAI Assistants API definitions | .json |
| for-vscode/ | VS Code extension (live god activity panel) | .vsix |

Each folder contains an INSTALL.md with step-by-step setup instructions.

## Quick start

1. Pick your AI tool (Claude Code recommended)
2. Open the matching folder (e.g. for-claude/)
3. Read INSTALL.md
4. Copy the agent files into your project

## Feel the presence of the gods

Every agent opens with their identity banner, speaks with total domain expertise,
and signs their work. Zeus announces every routing decision before a god responds.
This is by design — you should always know which god is working for you.

## The Zeus orchestrators

Start with Zeus. Each platform has a Zeus entry point that routes to the right
specialist automatically:

- Claude Code: zeus-executive-agent + PANTHEON.md (routing announcements)
- ChatGPT: zeus-pantheon-orchestrator (one GPT, full Pantheon via knowledge files)
- Claude.ai: zeus-pantheon-orchestrator + council bundles
- Gemini: zeus-receptionist (routes you to the right Gem)
- Figma: zeus-figma-card (routes between the design gods in one session)

---

Thesmos Pantheon · https://holley.studio/thesmos
© Holley Studio. All rights reserved.
`

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function cleanDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

function collectAgentIds(srcDir: string, ext: string, filterFn?: (id: string) => boolean): string[] {
  if (!existsSync(srcDir)) return []
  return readdirSync(srcDir)
    .filter(f => f.endsWith(ext))
    .map(f => f.replace(ext, ''))
    .filter(id => filterFn ? filterFn(id) : true)
}

const VSIX_VERSION = '1.8.0'
const VSIX_PATH = resolve(__dirname, `../../extensions/vscode/thesmos-governance-vscode-${VSIX_VERSION}.vsix`)
// Hand-authored (not generated) kit sources live in pantheon/sources/ so they
// are version-controlled — unlike pantheon/exports/, which is regenerable and
// gitignored. Do not move this back under exports/.
const CLAUDE_EXTRAS_DIR = resolve(__dirname, '../../pantheon/sources/claude-extras')

const VSIX_INSTALL_GUIDE = `# Thesmos Governance — VS Code Extension

The included .vsix file adds real-time governance findings directly into VS Code.

## How to install

1. Open VS Code
2. Press Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)
3. Type: Install from VSIX
4. Select thesmos-governance-vscode-${VSIX_VERSION}.vsix from this folder
5. Reload VS Code when prompted

## What you get

- Inline BLOCKER / HIGH / MEDIUM findings as you code
- Agent Activity sidebar panel — Zeus dispatching gods live, with progress verbs
- Status bar routing chain (⚡ Zeus → 👁 Argus) while gods work
- Adapter sync status and health score display
- 1,137 rules across security, AI, performance, accessibility, and more

Pair with the for-claude/ setup (PANTHEON.md + hooks) for the full theatrical
experience — see for-claude/INSTALL.md.

## Updates

Check https://github.com/Holley-Studio/thesmos-governance/releases for new versions.
`

function buildBundle(
  bundleName: string,
  filterFn: (id: string) => boolean,
): { agentCount: number; zipPath: string } {
  const bundleDir = join(TMP_DIR, bundleName)
  cleanDir(bundleDir)

  // The reported "N agents" count must come from a platform that ships
  // exactly one file per god with no orchestrator/council meta-files mixed
  // in (claude-code is 1:1 with the catalog) — platforms like claude-project
  // or chatgpt also bundle Zeus orchestrators and council bundles in the same
  // directory, which would inflate a cross-platform max into counting
  // meta-files as if they were agents.
  const CANONICAL_COUNT_SOURCE = 'claude-code'
  let canonicalAgentCount = 0

  const tier = filterFn === freeFilter ? 'starter' : 'pantheon'

  for (const platform of PLATFORM_MAP) {
    const srcDir = join(EXPORTS_DIR, platform.srcDir)
    const destDir = join(bundleDir, platform.destDir)
    ensureDir(destDir)

    // Platforms with an empty guide ship their own INSTALL.md in srcDir
    if (platform.guide) {
      writeFileSync(join(destDir, 'INSTALL.md'), platform.guide, 'utf-8')
    } else if (existsSync(join(srcDir, 'INSTALL.md'))) {
      copyFileSync(join(srcDir, 'INSTALL.md'), join(destDir, 'INSTALL.md'))
    }

    const ids = collectAgentIds(srcDir, platform.ext, filterFn)
      // AGENTS.md is Codex's orchestrator convention file, not a per-god export.
      // pantheon-council-free-gpt-store is the free public GPT Store listing —
      // a separate marketing artifact, never bundled into a paid or vertical zip.
      .filter(id => id !== 'AGENTS' && id !== 'pantheon-council-free-gpt-store')
      // Incomplete god drops never ship — see HOLDBACK_AGENT_IDS above.
      .filter(id => !isHeldBack(id))
    if (platform.srcDir === CANONICAL_COUNT_SOURCE) canonicalAgentCount = ids.length

    for (const id of ids) {
      const src = join(srcDir, `${id}${platform.ext}`)
      const dest = join(destDir, `${id}${platform.ext}`)
      copyFileSync(src, dest)
    }

    // Codex always ships its AGENTS.md orchestrator regardless of filter
    if (platform.srcDir === 'codex' && existsSync(join(srcDir, 'AGENTS.md'))) {
      copyFileSync(join(srcDir, 'AGENTS.md'), join(destDir, 'AGENTS.md'))
    }
  }

  // Claude Code full-experience extras: PANTHEON.md + activity hook +
  // statusline script + settings snippet (see for-claude/INSTALL.md steps
  // 2–3 and 5). Paid bundle only.
  if (tier === 'pantheon' && existsSync(CLAUDE_EXTRAS_DIR)) {
    const claudeDir = join(bundleDir, 'for-claude')
    ensureDir(join(claudeDir, 'hooks'))
    copyFileSync(join(CLAUDE_EXTRAS_DIR, 'PANTHEON.md'), join(claudeDir, 'PANTHEON.md'))
    copyFileSync(join(CLAUDE_EXTRAS_DIR, 'hooks', 'agent-activity.cjs'), join(claudeDir, 'hooks', 'agent-activity.cjs'))
    copyFileSync(join(CLAUDE_EXTRAS_DIR, 'hooks', 'settings-snippet.json'), join(claudeDir, 'hooks', 'settings-snippet.json'))
    copyFileSync(join(CLAUDE_EXTRAS_DIR, 'hooks', 'statusline-pantheon.sh'), join(claudeDir, 'hooks', 'statusline-pantheon.sh'))
  }

  // Claude Code Agent Skills — 53 workflow rituals live in
  // pantheon/exports/skills/ (one directory per skill, SKILL.md inside).
  // The paid Full Pantheon bundle ships all 53; the starter
  // bundle gets exactly 3 as an upsell teaser.
  if (existsSync(SKILLS_EXPORT_DIR)) {
    const skillsDestDir = join(bundleDir, 'for-claude', 'skills')
    ensureDir(skillsDestDir)

    const allSkillIds = readdirSync(SKILLS_EXPORT_DIR)
      .filter((id) => existsSync(join(SKILLS_EXPORT_DIR, id, 'SKILL.md')))
    const skillIds = tier === 'starter'
      ? allSkillIds.filter((id) => STARTER_SAMPLE_SKILL_IDS.has(id))
      : allSkillIds

    for (const id of skillIds) {
      cpSync(join(SKILLS_EXPORT_DIR, id), join(skillsDestDir, id), { recursive: true })
    }

    writeFileSync(
      join(skillsDestDir, 'README.md'),
      tier === 'starter'
        ? `# Thesmos Skills — Starter Sample\n\n${skillIds.length} of the Pantheon's ${allSkillIds.length} workflow skills, included as a teaser:\n\n${skillIds.map((id) => `- ${id}`).join('\n')}\n\nEach skill is a directory with a SKILL.md — copy the ones you want into your project's .claude/skills/.\n\nThe full Pantheon pack ships all ${allSkillIds.length} skills: https://holley.studio/thesmos\n`
        : `# Thesmos Skills — Full Pack\n\nAll ${allSkillIds.length} Pantheon workflow skills, one directory per skill (Claude Code Agent Skills format).\n\nCopy the ones you want — or all of them — into your project's .claude/skills/.\n`,
      'utf-8',
    )
  }

  writeFileSync(
    join(bundleDir, 'README.md'),
    ROOT_README(canonicalAgentCount, tier),
    'utf-8',
  )

  // Include VS Code extension in the full Pantheon bundle only
  if (tier === 'pantheon' && existsSync(VSIX_PATH)) {
    const vsixDir = join(bundleDir, 'for-vscode')
    ensureDir(vsixDir)
    copyFileSync(VSIX_PATH, join(vsixDir, `thesmos-governance-vscode-${VSIX_VERSION}.vsix`))
    writeFileSync(join(vsixDir, 'INSTALL.md'), VSIX_INSTALL_GUIDE, 'utf-8')
  }

  // Premium engine unlock — the marker tiers.ts's hasPremiumPack() looks for.
  // Paid bundle only; its presence in ~/.thesmos/premium/ (or a project's
  // .thesmos/premium/) flips the CLI from 288 Essentials rules to all 1,137.
  if (tier === 'pantheon') {
    const premiumDir = join(bundleDir, 'premium')
    ensureDir(premiumDir)
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf-8')) as { version: string }
    writeFileSync(
      join(premiumDir, 'pack.json'),
      JSON.stringify(
        {
          product: 'thesmos-pantheon-full',
          tier: 'premium',
          engineVersion: pkg.version,
          purchasedFrom: 'https://holleystudio.gumroad.com/l/thesmos-pantheon',
          note: 'Presence of this file unlocks the full 1,137-rule engine. See INSTALL.md.',
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    )
    writeFileSync(join(premiumDir, 'INSTALL.md'), PREMIUM_INSTALL_GUIDE, 'utf-8')
  }

  // Only the free starter pack ships from the public website. The paid bundle
  // goes to dist-packs/ for manual Gumroad upload —
  // never committed, never served from holley.studio (Operation Clear Temple).
  const outDir = tier === 'starter' ? DOWNLOADS_DIR : DIST_PACKS_DIR
  ensureDir(outDir)
  const zipPath = join(outDir, `${bundleName}.zip`)

  if (existsSync(zipPath)) rmSync(zipPath)

  // thesmos-disable-next-line shell_injection -- reason: TMP_DIR/zipPath/bundleName are compile-time constants derived from import.meta.url, never user input -- owner: @MHolley
  // thesmos-disable-next-line child_process_shell_injection -- reason: same static constants, build script not shipped runtime -- owner: @MHolley
  execSync(`cd "${TMP_DIR}" && zip -r "${zipPath}" "${bundleName}"`, { stdio: 'pipe' })

  return { agentCount: canonicalAgentCount, zipPath }
}

function freeFilter(id: string): boolean {
  // -chatgpt-knowledge must be checked before -chatgpt (both are valid
  // suffixes of the same file family; the knowledge companion's suffix
  // doesn't end in plain "-chatgpt" so the shorter pattern alone would miss it).
  const bareId = id.replace(/-chatgpt-knowledge$|-chatgpt$|-gemini$|-claude-project$|-copilot$/, '')
  return FREE_AGENT_IDS.has(bareId)
}

function allFilter(): boolean {
  return true
}

function main(): void {
  console.log('\n⚡ Thesmos Agent Packager\n')

  ensureDir(TMP_DIR)

  const starter = buildBundle('thesmos-starter-agents', freeFilter)
  console.log(`  ✅ Starter pack     ${starter.agentCount} agents/platform → website/downloads/thesmos-starter-agents.zip`)

  const full = buildBundle('thesmos-pantheon-agents', allFilter)
  console.log(`  ✅ Full Pantheon    ${full.agentCount} agents/platform + premium engine unlock → dist-packs/thesmos-pantheon-agents.zip`)

  rmSync(TMP_DIR, { recursive: true, force: true })

  console.log('\n✅ Packaging complete.\n')
  console.log('Next steps:')
  console.log('  1. Upload dist-packs/thesmos-pantheon-agents.zip to Gumroad as the Full Pantheon product ($79)')
  console.log('  2. Only website/downloads/thesmos-starter-agents.zip is committed to the repo — the paid')
  console.log('     bundle in dist-packs/ is gitignored and distributed exclusively through Gumroad')
  console.log('  3. The zip\'s premium/pack.json is the full-engine unlock (288 → 1,137 rules) — see premium/INSTALL.md\n')
}

main()
