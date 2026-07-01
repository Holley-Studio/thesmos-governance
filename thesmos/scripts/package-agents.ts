#!/usr/bin/env node
/**
 * Thesmos Agent Packager.
 * Bundles exported agent files into two downloadable ZIPs:
 *
 *   website/downloads/thesmos-starter-agents.zip  — 5 free agents, all platforms
 *   website/downloads/thesmos-pantheon-agents.zip — ALL agents, all platforms
 *
 * The full ZIP is the Gumroad product file. The starter ZIP is a free download.
 * Both ZIPs include per-platform INSTALL.md guides.
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
  copyFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const EXPORTS_DIR  = resolve(__dirname, '../../pantheon/exports')
const DOWNLOADS_DIR = resolve(__dirname, '../../website/downloads')
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
])

const PLATFORM_MAP: Array<{ srcDir: string; destDir: string; ext: string; guide: string }> = [
  {
    srcDir: 'claude-code',
    destDir: 'for-claude',
    ext: '.md',
    guide: `# Installing Thesmos Agents in Claude Code — Full Experience

Four steps give you the complete theatrical Pantheon: Zeus routing announcements
in chat, the live god tree in the VS Code sidebar, and the routing chain in the
status bar.

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
   (create the file with exactly that content if it doesn't exist)

Every god dispatch now streams into .thesmos/agent-activity.jsonl.

## Step 4 — Install the VS Code extension

Install the .vsix from the for-vscode/ folder (Cmd+Shift+P → "Install from VSIX").
The Agent Activity panel shows Zeus dispatching gods live, and the status bar
displays the routing chain (⚡ Zeus → 👁 Argus) while they work.

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

1. Create a GPT → Configure
2. Paste the agent's .txt file (e.g. argus-security-agent-chatgpt.txt) into
   "Instructions"
3. Name it after the agent and save

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
]

const ROOT_README = (agentCount: number, tier: 'starter' | 'pantheon'): string => `# Thesmos ${tier === 'starter' ? 'Starter Pack' : 'Full Pantheon'} — Agent Bundle

${tier === 'starter'
  ? `This package contains **5 free starter agents** from the Thesmos Pantheon.
These are the best agents to start with — Zeus orchestrates, Athena strategises,
Argus handles security, Apollo writes, and Hephaestus designs.`
  : `This package contains **${agentCount} agents** from the complete Thesmos Pantheon.
Every specialist, every domain, every platform — ready to deploy.`}

## What's inside

| Folder | Platform | File type |
|---|---|---|
| for-claude/ | Claude Code (+ PANTHEON.md routing & live activity hooks) | .md |
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

const VSIX_VERSION = '1.6.0'
const VSIX_PATH = resolve(__dirname, `../../extensions/vscode/thesmos-governance-vscode-${VSIX_VERSION}.vsix`)
const CLAUDE_EXTRAS_DIR = resolve(__dirname, '../../pantheon/exports/claude-extras')

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
- 1,075 rules across security, AI, performance, accessibility, and more

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

  let maxAgentCount = 0

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
    maxAgentCount = Math.max(maxAgentCount, ids.length)

    for (const id of ids) {
      const src = join(srcDir, `${id}${platform.ext}`)
      const dest = join(destDir, `${id}${platform.ext}`)
      copyFileSync(src, dest)
    }
  }

  // Claude Code full-experience extras: PANTHEON.md + activity hook + settings
  // snippet (see for-claude/INSTALL.md steps 2–3). Full Pantheon bundle only.
  if (tier === 'pantheon' && existsSync(CLAUDE_EXTRAS_DIR)) {
    const claudeDir = join(bundleDir, 'for-claude')
    ensureDir(join(claudeDir, 'hooks'))
    copyFileSync(join(CLAUDE_EXTRAS_DIR, 'PANTHEON.md'), join(claudeDir, 'PANTHEON.md'))
    copyFileSync(join(CLAUDE_EXTRAS_DIR, 'hooks', 'agent-activity.cjs'), join(claudeDir, 'hooks', 'agent-activity.cjs'))
    copyFileSync(join(CLAUDE_EXTRAS_DIR, 'hooks', 'settings-snippet.json'), join(claudeDir, 'hooks', 'settings-snippet.json'))
  }

  writeFileSync(join(bundleDir, 'README.md'), ROOT_README(maxAgentCount, tier), 'utf-8')

  // Include VS Code extension in full Pantheon bundle only
  if (tier === 'pantheon' && existsSync(VSIX_PATH)) {
    const vsixDir = join(bundleDir, 'for-vscode')
    ensureDir(vsixDir)
    copyFileSync(VSIX_PATH, join(vsixDir, `thesmos-governance-vscode-${VSIX_VERSION}.vsix`))
    writeFileSync(join(vsixDir, 'INSTALL.md'), VSIX_INSTALL_GUIDE, 'utf-8')
  }

  ensureDir(DOWNLOADS_DIR)
  const zipPath = join(DOWNLOADS_DIR, `${bundleName}.zip`)

  if (existsSync(zipPath)) rmSync(zipPath)

  execSync(`cd "${TMP_DIR}" && zip -r "${zipPath}" "${bundleName}"`, { stdio: 'pipe' })

  return { agentCount: maxAgentCount, zipPath }
}

function freeFilter(id: string): boolean {
  const bareId = id.replace(/-chatgpt$|-gemini$|-claude-project$|-copilot$/, '')
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
  console.log(`  ✅ Full Pantheon    ${full.agentCount} agents/platform → website/downloads/thesmos-pantheon-agents.zip`)

  rmSync(TMP_DIR, { recursive: true, force: true })

  console.log('\n✅ Packaging complete.\n')
  console.log('Next steps:')
  console.log('  1. Upload website/downloads/thesmos-pantheon-agents.zip to Gumroad as your paid product')
  console.log('  2. Update the pro-tier CTA link in website/index.html with the Gumroad product URL')
  console.log('  3. Commit both ZIPs to the repo\n')
}

main()
