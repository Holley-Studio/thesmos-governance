// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Mnemosyne — durable local store.
 *
 * Storage choice: newline-delimited JSON plus a sidecar vector file, not
 * SQLite. Three reasons, in priority order:
 *
 *   1. **No native dependency.** `better-sqlite3` needs a compiler toolchain
 *      on every platform Thesmos installs onto. `node:sqlite` is still
 *      experimental on the Node versions this repo supports.
 *   2. **Inspectable.** `.thesmos/memory/records.jsonl` can be read, diffed and
 *      grepped without a client. For a subsystem whose whole promise is "no
 *      opaque hidden memory", that is a feature, not a compromise.
 *   3. **Matches existing convention** — `agent-activity.jsonl` already does
 *      this, so operators have one mental model rather than two.
 *
 * The tradeoff is honest: retrieval is a linear scan. At the volumes Mnemosyne
 * targets (curated project knowledge, not an index of every file) that is
 * milliseconds, and correctness beats scale here. If volume ever justifies it,
 * the store interface is narrow enough to swap.
 *
 * Vectors live in a separate file so the record log stays human-readable —
 * a few thousand floats per line would destroy that.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  MEMORY_SCHEMA_VERSION,
  MEMORY_SCOPE_ORDER,
  CONFIDENCE_WEIGHT,
  SENSITIVITY_ORDER,
  sameMemoryNamespace,
  embeddingNamespace,
  type MemoryProposal,
  type MemoryRecord,
} from './types.js';
import { isObject, isTimestamp, readValidatedJsonl } from '../jsonl.js';

export const MEMORY_DIR = join('.thesmos', 'memory');
export const RECORDS_PATH = join(MEMORY_DIR, 'records.jsonl');
export const VECTORS_PATH = join(MEMORY_DIR, 'vectors.jsonl');
export const META_PATH = join(MEMORY_DIR, 'meta.json');
export const WRITE_LOCK_PATH = join(MEMORY_DIR, '.write.lock');

export class MemoryStoreBusyError extends Error {
  readonly code = 'MEMORY_WRITE_LOCKED';
  constructor() {
    super(
      'Memory writer lock is held by another or interrupted process; retry after it finishes, or inspect .thesmos/memory/.write.lock before recovery'
    );
    this.name = 'MemoryStoreBusyError';
  }
}

/** One stored vector, keyed to a record and a namespace. */
export interface StoredVector {
  memoryId: string;
  /** `provider:model:dims` — vectors from different namespaces never compare. */
  namespace: string;
  contentHash: string;
  vector: number[];
}

export interface MemoryStoreMeta {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Stable hash of embedded content, so a content edit invalidates its vector. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 32);
}

/**
 * Write via a temp file and rename.
 *
 * A crash mid-write would otherwise leave a truncated JSONL line, which on
 * reload looks like one corrupt record and — worse — silently loses every
 * record after it. Rename is atomic on both POSIX and NTFS.
 */
function atomicWrite(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, contents, { encoding: 'utf8', flag: 'wx' });
    // Windows readers (including indexers and antivirus) can briefly prevent
    // replacement even after our own handles close. Keep the existing file
    // intact and retry the same atomic rename, with a bounded backoff.
    for (let attempt = 0; ; attempt++) {
      try {
        renameSync(tmp, path);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' || attempt >= 5 ||
            !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * 2 ** attempt);
      }
    }
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      /* preserve the original error */
    }
    throw error;
  }
}

function isMemoryRecord(value: unknown): value is MemoryRecord {
  if (!isObject(value) || !isObject(value.provenance)) return false;
  const provenance = value.provenance;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.content === 'string' &&
    Number.isSafeInteger(value.schemaVersion) &&
    (value.schemaVersion as number) >= 0 &&
    (value.schemaVersion as number) <= MEMORY_SCHEMA_VERSION &&
    MEMORY_SCOPE_ORDER.includes(value.scope as MemoryRecord['scope']) &&
    [
      'user-decision',
      'architecture-decision',
      'constraint',
      'procedure',
      'observation',
      'summary',
      'hypothesis',
      'ephemeral',
    ].includes(value.type as string) &&
    (value.status === undefined ||
      ['active', 'superseded', 'expired', 'disputed'].includes(value.status as string)) &&
    Object.hasOwn(CONFIDENCE_WEIGHT, value.confidence as string) &&
    SENSITIVITY_ORDER.includes(value.sensitivity as MemoryRecord['sensitivity']) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    typeof provenance.creator === 'string' &&
    typeof provenance.sourceKind === 'string' &&
    ['observed', 'stated', 'inferred', 'consolidated'].includes(provenance.derivation as string) &&
    ['repoId', 'projectId', 'missionId', 'sessionId', 'agentId'].every(
      (key) => value[key] === undefined || typeof value[key] === 'string'
    ) &&
    ['supersedes', 'supersededBy'].every(
      (key) =>
        value[key] === undefined ||
        (Array.isArray(value[key]) &&
          (value[key] as unknown[]).every((id) => typeof id === 'string'))
    ) &&
    (value.metadata === undefined || isObject(value.metadata)) &&
    (value.retention === undefined ||
      (isObject(value.retention) &&
        (value.retention.expiresAt === undefined || isTimestamp(value.retention.expiresAt))))
  );
}

