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
import { OllamaProvider } from '../../../thesmos/runtime/providers/ollama/provider.js';
import { ProviderRegistry } from '../../../thesmos/runtime/registry.js';
import { MnemosyneService } from '../../../thesmos/memory/service.js';
import { MemoryStore } from '../../../thesmos/memory/store.js';
import type {
  RuntimeHealth,
  RuntimeMethod,
  RuntimeOutbound,
  RuntimeRequest,
} from './protocol.js';

const VERSION = '0.1.0-alpha.0';
const startedAt = Date.now();

/**
 * The project root, set only by an explicit `project.open`.
 *
 * Never defaulted to cwd. A runtime that silently adopts whatever directory it
 * happened to launch in would give the app filesystem reach the user never
 * granted — the opposite of the narrow-grant model the desktop promises.
 */
let projectRoot: string | undefined;

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

const handlers: Record<RuntimeMethod, (params: Record<string, unknown>) => Promise<unknown>> = {
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
    setTimeout(() => process.exit(0), 10);
    return { stopping: true };
  },

  'providers.list': async () => {
    const registry = new ProviderRegistry();
    registry.register(new OllamaProvider());
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

  'project.open': async (params) => {
    const root = params.root;
    if (typeof root !== 'string' || !root.trim()) {
      throw new Error('project.open requires a root path');
    }
    // The shell resolves and validates the path against a user grant before it
    // reaches here; the runtime records it rather than discovering it.
    projectRoot = root;
    return { projectRoot, memory: memoryHealth() };
  },
};

async function handle(request: RuntimeRequest): Promise<void> {
  const handler = handlers[request.method];
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
rl.on('close', () => process.exit(0));

process.on('uncaughtException', (err) => {
  send({ event: 'runtime.error', payload: { message: err.message } });
});
process.on('unhandledRejection', (reason) => {
  send({ event: 'runtime.error', payload: { message: String(reason) } });
});

send({ event: 'runtime.ready', payload: { version: VERSION, pid: process.pid } });
