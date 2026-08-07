// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Typed client for the Thesmos Runtime sidecar.
 *
 * The UI never spawns a process, never touches the filesystem and never opens a
 * socket. It calls `invoke('runtime_request', …)` and the Rust shell relays to
 * the sidecar over stdio. That indirection is the security boundary: the
 * webview's entire native surface is this one command plus a folder picker.
 *
 * Method names are a closed union here and again in Rust and again in the
 * sidecar. Three checks sounds redundant; it means a compromised webview cannot
 * invent a method, and a renamed method fails to compile rather than failing at
 * runtime in front of a user.
 */

import { invoke } from '@tauri-apps/api/core';

export type RuntimeMethod =
  | 'runtime.health'
  | 'runtime.shutdown'
  | 'providers.list'
  | 'memory.search'
  | 'memory.stats'
  | 'project.open';

export interface RuntimeHealth {
  status: 'ready' | 'degraded';
  version: string;
  pid: number;
  uptimeMs: number;
  projectRoot?: string;
  memory: { available: boolean; records?: number; detail?: string };
}

export interface ProviderSummary {
  id: string;
  label: string;
  available: boolean;
  endpoint: string;
  locality: 'local' | 'lan' | 'remote';
  latencyMs?: number;
  detail?: string;
  models: Array<{
    id: string;
    label: string;
    billingClass: 'metered-api' | 'subscription' | 'local-compute';
    privacyClass: 'local-only' | 'egress';
    parameterSize?: string;
    contextWindow?: number;
    capabilities: Record<string, boolean | undefined>;
  }>;
}

export interface MemoryHit {
  id: string;
  content: string;
  type: string;
  status: string;
  confidence: string;
  scope: string;
  provenance: { sourceKind: string; creator: string; derivation: string; evidenceRef?: string };
  updatedAt: string;
  relevanceScore: number;
  reasons: string[];
}

export interface MemoryStats {
  total: number;
  active?: number;
  superseded?: number;
  byType?: Record<string, number>;
  vectors?: number;
  detail?: string;
}

/** Thrown when the runtime answers with an error rather than a result. */
export class RuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

async function call<T>(method: RuntimeMethod, params?: Record<string, unknown>): Promise<T> {
  const raw = await invoke<{ ok: boolean; result?: unknown; error?: { code: string; message: string } }>(
    'runtime_request',
    { method, params: params ?? {} },
  );
  if (!raw.ok) {
    throw new RuntimeError(raw.error?.code ?? 'unknown', raw.error?.message ?? 'runtime error');
  }
  return raw.result as T;
}

export const runtime = {
  health: () => call<RuntimeHealth>('runtime.health'),
  providers: () => call<ProviderSummary[]>('providers.list'),
  memoryStats: () => call<MemoryStats>('memory.stats'),
  memorySearch: (query: string, limit = 20) =>
    call<{ results: MemoryHit[]; telemetry: Record<string, unknown> }>('memory.search', {
      query,
      limit,
    }),
  openProject: (root: string) =>
    call<{ projectRoot: string; memory: RuntimeHealth['memory'] }>('project.open', { root }),
};

/**
 * Ask the shell to show a native folder picker.
 *
 * Separate from `runtime.*`: choosing a project is a *grant*, made through the
 * OS dialog the user recognizes, not something the runtime can initiate.
 */
export async function chooseProjectFolder(): Promise<string | null> {
  return invoke<string | null>('choose_project_folder');
}
