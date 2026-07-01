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
])

const PLATFORM_MAP: Array<{ srcDir: string; destDir: string; ext: string; guide: string }> = [
  {
    srcDir: 'claude-code',
    destDir: 'for-claude',
    ext: '.md',
    guide: `# Installing Thesmos Agents in Claude Code

Each .md file in this folder is an agent definition for Claude Code.

## How to add an agent

1. In your project root, create a directory: .claude/agents/
2. Copy the .md files you want into .claude/agents/
3. Restart Claude Code — the agents will appear automatically

## Quick install (all agents)

cp *.md /path/to/your/project/.claude/agents/

## Individual agent install

cp zeus-executive-agent.md /path/to/your/project/.claude/agents/

Claude Code will discover and load agents from .claude/agents/ automatically.
The agent name shown in the UI matches the filename (without the .md extension).

Learn more: https://docs.anthropic.com/claude-code/agents
`,
  },
  {
    srcDir: 'chatgpt',
    destDir: 'for-chatgpt',
    ext: '.txt',
    guide: `# Installing Thesmos Agents as Custom GPTs in ChatGPT

Each .txt file in this folder contains instructions for one ChatGPT Custom GPT.

## How to create a Custom GPT

1. Go to https://chatgpt.com/gpts/editor
2. Click "Create a GPT"
3. Click "Configure" tab
4. Open the .txt file for the agent you want
5. Copy the entire contents into the "Instructions" field
6. Give the GPT the agent's name (e.g. "Ares — Sales Agent")
7. Click "Save"

## Tips

- You can create multiple Custom GPTs, one per agent
- For the full Pantheon experience, create all agents and use the Zeus agent
  to route tasks to the right specialist
- Custom GPTs can be kept private (only you) or shared

Learn more: https://help.openai.com/en/articles/8554397-creating-a-gpt
`,
  },
  {
    srcDir: 'gemini',
    destDir: 'for-gemini',
    ext: '.txt',
    guide: `# Installing Thesmos Agents as Gemini Gems

Each .txt file in this folder contains instructions for one Gemini Gem.

## How to create a Gem

1. Go to https://gemini.google.com/gems/new
2. Click "New Gem" or "Create a Gem"
3. Open the .txt file for the agent you want
4. Copy the entire contents into the "Instructions" field
5. Give the Gem the agent's name (e.g. "Ares — Sales Agent")
6. Click "Save"

## Tips

- Gems are private by default
- You can create as many Gems as your plan allows
- Use the Zeus Gem to orchestrate the full Pantheon

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
| for-claude/ | Claude Code | .md |
| for-chatgpt/ | ChatGPT Custom GPTs | .txt |
| for-gemini/ | Gemini Gems | .txt |
| for-cursor/ | Cursor rules | .mdc |
| for-copilot/ | GitHub Copilot | .md |

Each folder contains an INSTALL.md with step-by-step setup instructions.

## Quick start

1. Pick your AI tool (Claude Code recommended)
2. Open the matching folder (e.g. for-claude/)
3. Read INSTALL.md
4. Copy the agent files into your project

## The Zeus agent

Start with Zeus (zeus-executive-agent). Zeus orchestrates the entire Pantheon.
Tell Zeus what you need and he will route to the right specialist automatically.

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

function buildBundle(
  bundleName: string,
  filterFn: (id: string) => boolean,
): { agentCount: number; zipPath: string } {
  const bundleDir = join(TMP_DIR, bundleName)
  cleanDir(bundleDir)

  let maxAgentCount = 0

  for (const platform of PLATFORM_MAP) {
    const srcDir = join(EXPORTS_DIR, platform.srcDir)
    const destDir = join(bundleDir, platform.destDir)
    ensureDir(destDir)

    writeFileSync(join(destDir, 'INSTALL.md'), platform.guide, 'utf-8')

    const ids = collectAgentIds(srcDir, platform.ext, filterFn)
    maxAgentCount = Math.max(maxAgentCount, ids.length)

    for (const id of ids) {
      const src = join(srcDir, `${id}${platform.ext}`)
      const dest = join(destDir, `${id}${platform.ext}`)
      copyFileSync(src, dest)
    }
  }

  const tier = filterFn === freeFilter ? 'starter' : 'pantheon'
  writeFileSync(join(bundleDir, 'README.md'), ROOT_README(maxAgentCount, tier), 'utf-8')

  ensureDir(DOWNLOADS_DIR)
  const zipPath = join(DOWNLOADS_DIR, `${bundleName}.zip`)

  if (existsSync(zipPath)) rmSync(zipPath)

  execSync(`cd "${TMP_DIR}" && zip -r "${zipPath}" "${bundleName}"`, { stdio: 'pipe' })

  return { agentCount: maxAgentCount, zipPath }
}

function freeFilter(id: string): boolean {
  const bareId = id.replace(/-chatgpt$|-gemini$/, '')
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
