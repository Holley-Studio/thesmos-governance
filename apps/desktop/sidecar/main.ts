// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Thesmos Runtime sidecar — entry point.
 *
 * Long-lived process spawned by the Tauri shell. Owns Thesmos core; the UI owns
 * none of it. Bundled to a single file by esbuild and packaged into a
 * self-contained executable, so an installed user needs no Node.
 *
 * Failure posture: every handler resolves. An unhandled rejection here would
 * kill the runtime and take the app's only intelligence path with it, so errors
 * become error *responses* and the process stays up.
 */

import { createInterface } from 'node:readline';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync } from 'node:fs';
import { StudioService, textParam } from './studio/service.js';
import { CouncilChatService } from './studio/chat.js';
import { RagService } from './studio/rag.js';
import { DriveService } from './studio/drive/service.js';
import { registeredProjectKind } from './studio/store.js';
import { readBrief } from './studio/brief.js';
import { FinanceStore } from './studio/finance.js';
import { godIdentity } from '../shared/pantheon.js';
import { connections } from './studio/workers.js';
import { createProviderRegistry } from './providers.js';
import { SettingsStore } from './studio/settings.js';
import { setOllamaEndpoint, ollamaIsLocal, ollamaOrigin } from './studio/ollama-endpoint.js';
import { MnemosyneService } from '../../../thesmos/memory/service.js';
import { MemoryStore } from '../../../thesmos/memory/store.js';
import { listRoutableAgents } from '../../../thesmos/bin/commands/pantheon.js';
import type {
  RuntimeHealth,
  RuntimeMethod,
  NativeRuntimeMethod,
  RuntimeOutbound,
  RuntimeRequest,
} from './protocol.js';

// Injected by scripts/build-sidecar.mjs from tauri.conf.json, so the runtime,
// the shell and the release manifest all report the same version.
declare const __PANTHEON_VERSION__: string | undefined;
const VERSION = typeof __PANTHEON_VERSION__ === 'string' ? __PANTHEON_VERSION__ : '0.0.0-dev';
const startedAt = Date.now();

/**
 * The project root, set only by an explicit `project.open`.
 *
 * Never defaulted to cwd. A runtime that silently adopts whatever directory it
 * happened to launch in would give the app filesystem reach the user never
 * granted — the opposite of the narrow-grant model the desktop promises.
 */
