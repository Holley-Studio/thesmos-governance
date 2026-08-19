// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos memory:list    — what is remembered
 * thesmos memory:search  — governed retrieval, semantic when Ollama is up
 * thesmos memory:show    — one record with full provenance
 * thesmos memory:add     — record a decision or fact
 * thesmos memory:forget  — delete a record, mission, or repository
 * thesmos memory:index   — build/refresh embeddings
 * thesmos memory:doctor  — store, index and provider health
 * thesmos memory:stats   — counts by scope, type and status
 *
 * "No opaque hidden memory" is a product requirement, so every stored record
 * must be reachable and explainable from the terminal.
 */

import { loadConfig } from '../../config.js';
import { MnemosyneService } from '../../memory/service.js';
import { MemoryStore } from '../../memory/store.js';
import { indexMemories, resolveEmbeddingModel } from '../../memory/embeddings.js';
import { detectConflicts } from '../../memory/retrieve.js';
import { OllamaProvider } from '../../runtime/providers/ollama/provider.js';
import type { EmbeddingContext } from '../../memory/embeddings.js';
import type { MemoryProposal, MemoryRecord } from '../../memory/types.js';

interface ProvidersConfig {
  ollama?: { enabled?: boolean; baseUrl?: string; embeddingModel?: string };
}

function providersConfig(root: string): ProvidersConfig {
  return (loadConfig(root) as { providers?: ProvidersConfig }).providers ?? {};
}

function flagValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = argv.indexOf(`--${name}`);
  return index !== -1 ? argv[index + 1] : undefined;
}

function service(root: string): MnemosyneService {
  const config = loadConfig(root);
  return new MnemosyneService(root, {
    secretPatterns: config.secretPatterns ?? [],
    repoId: config.project,
  });
}

/**
 * Build an embedding context, or explain why there isn't one.
 *
 * Never throws and never installs anything: semantic retrieval is an
 * enhancement, and its absence must leave structured memory fully working.
 */
async function embeddingContext(
  root: string,
): Promise<{ context?: EmbeddingContext; note: string }> {
  const config = providersConfig(root);
  if (config.ollama?.enabled === false) return { note: 'Ollama disabled in config' };

  const provider = new OllamaProvider({ baseUrl: config.ollama?.baseUrl });
  const health = await provider.health();
  if (!health.available) {
    return { note: `Ollama unavailable (${health.errorCode ?? 'unknown'}) — lexical retrieval only` };
  }

  const resolved = resolveEmbeddingModel(await provider.listModels(), config.ollama?.embeddingModel);
  if ('error' in resolved) return { note: resolved.error };
  if (!resolved.model.embeddingDimensions) {
    return { note: `Model ${resolved.model.id} did not report its vector width — cannot index safely` };
  }

  return {
    context: {
      provider,
      model: resolved.model.id,
      dimensions: resolved.model.embeddingDimensions,
    },
    note: `semantic via ${resolved.model.id} (${resolved.model.embeddingDimensions}d)`,
  };
}

function line(record: MemoryRecord): string {
  const flag = record.status === 'active' ? ' ' : '!';
  const date = (record.updatedAt || record.createdAt).slice(0, 10);
  const head = record.content.replace(/\s+/g, ' ').slice(0, 84);
  return `${flag} ${record.id.slice(0, 8)}  ${date}  ${record.type.padEnd(22)} ${record.confidence.padEnd(8)} ${head}`;
}

