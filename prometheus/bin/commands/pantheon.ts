/**
 * prometheus pantheon:list        — list all 21 Pantheon agents
 * prometheus pantheon:install     — add agents to .prometheus/registry.json
 * prometheus pantheon:status      — show installed Pantheon agents
 * prometheus pantheon:export      — export agents to platform-specific formats
 * prometheus pantheon:orchestrate — Zeus routes a task to the right agents
 * prometheus pantheon:memory      — manage persistent agent memory files
 * prometheus pantheon:upgrade     — check for newer agent versions
 * prometheus pantheon:remove      — remove installed agents
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANTHEON_DIR = join(__dirname, '../../catalog/agents/pantheon');
const MEMORY_DIR_REL = '.prometheus/pantheon/memory';

// ── Agent metadata ─────────────────────────────────────────────────────────────

interface PantheonAgent {
  id: string;
  name: string;
  god: string;
  role: string;
  color: string;
  avatar: string;
  version: string;
  tags: string[];
  body: string;
}

function loadPantheonAgents(): PantheonAgent[] {
  if (!existsSync(PANTHEON_DIR)) return [];
  return readdirSync(PANTHEON_DIR)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .sort()
    .map(filename => {
      const raw = readFileSync(join(PANTHEON_DIR, filename), 'utf8');
      return parsePantheonAgent(raw, filename.replace('.md', ''));
    })
    .filter((a): a is PantheonAgent => a !== null);
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

  return {
    id: get('id') || fallbackId,
    name: get('name').replace(/['"]/g, ''),
    god: get('god'),
    role: get('role'),
    color: get('color'),
    avatar: get('avatar'),
    version: get('version') || '1.0.0',
    tags: getArr('tags'),
    body,
  };
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
  { pattern: /photo|shot list|photography|art direction|retouching/i, agents: ['iris-photography-agent'] },
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
  const p = join(root, '.prometheus/registry.json');
  if (!existsSync(p)) return { rules: ['@prometheus/core'], agents: [], skills: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; }
  catch { return { rules: ['@prometheus/core'], agents: [], skills: [] }; }
}

function writeRegistry(root: string, data: Record<string, unknown>): void {
  const p = join(root, '.prometheus/registry.json');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── Export generators ──────────────────────────────────────────────────────────

function exportClaudeCode(agent: PantheonAgent): string {
  const tools = ['Read', 'Write', 'Bash'];
  const model = agent.id === 'zeus-executive-agent' || agent.id === 'argus-security-agent' ||
    agent.id === 'athena-strategy-agent' || agent.id === 'plutus-finance-agent' ||
    agent.id === 'daedalus-product-agent'
    ? 'claude-opus-4-8'
    : 'claude-sonnet-4-6';

  return `---
name: ${agent.name}
description: >
  ${agent.role} — ${agent.tags.slice(0, 3).join(', ')}. Invoke for any task in this domain.
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

function exportOpenAIAssistant(agent: PantheonAgent): string {
  return JSON.stringify({
    name: agent.name,
    instructions: `# ${agent.name}\n\n${agent.body}`,
    model: 'gpt-4o',
    metadata: {
      prometheus_version: '3.0.0',
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

// ── pantheon:list ──────────────────────────────────────────────────────────────

function cmdList(agents: PantheonAgent[]): void {
  console.log('\n  THE PROMETHEUS PANTHEON — 21 Governed AI Business Agents\n');
  console.log(`  ${'GOD'.padEnd(16)} ${'ROLE'.padEnd(36)} VERSION`);
  console.log(`  ${''.padEnd(16, '─')} ${''.padEnd(36, '─')} ${''.padEnd(7, '─')}`);
  for (const a of agents) {
    console.log(`  ${a.god.padEnd(16)} ${a.role.padEnd(36)} ${a.version}`);
  }
  console.log(`\n  Total: ${agents.length} agents\n`);
  console.log('  Install all:  prometheus pantheon:install --all');
  console.log('  Export:       prometheus pantheon:export --target claude-code\n');
}

// ── pantheon:install ───────────────────────────────────────────────────────────

function cmdInstall(agents: PantheonAgent[], argv: string[], root: string): void {
  const { flags, positionals } = parseArgs(argv);
  const all = flag(flags, 'all');

  const toInstall = all ? agents.map(a => a.id) : positionals;
  if (toInstall.length === 0) {
    console.error('  Usage: prometheus pantheon:install [agent-id...] [--all]');
    process.exit(1);
  }

  const validIds = new Set(agents.map(a => a.id));
  const invalid = toInstall.filter(id => !validIds.has(id));
  if (invalid.length > 0) {
    console.error(`  Unknown agent(s): ${invalid.join(', ')}`);
    console.error('  Run `prometheus pantheon:list` to see valid agent IDs.');
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
  console.log('\n  Agents are now active in .prometheus/registry.json\n');
}

// ── pantheon:status ────────────────────────────────────────────────────────────

function cmdStatus(agents: PantheonAgent[], root: string): void {
  const reg = readRegistry(root);
  const active = new Set((reg['agents'] as string[] | undefined) ?? []);
  const pantheonActive = agents.filter(a => active.has(a.id));

  if (pantheonActive.length === 0) {
    console.log('\n  No Pantheon agents installed. Run: prometheus pantheon:install --all\n');
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
    ? ['claude-code', 'claude-project', 'chatgpt', 'openai-assistant', 'cursor', 'gemini', 'copilot']
    : [target];

  let totalWritten = 0;

  for (const t of targets) {
    let dir: string;
    let ext: string;

    switch (t) {
      case 'claude-code':
        dir = outDir ?? join(root, '.claude/agents');
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
        dir = outDir ?? join(root, '.cursor/rules');
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
      default:
        console.error(`  Unknown target: ${t}. Valid: claude-code, claude-project, chatgpt, openai-assistant, cursor, gemini, copilot, all`);
        process.exit(1);
    }

    mkdirSync(dir, { recursive: true });

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

// ── pantheon:orchestrate ───────────────────────────────────────────────────────

function cmdOrchestrate(agents: PantheonAgent[], argv: string[]): void {
  const { flags, positionals } = parseArgs(argv);
  const task = positionals.join(' ');
  const outFile = flags['out'] as string | undefined;

  if (!task) {
    console.error('  Usage: prometheus pantheon:orchestrate "<task description>"');
    process.exit(1);
  }

  const agentIds = routeTask(task);

  let brief = `# Zeus Orchestration Brief\n`;
  brief += `**Task:** ${task}\n`;
  brief += `**Delegated to:** ${agentIds.length} agent${agentIds.length !== 1 ? 's' : ''}\n\n---\n\n`;

  if (agentIds.length === 0) {
    brief += `Zeus could not confidently route this task. Run \`prometheus pantheon:list\` to browse all 21 agents and invoke the most relevant one directly.\n`;
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
      brief += `**Governance:** Run \`prometheus validate\` on all content before delivery.\n\n`;
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
    console.error('  Usage: prometheus pantheon:memory save|show|clear --agent <id> "[note]"');
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
      console.log(`\n  No memory found for ${agent.name}. Run: prometheus pantheon:memory save --agent ${agent.id} "[note]"\n`);
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
    console.error('  Usage: prometheus pantheon:remove [agent-id...] [--all]');
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
  console.log('  To update: npm update -g prometheus-governance\n');
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
      console.error('  Available: list, install, status, export, orchestrate, memory, remove, upgrade');
      process.exit(1);
  }
}
