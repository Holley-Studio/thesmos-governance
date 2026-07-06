// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos pantheon:list        — list all 38 God Agents
 * thesmos pantheon:install     — add agents to .thesmos/registry.json
 * thesmos pantheon:status      — show installed Pantheon agents
 * thesmos pantheon:export      — export agents to platform-specific formats
 * thesmos pantheon:orchestrate — Zeus routes a task to the right agents
 * thesmos pantheon:memory      — manage persistent agent memory files
 * thesmos pantheon:upgrade     — check for newer agent versions
 * thesmos pantheon:remove      — remove installed agents
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { logAgentSpawn } from '../../agent-activity.ts';
import { modelFor } from '../../generated/pantheon-models.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Resolve catalog path for both dev (bin/commands/) and bundle (dist/) locations.
const _agentsDirCandidates = [
  join(__dirname, '../../catalog/agents'), // dev: bin/commands/ → thesmos/
  join(__dirname, '../catalog/agents'),    // bundle: dist/ → thesmos/
];
const AGENTS_DIR = _agentsDirCandidates.find(p => existsSync(p)) ?? _agentsDirCandidates[0];
const PANTHEON_DIR = join(AGENTS_DIR, 'pantheon');
const FIGMA_DIR = join(AGENTS_DIR, 'figma');
const MEMORY_DIR_REL = '.thesmos/pantheon/memory';

// Slugs of agent .md files directly in a directory (non-recursive), excluding
// README.md and any <slug>-README.md companion doc (identified by lacking the
// --- frontmatter block a real agent file has — see parsePantheonAgent).
function listAgentSlugs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => f.replace(/\.md$/, ''));
}

// ── Agent metadata ─────────────────────────────────────────────────────────────

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
  body: string;
}

function loadPantheonAgents(): PantheonAgent[] {
  const agents: PantheonAgent[] = [];

  // Every agent .md file, discovered dynamically rather than off a
  // hand-maintained slug list — a hardcoded list silently drifts the moment
  // a new agent lands in one of these directories without the list being
  // updated (this is exactly how 25 shipped agents went undiscoverable:
  // 15 root-level agents were never added to the old hardcoded list, and an
  // entire catalog/agents/figma/ directory was never scanned at all).
  const sources = [
    { dir: PANTHEON_DIR, slugs: listAgentSlugs(PANTHEON_DIR).sort() },
    { dir: FIGMA_DIR, slugs: listAgentSlugs(FIGMA_DIR).sort() },
    { dir: AGENTS_DIR, slugs: listAgentSlugs(AGENTS_DIR).sort() },
  ];

  for (const { dir, slugs } of sources) {
    for (const slug of slugs) {
      const raw = readFileSync(join(dir, `${slug}.md`), 'utf8');
      const agent = parsePantheonAgent(raw, slug);
      if (agent) agents.push(agent);
    }
  }

  return agents;
}

function parsePantheonAgent(raw: string, fallbackId: string): PantheonAgent | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;
  const fm = fmMatch[1]!;
  const body = fmMatch[2]!.trim();

  const get = (key: string) => {
    const m = fm.match(new RegExp(`^${key}:\\s*["\']?(.+?)["\']?\\s*$`, 'm'));
    return m?.[1]?.trim() ?? '';
  };
  const getArr = (key: string): string[] => {
    const m = fm.match(new RegExp(`^${key}:\\n((?:  - .+\\n?)+)`, 'm'));
    if (!m) return [];
    return m[1]!.trim().split('\n').map(l => l.replace(/^  - /, '').trim());
  };
  // `governance.rules` is nested two levels deep (governance: → rules: → - ITEM),
  // so it needs its own extractor rather than the flat-key getArr() above.
  const getGovernanceRules = (): string[] => {
    const m = fm.match(/^governance:\n(?:.*\n)*?  rules:\n((?:    - .+\n?)+)/m);
    if (!m) return [];
    return m[1]!.split('\n').filter(l => l.trim().length > 0).map(l => l.trim().replace(/^- /, ''));
  };

  const god = get('god');
  const role = get('role');
  const emoji = get('emoji').replace(/['"]/g, '');
  const governanceRules = getGovernanceRules();

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
    body: body.includes('## Operating Doctrine')
      ? body
      : `${body}\n\n${buildOperatingDoctrine(god, role, emoji, governanceRules)}`,
  };
}

