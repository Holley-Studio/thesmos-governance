#!/usr/bin/env node
/**
 * Thesmos starter-prompt extraction.
 *
 * Pure extraction, no new writing: pulls each free-tier god's "## Example
 * Tasks" section (or "## Trigger phrases" when Example Tasks doesn't exist,
 * e.g. Zeus) straight from its catalog .md source and reformats it into a
 * short, ready-to-paste starter-prompt file — one file per god, five
 * prompts each.
 *
 * Output: pantheon/exports/starters/<id>.md
 *
 * Usage:
 *   tsx scripts/extract-starters.ts
 *   npm run agents:starters
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const CATALOG_PANTHEON_DIR = resolve(__dirname, '../catalog/agents/pantheon')
const PANTHEON_MAP_PATH = resolve(__dirname, '../catalog/pantheon-map.json')
const STARTERS_OUT_DIR = resolve(__dirname, '../../pantheon/exports/starters')

// The 5 free-tier gods (see FREE_AGENT_IDS in package-agents.ts) — the front
// door to the Pantheon. Vertical/product meta-agents (zeus-pantheon-orchestrator,
// zeus-receptionist, zeus-figma-card) are excluded: they have no catalog
// "Example Tasks" / "Trigger phrases" section of their own to extract from.
const STARTER_AGENT_IDS = [
  'zeus-executive-agent',
  'athena-strategy-agent',
  'argus-security-agent',
  'apollo-content-agent',
  'hephaestus-design-agent',
]

const PROMPT_COUNT = 5

interface GodEntry {
  emoji: string
  name: string
  domain: string
}

function loadPantheonMap(): Record<string, GodEntry> {
  const raw = JSON.parse(readFileSync(PANTHEON_MAP_PATH, 'utf-8')) as { gods: Record<string, GodEntry> }
  return raw.gods
}

function godKey(id: string): string {
  return id.split('-')[0].toLowerCase()
}

/** Pull a single top-level frontmatter string value, e.g. `role: Executive Orchestration`. */
function frontmatterField(source: string, key: string): string {
  const match = source.match(new RegExp(`^${key}:\\s*"?([^"\\r\\n]+?)"?\\s*$`, 'm'))
  return match ? match[1].trim() : ''
}

/**
 * Extract the numbered/bulleted list items directly under a `## Heading`
 * (case-sensitive, matches the catalog convention) up to the next `## `
 * heading. Returns raw lines, list marker stripped, content otherwise
 * untouched — no rewriting.
 */
function extractListUnderHeading(body: string, headingPrefix: string): string[] {
  const headingMatch = body.match(new RegExp(`^##\\s+${headingPrefix}.*$`, 'm'))
  if (!headingMatch) return []

  const start = (headingMatch.index ?? 0) + headingMatch[0].length
  const rest = body.slice(start)
  const nextHeadingIdx = rest.search(/^##\s+/m)
  const section = nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx)

  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean)
  const items: string[] = []
  for (const line of lines) {
    const numbered = line.match(/^\d+\.\s+(.*)$/)
    const bulleted = line.match(/^-\s+(.*)$/)
    if (numbered) items.push(numbered[1])
    else if (bulleted) items.push(bulleted[1])
  }
  return items
}

function buildStarterFile(id: string, godMap: Record<string, GodEntry>): { content: string; source: string } | null {
  const filePath = join(CATALOG_PANTHEON_DIR, `${id}.md`)
  if (!existsSync(filePath)) return null

  const source = readFileSync(filePath, 'utf-8')
  const god = godMap[godKey(id)]
  const emoji = frontmatterField(source, 'emoji') || god?.emoji || ''
  const name = god?.name || frontmatterField(source, 'god') || id
  const role = frontmatterField(source, 'role') || god?.domain || 'Thesmos Pantheon'

  let items = extractListUnderHeading(source, 'Example Tasks')
  let sourceSection = 'Example Tasks'
  if (items.length === 0) {
    items = extractListUnderHeading(source, 'Trigger phrases')
    sourceSection = 'Trigger phrases'
  }
  items = items.slice(0, PROMPT_COUNT)
  if (items.length === 0) return null

  const numbered = items.map((item, i) => `${i + 1}. ${item}`).join('\n')

  const content = `# ${emoji} ${name} — ${role} — Starter Prompts

${items.length} ready-to-use prompts to start a session with ${name} (${role}).
Extracted verbatim from the "${sourceSection}" section of the agent's own
specification — pure extraction, nothing rewritten.

${numbered}

---

Thesmos Pantheon — Free Starter Pack · https://holley.studio/thesmos
`

  return { content, source: sourceSection }
}

function main(): void {
  const godMap = loadPantheonMap()
  if (!existsSync(STARTERS_OUT_DIR)) mkdirSync(STARTERS_OUT_DIR, { recursive: true })

  console.log('\n⚡ Thesmos Starter Prompt Extraction\n')

  let exported = 0
  let skipped = 0

  for (const id of STARTER_AGENT_IDS) {
    const result = buildStarterFile(id, godMap)
    if (!result) {
      console.warn(`  ⚠️  ${id}: no Example Tasks/Trigger phrases section found — skipped`)
      skipped++
      continue
    }
    writeFileSync(join(STARTERS_OUT_DIR, `${id}.md`), result.content, 'utf-8')
    console.log(`  ✅ ${id.padEnd(28)} 5 prompts from "${result.source}" → pantheon/exports/starters/${id}.md`)
    exported++
  }

  console.log(`\n✅ ${exported} starter file(s) written, ${skipped} skipped.\n`)
}

main()
