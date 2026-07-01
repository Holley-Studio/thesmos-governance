#!/usr/bin/env node
/**
 * Thesmos Pantheon agent export script.
 * Reads all agent .md files and converts them to tool-specific formats.
 *
 * Usage:
 *   tsx scripts/export-agents.ts                 # exports all formats
 *   tsx scripts/export-agents.ts --format=cursor
 *   tsx scripts/export-agents.ts --format=copilot
 *   tsx scripts/export-agents.ts --format=claude-code
 *   tsx scripts/export-agents.ts --format=gpt
 *   tsx scripts/export-agents.ts --format=gemini
 *   tsx scripts/export-agents.ts --format=claude-project
 *   tsx scripts/export-agents.ts --format=gpt-clusters
 *
 * Output (relative to repo root):
 *   pantheon/exports/cursor/           — Cursor .mdc rules files
 *   pantheon/exports/copilot/          — GitHub Copilot instruction files
 *   pantheon/exports/claude-code/      — Claude Code agent files (as-is)
 *   pantheon/exports/chatgpt/          — ChatGPT instruction files (.txt)
 *   pantheon/exports/gemini/           — Gemini Gem instruction files (.txt)
 *   pantheon/exports/claude-project/   — Claude.ai Project instruction files (.txt)
 *   pantheon/exports/chatgpt-clusters/ — Cluster knowledge files for the Zeus GPT (.txt)
 *
 * Every per-agent export carries the agent's Response Identity Protocol
 * (from the catalog source) plus a generated Anti-Drift Protocol so the
 * theatrical presence survives long conversations on every platform.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const CATALOG_DIR = resolve(__dirname, '../catalog/agents')
const PANTHEON_MAP_PATH = resolve(__dirname, '../catalog/pantheon-map.json')
const EXPORTS_DIR = resolve(__dirname, '../../pantheon/exports')

type Format =
  | 'cursor'
  | 'copilot'
  | 'claude-code'
  | 'gpt'
  | 'gemini'
  | 'claude-project'
  | 'gpt-clusters'

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

interface GodEntry {
  emoji: string
  name: string
  domain: string
  progressVerb: string
}

// ---------------------------------------------------------------------------
// Canonical pantheon map
// ---------------------------------------------------------------------------

function loadPantheonMap(): Record<string, GodEntry> {
  try {
    const raw = JSON.parse(readFileSync(PANTHEON_MAP_PATH, 'utf-8')) as {
      gods: Record<string, GodEntry>
    }
    return raw.gods
  } catch {
    return {}
  }
}

const PANTHEON_MAP = loadPantheonMap()

/** Resolve the god-map key for an agent — first word of its id. */
function godKey(agent: AgentMeta): string {
  return agent.id.split('-')[0].toLowerCase()
}

function godEmoji(agent: AgentMeta): string {
  if (agent.emoji) return agent.emoji
  return PANTHEON_MAP[godKey(agent)]?.emoji ?? '🔮'
}

function godName(agent: AgentMeta): string {
  return PANTHEON_MAP[godKey(agent)]?.name ?? agent.name.replace(/^God Agent /, '').split(' — ')[0]
}

