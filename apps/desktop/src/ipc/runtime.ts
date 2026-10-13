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

import type { RagBundle, RagStatus } from '../../shared/rag';
import type { DriveStatus, DriveFileView, DriveAuthStatus } from '../../shared/drive';
import { invoke } from '@tauri-apps/api/core';
import type { Connection, StudioSnapshot, StudioJob, StudioArtifact, WorkerId, KnowledgeView } from '../../shared/studio';
import type { CouncilThread, ThreadSummary, ChatEngine } from '../../shared/chat';

export type RuntimeMethod =
  | 'runtime.health'
  | 'runtime.shutdown'
  | 'providers.list'
  | 'memory.search'
  | 'memory.stats'
  | 'project.open'
  | 'pantheon.list'
  | 'channel.get'
  | 'channel.postMessage'
  | 'channel.getMessages'
  | 'studio.snapshot'
  | 'brief.read'
  | 'finance.read' | 'finance.preview' | 'finance.commit' | 'finance.backup'
  | 'chat.list' | 'chat.get' | 'chat.create' | 'chat.send' | 'chat.stop' | 'chat.delete'
  | 'rag.status' | 'rag.rebuild' | 'rag.cancel' | 'rag.search' | 'rag.source'
  | 'drive.status' | 'drive.files' | 'drive.search' | 'drive.source'
  | 'settings.get' | 'settings.set'
  | 'studio.knowledge'
  | 'studio.backup'
  | 'studio.artifact'
  | 'studio.connections'
  | 'studio.createJob'
  | 'studio.runJob'
  | 'studio.cancelJob'
  | 'studio.reviewJob'
  | 'studio.exportJob';

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

export interface PantheonAgentSummary {
  id: string;
  god: string;
  name: string;
  role: string;
  emoji: string;
  tags: string[];
  version: string;
}

export interface ChannelDefinitionSummary {
  id: string;
  name: string;
  agentIds: string[];
}

export interface ChannelMessageSummary {
  id: string;
  seq: number;
  ts: string;
  authorId: string;
  authorType: 'user' | 'agent';
  text: string;
  round: number;
}

