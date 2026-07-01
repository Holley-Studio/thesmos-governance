#!/usr/bin/env node
/**
 * Thesmos Pantheon agent export script.
 * Reads all agent .md files and converts them to tool-specific formats.
 *
 * Usage:
 *   tsx scripts/export-agents.ts                 # exports all 5 formats
 *   tsx scripts/export-agents.ts --format=cursor
 *   tsx scripts/export-agents.ts --format=copilot
 *   tsx scripts/export-agents.ts --format=claude-code
 *   tsx scripts/export-agents.ts --format=gpt
 *   tsx scripts/export-agents.ts --format=gemini
 *
 * Output (relative to repo root):
 *   pantheon/exports/cursor/       — Cursor .mdc rules files
 *   pantheon/exports/copilot/      — GitHub Copilot instruction files
 *   pantheon/exports/claude-code/  — Claude Code agent files (as-is)
 *   pantheon/exports/chatgpt/      — ChatGPT instruction files (.txt)
 *   pantheon/exports/gemini/       — Gemini Gem instruction files (.txt)
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const CATALOG_DIR = resolve(__dirname, '../catalog/agents')
const EXPORTS_DIR = resolve(__dirname, '../../pantheon/exports')

type Format = 'cursor' | 'copilot' | 'claude-code' | 'gpt' | 'gemini'

interface AgentMeta {
  id: string
  name: string
  role: string
  emoji: string
  vibe: string
  cursorGlobs: string
  tags: string[]
  enabled: boolean
  rawContent: string
  body: string
}

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

function parseFrontmatter(source: string): { meta: Record<string, unknown>; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: source }

  const [, rawYaml, body] = match
  const meta: Record<string, unknown> = {}
  const lines = rawYaml.split('\n')

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Top-level key: "value" or key: value
    const topKV = line.match(/^(\w[\w-]*):\s*(.+)$/)
    if (topKV) {
      const [, key, val] = topKV
      const clean = val.replace(/^["']|["']$/g, '')
      if (clean === 'true') meta[key] = true
      else if (clean === 'false') meta[key] = false
      else meta[key] = clean
      i++
      continue
    }

    // Top-level key with no inline value — array or sub-object follows
    const topKey = line.match(/^(\w[\w-]*):\s*$/)
    if (topKey) {
      const [, key] = topKey
      const items: string[] = []
      const subObj: Record<string, string> = {}
      i++
      while (i < lines.length && /^\s+/.test(lines[i])) {
        const sub = lines[i]
        const arrayItem = sub.match(/^\s+-\s+(.+)$/)
        const subKV = sub.match(/^\s+(\w[\w_-]*):\s+(.+)$/)
        if (arrayItem) {
          items.push(arrayItem[1].replace(/^["']|["']$/g, ''))
        } else if (subKV) {
          subObj[subKV[1]] = subKV[2].replace(/^["']|["']$/g, '')
        }
        i++
      }
      if (items.length > 0) meta[key] = items
      else if (Object.keys(subObj).length > 0) meta[key] = subObj
      continue
    }

    i++
  }

  return { meta, body: body.trim() }
}

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
    tags: Array.isArray(meta['tags']) ? (meta['tags'] as string[]) : [],
    enabled: meta['enabled'] !== false,
    rawContent: source,
    body,
  }
}

// ---------------------------------------------------------------------------
// Format converters
// ---------------------------------------------------------------------------

function toCursorMdc(agent: AgentMeta): string {
  const descParts = [agent.emoji, agent.name]
  if (agent.vibe) descParts.push(`— ${agent.vibe}`)
  const description = descParts.join(' ').replace(/"/g, "'")

  return [
    '---',
    `description: "${description}"`,
    `globs: "${agent.cursorGlobs}"`,
    'alwaysApply: false',
    '---',
    '',
    agent.body,
  ].join('\n')
}

function toCopilotInstructions(agent: AgentMeta): string {
  return [
    `<!-- ${agent.emoji} ${agent.name} | ${agent.role} -->`,
    `<!-- ${agent.vibe} -->`,
    `<!-- Tags: ${agent.tags.join(', ')} -->`,
    '',
    agent.body,
  ].join('\n')
}

function toGptInstructions(agent: AgentMeta): string {
  return agent.body
}

function toGeminiInstructions(agent: AgentMeta): string {
  return [`# ${agent.name} — Gemini Gem`, '', agent.body].join('\n')
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function collectAgentFiles(): string[] {
  const files: string[] = []
  const dirs = [CATALOG_DIR, join(CATALOG_DIR, 'pantheon')]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(join(dir, entry.name))
      }
    }
  }
  return files
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** Maps logical format name → {dir, ext, filenameFn} */
function formatConfig(format: Format): {
  dir: string
  ext: string
  filename: (id: string) => string
} {
  switch (format) {
    case 'cursor':
      return { dir: 'cursor', ext: '.mdc', filename: (id) => `${id}.mdc` }
    case 'copilot':
      return { dir: 'copilot', ext: '.md', filename: (id) => `${id}.md` }
    case 'claude-code':
      return { dir: 'claude-code', ext: '.md', filename: (id) => `${id}.md` }
    case 'gpt':
      return { dir: 'chatgpt', ext: '.txt', filename: (id) => `${id}-chatgpt.txt` }
    case 'gemini':
      return { dir: 'gemini', ext: '.txt', filename: (id) => `${id}-gemini.txt` }
  }
}

