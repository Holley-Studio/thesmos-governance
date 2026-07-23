// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos agent:run <name> — execute a local agent definition via the autopilot adapter.
 *
 * Resolution order (first match wins):
 *   .thesmos/agents/<name>.md
 *   .thesmos/catalog/agents/<name>.md
 *   .claude/commands/<name>.md
 *   thesmos/catalog/agents/pantheon/<name>.md (package catalog)
 *
 * Flags:
 *   --dry-run   Print resolved path + prompt preview; do not call the adapter
 *   --prompt=   Extra user prompt appended to the agent body
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { createAdapter } from '../../autopilot/adapters.ts';
import { logAgentComplete, logAgentError, logAgentSpawn } from '../../agent-activity.ts';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PACKAGE_PANTHEON_CANDIDATES = [
  join(__dirname, '../../catalog/agents/pantheon'),
  join(__dirname, '../catalog/agents/pantheon'),
];

export function resolveAgentPath(root: string, name: string): string | null {
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const local = [
    join(root, '.thesmos', 'agents', `${slug}.md`),
    join(root, '.thesmos', 'catalog', 'agents', `${slug}.md`),
    join(root, '.claude', 'commands', `${slug}.md`),
    join(root, '.thesmos', 'agents', `${slug}-agent.md`),
  ];
  for (const p of local) {
    if (existsSync(p)) return p;
  }

  // Accept bare god names / full pantheon ids against the shipped catalog
  const pantheonDir = PACKAGE_PANTHEON_CANDIDATES.find((d) => existsSync(d));
  if (pantheonDir) {
    const candidates = [
      join(pantheonDir, `${slug}.md`),
      join(pantheonDir, `${slug}-agent.md`),
    ];
    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }
  return null;
}

function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md.trim();
  const end = md.indexOf('\n---', 3);
  if (end === -1) return md.trim();
  return md.slice(end + 4).trim();
}

export function buildAgentRunPrompt(agentBody: string, extraPrompt?: string): string {
  const body = stripFrontmatter(agentBody).slice(0, 8000);
  const parts = [
    'You are the agent defined below. Follow your instructions and produce the deliverable.',
    '',
    '--- AGENT DEFINITION ---',
    body,
    '--- END AGENT DEFINITION ---',
  ];
  if (extraPrompt?.trim()) {
    parts.push('', 'User request:', extraPrompt.trim());
  }
  parts.push('', 'End with a line: TASK COMPLETE— <one-sentence summary>');
  return parts.join('\n');
}

export async function cmdAgentRun(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags, positionals } = parseArgs(argv, { valueFlags: ['prompt'] });
  const name = positionals[0];
  const dryRun = flag(flags, 'dry-run');
  const extraPrompt = flagVal(flags, 'prompt') ?? positionals.slice(1).join(' ').trim();

  if (!name) {
    process.stderr.write(
      'Usage: thesmos agent:run <name> [--dry-run] [--prompt "..."]\n' +
        'Resolves agent markdown under .thesmos/agents, .thesmos/catalog/agents, or .claude/commands.\n',
    );
    process.exit(1);
  }

  const agentPath = resolveAgentPath(root, name);
  if (!agentPath) {
    process.stderr.write(
      `agent:run: agent not found: ${name}\n` +
        `Looked in .thesmos/agents/, .thesmos/catalog/agents/, .claude/commands/, and the Pantheon catalog.\n`,
    );
    process.exit(1);
  }

  const body = readFileSync(agentPath, 'utf8');
  const prompt = buildAgentRunPrompt(body, extraPrompt || undefined);

  process.stdout.write(`\nagent:run ${name}\n`);
  process.stdout.write(`  Source: ${agentPath}\n`);

  if (dryRun) {
    process.stdout.write(`  Mode:   dry-run (no adapter call)\n\n`);
    process.stdout.write('── Prompt preview ──\n');
    process.stdout.write(prompt.slice(0, 2000));
    if (prompt.length > 2000) process.stdout.write('\n…\n');
    process.stdout.write('\n── End preview ──\n\n');
    return;
  }

  const sessionId = randomUUID();
  const invocationId = randomUUID();
  const adapter = createAdapter(config.autopilot?.adapter ?? 'claude', {
    httpUrl: config.autopilot?.httpAdapterUrl,
    dangerouslySkipPermissions: config.autopilot?.dangerouslySkipPermissions === true,
  });

  process.stdout.write(`  Adapter: ${adapter.name}\n`);
  process.stdout.write(`  Executing...\n\n`);

  logAgentSpawn(root, {
    sessionId,
    agentId: invocationId,
    description: `agent:run ${name}`,
    subagentType: name,
  });

  const tmpDir = mkdtempSync(join(tmpdir(), 'thesmos-agent-run-'));
  const logPath = join(tmpDir, `${name}.log`);
  const started = Date.now();

  const result = await adapter.execute(prompt, {
    timeoutMs: (config.autopilot?.taskTimeoutMinutes ?? 10) * 60 * 1000,
    logPath,
    sessionId,
    taskIndex: 0,
  });

  const durationMs = Date.now() - started;
  if (result.success) {
    logAgentComplete(root, {
      sessionId,
      agentId: invocationId,
      durationMs,
      resultSummary: (result.summary ?? 'ok').slice(0, 200),
    });
    process.stdout.write(`✓ Complete (${durationMs}ms)\n`);
    if (result.summary) process.stdout.write(`  ${result.summary}\n`);
    process.stdout.write(`  Log: ${logPath}\n\n`);
  } else {
    logAgentError(root, {
      sessionId,
      agentId: invocationId,
      durationMs,
      resultSummary: result.timedOut ? 'timed out' : `exit ${result.exitCode}`,
    });
    process.stderr.write(
      `✗ Failed (${result.timedOut ? 'timed out' : `exit ${result.exitCode}`})\n` +
        `  Log: ${logPath}\n\n`,
    );
    process.exit(1);
  }
}
