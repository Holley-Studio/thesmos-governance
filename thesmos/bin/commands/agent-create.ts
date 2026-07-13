// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos agent:create <name> — scaffold a new agent file in .thesmos/agents/
 *
 * Usage:
 *   thesmos agent:create "My Custom Agent"
 *   thesmos agent:create my-agent-id "My Custom Agent"
 *
 * Flags:
 *   --no-sync   Create and register but skip adapter synchronization
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { buildAgentStub } from '../../catalog.ts';
import { toKebabCase, addAgentToRegistry, syncAdapters, AgentInstallError } from '../../agent-lifecycle.ts';
import { appendAuditEntry } from '../../agent-audit.ts';
import { mkdirSync, writeFileSync } from 'node:fs';

export async function cmdAgentCreate(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals, flags } = parseArgs(argv);
  const noSync = flag(flags, 'no-sync');

  let id: string;
  let name: string;

  if (positionals.length === 0) {
    process.stderr.write(
      'agent:create: missing <name>\nUsage: thesmos agent:create "<Agent Name>" [--no-sync]\n'
    );
    process.exit(1);
  }

  if (positionals.length === 1) {
    name = positionals[0]!;
    id = toKebabCase(name);
  } else {
    id = toKebabCase(positionals[0]!);
    name = positionals[1]!;
  }

  if (!/^[a-z0-9-]+$/.test(id) || id.length === 0) {
    process.stderr.write(
      `agent:create: invalid id "${id}" — must be lowercase kebab-case\n`
    );
    process.exit(1);
  }

  const agentsDir = join(root, '.thesmos', 'agents');
  const filePath = join(agentsDir, `${id}.md`);
  const canonicalRel = `.thesmos/agents/${id}.md`;

  if (existsSync(filePath)) {
    process.stderr.write(
      `agent:create: file already exists: ${canonicalRel}\n`
    );
    process.exit(1);
  }

  const content = buildAgentStub(id, name);

  try {
    // Write canonical file
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(filePath, content, 'utf8');

    // Register in registry
    const registryResult = addAgentToRegistry(root, id);

    // Audit — 'AgentCanonicalCreate' covers the canonical-file write + registry update.
    // A second event 'AgentAdapterSync' is appended below after adapter sync completes.
    try {
      appendAuditEntry(root, 'AgentCanonicalCreate', canonicalRel, 'INFO', []);
    } catch {
      // non-fatal
    }

    // Sync adapters
    let adapterPaths: string[] = [];
    if (!noSync) {
      try {
        adapterPaths = syncAdapters(root);
        try { appendAuditEntry(root, 'AgentAdapterSync', id, 'INFO', []); } catch { /**/ }
      } catch (err) {
        try { appendAuditEntry(root, 'AgentAdapterSync', id, 'WARN', []); } catch { /**/ }
        console.error(`\nagent:create: adapter synchronization failed: ${String(err)}`);
        console.error(`Canonical file and registry are intact.`);
        console.error(`Run \`thesmos adapters\` to retry adapter synchronization.`);
        process.exit(1);
      }
    }

    const regLabel = registryResult === 'added' ? 'registry: added' : 'registry: already registered';
    const adapterLabel = noSync
      ? 'adapters: skipped (--no-sync)'
      : adapterPaths.length > 0
      ? `adapters: synchronized (${adapterPaths.length} files)`
      : 'adapters: none written';

    console.log(`agent:create — created custom agent: ${id}`);
    console.log(`  canonical: created ${canonicalRel}`);
    console.log(`  ${regLabel}`);
    console.log(`  ${adapterLabel}`);
    console.log('');
    console.log(`Edit ${canonicalRel} with your agent's logic.`);

    if (noSync) {
      console.log(`\nTo synchronize adapters: thesmos adapters`);
    }
  } catch (err) {
    if (err instanceof AgentInstallError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }
}
