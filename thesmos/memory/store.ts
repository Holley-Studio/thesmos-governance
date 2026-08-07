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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  MEMORY_SCHEMA_VERSION,
  embeddingNamespace,
  type MemoryProposal,
  type MemoryRecord,
} from './types.js';

export const MEMORY_DIR = join('.thesmos', 'memory');
export const RECORDS_PATH = join(MEMORY_DIR, 'records.jsonl');
export const VECTORS_PATH = join(MEMORY_DIR, 'vectors.jsonl');
export const META_PATH = join(MEMORY_DIR, 'meta.json');

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
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, path);
}

function readJsonl<T>(path: string, onCorrupt?: (line: number) => void): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // A damaged line is skipped, not fatal — one bad record must not make the
      // entire memory unreadable. The count is surfaced by `memory doctor`.
      onCorrupt?.(index + 1);
    }
  });
  return out;
}

export interface LoadResult {
  records: MemoryRecord[];
  corruptLines: number[];
}

export class MemoryStore {
  private readonly recordsPath: string;
  private readonly vectorsPath: string;
  private readonly metaPath: string;

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
    const corruptLines: number[] = [];
    const raw = readJsonl<MemoryRecord>(this.recordsPath, (line) => corruptLines.push(line));
    return { records: raw.map((r) => migrateRecord(r)), corruptLines };
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

    const records = this.all();
    const superseded = new Set(record.supersedes ?? []);
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
    const records = this.all();
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return false;
    records[index] = { ...records[index], ...patch, updatedAt: new Date().toISOString() };
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
  forget(predicate: (record: MemoryRecord) => boolean): { removed: number; vectorsRemoved: number } {
    const records = this.all();
    const doomed = new Set(records.filter(predicate).map((r) => r.id));
    if (doomed.size === 0) return { removed: 0, vectorsRemoved: 0 };

    this.writeAll(records.filter((r) => !doomed.has(r.id)));

    const vectors = this.vectors();
    const keptVectors = vectors.filter((v) => !doomed.has(v.memoryId));
    this.writeVectors(keptVectors);

    return { removed: doomed.size, vectorsRemoved: vectors.length - keptVectors.length };
  }

  vectors(): StoredVector[] {
    return readJsonl<StoredVector>(this.vectorsPath);
  }

  /** Vectors in one namespace only — never mix incompatible spaces. */
  vectorsIn(providerId: string, model: string, dimensions: number): StoredVector[] {
    const ns = embeddingNamespace(providerId, model, dimensions);
    return this.vectors().filter((v) => v.namespace === ns);
  }

  putVector(vector: StoredVector): void {
    const existing = this.vectors().filter(
      (v) => !(v.memoryId === vector.memoryId && v.namespace === vector.namespace),
    );
    existing.push(vector);
    this.writeVectors(existing);
  }

  /** Drop every vector, optionally only in one namespace. Records are untouched. */
  clearVectors(namespace?: string): number {
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
        2,
      ) + '\n',
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