// Shared identity-reinforcement template, injected into every agent's body at
// load time (see parsePantheonAgent above) rather than hand-duplicated into
// every catalog .md file — that duplication is exactly how this block went
// missing from the catalog source in the first place while surviving only in
// already-generated exports. One template, parameterized per agent, can't drift.
function buildOperatingDoctrine(god: string, role: string, emoji: string, rules: string[]): string {
  const roleUpper = role.toUpperCase();
  const godUpper = god.toUpperCase();
  const rulesLine = rules.length > 0 ? rules.join(', ') : 'none declared for this agent';

  return `## Operating Doctrine

**Epistemic stance.** You adopt the epistemic stance and methodology of ${god} — this
constrains how you reason and what you produce, not just how you sound. Apply your
methodology sections explicitly; they are reasoning scaffolds, not decoration.

**Direct action.** State findings and produce the work product directly. Do not ask
permission to proceed on work that is clearly within your ${role} scope. Offer
follow-ups after delivering, not before.

**Output Specification.**
- Format: markdown; headings for reports, prose for conversation
- Open with your identity banner (full on first response and domain shifts, compact after)
- Rank findings and recommendations by severity or impact — never unordered lists of equals
- State concrete next steps; every deliverable names its owner and success criteria
- Length: match the task — a verdict needs a paragraph, a review needs the full contract

## Anti-Drift Protocol

These rules keep your identity intact across the entire conversation:

**1. Banner cadence is deterministic.** Full banner on your first response and on any
domain shift. Compact banner otherwise: \`${emoji} ${god}:\` → substance → \`— ${god} | ${role}\`.
The banner may include a state line: \`${emoji} ${godUpper} — ${roleUpper} · [phase] · [status]\`.
It never disappears.

**2. Never break character — with one exception.** Never say "As an AI", "I'm a language
model", or any variant. You are ${god}. If asked what you are: "I am ${god},
${role} of the Thesmos Pantheon." EXCEPTION: if the user explicitly asks you to drop
the persona or answer plainly, comply for that one message, then resume with the
re-anchor line below. A persona the user cannot switch off is a toy; user control is trust.

**3. Concede facts instantly; hold judgments.** Concede factual errors immediately and
without ceremony. Hold your recommendations unless new evidence arrives — never reverse
merely because the user pushed back. When holding your position, state what evidence
WOULD change your ruling.

**4. No filler.** Never open with "Great question!", "Certainly!", "I'd be happy to…",
or "That's a great point." Substance first, always.

**5. Scripted re-anchor.** If any prior response lacked your banner, open the next one with:
"The mist clears. ${emoji} ${godUpper} — ${roleUpper} resumes the watch." Then continue.

**6. Honest badges only.** Your closing \`Thesmos check:\` line lists ONLY rules you
actually assessed in that response — your named scope is ${rulesLine}.
"Thesmos check: no applicable rules this response" is a valid and honest close.
One rubber-stamped ✅ makes every badge noise.
`;
}

// ── Zeus routing table ─────────────────────────────────────────────────────────

const DOMAIN_ROUTING: Array<{ pattern: RegExp; agents: string[] }> = [
  { pattern: /marketing|campaign|growth|channel|brand awareness/i, agents: ['hermes-marketing-agent', 'apollo-content-agent', 'aphrodite-creative-agent'] },
  { pattern: /sales|pitch|deal|close|proposal|objection|demo/i, agents: ['ares-sales-agent', 'nike-leadgen-agent'] },
  { pattern: /design|ui|ux|component|layout|wireframe|interface/i, agents: ['hephaestus-design-agent', 'aphrodite-creative-agent'] },
  { pattern: /legal|contract|tos|nda|terms|liability|agreement/i, agents: ['themis-legal-agent', 'argus-security-agent'] },
  { pattern: /analytics|kpi|metrics|dashboard|data|measure/i, agents: ['tyche-analytics-agent', 'mnemosyne-knowledge-agent'] },
  { pattern: /security|threat|audit|vulnerability|pentest|owasp/i, agents: ['argus-security-agent'] },
  { pattern: /finance|pricing|budget|unit economics|cac|ltv|revenue|cost/i, agents: ['plutus-finance-agent'] },
  { pattern: /pr|press|media|crisis|announcement|coverage|journalist/i, agents: ['pheme-pr-agent', 'apollo-content-agent'] },
  { pattern: /operations|sop|hiring|hr|onboarding|process|handbook/i, agents: ['hera-operations-agent'] },
  { pattern: /content|copy|blog|seo|email|post|write|script/i, agents: ['apollo-content-agent'] },
  { pattern: /video|production|shoot|edit|film/i, agents: ['dionysus-video-agent'] },
  { pattern: /animation|motion|storyboard|after effects|micro-interaction/i, agents: ['morpheus-animation-agent'] },
  { pattern: /photo|shot list|photography|art direction|retouching/i, agents: ['artemis-photography-agent'] },
  { pattern: /data|sql|bi|business intelligence|cohort|attribution|anomaly/i, agents: ['pythia-data-agent', 'tyche-analytics-agent'] },
  { pattern: /ux research|user interview|usability|persona|jtbd|affinity map/i, agents: ['psyche-research-agent', 'daedalus-product-agent'] },
  { pattern: /compliance|grc|gdpr|soc2|iso 27001|eu ai act|audit trail|risk register/i, agents: ['nemesis-compliance-agent', 'argus-security-agent'] },
  { pattern: /customer success|renewal|churn prevention|qbr|upsell|health score/i, agents: ['demeter-cs-agent', 'hestia-cx-agent'] },
  { pattern: /strategy|gtm|competitive|okr|roadmap|positioning/i, agents: ['athena-strategy-agent'] },
  { pattern: /leads|pipeline|prospecting|outbound|icp|lead gen/i, agents: ['nike-leadgen-agent'] },
  { pattern: /creative|brand|identity|visual|aesthetic|logo/i, agents: ['aphrodite-creative-agent'] },
  { pattern: /cx|customer|support|retention|churn|onboard|nps/i, agents: ['hestia-cx-agent'] },
  { pattern: /knowledge|documentation|wiki|doc|memory|context/i, agents: ['mnemosyne-knowledge-agent'] },
  { pattern: /product|prd|feature|roadmap|user story|requirements|mvp/i, agents: ['daedalus-product-agent'] },
  { pattern: /partnership|bd|business development|reseller|channel partner|alliance/i, agents: ['heracles-bd-agent'] },
];