export async function cmdMemory(sub: string, argv: string[]): Promise<void> {
  const root = process.cwd();
  const asJson = argv.includes('--json');
  const svc = service(root);

  switch (sub) {
    case 'list': {
      const all = svc.store.all();
      const visible = argv.includes('--all') ? all : all.filter((r) => r.status === 'active');
      if (asJson) {
        console.log(JSON.stringify(visible, null, 2));
        return;
      }
      if (visible.length === 0) {
        console.log('\n  No memories stored. Add one with `thesmos memory:add`.\n');
        return;
      }
      console.log(`\n  ${visible.length} memories (${all.length} total)\n`);
      console.log('    id        date        type                   confidence content');
      for (const record of visible) console.log(`  ${line(record)}`);
      console.log('\n  ! = superseded/expired. Use --all to include them.\n');
      return;
    }

    case 'search': {
      const query = argv.filter((a) => !a.startsWith('--'))[0];
      if (!query) {
        process.stderr.write('Usage: thesmos memory:search "<query>"\n');
        process.exit(1);
      }
      const { context, note } = await embeddingContext(root);
      const outcome = await svc.recall({
        text: query,
        limit: Number(flagValue(argv, 'limit') ?? 10),
        embedding: context,
      });

      if (asJson) {
        console.log(JSON.stringify({ note, ...outcome }, null, 2));
        return;
      }

      console.log(`\n  Query: ${query}`);
      console.log(`  Retrieval: ${note}`);
      console.log(
        `  ${outcome.telemetry.retrieved} of ${outcome.telemetry.candidatesConsidered} considered · ${outcome.telemetry.retrievalMs}ms\n`,
      );
      for (const result of outcome.results) {
        console.log(`  [${result.relevanceScore.toFixed(3)}] ${result.memory.id.slice(0, 8)}`);
        console.log(`    ${result.memory.content.replace(/\s+/g, ' ').slice(0, 100)}`);
        console.log(`    ${result.reasons.join(' · ')}`);
        console.log('');
      }
      if (outcome.capsule.conflicts.length > 0) {
        console.log(`  ⚠ ${outcome.capsule.conflicts.length} unresolved conflict(s) among these results.\n`);
      }
      if (outcome.results.length === 0) console.log('  No matching memories.\n');
      return;
    }

    case 'show': {
      const id = argv.filter((a) => !a.startsWith('--'))[0];
      const record = svc.store.all().find((r) => r.id === id || r.id.startsWith(id ?? '\0'));
      if (!record) {
        process.stderr.write(`No memory matching "${id}"\n`);
        process.exit(1);
      }
      if (asJson) {
        console.log(JSON.stringify(record, null, 2));
        return;
      }
      console.log(`\n  ${record.id}`);
      console.log(`  ${record.content}\n`);
      console.log(`  type        ${record.type}`);
      console.log(`  status      ${record.status}`);
      console.log(`  scope       ${record.scope}`);
      console.log(`  confidence  ${record.confidence}`);
      console.log(`  sensitivity ${record.sensitivity}`);
      console.log(
        `  provenance  ${record.provenance.sourceKind} · ${record.provenance.creator} · ${record.provenance.derivation}`,
      );
      if (record.provenance.evidenceRef) console.log(`  evidence    ${record.provenance.evidenceRef}`);
      if (record.supersedes?.length) console.log(`  supersedes  ${record.supersedes.join(', ')}`);
      if (record.supersededBy?.length) console.log(`  superseded  ${record.supersededBy.join(', ')}`);
      console.log(`  created     ${record.createdAt}`);
      console.log(`  updated     ${record.updatedAt}\n`);
      return;
    }

    case 'add': {
      const content = argv.filter((a) => !a.startsWith('--'))[0];
      if (!content) {
        process.stderr.write('Usage: thesmos memory:add "<content>" [--type=<type>] [--scope=<scope>]\n');
        process.exit(1);
      }
      const proposal: MemoryProposal = {
        scope: (flagValue(argv, 'scope') ?? 'repository') as MemoryProposal['scope'],
        type: (flagValue(argv, 'type') ?? 'user-decision') as MemoryProposal['type'],
        content,
        provenance: {
          sourceKind: 'user',
          creator: flagValue(argv, 'creator') ?? 'cli',
          derivation: 'stated',
        },
        confidence: (flagValue(argv, 'confidence') ?? 'high') as MemoryProposal['confidence'],
        sensitivity: (flagValue(argv, 'sensitivity') ?? 'project') as MemoryProposal['sensitivity'],
        metadata: {},
      };
      const supersedes = flagValue(argv, 'supersedes');
      if (supersedes) proposal.supersedes = supersedes.split(',').map((s) => s.trim());

      const { validation, record } = svc.remember(proposal);
      if (!record) {
        process.stderr.write(`\n  Rejected (${validation.decision}):\n`);
        for (const issue of validation.issues) {
          process.stderr.write(`    ${issue.severity}: ${issue.message}\n`);
        }
        process.stderr.write('\n');
        process.exit(1);
      }
      console.log(`\n  Remembered ${record.id}\n`);
      return;
    }

    case 'forget': {
      const missionId = flagValue(argv, 'mission');
      const repoId = flagValue(argv, 'repo');
      if (missionId) {
        console.log(`\n  Forgot ${svc.forgetMission(missionId)} memories from mission ${missionId}\n`);
        return;
      }
      if (repoId) {
        console.log(`\n  Forgot ${svc.forgetRepository(repoId)} memories from repo ${repoId}\n`);
        return;
      }
      const id = argv.filter((a) => !a.startsWith('--'))[0];
      if (!id) {
        process.stderr.write('Usage: thesmos memory:forget <id> | --mission=<id> | --repo=<id>\n');
        process.exit(1);
      }
      const match = svc.store.all().find((r) => r.id === id || r.id.startsWith(id));
      if (!match || !svc.forgetById(match.id)) {
        process.stderr.write(`No memory matching "${id}"\n`);
        process.exit(1);
      }
      console.log(`\n  Forgot ${match.id} (and its embedding)\n`);
      return;
    }

    case 'index': {
      const { context, note } = await embeddingContext(root);
      if (!context) {
        // exitCode, not exit() — the health probe's socket is still settling.
        process.stderr.write(`\n  Cannot index: ${note}\n\n`);
        process.exitCode = 1;
        return;
      }
      if (argv.includes('--rebuild')) {
        console.log(`  Cleared ${svc.store.clearVectors()} existing vectors.`);
      }
      const started = Date.now();
      const result = await indexMemories(svc.store, svc.store.all(), context);
      console.log(`\n  Indexed with ${note}`);
      console.log(`    embedded          ${result.embedded}`);
      console.log(`    already current   ${result.skippedUpToDate}`);
      console.log(`    skipped sensitive ${result.skippedSensitive}`);
      console.log(`    failed            ${result.failed}`);
      console.log(`    elapsed           ${Date.now() - started}ms\n`);
      return;
    }

    case 'stats': {
      const all = svc.store.all();
      const count = <K extends keyof MemoryRecord>(key: K): Record<string, number> =>
        all.reduce<Record<string, number>>((acc, r) => {
          const value = String(r[key]);
          acc[value] = (acc[value] ?? 0) + 1;
          return acc;
        }, {});
      const stats = {
        total: all.length,
        byStatus: count('status'),
        byType: count('type'),
        byScope: count('scope'),
        bySensitivity: count('sensitivity'),
        vectors: svc.store.vectors().length,
        orphanedVectors: svc.store.orphanedVectors().length,
      };
      if (asJson) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      console.log(`\n  ${stats.total} memories · ${stats.vectors} vectors\n`);
      for (const [label, group] of [
        ['status', stats.byStatus],
        ['type', stats.byType],
        ['scope', stats.byScope],
        ['sensitivity', stats.bySensitivity],
      ] as const) {
        console.log(`  by ${label}:`);
        for (const [k, v] of Object.entries(group)) console.log(`    ${k.padEnd(24)} ${v}`);
      }
      console.log('');
      return;
    }

    case 'doctor': {
      const store = new MemoryStore(root);
      const { records, corruptLines } = store.load();
      const orphans = store.orphanedVectors();
      const conflicts = detectConflicts(records);
      const { note } = await embeddingContext(root);
      const namespaces = new Set(store.vectors().map((v) => v.namespace));

      const checks: Array<[boolean, string]> = [
        [corruptLines.length === 0, corruptLines.length === 0 ? 'record log parses cleanly' : `${corruptLines.length} corrupt line(s): ${corruptLines.join(', ')}`],
        [store.meta().schemaVersion === 1, `schema version ${store.meta().schemaVersion}`],
        [orphans.length === 0, orphans.length === 0 ? 'no orphaned vectors' : `${orphans.length} orphaned vector(s) — run memory:index --rebuild`],
        [namespaces.size <= 1, namespaces.size <= 1 ? `single vector namespace` : `${namespaces.size} namespaces present — incompatible spaces, rebuild recommended`],
        // Conflicts are reported, never auto-resolved.
        [conflicts.length === 0, conflicts.length === 0 ? 'no unresolved conflicts' : `${conflicts.length} unresolved conflict(s)`],
      ];

      console.log('\n  Mnemosyne\n');
      console.log(`  ${records.length} memories · ${store.vectors().length} vectors`);
      console.log(`  embedding: ${note}\n`);
      for (const [pass, message] of checks) console.log(`  ${pass ? '✓' : '✗'}  ${message}`);
      console.log('');

      // Semantic retrieval being unavailable is degradation, not failure — an
      // optional provider must never make the repo look broken.
      //
      // `exitCode` rather than `exit()`: the Ollama health probe leaves a
      // socket handle settling, and forcing exit while it is open trips a
      // libuv assertion on Windows (`UV_HANDLE_CLOSING`). Setting the code lets
      // Node drain and exit with the same status, without the crash.
      if (checks.some(([pass]) => !pass)) process.exitCode = 1;
      return;
    }

    default:
      process.stderr.write(`thesmos memory: unknown subcommand "${sub}"\n`);
      process.stderr.write(
        'Usage: thesmos memory:list | memory:search | memory:show | memory:add | memory:forget | memory:index | memory:stats | memory:doctor\n',
      );
      process.exit(1);
  }
}
