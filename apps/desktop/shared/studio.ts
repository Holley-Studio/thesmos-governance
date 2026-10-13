// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// Data-only contract shared by the desktop and its governed runtime.
export type JobState = 'planned' | 'running' | 'review' | 'approved' | 'failed' | 'cancelled';
export type WorkerId = 'evidence' | 'ollama' | 'codex' | 'claude';
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
}
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
