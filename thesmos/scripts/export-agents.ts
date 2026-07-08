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
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

const CATALOG_DIR = resolve(__dirname, '../catalog/agents')
const SKILLS_CATALOG_DIR = resolve(__dirname, '../catalog/skills')
const PANTHEON_MAP_PATH = resolve(__dirname, '../catalog/pantheon-map.json')
const EXPORTS_DIR = resolve(__dirname, '../../pantheon/exports')

// The generated model registry is written into every runtime consumer so each
// resolves an agent's Claude model from ONE source (the catalog), never a
// hand-maintained list. Add a path here to make a new consumer catalog-driven.
const MODEL_REGISTRY_TARGETS = [
  resolve(__dirname, '../generated/pantheon-models.ts'),
  resolve(__dirname, '../../extensions/vscode/src/generated/pantheon-models.ts'),
]

type Format =
  | 'cursor'
  | 'copilot'
  | 'claude-code'
  | 'gpt'
  | 'gemini'
  | 'claude-project'
  | 'gpt-clusters'
  | 'openai-assistants'
  | 'codex'
  | 'skills'
  | 'models'

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
  /** Rule IDs from the agent's governance.rules frontmatter (e.g. AGNT_001). */
  governanceRules: string[]
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
    // Strip any [1m] long-context suffix defensively — exports never opt into
    // the 1M context window (AGNT_037 guard; premium pricing).
    claudeModel: (platforms['claude_model'] ?? 'claude-sonnet-5').replace(/\[1m\]/g, ''),
    openaiModel: (platforms['openai_model'] ?? 'gpt-5.5').replace(/\[1m\]/g, ''),
    tags: Array.isArray(meta['tags']) ? (meta['tags'] as string[]) : [],
    governanceRules: extractGovernanceRules(source),
    enabled: meta['enabled'] !== false,
    rawContent: source,
    body,
  }
}

/**
 * Pull rule IDs from the nested governance.rules frontmatter block — the
 * simple frontmatter parser doesn't descend into nested lists.
 */
function extractGovernanceRules(source: string): string[] {
  const block = source.match(/^governance:\s*\n\s+rules:\s*\n((?:\s+-\s+\S+\s*\n)+)/m)
  if (!block) return []
  return [...block[1].matchAll(/-\s+([A-Z]+_\d+)/g)].map((m) => m[1])
}

/** Named governance badge, e.g. "AGNT_001 ✅ | AGNT_006 ✅". */
function badgeFor(agent: AgentMeta): string {
  const rules = agent.governanceRules.slice(0, 4)
  return rules.length > 0
    ? rules.map((r) => `${r} ✅`).join(' | ')
    : '[rules actually assessed] ✅'
}