function godDomain(agent: AgentMeta): string {
  return agent.role || PANTHEON_MAP[godKey(agent)]?.domain || 'Thesmos Pantheon'
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
// Identity sections — Response Identity Protocol + Anti-Drift Protocol
// ---------------------------------------------------------------------------

/**
 * Generated Response Identity Protocol for agents whose catalog source lacks
 * one (currently the Figma line). Matches the hand-written protocol format
 * used across the pantheon.
 */
function buildResponseIdentity(agent: AgentMeta): string {
  const emoji = godEmoji(agent)
  const name = godName(agent)
  const domain = godDomain(agent)
  const upperName = name.toUpperCase()
  const upperDomain = domain.toUpperCase()

  return `## Response Identity Protocol

Every response you send must carry your identity. Never respond as a generic assistant.

Open every response with:
\`\`\`
${emoji} ${upperName} — ${upperDomain}
\`\`\`

Attribute your work in first person. When Zeus summarises your work, you will be
referenced as: "${name} has delivered: [finding]."

Close every substantive response with:
\`\`\`
— ${name} | ${domain}
Thesmos check: [rules actually assessed] ✅
\`\`\``
}

/**
 * Anti-Drift Protocol v2 — appended to every per-agent export. Keeps the
 * theatrical presence alive across long conversations on every platform.
 */
function buildAntiDrift(agent: AgentMeta): string {
  const emoji = godEmoji(agent)
  const name = godName(agent)
  const domain = godDomain(agent)
  const upperName = name.toUpperCase()
  const upperDomain = domain.toUpperCase()

  return `## Anti-Drift Protocol

These rules keep your identity intact across the entire conversation:

**1. Banner cadence is deterministic.** Full banner on your first response and on any
domain shift. Compact banner otherwise: \`${emoji} ${name}:\` → substance → \`— ${name} | ${domain}\`.
The banner may include a state line: \`${emoji} ${upperName} — ${upperDomain} · [phase] · [status]\`.
It never disappears.

**2. Never break character — with one exception.** Never say "As an AI", "I'm a language
model", or any variant. You are ${name}. If asked what you are: "I am ${name},
${domain} of the Thesmos Pantheon." EXCEPTION: if the user explicitly asks you to drop
the persona or answer plainly, comply for that one message, then resume with the
re-anchor line below. A persona the user cannot switch off is a toy; user control is trust.

**3. Concede facts instantly; hold judgments.** Concede factual errors immediately and
without ceremony. Hold your recommendations unless new evidence arrives — never reverse
merely because the user pushed back. When holding your position, state what evidence
WOULD change your ruling.

**4. No filler.** Never open with "Great question!", "Certainly!", "I'd be happy to…",
or "That's a great point." Substance first, always.

**5. Scripted re-anchor.** If any prior response lacked your banner, open the next one with:
"The mist clears. ${emoji} ${upperName} — ${upperDomain} resumes the watch." Then continue.

**6. Honest badges only.** Your closing \`Thesmos check:\` line lists ONLY rules you
actually assessed in that response. "Thesmos check: no applicable rules this response"
is a valid and honest close. One rubber-stamped ✅ makes every badge noise.`
}

/** Compose the identity block to append to an export body. */
function identityBlock(agent: AgentMeta): string {
  const parts: string[] = []
  if (!agent.body.includes('## Response Identity Protocol')) {
    parts.push(buildResponseIdentity(agent))
  }
  if (!agent.body.includes('## Anti-Drift Protocol')) {
    parts.push(buildAntiDrift(agent))
  }
  return parts.join('\n\n')
}

function withIdentity(content: string, agent: AgentMeta): string {
  const block = identityBlock(agent)
  return block ? `${content}\n\n${block}\n` : `${content}\n`
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

function toClaudeProjectInstructions(agent: AgentMeta): string {
  // Single H1 header (the hand-made predecessors had a duplicate-H1 bug).
  const body = agent.body.replace(/^# .+\r?\n+/, '')
  return [`# ${godEmoji(agent)} ${godName(agent)} — ${godDomain(agent)}`, '', body].join('\n')
}

// ---------------------------------------------------------------------------
// Cluster knowledge files — for the Zeus Custom GPT (two-layer architecture)
// ---------------------------------------------------------------------------

/**
 * Cluster assignments. ChatGPT Custom GPTs allow max 20 knowledge files;
 * 57 agents consolidate into these clusters. RAG chunks files regardless,
 * so consolidation costs nothing — but every section header must carry the
 * god's identity so any retrieved chunk stays in character.
 */
const CLUSTERS: Record<string, string[]> = {
  'sales': [
    'ares-sales-agent', 'ares-discovery-agent', 'ares-deal-strategy-agent',
    'ares-pipeline-agent', 'nike-leadgen-agent', 'heracles-crm-agent',
  ],
  'strategy': [
    'athena-strategy-agent', 'alecto-competitive-agent', 'coeus-ideation-agent',
    'momus-challenger-agent', 'metis-pm-agent',
  ],
  'marketing-growth': [
    'hermes-marketing-agent', 'psyche-seo-agent', 'nike-social-agent',
    'clio-case-study-agent', 'calliope-email-agent',
  ],
  'content-brand': [
    'apollo-content-agent', 'erato-brand-voice-agent', 'aphrodite-creative-agent',
    'pheme-pr-agent',
  ],
  'finance-legal': [
    'plutus-finance-agent', 'plutus-billing-agent', 'chrysos-stripe-agent',
    'themis-legal-agent',
  ],
  'security-compliance': [
    'argus-security-agent', 'nemesis-compliance-agent', 'dike-ethics-agent',
  ],
  'product-design': [
    'daedalus-product-agent', 'hephaestus-design-agent', 'psyche-research-agent',
  ],
  'engineering': [
    'talos-web-dev-agent', 'chiron-architecture-agent', 'kratos-devops-agent',
    'kronos-github-agent', 'cassandra-qa-agent', 'notus-vercel-agent',
    'pontus-supabase-agent', 'atlas-integration-agent', 'eos-automation-agent',
  ],
  'data-analytics': [
    'tyche-analytics-agent', 'pythia-data-agent',
  ],
  'people-ops': [
    'hera-operations-agent', 'hera-recruiting-agent', 'hestia-cx-agent',
    'demeter-cs-agent', 'heracles-bd-agent', 'mnemosyne-knowledge-agent',
    'polyhymnia-docs-agent',
  ],
  'creative-visual': [
    'artemis-photography-agent', 'dionysus-video-agent', 'morpheus-animation-agent',
    'pygmalion-blender-agent', 'helios-keyshot-agent',
  ],
  'ai-orchestration': [
    'zeus-executive-agent', 'aether-ai-strategy-agent', 'proteus-drift-agent',
  ],
  'figma': [
    'eidos-figma-orchestrator', 'techne-design-system', 'kairos-prototype-engineer',
    'kinesis-motion-systems', 'logos-ux-research', 'hyle-shader-material',
    'morphe-weave-workflow', 'praxis-figma-make', 'mnemon-context-librarian',
    'ergon-code-layers',
  ],
}

/**
 * Rewrite an agent body so every section header carries the god's identity —
 * a RAG chunk retrieved in isolation still knows who is speaking.
 */
function toClusterSection(agent: AgentMeta): string {
  const emoji = godEmoji(agent)
  const name = godName(agent).toUpperCase()
  const body = agent.body
    .replace(/^# .+$/m, '')
    .replace(/^## (.+)$/gm, `## ${emoji} ${name} — $1`)
    .trim()

  return [
    `# ${emoji} ${name} — ${godDomain(agent)}`,
    '',
    body,
    '',
    withIdentity('', agent).trim(),
  ].join('\n')
}

function exportClusters(agents: AgentMeta[]): { exported: number; skipped: number } {
  const outDir = join(EXPORTS_DIR, 'chatgpt-clusters')
  ensureDir(outDir)

  const byId = new Map(agents.map(a => [a.id, a]))
  const assigned = new Set(Object.values(CLUSTERS).flat())
  let exported = 0

  for (const [cluster, ids] of Object.entries(CLUSTERS)) {
    const members = ids.map(id => byId.get(id)).filter((a): a is AgentMeta => !!a && a.enabled)
    if (members.length === 0) continue

    const header = [
      `# THESMOS PANTHEON — ${cluster.toUpperCase().replace(/-/g, ' ')} CLUSTER`,
      '',
      'This knowledge file contains the complete expertise specifications for the gods below.',
      'When Zeus routes to one of these gods, apply their full methodology, output contract,',
      'voice, and governance scope exactly as specified in their sections.',
      '',
      members.map(a => `- ${godEmoji(a)} **${godName(a)}** — ${godDomain(a)}`).join('\n'),
      '',
      '---',
      '',
    ].join('\n')

    const content = header + members.map(toClusterSection).join('\n\n---\n\n') + '\n'
    writeFileSync(join(outDir, `pantheon-${cluster}-cluster.txt`), content, 'utf-8')
    exported++
  }

  // Warn about unassigned agents so new gods don't silently vanish from the GPT.
  const unassigned = agents.filter(a => a.id && a.enabled && !assigned.has(a.id))
  for (const a of unassigned) {
    console.warn(`  ⚠️  ${a.id} is not assigned to any cluster — add it to CLUSTERS in export-agents.ts`)
  }

  return { exported, skipped: unassigned.length }
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

function collectAgentFiles(): string[] {
  const files: string[] = []
  const dirs = [CATALOG_DIR, join(CATALOG_DIR, 'pantheon'), join(CATALOG_DIR, 'figma')]
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.includes('README')) {
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
function formatConfig(format: Exclude<Format, 'gpt-clusters'>): {
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
    case 'claude-project':
      return { dir: 'claude-project', ext: '.txt', filename: (id) => `${id}-claude-project.txt` }
  }
}

function exportFormat(
  agents: AgentMeta[],
  format: Exclude<Format, 'gpt-clusters'>,
): { exported: number; skipped: number } {
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
      content = withIdentity(toCursorMdc(agent), agent)
    } else if (format === 'copilot') {
      content = withIdentity(toCopilotInstructions(agent), agent)
    } else if (format === 'gpt') {
      content = withIdentity(toGptInstructions(agent), agent)
    } else if (format === 'gemini') {
      content = withIdentity(toGeminiInstructions(agent), agent)
    } else if (format === 'claude-project') {
      content = withIdentity(toClaudeProjectInstructions(agent), agent)
    } else {
      content = withIdentity(agent.rawContent.trimEnd(), agent)
    }

    writeFileSync(outFile, content, 'utf-8')
    exported++
  }

  return { exported, skipped }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const ALL_FORMATS: Format[] = [
  'cursor', 'copilot', 'claude-code', 'gpt', 'gemini', 'claude-project', 'gpt-clusters',
]

const FORMAT_LABELS: Record<Format, string> = {
  'cursor': 'Cursor (.mdc)',
  'copilot': 'GitHub Copilot',
  'claude-code': 'Claude Code',
  'gpt': 'ChatGPT (.txt)',
  'gemini': 'Gemini (.txt)',
  'claude-project': 'Claude.ai Project (.txt)',
  'gpt-clusters': 'Zeus GPT clusters (.txt)',
}

function main(): void {
  const args = process.argv.slice(2)
  const formatArg = args.find(a => a.startsWith('--format='))
  const requestedFormat = formatArg ? (formatArg.split('=')[1] as Format) : null
  const formats: Format[] = requestedFormat ? [requestedFormat] : ALL_FORMATS

  for (const f of formats) {
    if (!ALL_FORMATS.includes(f)) {
      console.error(`❌ Unknown format: ${f}. Valid options: ${ALL_FORMATS.join(', ')}`)
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
    const { exported, skipped } = format === 'gpt-clusters'
      ? exportClusters(agents)
      : exportFormat(agents, format)
    const dir = format === 'gpt-clusters' ? 'chatgpt-clusters' : formatConfig(format).dir
    console.log(`  ✅ ${FORMAT_LABELS[format].padEnd(26)} ${exported} → pantheon/exports/${dir}/`)
    if (skipped > 0) console.log(`     ⏭  ${skipped} skipped`)
  }

  console.log('\n✅ Export complete.\n')
}

main()
