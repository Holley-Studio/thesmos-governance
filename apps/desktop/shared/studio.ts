// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// Data-only contract shared by the desktop and its governed runtime.
export type JobState = 'planned' | 'running' | 'review' | 'approved' | 'failed' | 'cancelled';
/** Engines billed per use to the user's own API account. Off unless enabled in Settings. */
export type ApiWorkerId = 'claude-api' | 'openai-api' | 'gemini-api';
export const API_WORKERS: readonly ApiWorkerId[] = ['claude-api', 'openai-api', 'gemini-api'];
export const isApiWorker = (id: unknown): id is ApiWorkerId => API_WORKERS.includes(id as ApiWorkerId);
export const API_COMPANY: Record<ApiWorkerId, string> = { 'claude-api': 'Anthropic', 'openai-api': 'OpenAI', 'gemini-api': 'Google' };
export type WorkerId = 'evidence' | 'ollama' | 'codex' | 'claude' | ApiWorkerId;
export interface Playbook {
  id: string; name: string; category: string; description: string;
  owner: string; reviewer: string; worker: WorkerId; cadence: string;
  steps: string[]; acceptance: string[]; output: string; instruction: string;
}
export interface StudioProject {
  id: string; name: string; root: string; kind: 'ohw' | 'studio' | 'client'; createdAt: string;
}
export interface SourceEvidence {
  id: string; path: string; sha256: string; capturedAt: string; excerpt: string; content?: string;
}
export interface Finding {
  id: string; severity: 'blocker' | 'attention' | 'info'; title: string;
  evidence: string; recommendation: string; sourceId: string;
}
export interface QualityCheck { name: string; passed: boolean; detail: string }
export interface StudioJob {
  id: string; projectId: string; playbookId: string; title: string; brief: string;
  owner: string; reviewer: string; state: JobState; createdAt: string; updatedAt: string;
  dueAt?: string; worker?: WorkerId; model?: string; attempts: number;
  stage: string; error?: string; artifactId?: string; reviewNote?: string;
  durationMs?: number; inputTokens?: number; outputTokens?: number;
  /** Set when the job was imported from a Holley Studio portal request. */
  portalRequest?: { requestId: string; revision: number };
}
export interface StudioArtifact {
  id: string; jobId: string; title: string; content: string; sha256: string;
  createdAt: string; sources: SourceEvidence[]; findings: Finding[];
  checks: QualityCheck[]; worker: WorkerId; model?: string;
}
export interface StudioEvent {
  id: string; jobId?: string; at: string; action: string; detail: string;
}
export interface Connection {
  id: string; name: string; kind: 'model' | 'business';
  state: 'ready' | 'signin' | 'missing' | 'unverified' | 'planned';
  detail: string; models?: string[]; billing: string;
  /** API-key engines only. Never carries the key or any part of it. */
  api?: { hasKey: boolean; verified: boolean; model: string; enabled: boolean };
}
/** A subscription or local engine is usable when ready; an API engine needs the setting, a key and a chosen model. */
export const workerReady = (connections: Connection[], id: string): boolean => {
  const c = connections.find((item) => item.id === id);
  return isApiWorker(id) ? Boolean(c?.api?.enabled && c.api.hasKey && c.api.model) : c?.state === 'ready';
};
export interface StudioSnapshot {
  projects: StudioProject[]; jobs: StudioJob[]; artifacts: ArtifactSummary[];
  events: StudioEvent[]; playbooks: Playbook[]; dataDir: string;
  policy: { concurrency: number; maxAttempts: number; cloudAutomatic: false; externalActions: false };
}
export type ArtifactSummary = Omit<StudioArtifact, 'content' | 'sources'> & { sourceCount: number };

export interface KnowledgeView {
  scope: 'studio' | 'ohw'; root: string; connected: boolean; documents: number; stale: boolean;
  lastSyncedAt?: string; taskSourceUrl?: string; bridge: string; warnings: string[];
  hits: Array<{ id: string; title: string; path: string; text: string; sourceUrl: string; syncedAt: string; status: string; score: number }>;
  tasks: Array<{ id: string; title: string; owner: string; status: string; nextStep: string; due: string }>;
}