let projectRoot: string | undefined;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const dataDir = argument('--data-dir') ?? join(process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share'), 'HolleyStudio', 'Pantheon');
if (!isAbsolute(dataDir)) throw new Error('Runtime data directory must be absolute');
// Before any service is built: they capture the Ollama address when constructed.
const settingsStore = new SettingsStore(dataDir);
setOllamaEndpoint(settingsStore.read().ollamaEndpoint);
const settingsView = () => ({ settings: settingsStore.read(), activeOllama: ollamaOrigin(), ollamaIsLocal: ollamaIsLocal() });
const studio = new StudioService(dataDir, () => projectRoot);
const finance = new FinanceStore(dataDir);
const rag = new RagService(dataDir, studio.store, () => projectRoot);
let chat: CouncilChatService;
const drive = new DriveService(dataDir, { onInvalidate: () => chat?.cancelKnowledge('drive') });
chat = new CouncilChatService(studio.store, () => projectRoot,
 () => { const catalog = listRoutableAgents(); if (!catalog.holdbackFilterApplied) throw new Error('The agent availability ledger is unreadable'); return catalog.agents.map((a) => ({ god: godIdentity(a.id, a.god), role: a.role })); },
 () => studio.snapshot().jobs.some((j) => j.state === 'running'), undefined, {
 search: (projectId, query, signal, library) => library === 'drive' ? drive.search(query, signal) : rag.search(projectId, query, signal),
 identity: library => { const status = drive.status(); return library === 'drive' && status.account && status.state !== 'signin' && status.state !== 'disconnected' ? 'drive:' + status.account.id : undefined; },
 });
const initialRoot = argument('--project-root');
if (initialRoot && isAbsolute(initialRoot)) {
  projectRoot = realpathSync.native(initialRoot);
  studio.register(projectRoot);
}

function send(message: RuntimeOutbound): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function memoryHealth(): RuntimeHealth['memory'] {
  if (!projectRoot) return { available: false, detail: 'no project opened' };
  try {
    const { records, corruptLines } = new MemoryStore(projectRoot).load();
    return {
      available: true,
      records: records.length,
      detail: corruptLines.length > 0 ? `${corruptLines.length} corrupt line(s)` : undefined,
    };
  } catch (err) {
    // Degraded, never fatal: memory is additive to the product.
    return { available: false, detail: err instanceof Error ? err.message : 'unreadable' };
  }
}

const handlers: Record<NativeRuntimeMethod, (params: Record<string, unknown>) => Promise<unknown>> = {
  'drive.session': async (params) => drive.setSession({ accountId: textParam(params,'accountId',200), email:textParam(params,'email',320), accessToken:textParam(params,'accessToken',8192), expiresAt:Number(params.expiresAt) }),
  'drive.disconnect': async () => { chat.cancelKnowledge('drive'); return drive.disconnect(); },
  'drive.authState': async (params) => { if(params.state !== 'signin' && params.state !== 'offline') throw new Error('Invalid Drive connection state'); chat.cancelKnowledge('drive'); return drive.setAuthState(params.state); },
  'drive.sync': async (params) => drive.sync(params.force !== false),
  'drive.pause': async () => drive.pause(),
  'drive.resume': async () => drive.sync(true),
  'drive.status': async () => drive.status(),
  'drive.files': async (params) => drive.files(Number(params.limit ?? 100),Number(params.offset ?? 0),typeof params.query === 'string' ? params.query : ''),
  'drive.search': async (params) => drive.search(textParam(params,'query',5200)),
  'drive.source': async (params) => drive.source(textParam(params,'sourceId',200)),
  'finance.read': async () => finance.read(),
  'finance.preview': async (params) => finance.preview(params),
  'finance.commit': async (params) => finance.commit(params),
  'finance.backup': async () => finance.backup(),
  'runtime.health': async () => {
    const memory = memoryHealth();
    const health: RuntimeHealth = {
      status: memory.available || !projectRoot ? 'ready' : 'degraded',
      version: VERSION,
      pid: process.pid,
      uptimeMs: Date.now() - startedAt,
      projectRoot,
      memory,
    };
    return health;
  },

  'runtime.shutdown': async () => {
    // Acknowledge before exiting so the shell sees a clean close rather than a
    // dropped pipe it would have to treat as a crash.
    chat.shutdown(); drive.shutdown(); rag.shutdown(); studio.shutdown();
    setTimeout(() => process.exit(0), 50);
    return { stopping: true };
  },

  'providers.list': async () => {
    const registry = createProviderRegistry();
    const statuses = await registry.statuses();
    return statuses.map((s) => ({
      id: s.id,
      label: s.label,
      available: s.health.available,
      endpoint: s.health.endpoint,
      locality: s.health.locality,
      latencyMs: s.health.latencyMs,
      detail: s.health.detail,
      models: s.models.map((m) => ({
        id: m.id,
        label: m.label,
        billingClass: m.billingClass,
        privacyClass: m.privacyClass,
        parameterSize: m.parameterSize,
        contextWindow: m.contextWindow,
        capabilities: m.capabilities,
      })),
    }));
  },

  'memory.search': async (params) => {
    if (!projectRoot) return { results: [], detail: 'no project opened' };
    const query = typeof params.query === 'string' ? params.query : '';
    const service = new MnemosyneService(projectRoot, { secretPatterns: [] });
    const outcome = await service.recall({
      text: query,
      limit: typeof params.limit === 'number' ? params.limit : 20,
    });
    return {
      results: outcome.results.map((r) => ({
        id: r.memory.id,
        content: r.memory.content,
        type: r.memory.type,
        status: r.memory.status,
        confidence: r.memory.confidence,
        scope: r.memory.scope,
        provenance: r.memory.provenance,
        updatedAt: r.memory.updatedAt,
        relevanceScore: r.relevanceScore,
        reasons: r.reasons,
      })),
      telemetry: outcome.telemetry,
    };
  },

  'memory.stats': async () => {
    if (!projectRoot) return { total: 0, detail: 'no project opened' };
    const store = new MemoryStore(projectRoot);
    const records = store.all();
    const byType: Record<string, number> = {};
    for (const r of records) byType[r.type] = (byType[r.type] ?? 0) + 1;
    return {
      total: records.length,
      active: records.filter((r) => r.status === 'active').length,
      superseded: records.filter((r) => r.status === 'superseded').length,
      byType,
      vectors: store.vectors().length,
    };
  },

  /**
   * The canonical routable agent population.
   *
   * Read from the catalog at call time — the desktop keeps no agent list of its
   * own. A hardcoded copy in the UI would drift the moment an agent is added or
   * held back, which is precisely how agents previously went undiscoverable.
   *
   * Held-back agents are already excluded by `listRoutableAgents`; the desktop
   * never sees them.
   */
  'pantheon.list': async () => {
    const { agents, holdbackFilterApplied, populations } = listRoutableAgents();
    return {
      agents: agents.map((a) => ({
        id: a.id,
        god: godIdentity(a.id, a.god),
        name: `${godIdentity(a.id, a.god)} — ${a.role}`,
        role: a.role,
        emoji: a.emoji,
        tags: a.tags,
        version: a.version,
      })),
      // Reported, never hardcoded, and never asserted as a marketing figure.
      routableCount: agents.length,
      // False means the holdback ledger was unreadable, so this list may include
      // an agent that should be unavailable. Surfaced rather than swallowed.
      holdbackFilterApplied,
      // Canonical populations owned by core catalog services — the desktop
      // never derives or hardcodes these.
      populations,
    };
  },

  'project.open': async (params) => {
    const root = params.root;
    if (typeof root !== 'string' || !root.trim()) {
      throw new Error('project.open requires a root path');
    }
    // The shell resolves and validates the path against a user grant before it
    // reaches here; the runtime records it rather than discovering it.
    const openedRoot = realpathSync.native(root);
    if (projectRoot?.toLowerCase() !== openedRoot.toLowerCase()) {
      chat.shutdown();
      const previous = studio.store.projects().find((project) => project.root.toLowerCase() === projectRoot?.toLowerCase());
      if (previous && registeredProjectKind(previous.root) !== 'client') rag.cancel(previous.id);
    }
    projectRoot = openedRoot;
    studio.register(projectRoot);
    return { projectRoot, memory: memoryHealth() };
  },

  'studio.snapshot': async () => studio.snapshot(),
  'brief.read': async () => readBrief(dataDir),
  'chat.list': async (params) => chat.list(params),
  'chat.get': async (params) => chat.get(params),
  'chat.create': async (params) => chat.create(params),
  'chat.send': async (params) => chat.send(params),
  'chat.stop': async (params) => chat.stop(params),
  'chat.delete': async (params) => chat.delete(params),
  'rag.status': async (params) => rag.status(textParam(params, 'projectId', 80)),
  'rag.rebuild': async (params) => rag.rebuild(textParam(params, 'projectId', 80)),
  'rag.cancel': async (params) => rag.cancel(textParam(params, 'projectId', 80)),
  'rag.search': async (params) => rag.search(textParam(params, 'projectId', 80), textParam(params, 'query', 5200)),
  'rag.source': async (params) => rag.source(textParam(params, 'projectId', 80), textParam(params, 'sourceId', 200)),
  'studio.knowledge': async (params) => studio.knowledge(params),
  'studio.backup': async () => studio.store.backup(),
  'studio.artifact': async (params) => studio.store.artifact(textParam(params, 'artifactId', 80)),
  'studio.connections': async () => connections(dataDir),
  'settings.get': async () => settingsView(),
  // The Ollama address applies at the next start: running services keep the one they were built with.
  'settings.set': async (params) => { settingsStore.update(params.values); const view = settingsView(); return { ...view, restartRequired: view.settings.ollamaEndpoint !== view.activeOllama }; },
  'studio.createJob': async (params) => studio.create(params),
  'studio.importRequest': async (params) => studio.importRequest(params),
  'studio.runJob': async (params) => { if (chat.busy) throw new Error('Finish or stop the council conversation before starting a workboard job'); return studio.run(params); },
  'studio.cancelJob': async (params) => studio.cancel(textParam(params, 'jobId', 80)),
  'studio.reviewJob': async (params) => {
    const action = textParam(params, 'action', 20);
    if (action !== 'approve' && action !== 'revise') throw new Error('Choose approve or revise');
    return studio.store.review(textParam(params, 'jobId', 80), action, textParam(params, 'note', 2000));
  },
  'studio.exportJob': async (params) => studio.export(textParam(params, 'jobId', 80)),

  'channel.get': async () => { throw new Error('Legacy channels are unavailable in the business pilot. Use the workboard.'); },

  /**
   * Returns as soon as the user's message is recorded — the round runs in
   * the background (see thesmos/channel/orchestrator.ts), so this never
   * blocks on an agent turn the way a synchronous mission-execute call would.
   */
  'channel.postMessage': async () => { throw new Error('Legacy channel execution is disabled. Create an explicit workboard job.'); },

  'channel.getMessages': async () => { throw new Error('Legacy channels are unavailable in the business pilot. Use the workboard.'); },
};

async function handle(request: RuntimeRequest): Promise<void> {
  const handler = Object.hasOwn(handlers, request.method) ? handlers[request.method] : undefined;
  if (!handler) {
    send({
      id: request.id,
      ok: false,
      error: { code: 'unknown_method', message: `unknown method "${request.method}"` },
    });
    return;
  }
  try {
    send({ id: request.id, ok: true, result: await handler(request.params ?? {}) });
  } catch (err) {
    send({
      id: request.id,
      ok: false,
      error: {
        code: 'handler_failed',
        message: err instanceof Error ? err.message : String(err),
      },
    });
  }
}

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: RuntimeRequest;
  try {
    request = JSON.parse(trimmed) as RuntimeRequest;
  } catch {
    // Malformed input is ignored rather than fatal — a corrupt frame must not
    // take down a runtime that may be mid-mission.
    return;
  }
  if (typeof request.id !== 'string' || typeof request.method !== 'string') return;
  void handle(request);
});

// Parent went away: exit rather than linger as an orphan.
rl.on('close', () => { chat.shutdown(); drive.shutdown(); rag.shutdown(); studio.shutdown(); process.exit(0); });

// Runs on every exit path (shutdown request, parent pipe closed). Synchronous,
// so it completes before the process goes.
process.on('exit', () => { studio.store.checkpoint(); });

process.on('uncaughtException', (err) => {
  send({ event: 'runtime.error', payload: { message: err.message } });
});
process.on('unhandledRejection', (reason) => {
  send({ event: 'runtime.error', payload: { message: String(reason) } });
});

send({ event: 'runtime.ready', payload: { version: VERSION, pid: process.pid } });