function exportFormat(agents: AgentMeta[], format: Format): { exported: number; skipped: number } {
  const cfg = formatConfig(format)
  const outDir = join(EXPORTS_DIR, cfg.dir)
  ensureDir(outDir)

  let exported = 0
  let skipped = 0

  for (const agent of agents) {
    if (!agent.id) { skipped++; continue }
    if (agent.enabled === false) { skipped++; continue }

    const outFile = join(outDir, cfg.filename(agent.id))

    let content: string
    if (format === 'cursor') {
      content = toCursorMdc(agent)
    } else if (format === 'copilot') {
      content = toCopilotInstructions(agent)
    } else if (format === 'gpt') {
      content = toGptInstructions(agent)
    } else if (format === 'gemini') {
      content = toGeminiInstructions(agent)
    } else {
      content = agent.rawContent
    }

    writeFileSync(outFile, content, 'utf-8')
    exported++
  }

  return { exported, skipped }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2)
  const formatArg = args.find(a => a.startsWith('--format='))
  const requestedFormat = formatArg ? (formatArg.split('=')[1] as Format) : null
  const formats: Format[] = requestedFormat
    ? [requestedFormat]
    : ['cursor', 'copilot', 'claude-code', 'gpt', 'gemini']

  const validFormats: Format[] = ['cursor', 'copilot', 'claude-code', 'gpt', 'gemini']
  for (const f of formats) {
    if (!validFormats.includes(f)) {
      console.error(`❌ Unknown format: ${f}. Valid options: ${validFormats.join(', ')}`)
      process.exit(1)
    }
  }

  const filePaths = collectAgentFiles()
  if (filePaths.length === 0) {
    console.error(`❌ No agent files found in ${CATALOG_DIR}`)
    process.exit(1)
  }

  const agents = filePaths.map(fp => extractMeta(readFileSync(fp, 'utf-8')))

  console.log(`\n⚡ Thesmos Agent Export`)
  console.log(`   ${agents.length} agent files discovered\n`)

  ensureDir(EXPORTS_DIR)

  for (const format of formats) {
    const { exported, skipped } = exportFormat(agents, format)
    const cfg = formatConfig(format)
    const label = format === 'cursor'
      ? 'Cursor (.mdc)'
      : format === 'copilot'
        ? 'GitHub Copilot'
        : format === 'gpt'
          ? 'ChatGPT (.txt)'
          : format === 'gemini'
            ? 'Gemini (.txt)'
            : 'Claude Code'
    console.log(`  ✅ ${label.padEnd(22)} ${exported} agents → pantheon/exports/${cfg.dir}/`)
    if (skipped > 0) console.log(`     ⏭  ${skipped} skipped (disabled or missing id)`)
  }

  console.log('\n✅ Export complete.\n')
}

main()
