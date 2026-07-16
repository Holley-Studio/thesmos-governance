// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent ownership — explicit Thesmos-managed file tracking.
 *
 * Principle: Thesmos governs what an agent does, not whether it may exist.
 * Only paths listed in `.thesmos/managed-agents.json` are owned by Thesmos.
 * Filename equality alone is never proof of ownership.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentOwnership = 'managed' | 'external' | 'adopted';
export type AgentOrigin = 'pantheon' | 'project' | 'user' | 'plugin' | 'thesmos';
export type AgentStatus = 'active' | 'shadowed' | 'conflict' | 'modified';

export interface ManagedAgentRecord {
  owner: 'thesmos';
  source: AgentOrigin | 'pantheon' | 'adopted';
  agentId: string;
  hash: string;
  /** Optional human-readable note. */
  note?: string;
}

export interface ManagedAgentsManifest {
  version: 1;
  files: Record<string, ManagedAgentRecord>;
}

export interface OwnershipFs {
  exists: (absPath: string) => boolean;
  read: (absPath: string) => string;
  write: (absPath: string, content: string) => void;
  rename: (from: string, to: string) => void;
  mkdir: (absPath: string) => void;
  unlink: (absPath: string) => void;
  chmod?: (absPath: string, mode: number) => void;
  mode?: (absPath: string) => number | undefined;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const MANAGED_MANIFEST_REL = '.thesmos/managed-agents.json';
export const MANAGED_CLAUDE_DIR_REL = '.claude/agents/thesmos';
export const MANAGED_MARKER_RE =
  /<!--\s*THESMOS:MANAGED\b([\s\S]*?)-->/i;

export const EMPTY_MANIFEST: ManagedAgentsManifest = {
  version: 1,
  files: {},
};

// ── Path helpers (pure) ───────────────────────────────────────────────────────

/** Normalize to forward-slash relative path (POSIX-style, no leading ./). */
export function normalizeRelPath(raw: string): string {
  const withForward = raw.replace(/\\/g, '/');
  const stripped = withForward.replace(/^\.\/+/, '').replace(/\/+$/, '');
  // Collapse duplicate slashes and reject empty
  return stripped.split('/').filter(Boolean).join('/');
}

/**
 * Resolve a relative path under root and reject traversal.
 * Returns absolute path when safe; throws otherwise.
 */
export function resolveSafePath(root: string, relPath: string): string {
  if (relPath.includes('\0')) {
    throw new Error('Path contains a null byte.');
  }
  // Reject absolute inputs before normalization (which would strip a leading /)
  const forward = relPath.replace(/\\/g, '/');
  if (
    isAbsolute(relPath) ||
    isAbsolute(forward) ||
    forward.startsWith('/') ||
    /^[a-zA-Z]:/.test(forward)
  ) {
    throw new Error(`Absolute paths are not allowed: ${relPath}`);
  }
  const normalized = normalizeRelPath(relPath);
  if (!normalized) {
    throw new Error('Path is empty after normalization.');
  }
  if (normalized.startsWith('..') || normalized.split('/').includes('..')) {
    throw new Error(`Path traversal rejected: ${relPath}`);
  }
  const absRoot = resolve(root);
  const absTarget = resolve(absRoot, ...normalized.split('/'));
  const rel = relative(absRoot, absTarget);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal rejected: ${relPath}`);
  }
  return absTarget;
}

/** True when relPath is under `.claude/agents/` (any depth). */
export function isClaudeAgentsPath(relPath: string): boolean {
  const n = normalizeRelPath(relPath);
  return n === '.claude/agents' || n.startsWith('.claude/agents/');
}

/** True when relPath is under the Thesmos-managed Claude agents namespace. */
export function isManagedClaudeAgentsPath(relPath: string): boolean {
  const n = normalizeRelPath(relPath);
  return n === MANAGED_CLAUDE_DIR_REL || n.startsWith(`${MANAGED_CLAUDE_DIR_REL}/`);
}

export function contentHash(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function managedMarker(agentId: string, source = 'pantheon', version = 1): string {
  return [
    '<!-- THESMOS:MANAGED',
    `source=${source}`,
    `agent=${agentId}`,
    `version=${version}`,
    '-->',
  ].join('\n');
}

export function parseManagedMarker(
  content: string
): { source?: string; agent?: string; version?: string } | null {
  const m = content.match(MANAGED_MARKER_RE);
  if (!m) return null;
  const block = m[1] ?? '';
  const out: { source?: string; agent?: string; version?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim().toLowerCase();
    const val = trimmed.slice(eq + 1).trim();
    if (key === 'source' || key === 'agent' || key === 'version') {
      out[key] = val;
    }
  }
  return out;
}

export function ensureManagedMarker(content: string, agentId: string, source = 'pantheon'): string {
  if (MANAGED_MARKER_RE.test(content)) return content;
  const marker = managedMarker(agentId, source);
  // Insert after frontmatter if present
  if (content.startsWith('---')) {
    const close = content.indexOf('\n---', 3);
    if (close !== -1) {
      const end = close + 4; // past \n---
      return content.slice(0, end) + '\n\n' + marker + '\n' + content.slice(end).replace(/^\n*/, '\n');
    }
  }
  return marker + '\n\n' + content;
}

// ── Default FS ────────────────────────────────────────────────────────────────

export function defaultOwnershipFs(): OwnershipFs {
  return {
    exists: (p) => existsSync(p),
    read: (p) => readFileSync(p, 'utf8'),
    write: (p, c) => writeFileSync(p, c, 'utf8'),
    rename: (from, to) => renameSync(from, to),
    mkdir: (p) => mkdirSync(p, { recursive: true }),
    unlink: (p) => unlinkSync(p),
    chmod: (p, mode) => {
      try {
        chmodSync(p, mode);
      } catch {
        /* non-fatal */
      }
    },
    mode: (p) => {
      try {
        return statSync(p).mode & 0o777;
      } catch {
        return undefined;
      }
    },
  };
}

// ── Manifest I/O ──────────────────────────────────────────────────────────────

export function isValidManifest(raw: unknown): raw is ManagedAgentsManifest {
  if (raw === null || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== 1) return false;
  if (obj['files'] === null || typeof obj['files'] !== 'object' || Array.isArray(obj['files'])) {
    return false;
  }
  for (const [pathKey, record] of Object.entries(obj['files'] as Record<string, unknown>)) {
    if (typeof pathKey !== 'string' || !pathKey) return false;
    if (record === null || typeof record !== 'object') return false;
    const r = record as Record<string, unknown>;
    if (r['owner'] !== 'thesmos') return false;
    if (typeof r['agentId'] !== 'string' || !r['agentId']) return false;
    if (typeof r['hash'] !== 'string' || !r['hash'].startsWith('sha256:')) return false;
    if (typeof r['source'] !== 'string' || !r['source']) return false;
  }
  return true;
}

export function loadManagedManifest(
  root: string,
  fs: OwnershipFs = defaultOwnershipFs()
): ManagedAgentsManifest {
  const abs = resolveSafePath(root, MANAGED_MANIFEST_REL);
  if (!fs.exists(abs)) return { ...EMPTY_MANIFEST, files: {} };
  try {
    const raw = JSON.parse(fs.read(abs)) as unknown;
    if (!isValidManifest(raw)) {
      throw new Error('Invalid managed-agents.json schema.');
    }
    // Normalize keys
    const files: Record<string, ManagedAgentRecord> = {};
    for (const [k, v] of Object.entries(raw.files)) {
      files[normalizeRelPath(k)] = v;
    }
    return { version: 1, files };
  } catch (err) {
    throw new Error(
      `Failed to load ${MANAGED_MANIFEST_REL}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Atomically write the ownership manifest via same-directory temp + rename.
 */
export function writeManagedManifestAtomic(
  root: string,
  manifest: ManagedAgentsManifest,
  fs: OwnershipFs = defaultOwnershipFs()
): void {
  if (!isValidManifest(manifest)) {
    throw new Error('Refusing to write invalid managed-agents manifest.');
  }
  // Normalize + validate every path key
  const normalized: ManagedAgentsManifest = { version: 1, files: {} };
  for (const [k, v] of Object.entries(manifest.files)) {
    const nk = normalizeRelPath(k);
    resolveSafePath(root, nk); // throws on traversal
    normalized.files[nk] = v;
  }

  const abs = resolveSafePath(root, MANAGED_MANIFEST_REL);
  const dir = dirname(abs);
  fs.mkdir(dir);

  const tmp = join(dir, `.managed-agents-${process.pid}-${randomUUID()}.tmp`);
  const originalMode = fs.mode?.(abs);
  let written = false;
  try {
    fs.write(tmp, JSON.stringify(normalized, null, 2) + '\n');
    written = true;
    if (originalMode !== undefined && fs.chmod) {
      try {
        fs.chmod(tmp, originalMode);
      } catch {
        /* non-fatal */
      }
    }
    fs.rename(tmp, abs);
  } catch (err) {
    if (written) {
      try {
        fs.unlink(tmp);
      } catch {
        /* best-effort */
      }
    }
    throw err;
  }
}

export function getManagedRecord(
  manifest: ManagedAgentsManifest,
  relPath: string
): ManagedAgentRecord | undefined {
  return manifest.files[normalizeRelPath(relPath)];
}

export function isManagedPath(manifest: ManagedAgentsManifest, relPath: string): boolean {
  return getManagedRecord(manifest, relPath) !== undefined;
}

export type FileOwnershipState =
  | { state: 'unowned' }
  | { state: 'missing'; record: ManagedAgentRecord }
  | { state: 'unmodified'; record: ManagedAgentRecord; hash: string }
  | { state: 'modified'; record: ManagedAgentRecord; hash: string; expected: string };

export function inspectManagedFile(
  root: string,
  relPath: string,
  manifest: ManagedAgentsManifest,
  fs: OwnershipFs = defaultOwnershipFs()
): FileOwnershipState {
  const key = normalizeRelPath(relPath);
  const record = manifest.files[key];
  if (!record) return { state: 'unowned' };
  const abs = resolveSafePath(root, key);
  if (!fs.exists(abs)) return { state: 'missing', record };
  const hash = contentHash(fs.read(abs));
  if (hash === record.hash) return { state: 'unmodified', record, hash };
  return { state: 'modified', record, hash, expected: record.hash };
}

/**
 * Upsert a managed record after a successful write of known content.
 */
export function upsertManagedRecord(
  manifest: ManagedAgentsManifest,
  relPath: string,
  agentId: string,
  content: string,
  source: ManagedAgentRecord['source'] = 'pantheon'
): ManagedAgentsManifest {
  const key = normalizeRelPath(relPath);
  return {
    version: 1,
    files: {
      ...manifest.files,
      [key]: {
        owner: 'thesmos',
        source,
        agentId,
        hash: contentHash(content),
      },
    },
  };
}

export function removeManagedRecord(
  manifest: ManagedAgentsManifest,
  relPath: string
): ManagedAgentsManifest {
  const key = normalizeRelPath(relPath);
  const files = { ...manifest.files };
  delete files[key];
  return { version: 1, files };
}

export function findManagedByAgentId(
  manifest: ManagedAgentsManifest,
  agentId: string
): Array<{ path: string; record: ManagedAgentRecord }> {
  return Object.entries(manifest.files)
    .filter(([, r]) => r.agentId === agentId)
    .map(([path, record]) => ({ path, record }));
}

/** Rel path for a Pantheon fallback agent under the managed namespace. */
export function managedClaudeAgentRel(agentId: string): string {
  return `${MANAGED_CLAUDE_DIR_REL}/${agentId}.md`;
}

/** User-home managed namespace (relative to home). */
export function managedUserClaudeAgentRel(agentId: string): string {
  return `.claude/agents/thesmos/${agentId}.md`;
}

export function posixJoin(...parts: string[]): string {
  return parts
    .map((p) => p.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/');
}

/** For diagnostics — convert abs path under root to normalized rel. */
export function toRelPath(root: string, absPath: string): string {
  const rel = relative(resolve(root), resolve(absPath));
  return normalizeRelPath(rel.split(sep).join('/'));
}