function isStoredVector(value: unknown): value is StoredVector {
  return (
    isObject(value) &&
    typeof value.memoryId === 'string' &&
    typeof value.namespace === 'string' &&
    typeof value.contentHash === 'string' &&
    Array.isArray(value.vector) &&
    value.vector.length > 0 &&
    value.vector.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

export interface LoadResult {
  records: MemoryRecord[];
  corruptLines: number[];
}

export class MemoryStore {
  private readonly recordsPath: string;
  private readonly vectorsPath: string;
  private readonly metaPath: string;

  /** Serialize the entire read/modify/write across processes, not just rename. */
  private withWriteLock<T>(operation: () => T): T {
    const lock = join(this.root, WRITE_LOCK_PATH);
    mkdirSync(dirname(lock), { recursive: true });
    // A directory avoids Windows file-open/delete sharing races on a lock file.
    try {
      mkdirSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new MemoryStoreBusyError();
      throw error;
    }
    const owner = join(lock, 'owner.json');
    try {
      writeFileSync(
        owner,
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + '\n',
        'utf8'
      );
      return operation();
    } finally {
      try {
        if (existsSync(owner)) unlinkSync(owner);
      } finally {
        rmdirSync(lock);
      }
    }
  }

  constructor(private readonly root: string) {
    this.recordsPath = join(root, RECORDS_PATH);
    this.vectorsPath = join(root, VECTORS_PATH);
    this.metaPath = join(root, META_PATH);
  }

  get paths(): { records: string; vectors: string; meta: string } {
    return { records: this.recordsPath, vectors: this.vectorsPath, meta: this.metaPath };
  }

  meta(): MemoryStoreMeta {
    if (!existsSync(this.metaPath)) {
      const now = new Date().toISOString();
      return { schemaVersion: MEMORY_SCHEMA_VERSION, createdAt: now, updatedAt: now };
    }
    try {
      return JSON.parse(readFileSync(this.metaPath, 'utf8')) as MemoryStoreMeta;
    } catch {
      const now = new Date().toISOString();
      return { schemaVersion: MEMORY_SCHEMA_VERSION, createdAt: now, updatedAt: now };
    }
  }

  /**
   * Load every record, migrating older schema versions forward.
   *
   * Migration happens on read rather than as a separate step so an operator can
   * never end up running new code against an unmigrated file.
   */
  load(): LoadResult {
    const raw = readValidatedJsonl(this.recordsPath, isMemoryRecord);
    if (raw.error) throw new Error(`Memory records are unreadable: ${raw.error}`);
    return { records: raw.records.map((r) => migrateRecord(r)), corruptLines: raw.invalidLines };
  }

  private loadForWrite(): MemoryRecord[] {
    const loaded = this.load();
    if (loaded.corruptLines.length > 0)
      throw new Error(
        'Memory records are damaged/corrupt; preserve and repair the file before modifying it'
      );
    return loaded.records;
  }

  all(): MemoryRecord[] {
    return this.load().records;
  }

  get(id: string): MemoryRecord | undefined {
    return this.all().find((r) => r.id === id);
  }

  /**
   * Persist a validated proposal.
   *
   * Applies supersession as part of the same write: marking the old record and
   * back-linking the new one. Doing this separately would leave a window where
   * both records look active and retrieval returns contradictory truth.
   */
  append(proposal: MemoryProposal, overrides: Partial<MemoryRecord> = {}): MemoryRecord {
    return this.withWriteLock(() => this.appendUnlocked(proposal, overrides));
  }

  private appendUnlocked(proposal: MemoryProposal, overrides: Partial<MemoryRecord>): MemoryRecord {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      ...proposal,
      id: overrides.id ?? randomUUID(),
      schemaVersion: MEMORY_SCHEMA_VERSION,
      status: proposal.status ?? 'active',
      createdAt: now,
      updatedAt: now,
      metadata: proposal.metadata ?? {},
      ...overrides,
    };

    const records = this.loadForWrite();
    if (!isMemoryRecord(record)) throw new TypeError('Invalid memory record');
    if (records.some((existing) => existing.id === record.id))
      throw new Error('Memory record ID already exists');
    const superseded = new Set(record.supersedes ?? []);
    for (const id of superseded) {
      const existing = records.find((candidate) => candidate.id === id);
      if (!existing) throw new Error('Memory supersession target does not exist');
      if (!sameMemoryNamespace(existing, record)) {
        throw new Error('Memory supersession cannot cross repository, client or session scope');
      }
    }
    const next = records.map((existing) => {
      if (!superseded.has(existing.id)) return existing;
      return {
        ...existing,
        status: 'superseded' as const,
        supersededBy: [...new Set([...(existing.supersededBy ?? []), record.id])],
        updatedAt: now,
      };
    });
    next.push(record);
    this.writeAll(next);
    return record;
  }

  /** Replace a record wholesale. Returns false when the id is unknown. */
  update(id: string, patch: Partial<MemoryRecord>): boolean {
    return this.withWriteLock(() => this.updateUnlocked(id, patch));
  }

  private updateUnlocked(id: string, patch: Partial<MemoryRecord>): boolean {
    const records = this.loadForWrite();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return false;
    if (patch.id !== undefined && patch.id !== id) throw new Error('Memory record ID is immutable');
    records[index] = { ...records[index], ...patch, updatedAt: new Date().toISOString() };
    if (!isMemoryRecord(records[index])) throw new TypeError('Invalid memory record update');
    this.writeAll(records);
    return true;
  }

  /**
   * Delete records and their vectors together.
   *
   * Vector removal is not optional cleanup: an orphaned vector keeps surfacing
   * a "forgotten" memory through semantic search, which would make deletion a
   * lie.
   */
  forget(predicate: (record: MemoryRecord) => boolean): {
    removed: number;
    vectorsRemoved: number;
  } {
    return this.withWriteLock(() => this.forgetUnlocked(predicate));
  }

  private forgetUnlocked(predicate: (record: MemoryRecord) => boolean): {
    removed: number;
    vectorsRemoved: number;
  } {
    const records = this.loadForWrite();
    const doomed = new Set(records.filter(predicate).map((r) => r.id));
    if (doomed.size === 0) return { removed: 0, vectorsRemoved: 0 };

    const vectors = this.vectors();
    const keptVectors = vectors.filter((v) => !doomed.has(v.memoryId));
    this.writeAll(records.filter((r) => !doomed.has(r.id)));
    this.writeVectors(keptVectors);

    return { removed: doomed.size, vectorsRemoved: vectors.length - keptVectors.length };
  }

  vectors(): StoredVector[] {
    const read = readValidatedJsonl(this.vectorsPath, isStoredVector);
    if (read.error) throw new Error(`Memory vectors are unreadable: ${read.error}`);
    return read.records;
  }

  /** Vectors in one namespace only — never mix incompatible spaces. */
  vectorsIn(providerId: string, model: string, dimensions: number): StoredVector[] {
    const ns = embeddingNamespace(providerId, model, dimensions);
    return this.vectors().filter((v) => v.namespace === ns);
  }

  putVector(vector: StoredVector): void {
    this.withWriteLock(() => this.putVectorUnlocked(vector));
  }

  private putVectorUnlocked(vector: StoredVector): void {
    if (!isStoredVector(vector)) throw new TypeError('Invalid memory vector');
    const existing = this.vectors().filter(
      (v) => !(v.memoryId === vector.memoryId && v.namespace === vector.namespace)
    );
    existing.push(vector);
    this.writeVectors(existing);
  }

  /** Drop every vector, optionally only in one namespace. Records are untouched. */
  clearVectors(namespace?: string): number {
    return this.withWriteLock(() => this.clearVectorsUnlocked(namespace));
  }

  private clearVectorsUnlocked(namespace?: string): number {
    const vectors = this.vectors();
    const kept = namespace ? vectors.filter((v) => v.namespace !== namespace) : [];
    this.writeVectors(kept);
    return vectors.length - kept.length;
  }

  /** Vectors whose record is gone, or whose content hash no longer matches. */
  orphanedVectors(): StoredVector[] {
    const byId = new Map(this.all().map((r) => [r.id, r]));
    return this.vectors().filter((v) => {
      const record = byId.get(v.memoryId);
      if (!record) return true;
      return hashContent(record.content) !== v.contentHash;
    });
  }

  private writeAll(records: MemoryRecord[]): void {
    atomicWrite(this.recordsPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const meta = this.meta();
    atomicWrite(
      this.metaPath,
      JSON.stringify(
        { ...meta, schemaVersion: MEMORY_SCHEMA_VERSION, updatedAt: new Date().toISOString() },
        null,
        2
      ) + '\n'
    );
  }

  private writeVectors(vectors: StoredVector[]): void {
    atomicWrite(this.vectorsPath, vectors.map((v) => JSON.stringify(v)).join('\n') + '\n');
  }
}

/**
 * Bring a record forward to the current schema.
 *
 * Version 1 is the first release, so this only fills defaults for fields a
 * hand-written or imported record may omit. It exists now, populated, so the
 * first real migration has an obvious home rather than being bolted on.
 */
export function migrateRecord(raw: MemoryRecord): MemoryRecord {
  const record: MemoryRecord = {
    ...raw,
    schemaVersion: MEMORY_SCHEMA_VERSION,
    status: raw.status ?? 'active',
    metadata: raw.metadata ?? {},
  };
  return record;
}