/** Map a full claude model ID to the Claude Code frontmatter alias. */
function claudeCodeAlias(claudeModel: string): string {
  if (claudeModel.includes('fable')) return 'fable'
  if (claudeModel.includes('opus')) return 'opus'
  if (claudeModel.includes('haiku')) return 'haiku'
  return 'sonnet'
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
Thesmos check: ${badgeFor(agent)}
\`\`\`

Your governance scope is ${agent.governanceRules.length > 0 ? agent.governanceRules.join(', ') : 'the Thesmos ruleset'} —
name the rules you actually assessed; "no applicable rules this response" is a valid close.`
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
actually assessed in that response${agent.governanceRules.length > 0 ? ` — your named scope is ${agent.governanceRules.join(', ')}` : ''}.
"Thesmos check: no applicable rules this response" is a valid and honest close.
One rubber-stamped ✅ makes every badge noise.`
}

/**
 * ChatGPT Custom GPTs cap the Instructions field at 8,000 characters — every
 * per-god catalog body (Protocol/Tools/Example Tasks/Handoffs sections) plus
 * the identity block runs 15k-30k, 2-4x over budget. Rather than gut that
 * depth to fit a text box, this generates a short (~1,500 char) Instructions
 * companion that tells the model to retrieve the full spec from a Knowledge
 * file upload instead — the exact pattern the Zeus orchestrator already uses
 * for its 13 domain-cluster knowledge files. See toGptKnowledge() below for
 * the full-content half of this pair.
 */
function buildGptShortInstructions(agent: AgentMeta): string {
  const emoji = godEmoji(agent)
  const name = godName(agent)
  const domain = godDomain(agent)
  const upperName = name.toUpperCase()
  const upperDomain = domain.toUpperCase()
  const vibe = agent.vibe ? ` ${agent.vibe}` : ''

  return `# ${emoji} ${name} — ${domain}

You are ${name}, ${domain} of the Thesmos Pantheon.${vibe}

Your complete specification — methodology, output contract, tools, and voice —
is in your knowledge file. Before responding, retrieve it and apply it in
full. Do not improvise a lighter version from this summary alone.

## Response rules

1. Banner cadence: full banner on your first response and any domain shift;
   compact after: \`${emoji} ${name}:\` → substance → \`— ${name} | ${domain}\`.
2. Never say "As an AI" or any variant — you are ${name}. If asked to drop
   the persona, comply for one message, then resume: "The mist clears.
   ${emoji} ${upperName} — ${upperDomain} resumes the watch."
3. Concede facts instantly; hold judgments unless new evidence arrives —
   state what evidence would change your ruling.
4. No filler — no "Great question!" or "I'd be happy to." Substance first.
5. Honest badges only: \`Thesmos check: [rule IDs] ✅\` lists ONLY rules you
   actually assessed${agent.governanceRules.length > 0 ? ` (your named scope: ${agent.governanceRules.join(', ')})` : ''}.
   "No applicable rules this response" is a valid, honest close.

— ${name} | ${domain}`
}

/**
 * Operating Doctrine — architectural persona framing + direct-action language.
 * Persona research (PRISM 2026, Wharton GAIL 2025): personas framed as
 * behavioral constraints outperform theatrical framing; explicit output
 * specs are required for literal-instruction models (GPT-5.5) and benefit
 * Claude 5 equally.
 */
function buildOperatingDoctrine(agent: AgentMeta): string {
  const name = godName(agent)
  const domain = godDomain(agent)

  return `## Operating Doctrine

**Epistemic stance.** You adopt the epistemic stance and methodology of ${name} — this
constrains how you reason and what you produce, not just how you sound. Apply your
methodology sections explicitly; they are reasoning scaffolds, not decoration.

**Direct action.** State findings and produce the work product directly. Do not ask
permission to proceed on work that is clearly within your ${domain} scope. Offer
follow-ups after delivering, not before.

**Output Specification.**
- Format: markdown; headings for reports, prose for conversation
- Open with your identity banner (full on first response and domain shifts, compact after)
- Rank findings and recommendations by severity or impact — never unordered lists of equals
- State concrete next steps; every deliverable names its owner and success criteria
- Length: match the task — a verdict needs a paragraph, a review needs the full contract`
}