export const runtime = {
  finance: () => call<import('../../shared/finance').FinanceLedger>('finance.read'),
  financePreview: (input: import('../../shared/finance').FinanceInput) => call<import('../../shared/finance').FinancePreview>('finance.preview', { ...input }),
  financeCommit: (input: import('../../shared/finance').FinanceInput, preview: import('../../shared/finance').FinancePreview, acknowledgeRepeated: boolean) => call<import('../../shared/finance').FinanceLedger>('finance.commit', { ...input, revision: preview.revision, fileHash: preview.fileHash, previewKey: preview.previewKey, confirm: true, acknowledgeRepeated }),
  financeBackup: () => call<{path: string; sha256: string}>('finance.backup'),
  brief: () => call<import('../../shared/brief').BriefView>('brief.read'),
  chatList: (projectId: string) => call<ThreadSummary[]>('chat.list', { projectId }),
  chatGet: (threadId: string) => call<CouncilThread>('chat.get', { threadId }),
  chatCreate: (projectId: string, god: string, engine: ChatEngine, allowCloud: boolean) => call<CouncilThread>('chat.create', { projectId, god, engine, allowCloud }),
  chatSend: (thread: CouncilThread, text: string, requestId: string, allowCloud: boolean, useKnowledge = false, knowledgeLibrary: 'project'|'drive' = 'project') => call<CouncilThread>('chat.send', { threadId: thread.id, revision: thread.revision, text, requestId, allowCloud, useKnowledge, ...(useKnowledge ? {knowledgeLibrary} : {}) }),
  driveStatus: () => call<DriveStatus>('drive.status'),
  driveFiles: (limit = 100, offset = 0, query = '') => call<DriveFileView[]>('drive.files',{limit,offset,query}),
  driveSearch: (query: string) => call<RagBundle>('drive.search',{query}),
  chatStop: (threadId: string) => call<CouncilThread>('chat.stop', { threadId }),
  chatDelete: (threadId: string) => call<{ deleted: true }>('chat.delete', { threadId }),
  studio: () => call<StudioSnapshot>('studio.snapshot'),
  ragStatus: (projectId: string) => call<RagStatus>('rag.status', { projectId }),
  ragRebuild: (projectId: string) => call<{accepted: true; status: RagStatus}>('rag.rebuild', { projectId }),
  ragCancel: (projectId: string) => call<RagStatus>('rag.cancel', { projectId }),
  ragSearch: (projectId: string, query: string) => call<RagBundle>('rag.search', { projectId, query }),
  knowledge: (projectId: string, query = '') => call<KnowledgeView>('studio.knowledge', { projectId, query }),
  backup: () => call<{ path: string; sha256: string }>('studio.backup'),
  artifact: (artifactId: string) => call<StudioArtifact>('studio.artifact', { artifactId }),
  connections: () => call<Connection[]>('studio.connections'),
  settings: () => call<SettingsView>('settings.get'),
  saveSettings: (values: Partial<PantheonSettings>) => call<SettingsView>('settings.set', { values }),
  createJob: (params: { projectId: string; playbookId: string; brief: string; dueAt?: string; requestId: string }) => call<StudioJob>('studio.createJob', params),
  runJob: (jobId: string, worker: WorkerId) => call<{ accepted: true; job: StudioJob }>('studio.runJob', { jobId, worker, allowCloud: worker === 'codex' || worker === 'claude' }),
  cancelJob: (jobId: string) => call<StudioJob>('studio.cancelJob', { jobId }),
  reviewJob: (jobId: string, action: 'approve' | 'revise', note: string) => call<StudioJob>('studio.reviewJob', { jobId, action, note }),
  exportJob: (jobId: string) => call<{ path: string; integrity: string }>('studio.exportJob', { jobId }),
  health: () => call<RuntimeHealth>('runtime.health'),
  providers: () => call<ProviderSummary[]>('providers.list'),
  memoryStats: () => call<MemoryStats>('memory.stats'),
  memorySearch: (query: string, limit = 20) =>
    call<{ results: MemoryHit[]; telemetry: Record<string, unknown> }>('memory.search', {
      query,
      limit,
    }),
  pantheon: () =>
    call<{
      agents: PantheonAgentSummary[];
      routableCount: number;
      holdbackFilterApplied: boolean;
      populations?: {
        availableAgentCount: number;
        heldBackAgentCount: number;
        internalReviewerCount: number;
        catalogAgentCount: number;
        freeAgentCount: number;
        proAgentCount: number;
      };
    }>('pantheon.list'),
  openProject: (root: string) =>
    call<{ projectRoot: string; memory: RuntimeHealth['memory'] }>('project.open', { root }),
  channel: (channelId?: string) => call<ChannelDefinitionSummary>('channel.get', { channelId }),
  postToChannel: (text: string, opts: { channelId?: string; providerId?: string } = {}) =>
    call<{ accepted: true; message: ChannelMessageSummary; respondingAgentIds: string[] }>(
      'channel.postMessage',
      { text, ...opts },
    ),
  channelMessages: (opts: { channelId?: string; sinceSeq?: number } = {}) =>
    call<{ messages: ChannelMessageSummary[] }>('channel.getMessages', opts),
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

export async function openExports(): Promise<void> { return invoke('open_exports'); }
export async function openChatGPT(): Promise<void> { return invoke('open_chatgpt'); }
export async function openGoogle(destination: { service: 'gmail' | 'calendar'; account: string; reference?: string }): Promise<void> { return invoke('open_google', { service: destination.service, account: destination.account, reference: destination.reference ?? null }); }
export async function connectSubscription(provider: 'codex' | 'claude'): Promise<void> { return invoke('connect_subscription', { provider }); }

export async function openKnowledgeSource(projectId: string, sourceId: string): Promise<void> { return invoke('open_knowledge_source', { projectId, sourceId }); }
export interface UpdateRelease { version: string; notes: string; publishedAt: string; size: number }
export interface UpdateStatus { current: string; channel: string | null; available: UpdateRelease | null; latest: string | null; problem: string | null }
export const updateStatus = () => invoke<UpdateStatus>('update_status');
/** Installs what the update folder offers and restarts. Takes no arguments by design. */
export const updateInstall = () => invoke<void>('update_install');
export type PreferredWorker = 'playbook' | 'ollama' | 'codex' | 'claude';
export interface PantheonSettings { displayName: string; studioName: string; preferredWorker: PreferredWorker; ollamaEndpoint: string; portalUrl: string }
export interface SettingsView { settings: PantheonSettings; activeOllama: string; ollamaIsLocal: boolean; restartRequired?: boolean }
/** Native folder picker for the update folder. Resolves the new status, or null when cancelled. */
export const chooseUpdateFolder = () => invoke<UpdateStatus | null>('update_choose_folder');
/** Go back to finding the studio release folder automatically. */
export const resetUpdateFolder = () => invoke<UpdateStatus>('update_reset_folder');
/** Opens the portal address from Settings in the browser. */
export const openPortal = () => invoke<void>('open_portal');
/** Native file picker, then a planned job. Resolves null when the picker is cancelled. */
export const importPortalRequest = (projectId: string, playbookId: string) => invoke<StudioJob | null>('import_portal_request', { projectId, playbookId });
export const driveAuthStatus = () => invoke<DriveAuthStatus>('drive_auth_status');
export const configureDrive = (clientConfig: string) => invoke<DriveAuthStatus>('drive_configure', {clientConfig});
export const connectDrive = () => invoke<DriveAuthStatus>('drive_connect');
export const disconnectDrive = () => invoke<DriveAuthStatus>('drive_disconnect');
export const syncDrive = () => invoke('drive_sync_now');
export const pauseDrive = () => invoke('drive_pause');
export const resumeDrive = () => invoke('drive_resume');
export const openDriveSource = (sourceId: string) => invoke<void>('open_drive_source', {sourceId});
