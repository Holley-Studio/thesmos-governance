import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { StudioProject, StudioJob, StudioArtifact, StudioEvent, WorkerId, ArtifactSummary } from '../../shared/studio.js';
import { getPlaybook } from './playbooks.js';
import type { CouncilThread, ThreadSummary } from '../../shared/chat.js';

const now = () => new Date().toISOString();
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const MAX_ATTEMPTS = 3;

/** Private knowledge authorization is derived from canonical roots, never legacy labels. */
export function registeredProjectKind(root: string): StudioProject['kind'] {
  let canonical: string;
  try { canonical = realpathSync.native(root).toLowerCase(); } catch { return 'client'; }
  const knownRoot = join(homedir(), 'Desktop', 'GitHub Repos', 'Holley-Studio');
  const matches = (name: string) => {
    try { return realpathSync.native(join(knownRoot, name)).toLowerCase() === canonical; }
    catch { return false; }
  };
  return matches('otter-house-wellness') ? 'ohw' : matches('thesmos-governance') ? 'studio' : 'client';
}

export class StudioStore {
  private readonly db: DatabaseSync;
  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'studio.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
      INSERT OR IGNORE INTO schema_version VALUES (1);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, root TEXT NOT NULL UNIQUE, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, at TEXT NOT NULL, job_id TEXT, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS council_chats (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id);
      CREATE INDEX IF NOT EXISTS events_at ON events(at);`);
    const version = this.db.prepare('SELECT MAX(version) AS version FROM schema_version').get()?.version;
    if (version !== 1) throw new Error('This workspace was created by a newer Pantheon. Update the app before opening it.');
    // Revalidate earlier registrations without changing project IDs or their work.
    for (const project of this.projects()) {
      const kind = registeredProjectKind(project.root);
      if (kind !== project.kind) this.db.prepare('UPDATE projects SET body = ? WHERE id = ?').run(JSON.stringify({ ...project, kind }), project.id);
    }
    // No automatic paid retries after a crash. The interrupted attempt is visible.
    for (const job of this.jobs().filter((j) => j.state === 'running')) {
      this.saveJob({ ...job, state: 'failed', stage: 'Interrupted', error: 'The app stopped during this job. Review the log and retry explicitly.', updatedAt: now() });
      this.event('interrupted', 'Recovered an interrupted job; no automatic retry.', job.id);
    }
  }
  /**
   * Fold the write-ahead log back into studio.sqlite.
   *
   * The runtime exits without closing this database (an aborted worker may
   * still settle), and SQLite only checkpoints on close. Without an explicit
   * checkpoint the main file stayed at its empty size and every job lived only
   * in studio.sqlite-wal, so copying the database file alone lost the work.
   */
  checkpoint(): void {
    try { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); } catch { /* best effort: never block an exit */ }
  }
  close(): void { this.checkpoint(); this.db.close(); }
  chatThreads(projectId?: string): CouncilThread[] {
    const rows = projectId ? this.db.prepare('SELECT body FROM council_chats WHERE project_id = ? ORDER BY rowid DESC').all(projectId)
      : this.db.prepare('SELECT body FROM council_chats ORDER BY rowid DESC').all();
    return rows.map((r) => JSON.parse(String(r.body)) as CouncilThread);
  }
  chatSummaries(projectId: string): ThreadSummary[] {
    return this.chatThreads(projectId).map(({ messages, ...thread }) => ({ ...thread, messageCount: messages.length, pending: messages.some((m) => m.state === 'pending') })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  chat(id: string): CouncilThread {
    const row = this.db.prepare('SELECT body FROM council_chats WHERE id = ?').get(id);
    if (!row) throw new Error('Conversation not found');
    return JSON.parse(String(row.body));
  }
  insertChat(thread: CouncilThread): void {
    this.db.prepare('INSERT INTO council_chats VALUES (?, ?, ?)').run(thread.id, thread.projectId, JSON.stringify(thread));
  }
  saveChat(thread: CouncilThread): void {
    const result = this.db.prepare("UPDATE council_chats SET body = ? WHERE id = ? AND json_extract(body, '$.revision') = ?").run(JSON.stringify(thread), thread.id, thread.revision - 1);
    if (result.changes !== 1) throw new Error('Conversation changed. Refresh before continuing.');
  }
  deleteChat(id: string): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM council_chats WHERE id = ?').run(id);
      this.event('conversation-deleted', `Local conversation ${id} removed. Content was not retained in this event.`);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  backup(): { path: string; sha256: string } {
    const folder = join(this.dataDir, 'backups'); mkdirSync(folder, { recursive: true });
    const path = join(folder, `studio-${Date.now()}-${randomUUID().slice(0, 8)}.sqlite`);
    // VACUUM INTO includes committed WAL data in a consistent standalone copy.
    this.db.prepare('VACUUM INTO ?').run(path);
    const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
    writeFileSync(path + '.sha256', hash + '\n', 'utf8');
    this.event('backup-created', 'Consistent business database snapshot saved locally.');
    return { path, sha256: hash };
  }
  private all<T>(table: 'projects' | 'jobs' | 'artifacts' | 'events'): T[] {
    const queries = { projects: 'SELECT body FROM projects ORDER BY rowid DESC', jobs: 'SELECT body FROM jobs ORDER BY rowid DESC',
      artifacts: 'SELECT body FROM artifacts ORDER BY rowid DESC', events: 'SELECT body FROM events ORDER BY rowid DESC' };
    return this.db.prepare(queries[table]).all().map((row) => JSON.parse(String(row.body)) as T);
  }
  projects(): StudioProject[] { return this.all('projects'); }
  jobs(): StudioJob[] { return this.all('jobs'); }
  artifacts(): StudioArtifact[] { return this.all('artifacts'); }
  artifactSummaries(): ArtifactSummary[] {
    return this.db.prepare("SELECT json_remove(body, '$.content', '$.sources') AS body, json_array_length(body, '$.sources') AS source_count FROM artifacts ORDER BY rowid DESC").all().map((row) => ({ ...JSON.parse(String(row.body)), sourceCount: Number(row.source_count) }));
  }
  events(): StudioEvent[] { return this.db.prepare('SELECT body FROM events ORDER BY rowid DESC LIMIT 100').all().map((row) => JSON.parse(String(row.body)) as StudioEvent); }
  project(id: string): StudioProject {
    const value = this.db.prepare('SELECT body FROM projects WHERE id = ?').get(id);
    if (!value) throw new Error('Open a project first');
    return JSON.parse(String(value.body));
  }
  job(id: string): StudioJob {
    const value = this.db.prepare('SELECT body FROM jobs WHERE id = ?').get(id);
    if (!value) throw new Error('Job not found');
    return JSON.parse(String(value.body));
  }
  artifact(id: string): StudioArtifact {
    const value = this.db.prepare('SELECT body FROM artifacts WHERE id = ?').get(id);
    if (!value) throw new Error('Deliverable not found');
    const artifact = JSON.parse(String(value.body)) as StudioArtifact;
    if (sha256(artifact.content) !== artifact.sha256) throw new Error('Deliverable integrity check failed');
    return artifact;
  }
  register(root: string): StudioProject {
    const canonical = realpathSync.native(root);
    const existing = this.projects().find((p) => p.root.toLowerCase() === canonical.toLowerCase());
    const kind = registeredProjectKind(canonical);
    if (existing) {
      if (existing.kind === kind) return existing;
      const updated = { ...existing, kind };
      this.db.prepare('UPDATE projects SET body = ? WHERE id = ?').run(JSON.stringify(updated), existing.id);
      return updated;
    }
    const project: StudioProject = { id: randomUUID(), name: kind === 'ohw' ? 'Otter House Wellness' : basename(canonical), root: canonical, kind, createdAt: now() };
    this.db.prepare('INSERT INTO projects VALUES (?, ?, ?)').run(project.id, canonical, JSON.stringify(project));
    this.event('project-opened', `${project.name} workspace connected.`);
    return project;
  }
  createJob(params: { projectId: string; playbookId: string; brief: string; dueAt?: string; requestId: string; portalRequest?: { requestId: string; revision: number } }): StudioJob {
    this.project(params.projectId);
    const playbook = getPlaybook(params.playbookId);
    if (!/^[a-zA-Z0-9-]{12,80}$/.test(params.requestId)) throw new Error('A valid request ID is required');
    if (typeof params.brief !== 'string' || params.brief.trim().length > 8000) throw new Error('Keep the brief under 8,000 characters');
    if (params.dueAt !== undefined && (typeof params.dueAt !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(params.dueAt) || !Number.isFinite(Date.parse(params.dueAt)) || new Date(params.dueAt).toISOString().slice(0, 10) !== params.dueAt)) throw new Error('Use a valid due date');
    const existing = this.db.prepare('SELECT body FROM jobs WHERE id = ?').get(params.requestId);
    if (existing) {
      const job = JSON.parse(String(existing.body)) as StudioJob;
      if (job.projectId !== params.projectId || job.playbookId !== params.playbookId || job.brief !== params.brief.trim() || job.dueAt !== params.dueAt) throw new Error('This request ID was already used for a different assignment');
      return job;
    }
    const job: StudioJob = {
      id: params.requestId, projectId: params.projectId, playbookId: playbook.id, title: playbook.name,
      brief: params.brief.trim(), owner: playbook.owner, reviewer: playbook.reviewer,
      state: 'planned', stage: 'Ready to start', attempts: 0, createdAt: now(), updatedAt: now(), dueAt: params.dueAt,
      ...(params.portalRequest ? { portalRequest: params.portalRequest } : {}),
    };
    this.db.prepare('INSERT INTO jobs VALUES (?, ?, ?, ?)').run(job.id, job.projectId, job.state, JSON.stringify(job));
    this.event('job-created', `${job.owner} assigned ${job.title}.`, job.id);
    return job;
  }
  saveJob(job: StudioJob): void {
    this.db.prepare('UPDATE jobs SET state = ?, body = ? WHERE id = ?').run(job.state, JSON.stringify(job), job.id);
  }
  startJob(id: string, worker: WorkerId): StudioJob {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const job = this.job(id);
      if (!['planned', 'failed', 'cancelled'].includes(job.state)) throw new Error('This job must be revised before another attempt');
      if (job.attempts >= MAX_ATTEMPTS) throw new Error('Attempt limit reached. Create a new job with a corrected brief.');
      if (this.db.prepare("SELECT id FROM jobs WHERE state = 'running' LIMIT 1").get()) throw new Error('Another job is running. Let it finish or stop it first.');
      const started: StudioJob = { ...job, state: 'running', stage: 'Gathering evidence', worker, attempts: job.attempts + 1, updatedAt: now(), error: undefined, artifactId: undefined, reviewNote: undefined };
      this.saveJob(started);
      this.event('job-started', `${worker} · attempt ${started.attempts}.`, id);
      this.db.exec('COMMIT');
      return started;
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  finish(jobId: string, artifact: StudioArtifact, usage: Partial<StudioJob>): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const job = this.job(jobId);
      if (job.state !== 'running') throw new Error('Job is no longer running');
      this.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?)').run(artifact.id, jobId, JSON.stringify(artifact));
      this.saveJob({ ...job, ...usage, state: 'review', stage: 'Awaiting your review', artifactId: artifact.id, updatedAt: now() });
      this.event('review-ready', `${artifact.title} saved. Quality checks and sources attached.`, jobId);
      this.db.exec('COMMIT');
    } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  review(id: string, action: 'approve' | 'revise', note: string): StudioJob {
    const job = this.job(id);
    if (job.state !== 'review') throw new Error('Only a deliverable awaiting review can be approved or revised');
    if (!note.trim() || note.length > 2000) throw new Error('Add a short review note');
    const artifact = this.artifact(job.artifactId!);
    if (action === 'approve' && artifact.checks.some((c) => !c.passed)) throw new Error('Resolve failed quality checks before approval');
    const reviewed: StudioJob = { ...job, state: action === 'approve' ? 'approved' : 'planned', stage: action === 'approve' ? 'Accepted internally' : 'Revision requested', reviewNote: note.trim(), artifactId: action === 'revise' ? undefined : job.artifactId, updatedAt: now(), brief: action === 'revise' ? `${job.brief}\n\nRevision request: ${note.trim()}`.slice(-8000) : job.brief };
    this.saveJob(reviewed);
    this.event(action === 'approve' ? 'approved' : 'revision-requested', note.trim(), id);
    return reviewed;
  }
  event(action: string, detail: string, jobId?: string): void {
    const event: StudioEvent = { id: randomUUID(), at: now(), action, detail, jobId };
    this.db.prepare('INSERT INTO events VALUES (?, ?, ?, ?)').run(event.id, event.at, jobId ?? null, JSON.stringify(event));
  }
}