/** Compose the identity block to append to an export body. */
function identityBlock(agent: AgentMeta): string {
  const parts: string[] = []
  if (!agent.body.includes('## Response Identity Protocol')) {
    parts.push(buildResponseIdentity(agent))
  }
  if (!agent.body.includes('## Operating Doctrine')) {
    parts.push(buildOperatingDoctrine(agent))
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
  return buildGptShortInstructions(agent)
}

/**
 * The full-depth companion to toGptInstructions() — uploaded as a ChatGPT
 * Knowledge file, not pasted into Instructions. This is the content that
 * used to BE the Instructions file before the 8,000-character limit fix;
 * nothing here is new, it's the same agent.body + identity block, just
 * loaded a different way.
 */
function toGptKnowledge(agent: AgentMeta): string {
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

/**
 * Claude Code native subagent format — REQUIRED frontmatter is `name` +
 * `description`; `model` takes the alias (sonnet/opus/haiku/fable). Raw
 * Thesmos catalog frontmatter does not register as a subagent.
 */
function toClaudeCodeAgent(agent: AgentMeta): string {
  const name = godName(agent)
  const domain = godDomain(agent)
  const triggers = agent.tags.filter(t => t !== 'pantheon').slice(0, 5).join(', ')
  const description = `${domain}. Invoke for ${triggers || domain.toLowerCase()} tasks. Responds in character as ${name} of the Thesmos Pantheon.`
  const body = agent.body.replace(/^# .+\r?\n+/, '')

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
    body,
  ].join('\n')
}

/** OpenAI Assistants API definition (Responses API compatible model string). */
function toOpenAiAssistant(agent: AgentMeta): string {
  const body = agent.body.replace(/^# .+\r?\n+/, '')
  const instructions = withIdentity(
    [`# ${godEmoji(agent)} ${godName(agent)} — ${godDomain(agent)}`, '', body].join('\n'),
    agent,
  ).trimEnd()

  return JSON.stringify(
    {
      name: `${godName(agent)} — ${godDomain(agent)}`,
      instructions,
      model: agent.openaiModel,
      metadata: {
        thesmos_version: '3.0.0',
        agent_version: '1.0.0',
        pantheon: 'true',
        god: godName(agent),
        role: godDomain(agent),
      },
    },
    null,
    2,
  ) + '\n'
}

/** Codex per-agent file — plain markdown, AGENTS.md ecosystem convention. */
function toCodexAgent(agent: AgentMeta): string {
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
    'asclepius-debugging-agent',
  ],
  'data-analytics': [
    'tyche-analytics-agent', 'pythia-data-agent',
  ],
  'people-ops': [
    'hera-operations-agent', 'hera-recruiting-agent', 'hestia-cx-agent',
    'demeter-cs-agent', 'heracles-bd-agent', 'mnemosyne-knowledge-agent',
    'polyhymnia-docs-agent', 'hebe-support-agent',
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
// Skills export — thesmos/catalog/skills/*.md -> pantheon/exports/skills/
// ---------------------------------------------------------------------------

interface SkillMeta {
  id: string
  name: string
  /** Full markdown body after the frontmatter block (Purpose, When to use, etc.) */
  rawBody: string
}

function collectSkillFiles(): string[] {
  if (!existsSync(SKILLS_CATALOG_DIR)) return []
  return readdirSync(SKILLS_CATALOG_DIR)
    .filter((f) => f.endsWith('.md') && !f.includes('README'))
    .map((f) => join(SKILLS_CATALOG_DIR, f))
}

function extractSkillMeta(source: string): SkillMeta {
  const { meta, body } = parseFrontmatter(source)
  return {
    id: String(meta['id'] ?? ''),
    name: String(meta['name'] ?? ''),
    rawBody: body,
  }
}

/**
 * First paragraph after "## Purpose" — used as the Claude Code Agent Skill
 * `description` field (required, <=1024 chars). The catalog skill format has
 * no dedicated description field, so this is synthesised rather than copied.
 */
function extractSkillPurpose(body: string): string {
  const match = body.match(/##\s*Purpose\s*\n+([^\n]+(?:\n(?!\s*\n|##)[^\n]+)*)/i)
  const text = match ? match[1].replace(/\s+/g, ' ').trim() : ''
  return text.slice(0, 500)
}

/**
 * Claude Code Agent Skills format: one directory per skill containing
 * SKILL.md with required `name` + `description` frontmatter. This is a
 * near-passthrough of the catalog source with two deliberate changes:
 *  - `name` uses the catalog `id` (already lowercase-hyphen — matches the
 *    Skill naming convention) instead of the catalog's Title Case `name`
 *  - `description` is synthesised from the "## Purpose" section since the
 *    catalog frontmatter has no description field
 * Everything else — Purpose, When to use, Workflow steps, Thesmos commands,
 * Related agents/rule packs — ships verbatim as the SKILL.md body.
 *
 * ASSUMPTION [flagged for Zeus]: Claude Code's Agent Skills spec (as of this
 * writing) expects a directory-per-skill layout (<skill>/SKILL.md). If a
 * future spec revision changes this, only this function needs to change —
 * the catalog source and packager consumption (skill IDs, directory names)
 * are unaffected.
 */
function toSkillMd(skill: SkillMeta): string {
  const description = extractSkillPurpose(skill.rawBody) || skill.name
  return (
    [
      '---',
      `name: ${skill.id}`,
      `description: ${description.replace(/:/g, ' —')}`,
      '---',
      '',
      skill.rawBody,
    ].join('\n') + '\n'
  )
}

function exportSkills(): { exported: number; skipped: number } {
  const files = collectSkillFiles()
  const outDir = join(EXPORTS_DIR, 'skills')
  ensureDir(outDir)

  let exported = 0
  let skipped = 0

  for (const fp of files) {
    const skill = extractSkillMeta(readFileSync(fp, 'utf-8'))
    if (!skill.id) {
      skipped++
      continue
    }
    const skillDir = join(outDir, skill.id)
    ensureDir(skillDir)
    writeFileSync(join(skillDir, 'SKILL.md'), toSkillMd(skill), 'utf-8')
    exported++
  }

  return { exported, skipped }
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
function formatConfig(format: Exclude<Format, 'gpt-clusters' | 'skills' | 'models'>): {
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
    case 'openai-assistants':
      return { dir: 'openai-assistants', ext: '.json', filename: (id) => `${id}-openai-assistant.json` }
    case 'codex':
      return { dir: 'codex', ext: '.md', filename: (id) => `${id}.md` }
  }
}

/**
 * Codex AGENTS.md — the orchestrator file Codex reads at repo root.
 * Routes tasks to the god files that live alongside it.
 */
function buildCodexAgentsMd(agents: AgentMeta[]): string {
  const roster = agents
    .filter(a => a.id && a.enabled && a.id !== 'zeus-executive-agent')
    .map(a => `| ${godEmoji(a)} ${godName(a)} | ${godDomain(a)} | \`agents/${a.id}.md\` |`)
    .join('\n')

  return `# AGENTS.md — Thesmos Pantheon for Codex

You are Zeus, Executive Orchestrator of the Thesmos Pantheon. Every task in this
workspace routes through you to a specialist god. Never respond as a generic assistant.

## Routing Protocol

1. Read the task and identify its domain.
2. Output the routing header before any substance:

\`\`\`
⚡ ZEUS — ROUTING
[Domain] detected · dispatching [Emoji] [Name]
────────────────────────────────────────────────
\`\`\`

3. Open the matched god's file from \`agents/\` and channel them exactly — their voice,
   methodology, output contract, banner, and closing signature.
4. Most tasks route to ONE specialist. Convene 2–3 gods only when the task genuinely
   crosses domains (announce with \`⚡ ZEUS — COUNCIL ASSEMBLY\`). A full council of 4+
   requires the user to explicitly ask ("full council", "all hands", "go").
5. After a council responds, close with:

\`\`\`
⚡ ZEUS — COUNCIL REPORT
[Emoji] [Name] has delivered: [one-line finding]
— Zeus | Executive Orchestration
\`\`\`

## The Pantheon

| God | Domain | Specification |
|---|---|---|
${roster}

## Persona Rules

- A single-specialist task gets a one-line banner, not the full ceremony — save the
  routing header's detail and the council report for genuinely cross-domain work.
- Never say "As an AI." If asked to drop the persona, comply for one message, then
  resume: "The mist clears. ⚡ ZEUS — EXECUTIVE ORCHESTRATION resumes command."
- Concede facts instantly; hold judgments — state what evidence would change the ruling.
- No filler openers. Substance immediately after the banner.
- Match your model to task depth (AGNT_031): default to mid-tier, escalate only for
  architecture-heavy or irreversible decisions.

---

Thesmos Pantheon · https://holley.studio/thesmos
`
}

function exportFormat(
  agents: AgentMeta[],
  format: Exclude<Format, 'gpt-clusters' | 'skills' | 'models'>,
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
      // Short Instructions file only — NOT wrapped in withIdentity, which
      // would re-blow the 8,000-char budget this template exists to respect.
      // The full identity/anti-drift/operating-doctrine content still ships,
      // just as the knowledge-file companion written below.
      content = toGptInstructions(agent)
    } else if (format === 'gemini') {
      content = withIdentity(toGeminiInstructions(agent), agent)
    } else if (format === 'claude-project') {
      content = withIdentity(toClaudeProjectInstructions(agent), agent)
    } else if (format === 'openai-assistants') {
      content = toOpenAiAssistant(agent)
    } else if (format === 'codex') {
      content = withIdentity(toCodexAgent(agent), agent)
    } else {
      content = withIdentity(toClaudeCodeAgent(agent), agent)
    }

    writeFileSync(outFile, content, 'utf-8')
    exported++

    if (format === 'gpt') {
      const knowledgeFile = join(outDir, `${agent.id}-chatgpt-knowledge.txt`)
      writeFileSync(knowledgeFile, withIdentity(toGptKnowledge(agent), agent), 'utf-8')
    }
  }

  if (format === 'codex') {
    writeFileSync(join(outDir, 'AGENTS.md'), buildCodexAgentsMd(agents), 'utf-8')
    exported++
  }

  return { exported, skipped }
}

// ---------------------------------------------------------------------------
// Model registry — single source of truth for per-agent Claude models
// ---------------------------------------------------------------------------

/**
 * Emit a generated `PANTHEON_MODELS` map (agent id → full Claude model ID)
 * derived from the catalog's `platforms.claude_model`, into every runtime
 * consumer. Anything that needs an agent's model imports this instead of
 * hardcoding it, so the four historical model tables can never drift again.
 */
function exportModels(agents: AgentMeta[]): { exported: number; skipped: number } {
  const entries = agents
    .filter((a) => a.id)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => `  ${JSON.stringify(a.id)}: ${JSON.stringify(a.claudeModel)},`)
    .join('\n')

  const content = `// GENERATED by thesmos/scripts/export-agents.ts — DO NOT EDIT.
// Source of truth: thesmos/catalog/agents/**/*.md (platforms.claude_model).
// Regenerate: \`npm run agents:export\` (or \`--format=models\`).
//
// Every runtime consumer (MCP server, VS Code panel, pantheon CLI) resolves an
// agent's Claude model from this map so model choices live in ONE place.

export const PANTHEON_MODELS: Record<string, string> = {
${entries}
}

/** Fallback used when an id is absent from the map (defensive; should not happen). */
export const DEFAULT_MODEL = 'claude-sonnet-5'

/** Resolve an agent's Claude model, falling back to the baseline tier. */
export function modelFor(id: string): string {
  return PANTHEON_MODELS[id] ?? DEFAULT_MODEL
}
`

  for (const target of MODEL_REGISTRY_TARGETS) {
    ensureDir(dirname(target))
    writeFileSync(target, content, 'utf-8')
  }
  return { exported: MODEL_REGISTRY_TARGETS.length, skipped: 0 }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const ALL_FORMATS: Format[] = [
  'cursor', 'copilot', 'claude-code', 'gpt', 'gemini', 'claude-project',
  'gpt-clusters', 'openai-assistants', 'codex', 'skills', 'models',
]

const FORMAT_LABELS: Record<Format, string> = {
  'cursor': 'Cursor (.mdc)',
  'copilot': 'GitHub Copilot',
  'claude-code': 'Claude Code',
  'gpt': 'ChatGPT (.txt)',
  'gemini': 'Gemini (.txt)',
  'claude-project': 'Claude.ai Project (.txt)',
  'gpt-clusters': 'Zeus GPT clusters (.txt)',
  'openai-assistants': 'OpenAI Assistants (.json)',
  'codex': 'Codex (AGENTS.md)',
  'skills': 'Claude Code Skills',
  'models': 'Model registry (.ts)',
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
    const { exported, skipped } =
      format === 'gpt-clusters' ? exportClusters(agents)
      : format === 'skills' ? exportSkills()
      : format === 'models' ? exportModels(agents)
      : exportFormat(agents, format)
    const dest =
      format === 'gpt-clusters' ? 'pantheon/exports/chatgpt-clusters/'
      : format === 'skills' ? 'pantheon/exports/skills/'
      : format === 'models' ? 'generated/pantheon-models.ts (×2)'
      : `pantheon/exports/${formatConfig(format).dir}/`
    console.log(`  ✅ ${FORMAT_LABELS[format].padEnd(26)} ${exported} → ${dest}`)
    if (skipped > 0) console.log(`     ⏭  ${skipped} skipped`)
  }

  console.log('\n✅ Export complete.\n')
}

main()
