// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Federated agent CLI:
 *   thesmos agents:list [--all] [--json]
 *   thesmos agents:doctor [--json]
 *   thesmos agents:conflicts [--json]
 *   thesmos agent:adopt <path> [--dry-run] [--force] [--no-sync]
 *   thesmos agent:release <agent-id> [--dry-run] [--delete]
 *
 * Exit codes:
 *   0 — success / diagnostics only (doctor with warnings still 0 unless --strict)
 *   1 — usage error or operation failure
 *   2 — CI-relevant conflicts when --strict is passed to doctor/conflicts
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  discoverAgents,
  formatAgentsTable,
  loadPluginAgentMetadata,
} from '../../agent-discovery.ts';
import {
  findManagedByAgentId,
  inspectManagedFile,
  loadManagedManifest,
  normalizeRelPath,
  removeManagedRecord,
  resolveSafePath,
  upsertManagedRecord,
  writeManagedManifestAtomic,
  MANAGED_MANIFEST_REL,
} from '../../agent-ownership.ts';
import {
  AgentInstallError,
  deriveAgentId,
  installAgent,
  syncAdapters,
} from '../../agent-lifecycle.ts';
import { appendAuditEntry } from '../../agent-audit.ts';

// ── agents:list ───────────────────────────────────────────────────────────────

export async function cmdAgentsList(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  // --all is the default federated view; kept for CLI compatibility
  void flag(flags, 'all');

  const result = discoverAgents({
    root,
    pluginAgents: loadPluginAgentMetadata(root),
  });

  if (json) {
    process.stdout.write(JSON.stringify({ agents: result.agents, conflicts: result.conflicts }, null, 2) + '\n');
    return;
  }

  console.log('');
  console.log(formatAgentsTable(result.agents));
  if (result.conflicts.length > 0) {
    console.log(`\n  ${result.conflicts.length} conflict(s)/shadow(s). Run \`thesmos agents:conflicts\` for details.`);
  }
  console.log('');
}

// ── agents:conflicts ──────────────────────────────────────────────────────────

export async function cmdAgentsConflicts(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const strict = flag(flags, 'strict');

  const result = discoverAgents({
    root,
    pluginAgents: loadPluginAgentMetadata(root),
  });

  const relevant = result.conflicts.filter((c) =>
    ['duplicate_id', 'duplicate_name', 'shadow', 'modified_managed', 'legacy_collision', 'missing_managed'].includes(
      c.kind
    )
  );

  if (json) {
    process.stdout.write(JSON.stringify({ conflicts: relevant }, null, 2) + '\n');
  } else if (relevant.length === 0) {
    console.log('\n  No agent conflicts, shadows, or modified managed files.\n');
  } else {
    console.log(`\n  Agent conflicts (${relevant.length})\n`);
    for (const c of relevant) {
      console.log(`── ${c.kind} ──`);
      console.log(c.message);
      if (c.paths?.length) console.log(`  paths: ${c.paths.join(', ')}`);
      console.log('');
    }
  }

  if (strict && relevant.length > 0) process.exit(2);
}

// ── agents:doctor ─────────────────────────────────────────────────────────────