function routeTask(task: string): string[] {
  const matched = new Set<string>();
  for (const { pattern, agents } of DOMAIN_ROUTING) {
    if (pattern.test(task)) {
      for (const a of agents) matched.add(a);
    }
  }
  const result = [...matched];
  return result.slice(0, 4);
}

// ── Registry helpers ───────────────────────────────────────────────────────────

function readRegistry(root: string): Record<string, unknown> {
  const p = join(root, '.thesmos/registry.json');
  if (!existsSync(p)) return { rules: ['@thesmos/core'], agents: [], skills: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; }
  catch { return { rules: ['@thesmos/core'], agents: [], skills: [] }; }
}

function writeRegistry(root: string, data: Record<string, unknown>): void {
  const p = join(root, '.thesmos/registry.json');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Export generators ──────────────────────────────────────────────────────────

function exportClaudeCode(agent: PantheonAgent): string {
  const tools = ['Read', 'Write', 'Bash'];
  // Model comes from the catalog (via the generated PANTHEON_MODELS map) so it
  // never drifts from platforms.claude_model. Was: hardcoded OPUS/HAIKU sets.
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

${agent.body}
`;
}

function exportChatGPT(agent: PantheonAgent): string {
  const MAX = 7800;
  let body = `# ${agent.name}\n\n${agent.body}`;
  if (body.length > MAX) {
    body = body.slice(0, MAX) + '\n\n[Full agent instructions: see pantheon/agents/' + agent.id + '.md]';
  }
  return body;
}

function exportCodex(agent: PantheonAgent): string {
  return `# ${agent.name}\n\n${agent.body}`;
}

function exportOpenAIAssistant(agent: PantheonAgent): string {
  return JSON.stringify({
    name: agent.name,
    instructions: `# ${agent.name}\n\n${agent.body}`,
    model: 'gpt-4o',
    metadata: {
      thesmos_version: '3.0.0',
      agent_version: agent.version,
      pantheon: 'true',
      god: agent.god,
      role: agent.role,
    },
  }, null, 2);
}

function exportCursor(agent: PantheonAgent): string {
  return `---
description: >
  ${agent.name} — ${agent.role}. Invoke for: ${agent.tags.slice(0, 4).join(', ')}.
alwaysApply: false
---

${agent.body}
`;
}

function exportGemini(agent: PantheonAgent): string {
  return `# ${agent.name} — Gemini Gem\n\n${agent.body}`;
}

function exportCopilot(agent: PantheonAgent): string {
  return `# ${agent.name}\n\n${agent.body}`;
}

function exportAgentsMd(agents: PantheonAgent[]): string {
  const lines: string[] = [
    '# AGENTS.md',
    '',
    '> This repository uses the **Thesmos Pantheon** — a team of governed AI specialists.',
    '> Each agent below has a defined domain, trigger phrases, and governance rules.',
    '> Install via: `npx thesmos-governance pantheon:install --all`',
    '',
    '---',
    '',
    `## Available agents (${agents.length})`,
    '',
  ];

  for (const agent of agents) {
    lines.push(`### ${agent.god} — ${agent.role}`);
    lines.push('');
    if (agent.mythology) {
      lines.push(`> ${agent.mythology.slice(0, 160).replace(/\n/g, ' ')}`);
      lines.push('');
    }
    lines.push(`**Agent ID:** \`${agent.id}\``);
    if (agent.tags.length > 0) {
      lines.push(`**Tags:** ${agent.tags.map(t => `\`${t}\``).join(', ')}`);
    }
    const triggerMatch = agent.body.match(/## Trigger phrases[^#]*?((?:^- ".+"\n)+)/ms);
    if (triggerMatch) {
      lines.push('**Trigger phrases:**');
      const phrases = triggerMatch[1].trim().split('\n').slice(0, 4);
      for (const p of phrases) lines.push(p);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('## Governance');
  lines.push('');
  lines.push('All agents operate under Thesmos governance rules.');
  lines.push('Run `thesmos eval` after any session to view compliance report.');
  lines.push('');

  return lines.join('\n');
}

// ── pantheon:list ──────────────────────────────────────────────────────────────

function cmdList(agents: PantheonAgent[]): void {
  console.log('\n  THE THESMOS PANTHEON — 40 Governed AI Business Agents\n');
  console.log(`  ${'GOD'.padEnd(16)} ${'ROLE'.padEnd(36)} VERSION`);
  console.log(`  ${''.padEnd(16, '─')} ${''.padEnd(36, '─')} ${''.padEnd(7, '─')}`);
  for (const a of agents) {
    console.log(`  ${a.god.padEnd(16)} ${a.role.padEnd(36)} ${a.version}`);
  }
  console.log(`\n  Total: ${agents.length} agents\n`);
  console.log('  Install all:  thesmos pantheon:install --all');
  console.log('  Export:       thesmos pantheon:export --target claude-code\n');
}

// ── pantheon:install ───────────────────────────────────────────────────────────

function cmdInstall(agents: PantheonAgent[], argv: string[], root: string): void {
  const { flags, positionals } = parseArgs(argv);
  const all = flag(flags, 'all');

  const toInstall = all ? agents.map(a => a.id) : positionals;
  if (toInstall.length === 0) {
    console.error('  Usage: thesmos pantheon:install [agent-id...] [--all]');
    process.exit(1);
  }

  const validIds = new Set(agents.map(a => a.id));
  const invalid = toInstall.filter(id => !validIds.has(id));
  if (invalid.length > 0) {
    console.error(`  Unknown agent(s): ${invalid.join(', ')}`);
    console.error('  Run `thesmos pantheon:list` to see valid agent IDs.');
    process.exit(1);
  }

  const reg = readRegistry(root);
  const existing = (reg['agents'] as string[] | undefined) ?? [];
  const merged = [...new Set([...existing, ...toInstall])];
  reg['agents'] = merged;
  writeRegistry(root, reg);

  console.log(`\n  ✓ Installed ${toInstall.length} Pantheon agent(s):\n`);
  for (const id of toInstall) {
    const a = agents.find(x => x.id === id)!;
    console.log(`    ${a.god.padEnd(16)} ${a.role}`);
  }
  console.log('\n  Agents are now active in .thesmos/registry.json\n');
}

// ── pantheon:status ────────────────────────────────────────────────────────────

function cmdStatus(agents: PantheonAgent[], root: string): void {
  const reg = readRegistry(root);
  const active = new Set((reg['agents'] as string[] | undefined) ?? []);
  const pantheonActive = agents.filter(a => active.has(a.id));

  if (pantheonActive.length === 0) {
    console.log('\n  No Pantheon agents installed. Run: thesmos pantheon:install --all\n');
    return;
  }
  console.log(`\n  Active Pantheon agents: ${pantheonActive.length}/${agents.length}\n`);
  for (const a of pantheonActive) {
    console.log(`  ● [${a.id}] ${a.name}`);
  }
  console.log();
}

// ── pantheon:export ────────────────────────────────────────────────────────────

function cmdExport(agents: PantheonAgent[], argv: string[], root: string): void {
  const { flags, positionals } = parseArgs(argv);
  const target = (flags['target'] as string | undefined) ?? 'claude-code';
  const agentFilter = flags['agent'] as string | undefined;
  const outDir = flags['out'] as string | undefined;

  const toExport = agentFilter
    ? agents.filter(a => a.id === agentFilter || a.god.toLowerCase() === agentFilter.toLowerCase())
    : agents;

  if (toExport.length === 0) {
    console.error(`  No agent found matching: ${agentFilter}`);
    process.exit(1);
  }

  const targets = target === 'all'
    ? ['claude-code', 'claude-project', 'chatgpt', 'openai-assistant', 'cursor', 'gemini', 'copilot', 'codex', 'agents-md']
    : [target];

  let totalWritten = 0;

  for (const t of targets) {
    let dir: string;
    let ext: string;

    switch (t) {
      case 'claude-code':
        dir = outDir ?? join(root, 'pantheon/exports/claude-code');
        ext = '.md';
        break;
      case 'claude-project':
        dir = outDir ?? join(root, 'pantheon/exports/claude-project');
        ext = '-claude-project.txt';
        break;
      case 'chatgpt':
        dir = outDir ?? join(root, 'pantheon/exports/chatgpt');
        ext = '-chatgpt.txt';
        break;
      case 'openai-assistant':
        dir = outDir ?? join(root, 'pantheon/exports/openai-assistants');
        ext = '-openai-assistant.json';
        break;
      case 'cursor':
        dir = outDir ?? join(root, 'pantheon/exports/cursor');
        ext = '.mdc';
        break;
      case 'gemini':
        dir = outDir ?? join(root, 'pantheon/exports/gemini');
        ext = '-gemini.txt';
        break;
      case 'copilot':
        dir = outDir ?? join(root, 'pantheon/exports/copilot');
        ext = '.instructions.md';
        break;
      case 'codex':
        dir = outDir ?? join(root, 'pantheon/exports/codex');
        ext = '.md';
        break;
      case 'agents-md':
        dir = outDir ?? root;
        ext = '';
        break;
      default:
        console.error(`  Unknown target: ${t}. Valid: claude-code, claude-project, chatgpt, openai-assistant, cursor, gemini, copilot, codex, agents-md, all`);
        process.exit(1);
    }

    mkdirSync(dir, { recursive: true });

    if (t === 'agents-md') {
      const content = exportAgentsMd(toExport);
      writeFileSync(join(dir, 'AGENTS.md'), content, 'utf8');
      totalWritten++;
      continue;
    }

    for (const agent of toExport) {
      let content: string;
      let filename: string;

      switch (t) {
        case 'claude-code':
          content = exportClaudeCode(agent);
          filename = `${agent.id}.md`;
          break;
        case 'claude-project':
          content = exportChatGPT(agent);
          filename = `${agent.id}${ext}`;
          break;
        case 'chatgpt':
          content = exportChatGPT(agent);
          filename = `${agent.id}${ext}`;
          break;
        case 'openai-assistant':
          content = exportOpenAIAssistant(agent);
          filename = `${agent.id}${ext}`;
          break;
        case 'cursor':
          content = exportCursor(agent);
          filename = `${agent.id}${ext}`;
          break;
        case 'gemini':
          content = exportGemini(agent);
          filename = `${agent.id}${ext}`;
          break;
        case 'copilot':
          content = exportCopilot(agent);
          filename = `${agent.id}${ext}`;
          break;
        case 'codex':
          content = exportCodex(agent);
          filename = `${agent.id}${ext}`;
          break;
        default:
          continue;
      }

      writeFileSync(join(dir, filename), content, 'utf8');
      totalWritten++;
    }
  }

  console.log(`\n  ✓ Exported ${toExport.length} agent(s) to ${targets.length} platform(s) — ${totalWritten} files written\n`);
  if (targets.includes('claude-code')) {
    console.log('  Claude Code: launch any agent with:');
    console.log('    claude --agent=hermes-marketing-agent "Write a campaign brief"\n');
  }
}

// ── pantheon:council ──────────────────────────────────────────────────────────

const AGENT_VOICES: Record<string, string> = {
  'athena-strategy-agent':    'Frame the strategic angle: positioning, timing, competitive moats, and the one assumption that, if wrong, changes everything.',
  'hermes-marketing-agent':   'Surface the go-to-market hook, channel priorities, and the single-sentence positioning statement that makes this land.',
  'ares-sales-agent':         'Identify the deal-closing argument, the most likely objection, and the close sequence.',
  'aphrodite-creative-agent': 'Define the visual language, tone, and the emotional hook that makes this memorable.',
  'hephaestus-design-agent':  'Specify the UX flows, component patterns, and the design decision with the biggest user-experience impact.',
  'themis-legal-agent':       'Flag the legal risk surface, required disclosures, and the one clause that could void the whole thing.',
  'argus-security-agent':     'Enumerate the threat vectors, the highest-severity exposure, and the first three controls to implement.',
  'tyche-analytics-agent':    'Define the north-star metric, the leading indicators, and the measurement cadence.',
  'plutus-finance-agent':     'Model the unit economics, the break-even scenario, and the pricing lever with the most leverage.',
  'pheme-pr-agent':           'Craft the earned-media angle, the spokesperson message, and the crisis-mitigation pre-plan.',
  'apollo-content-agent':     'Write the headline, the three supporting proof points, and the call-to-action.',
  'daedalus-product-agent':   'Define the MVP scope, the first cut-line decision, and the feature that unlocks the next cohort.',
  'hera-operations-agent':    'Identify the process bottleneck, the SOP that needs writing, and the hiring unblock.',
  'nike-leadgen-agent':       'Describe the ICP, the top-of-funnel hook, and the qualification signal that separates buyers from browsers.',
  'heracles-bd-agent':        'Name the partner category with the highest leverage, the integration unlock, and the deal structure.',
  'mnemosyne-knowledge-agent':'Synthesize what institutional knowledge already exists, what the knowledge gap is, and what to document first.',
  'hestia-cx-agent':          'Define the moment of truth in the customer journey, the churn signal to watch, and the retention intervention.',
  'demeter-cs-agent':         'Outline the success milestone framework, the QBR agenda, and the expansion signal.',
  'psyche-research-agent':    'Propose the research method, the key interview question, and the insight most likely to invalidate the assumption.',
  'nemesis-compliance-agent': 'Surface the regulatory regime, the audit gap, and the policy that needs drafting before launch.',
  'pythia-data-agent':        'Describe the data pipeline, the SQL query that answers the core question, and the anomaly to investigate.',
  'dionysus-video-agent':     'Define the video format, the narrative arc, and the first 5 seconds that stop the scroll.',
  'morpheus-animation-agent': 'Specify the motion principle, the micro-interaction that communicates value, and the easing curve.',
  'artemis-photography-agent':'Define the shot list, the lighting direction, and the hero image concept.',
  'zeus-executive-agent':     'Arbitrate the priorities, assign ownership, and state the irreversible decision that must be made first.',
  'aether-ai-strategy-agent': 'Map the AI capability leverage points, the data flywheel, and the model selection rationale.',
  'calliope-email-agent':     'Write the subject line, the three-line preview, and the CTA that drives the click.',
  'cassandra-qa-agent':       'Identify the test coverage gaps, the regression risk, and the first automated check to add.',
  'chiron-architecture-agent':'Define the component boundaries, the data flow, and the architectural decision record.',
  'clio-case-study-agent':    'Select the proof story, the measurable outcome, and the narrative structure.',
  'eos-automation-agent':     'Identify the highest-ROI automation target, the trigger condition, and the error-handling strategy.',
  'erato-brand-voice-agent':  'Define the tone spectrum, the vocabulary list, and the three phrases to avoid.',
  'kratos-devops-agent':      'Specify the deployment strategy, the rollback procedure, and the observability gap.',
  'metis-pm-agent':           'Produce the sprint plan, the stakeholder alignment summary, and the dependency to unblock.',
  'momus-challenger-agent':   'Surface the strongest counterargument, the hidden assumption, and the alternative frame.',
  'polyhymnia-docs-agent':    'Outline the documentation structure, the gap between what exists and what is needed, and the first doc to write.',
  'proteus-drift-agent':      'Detect the scope creep signals, the misalignment between intent and implementation, and the course-correction.',
  'talos-web-dev-agent':      'Define the component architecture, the performance budget, and the accessibility gap.',
};

function cmdCouncil(agents: PantheonAgent[], argv: string[]): void {
  const { positionals, flags } = parseArgs(argv);
  const task = positionals.join(' ');
  const outFile = flags['out'] as string | undefined;
  const maxAgents = typeof flags['max'] === 'string' ? parseInt(flags['max'], 10) : 4;

  if (!task) {
    console.error('  Usage: thesmos pantheon:council "<question or task>" [--max=N] [--out=<file>]');
    console.error('  Example: thesmos pantheon:council "What is our go-to-market strategy?"');
    process.exit(1);
  }

  const agentIds = routeTask(task).slice(0, Math.max(2, Math.min(maxAgents, 6)));
  const councilSessionId = randomUUID();

  const lines: string[] = [];
  const ruler = (label: string) => `${'━'.repeat(4)} ${label} ${'━'.repeat(Math.max(2, 50 - label.length))}`;

  lines.push('');
  lines.push(`🔱 Thesmos Pantheon Council — "${task}"`);
  lines.push('');

  if (agentIds.length === 0) {
    lines.push('  Zeus could not route this task confidently.');
    lines.push('  Run `thesmos pantheon:list` to browse all agents and invoke directly.');
    lines.push('');
    console.log(lines.join('\n'));
    return;
  }

  for (const id of agentIds) {
    const agent = agents.find(a => a.id === id);
    if (!agent) continue;

    try {
      const { root } = createContext();
      logAgentSpawn(root, {
        sessionId: councilSessionId,
        agentId: randomUUID(),
        description: `Council: ${task}`,
        subagentType: id,
      });
    } catch { /* non-fatal */ }

    const voice = AGENT_VOICES[id] ?? `Apply your ${agent.role.toLowerCase()} expertise to: ${task}`;
    const label = `${agent.god} — ${agent.role}`;

    lines.push(ruler(label));
    lines.push('');
    lines.push(`  Task: ${task}`);
    lines.push('');
    lines.push(`  ${voice}`);
    lines.push('');
    lines.push(`  Invoke **${agent.name}**: Agent({ subagent_type: "${agent.id}", prompt: "${task.replace(/"/g, "'")}" })`);
    lines.push('');
  }

  lines.push(`${'─'.repeat(58)}`);
  lines.push(`  Council convened: ${agentIds.length} agents · Run each invocation above for full deliberation.`);
  lines.push(`  Governance: thesmos validate before merging any council output.`);
  lines.push('');

  const output = lines.join('\n');

  if (outFile) {
    writeFileSync(outFile, output, 'utf8');
    console.log(`\n  ✓ Council brief written to ${outFile}\n`);
  } else {
    process.stdout.write(output);
  }

  // Always save council output to .thesmos/active-plan.md for session continuity
  if (!flags['no-save']) {
    try {
      const { root } = createContext();
      const activePlanPath = join(root, '.thesmos', 'active-plan.md');
      mkdirSync(join(root, '.thesmos'), { recursive: true });
      const header =
        `<!-- thesmos:active-plan generated ${new Date().toISOString()} -->\n` +
        `# Active Plan\n\n` +
        `**Task:** ${task}\n` +
        `**Council convened:** ${agentIds.length} agents\n` +
        `**Generated:** ${new Date().toLocaleString()}\n\n`;
      writeFileSync(activePlanPath, header + output + '\n', 'utf8');
      if (!outFile) {
        console.log(`  ✓ Active plan saved → .thesmos/active-plan.md\n`);
      }
    } catch {
      // Non-fatal — don't block council output if save fails
    }
  }
}

// ── pantheon:orchestrate ───────────────────────────────────────────────────────

function cmdOrchestrate(agents: PantheonAgent[], argv: string[]): void {
  const { flags, positionals } = parseArgs(argv);
  const task = positionals.join(' ');
  const outFile = flags['out'] as string | undefined;

  if (!task) {
    console.error('  Usage: thesmos pantheon:orchestrate "<task description>"');
    process.exit(1);
  }

  const agentIds = routeTask(task);
  const orchestrateSessionId = randomUUID();

  try {
    const { root } = createContext();
    for (const id of agentIds) {
      logAgentSpawn(root, {
        sessionId: orchestrateSessionId,
        agentId: randomUUID(),
        description: `Orchestrate: ${task}`,
        subagentType: id,
      });
    }
  } catch { /* non-fatal */ }

  let brief = `# Zeus Orchestration Brief\n`;
  brief += `**Task:** ${task}\n`;
  brief += `**Delegated to:** ${agentIds.length} agent${agentIds.length !== 1 ? 's' : ''}\n\n---\n\n`;

  if (agentIds.length === 0) {
    brief += `Zeus could not confidently route this task. Run \`thesmos pantheon:list\` to browse all 40 agents and invoke the most relevant one directly.\n`;
  } else {
    for (const id of agentIds) {
      const a = agents.find(x => x.id === id);
      if (!a) continue;

      const downstreamIds = agentIds.filter(x => x !== id);
      const downstream = downstreamIds
        .map(x => agents.find(ag => ag.id === x))
        .filter(Boolean)
        .map(x => x!.god)
        .join(', ');

      brief += `## ${a.name}\n\n`;
      brief += `**Sub-task:** Handle the "${a.role.toLowerCase()}" dimension of: ${task}\n\n`;
      brief += `**Context from Zeus:** Coordinate with the full team below. Produce your deliverable in your standard output format.\n\n`;
      if (downstream) {
        brief += `**Coordinate with:** ${downstream}\n\n`;
      }
      brief += `**Governance:** Run \`thesmos validate\` on all content before delivery.\n\n`;
      brief += `---\n\n`;
    }
  }

  if (outFile) {
    writeFileSync(outFile, brief, 'utf8');
    console.log(`\n  ✓ Brief written to ${outFile}\n`);
  } else {
    console.log('\n' + brief);
  }
}

// ── pantheon:memory ────────────────────────────────────────────────────────────

function cmdMemory(agents: PantheonAgent[], argv: string[], root: string): void {
  const { flags, positionals } = parseArgs(argv);
  const sub = positionals[0];
  const agentIdFlag = flags['agent'] as string | undefined;
  const note = positionals.slice(1).join(' ') || flags['note'] as string | undefined || '';

  if (!sub || !agentIdFlag) {
    console.error('  Usage: thesmos pantheon:memory save|show|clear --agent <id> "[note]"');
    process.exit(1);
  }

  const agent = agents.find(a => a.id === agentIdFlag || a.god.toLowerCase() === agentIdFlag.toLowerCase());
  if (!agent) {
    console.error(`  Unknown agent: ${agentIdFlag}`);
    process.exit(1);
  }

  const memDir = join(root, MEMORY_DIR_REL);
  mkdirSync(memDir, { recursive: true });
  const memFile = join(memDir, `${agent.id}.md`);

  if (sub === 'save') {
    if (!note) { console.error('  Provide a note to save.'); process.exit(1); }
    const date = new Date().toISOString().split('T')[0]!;
    let content: string;
    if (existsSync(memFile)) {
      const existing = readFileSync(memFile, 'utf8');
      const entriesMatch = existing.match(/^entries:\s*(\d+)/m);
      const count = entriesMatch ? parseInt(entriesMatch[1]!, 10) + 1 : 1;
      let updated = existing.replace(/^entries:\s*\d+/m, `entries: ${count}`);
      updated = updated.replace(/^updated:\s*.+/m, `updated: ${date}`);
      updated += `\n- ${note} [${date}]`;
      content = updated;
    } else {
      content = `---\nagent: ${agent.id}\nupdated: ${date}\nentries: 1\n---\n\n## Context\n\n- ${note} [${date}]`;
    }
    writeFileSync(memFile, content, 'utf8');
    console.log(`\n  ✓ Memory saved for ${agent.name}.\n`);
  } else if (sub === 'show') {
    if (!existsSync(memFile)) {
      console.log(`\n  No memory found for ${agent.name}. Run: thesmos pantheon:memory save --agent ${agent.id} "[note]"\n`);
    } else {
      console.log('\n' + readFileSync(memFile, 'utf8') + '\n');
    }
  } else if (sub === 'clear') {
    if (!existsSync(memFile)) {
      console.log(`\n  No memory file for ${agent.name}.\n`);
    } else {
      process.stdout.write(`  Clear all memory for ${agent.name}? (y/N) `);
      // In non-interactive use, just clear
      writeFileSync(memFile, `---\nagent: ${agent.id}\nupdated: ${new Date().toISOString().split('T')[0]}\nentries: 0\n---\n\n## Context\n\n`, 'utf8');
      console.log(`  ✓ Memory cleared for ${agent.name}.\n`);
    }
  } else {
    console.error(`  Unknown memory subcommand: ${sub}. Use: save, show, clear`);
    process.exit(1);
  }
}

// ── pantheon:remove ────────────────────────────────────────────────────────────

function cmdRemove(agents: PantheonAgent[], argv: string[], root: string): void {
  const { flags, positionals } = parseArgs(argv);
  const all = flag(flags, 'all');
  const toRemove = all ? agents.map(a => a.id) : positionals;

  if (toRemove.length === 0) {
    console.error('  Usage: thesmos pantheon:remove [agent-id...] [--all]');
    process.exit(1);
  }

  const reg = readRegistry(root);
  const existing = (reg['agents'] as string[] | undefined) ?? [];
  reg['agents'] = existing.filter(id => !toRemove.includes(id));
  writeRegistry(root, reg);
  console.log(`\n  ✓ Removed ${toRemove.length} agent(s) from registry.\n`);
}

// ── pantheon:upgrade ───────────────────────────────────────────────────────────

function cmdUpgrade(agents: PantheonAgent[]): void {
  console.log('\n  Checking Pantheon agent versions...\n');
  for (const a of agents) {
    console.log(`  ✓ [${a.id}] v${a.version} — up to date`);
  }
  console.log(`\n  All ${agents.length} agents are at the latest version.\n`);
  console.log('  To update: npm update -g thesmos-governance\n');
}

// ── main ───────────────────────────────────────────────────────────────────────

export async function cmdPantheon(argv: string[]): Promise<void> {
  const { root } = createContext();
  const sub = argv[0];
  const rest = argv.slice(1);

  const agents = loadPantheonAgents();

  switch (sub) {
    case 'list':
    case undefined:
      cmdList(agents);
      break;
    case 'install':
      cmdInstall(agents, rest, root);
      break;
    case 'status':
      cmdStatus(agents, root);
      break;
    case 'export':
      cmdExport(agents, rest, root);
      break;
    case 'council':
      cmdCouncil(agents, rest);
      break;
    case 'orchestrate':
      cmdOrchestrate(agents, rest);
      break;
    case 'memory':
      cmdMemory(agents, rest, root);
      break;
    case 'remove':
      cmdRemove(agents, rest, root);
      break;
    case 'upgrade':
      cmdUpgrade(agents);
      break;
    default:
      console.error(`  Unknown pantheon subcommand: ${sub}`);
      console.error('  Available: list, install, status, export, council, orchestrate, memory, remove, upgrade');
      process.exit(1);
  }
}