export async function cmdAgentsDoctor(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const strict = flag(flags, 'strict');

  const findings: Array<{ level: 'ok' | 'warn' | 'error'; code: string; message: string }> = [];

  // Manifest validity
  try {
    const manifest = loadManagedManifest(root);
    findings.push({
      level: 'ok',
      code: 'manifest_valid',
      message: `${MANAGED_MANIFEST_REL} loaded (${Object.keys(manifest.files).length} managed file(s)).`,
    });
    for (const [path, record] of Object.entries(manifest.files)) {
      try {
        resolveSafePath(root, path);
      } catch {
        findings.push({
          level: 'error',
          code: 'path_traversal',
          message: `Managed path fails traversal check: ${path}`,
        });
        continue; // never call inspectManagedFile on unsafe keys
      }
      try {
        const inspection = inspectManagedFile(root, path, manifest);
        if (inspection.state === 'missing') {
          findings.push({
            level: 'warn',
            code: 'missing_managed',
            message: `Missing managed file for ${record.agentId}: ${path}`,
          });
        } else if (inspection.state === 'modified') {
          findings.push({
            level: 'warn',
            code: 'modified_managed',
            message: `Modified managed file for ${record.agentId}: ${path}`,
          });
        }
      } catch (inspectErr) {
        findings.push({
          level: 'error',
          code: 'inspect_failed',
          message: `Could not inspect managed file ${path}: ${
            inspectErr instanceof Error ? inspectErr.message : String(inspectErr)
          }`,
        });
      }
    }
  } catch (err) {
    findings.push({
      level: 'error',
      code: 'manifest_invalid',
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const discovery = discoverAgents({
    root,
    pluginAgents: loadPluginAgentMetadata(root),
  });

  for (const c of discovery.conflicts) {
    findings.push({
      level: c.kind === 'duplicate_id' ? 'error' : 'warn',
      code: c.kind,
      message: c.message.split('\n')[0] ?? c.message,
    });
  }

  // Invalid frontmatter (empty id derivation) for project agents
  for (const a of discovery.agents) {
    if (!a.id) {
      findings.push({
        level: 'warn',
        code: 'invalid_frontmatter',
        message: `Agent at ${a.sourcePath ?? a.invocationName} has no usable id.`,
      });
    }
  }

  // Registry consistency: adopted ownership without registry entry is fine;
  // registry entry without canonical file is a warning
  try {
    const regPath = join(root, '.thesmos', 'registry.json');
    if (existsSync(regPath)) {
      const reg = JSON.parse(readFileSync(regPath, 'utf8')) as { agents?: string[] };
      for (const id of reg.agents ?? []) {
        const canonical = join(root, '.thesmos', 'agents', `${id}.md`);
        if (!existsSync(canonical)) {
          findings.push({
            level: 'warn',
            code: 'registry_inconsistency',
            message: `Registry lists "${id}" but .thesmos/agents/${id}.md is missing.`,
          });
        }
      }
    }
  } catch {
    findings.push({
      level: 'warn',
      code: 'registry_inconsistency',
      message: 'Could not parse .thesmos/registry.json.',
    });
  }

  findings.push({
    level: 'ok',
    code: 'discovery_complete',
    message: `Discovered ${discovery.agents.length} agent definition(s).`,
  });

  if (json) {
    process.stdout.write(JSON.stringify({ findings, agents: discovery.agents }, null, 2) + '\n');
  } else {
    console.log('\n  Agents doctor\n');
    for (const f of findings) {
      const mark = f.level === 'ok' ? '✓' : f.level === 'warn' ? '!' : '✗';
      console.log(`  ${mark} [${f.code}] ${f.message}`);
    }
    console.log('');
  }

  const hasError = findings.some((f) => f.level === 'error');
  const hasWarn = findings.some((f) => f.level === 'warn');
  if (hasError) process.exit(1);
  if (strict && hasWarn) process.exit(2);
}

// ── agent:adopt ───────────────────────────────────────────────────────────────

export async function cmdAgentAdopt(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals, flags } = parseArgs(argv);
  const dryRun = flag(flags, 'dry-run');
  const force = flag(flags, 'force');
  const noSync = flag(flags, 'no-sync');

  if (positionals.length === 0) {
    process.stderr.write(
      'agent:adopt: missing <path>\n' +
        'Usage: thesmos agent:adopt <path-to-agent.md> [--dry-run] [--force] [--no-sync]\n'
    );
    process.exit(1);
  }

  const absPath = resolve(positionals[0]!);
  if (!existsSync(absPath)) {
    process.stderr.write(`agent:adopt: not found: ${positionals[0]}\n`);
    process.exit(1);
  }

  let content: string;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch (err) {
    process.stderr.write(`agent:adopt: cannot read: ${String(err)}\n`);
    process.exit(1);
    return;
  }

  const id = deriveAgentId(content, absPath);

  // Warn on duplicates before adopting
  const discovery = discoverAgents({
    root,
    pluginAgents: loadPluginAgentMetadata(root),
  });
  const dupes = discovery.agents.filter(
    (a) => a.id === id && a.sourcePath && resolve(a.sourcePath) !== absPath
  );
  if (dupes.length > 0) {
    process.stderr.write(
      `agent:adopt: warning — adopting "${id}" will create duplicate active definitions:\n`
    );
    for (const d of dupes) {
      process.stderr.write(`  - ${d.origin}/${d.ownership}: ${d.sourcePath ?? d.invocationName}\n`);
    }
  }

  let result;
  try {
    result = installAgent({
      content,
      sourcePath: absPath,
      force,
      dryRun,
      noSync: true, // we control sync below
      root,
    });
  } catch (err) {
    if (err instanceof AgentInstallError) {
      process.stderr.write(err.message + '\n');
      process.exit(1);
    }
    throw err;
  }

  // Mark ownership as adopted for the canonical file (not the Claude surface)
  if (!dryRun) {
    let manifest = loadManagedManifest(root);
    const canonicalRel = normalizeRelPath(`.thesmos/agents/${id}.md`);
    const body = readFileSync(join(root, '.thesmos', 'agents', `${id}.md`), 'utf8');
    manifest = upsertManagedRecord(manifest, canonicalRel, id, body, 'adopted');
    writeManagedManifestAtomic(root, manifest);

    try {
      appendAuditEntry(root, 'AgentAdopt', id, 'INFO', []);
    } catch {
      /* non-fatal */
    }
  }

  if (!dryRun && !noSync) {
    try {
      syncAdapters(root);
    } catch (err) {
      process.stderr.write(`agent:adopt: adapter sync failed: ${String(err)}\n`);
      process.stderr.write('Canonical file and registry are intact. Run `thesmos adapters` to retry.\n');
      process.exit(1);
    }
  }

  console.log(
    dryRun
      ? `\n  [dry-run] Would adopt "${id}" from ${absPath} → .thesmos/agents/${id}.md\n`
      : `\n  ✓ Adopted "${id}" → .thesmos/agents/${id}.md (original preserved)\n`
  );
  for (const w of result.warnings) console.log(`  ! ${w}`);
}

// ── agent:release ─────────────────────────────────────────────────────────────

export async function cmdAgentRelease(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals, flags } = parseArgs(argv);
  const dryRun = flag(flags, 'dry-run');
  const deleteFile = flag(flags, 'delete');

  if (positionals.length === 0) {
    process.stderr.write(
      'agent:release: missing <agent-id>\n' +
        'Usage: thesmos agent:release <agent-id> [--dry-run] [--delete]\n'
    );
    process.exit(1);
  }

  const agentId = positionals[0]!;
  let manifest = loadManagedManifest(root);
  const owned = findManagedByAgentId(manifest, agentId);

  if (owned.length === 0) {
    process.stderr.write(
      `agent:release: "${agentId}" is not in ${MANAGED_MANIFEST_REL}. Nothing to release.\n`
    );
    process.exit(1);
  }

  for (const { path: rel, record } of owned) {
    const inspection = inspectManagedFile(root, rel, manifest);
    if (inspection.state === 'modified' && deleteFile) {
      process.stderr.write(
        `agent:release: refusing to delete modified managed file ${rel} without confirmation.\n` +
          `  Re-run without --delete to release ownership while preserving the file.\n`
      );
      process.exit(1);
    }

    if (dryRun) {
      console.log(`  [dry-run] Would release ownership of ${rel} (${record.source})`);
      if (deleteFile && inspection.state === 'unmodified') {
        console.log(`  [dry-run] Would delete unmodified managed file ${rel}`);
      }
      continue;
    }

    if (deleteFile && inspection.state === 'unmodified') {
      try {
        unlinkSync(resolveSafePath(root, rel));
      } catch {
        /* non-fatal */
      }
    }

    manifest = removeManagedRecord(manifest, rel);
    console.log(`  ✓ Released ${rel} (file ${deleteFile && inspection.state === 'unmodified' ? 'deleted' : 'preserved'})`);
  }

  if (!dryRun) {
    writeManagedManifestAtomic(root, manifest);
    // Remove from registry only when releasing adopted/canonical ownership
    try {
      const regPath = join(root, '.thesmos', 'registry.json');
      if (existsSync(regPath)) {
        const reg = JSON.parse(readFileSync(regPath, 'utf8')) as Record<string, unknown>;
        const agents = (reg['agents'] as string[] | undefined) ?? [];
        if (agents.includes(agentId)) {
          // Keep registry entry by default — release stops file ownership, not catalog presence.
          // Only drop registry when --delete was used on the canonical path.
          const canonical = owned.some((o) => o.path === `.thesmos/agents/${agentId}.md`);
          if (deleteFile && canonical) {
            reg['agents'] = agents.filter((a) => a !== agentId);
            writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n', 'utf8');
            console.log(`  ✓ Removed "${agentId}" from registry`);
          }
        }
      }
    } catch {
      /* non-fatal */
    }
    try {
      appendAuditEntry(root, 'AgentRelease', agentId, 'INFO', []);
    } catch {
      /* */
    }
  }

  console.log('');
}

// ── Shared entry for `thesmos agents <subcommand>` ────────────────────────────

export async function cmdAgents(argv: string[]): Promise<void> {
  const sub = argv[0];
  const rest = argv.slice(1);
  switch (sub) {
    case 'list':
      return cmdAgentsList(rest);
    case 'doctor':
      return cmdAgentsDoctor(rest);
    case 'conflicts':
      return cmdAgentsConflicts(rest);
    case undefined:
    case '--help':
    case '-h':
      process.stdout.write(
        'Usage:\n' +
          '  thesmos agents:list [--all] [--json]\n' +
          '  thesmos agents:doctor [--json] [--strict]\n' +
          '  thesmos agents:conflicts [--json] [--strict]\n'
      );
      return;
    default:
      process.stderr.write(`agents: unknown subcommand "${sub}"\n`);
      process.exit(1);
  }
}
