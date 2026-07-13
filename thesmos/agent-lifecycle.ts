// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent lifecycle — shared operations for agent:create and agent:install.
 *
 * Responsibilities:
 *   1. Validate an agent Markdown document and derive a canonical ID.
 *   2. Write the canonical file to .thesmos/agents/<id>.md.
 *   3. Add the agent to .thesmos/registry.json (idempotent).
 *   4. Synchronize platform adapter files via the existing adapter pipeline.
 *   5. Record the operation in the audit trail.
 *   6. Return a structured result — never swallow a failure and report success.
 *
 * Design:
 *   - All validation completes before any filesystem mutation.
 *   - Adapter sync is optional (--no-sync) and always runs once per batch, not per file.
 *   - The module is pure where possible; I/O is injectable for testing.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseFrontmatter } from './catalog.js';
import { appendAuditEntry } from './agent-audit.js';
import { loadRegistryConfig, mergeRegistryConfig, REGISTRY_DEFAULTS, REGISTRY_PATH } from './registry.js';
import { getActiveCatalog } from './catalog.js';
import { THESMOS_RULES, writeAllAdapters, ADAPTER_OUTPUT_PATHS, type AdapterTarget } from './adapters.js';
import { loadConfig } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Input for a single agent install or create operation. */
export interface AgentLifecycleInput {
  /** Markdown content to install. */
  content: string;
  /** Original source path (for display only, no filesystem access). */
  sourcePath: string;
  /** Override the derived ID (used by agent:create which already knows the ID). */
  targetId?: string;
  /** Overwrite an existing canonical file. */
  force?: boolean;
  /** Validate and report without mutating any files, registry, or audit log. */
  dryRun?: boolean;
  /** Install canonical file + registry but skip adapter generation. */
  noSync?: boolean;
  /** Project root. */
  root: string;
}

/** Result returned by installAgent (whether dry-run or real). */
export interface AgentLifecycleResult {
  agentId: string;
  canonicalFile: string;
  registryResult: 'added' | 'already-present' | 'dry-run';
  adapterPaths: string[];
  warnings: string[];
}

/** Validation error — thrown before any mutation. */
export class AgentInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentInstallError';
  }
}

// ── ID utilities (pure) ───────────────────────────────────────────────────────

/**
 * Normalize a string to lowercase kebab-case.
 * Strips non-alphanumeric characters (except spaces and hyphens), trims,
 * and collapses whitespace/hyphens to a single hyphen.
 */
export function toKebabCase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '-');
}

/** Return true if a string is a valid canonical agent ID. */
export function isValidAgentId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(id) || /^[a-z0-9]$/.test(id);
}

/**
 * Derive a canonical ID from an agent document.
 *
 * Priority:
 *   1. `id` field in frontmatter (already kebab-case, validated)
 *   2. `name` field in frontmatter (normalized to kebab-case)
 *   3. Source filename without extension (normalized to kebab-case)
 */
export function deriveAgentId(content: string, sourcePath: string): string {
  const { frontmatter } = parseFrontmatter(content);

  if (typeof frontmatter['id'] === 'string' && frontmatter['id'].trim()) {
    return toKebabCase(frontmatter['id']);
  }

  if (typeof frontmatter['name'] === 'string' && frontmatter['name'].trim()) {
    return toKebabCase(frontmatter['name']);
  }

  const stem = basename(sourcePath, extname(sourcePath));
  return toKebabCase(stem);
}

// ── Registry helpers ──────────────────────────────────────────────────────────

type RegistryShape = Record<string, unknown>;

function readRegistryRaw(root: string): RegistryShape {
  const p = join(root, REGISTRY_PATH);
  if (!existsSync(p)) return { rules: ['@thesmos/core'], agents: [], skills: [] };
  const raw = readFileSync(p, 'utf8');
  // Registry is user-controlled and bounded; 1 MB limit guards against accidental corruption.
  if (raw.length > 1_048_576) {
    throw new Error(`Registry file exceeds 1 MB — file may be corrupted: ${p}`);
  }
  // Throw on parse failure so callers see the error rather than silently replacing
  // valid registry data with defaults — silent replacement would destroy existing state.
  return JSON.parse(raw) as RegistryShape;
}

/**
 * Write registry.json via a same-directory temp-file + rename.
 *
 * Placing the temp file in the same directory as the destination guarantees
 * the rename is on the same filesystem, making it atomic on POSIX systems
 * (rename(2) is atomic when src and dst are on the same device).
 * On Windows, renameSync is not atomic but still protects against partial
 * writes: the old file remains intact until the rename succeeds.
 */
function writeRegistryAtomic(root: string, data: RegistryShape): void {
  const dir = join(root, '.thesmos');
  const dest = join(dir, 'registry.json');
  const tmpPath = join(dir, `.registry-${process.pid}-${randomUUID()}.tmp`);

  mkdirSync(dir, { recursive: true });

  // Preserve existing file mode if present (non-fatal if this fails)
  let originalMode: number | undefined;
  try {
    if (existsSync(dest)) {
      originalMode = statSync(dest).mode & 0o777;
    }
  } catch { /* non-fatal */ }

  let tmpWritten = false;
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    tmpWritten = true;

    if (originalMode !== undefined) {
      try { chmodSync(tmpPath, originalMode); } catch { /* non-fatal */ }
    }

    renameSync(tmpPath, dest);
  } catch (err) {
    // Clean up the temp file if the write succeeded but rename failed
    if (tmpWritten) {
      try { unlinkSync(tmpPath); } catch { /* best-effort cleanup */ }
    }
    throw err;
  }
}

/**
 * Add an agent ID to .thesmos/registry.json idempotently.
 * Returns 'added' when the registry was changed, 'already-present' when it was not.
 */
export function addAgentToRegistry(root: string, id: string): 'added' | 'already-present' {
  const registry = readRegistryRaw(root);
  const agents = (registry['agents'] as string[] | undefined) ?? [];
  if (agents.includes(id)) return 'already-present';
  registry['agents'] = [...agents, id];
  writeRegistryAtomic(root, registry);
  return 'added';
}

// ── Adapter sync ──────────────────────────────────────────────────────────────

export const ALL_ADAPTER_TARGETS = Object.keys(ADAPTER_OUTPUT_PATHS) as AdapterTarget[];

/**
 * Re-run the full adapter generation pipeline and return the output paths.
 * This is identical to what `thesmos adapters` does internally.
 */
export function syncAdapters(root: string): string[] {
  let config;
  try {
    config = loadConfig(root);
  } catch {
    // Non-thesmos project — use minimal config; adapters still generate.
    config = { version: '0.0.0', project: basename(root) } as ReturnType<typeof loadConfig>;
  }

  const registryConfig = loadRegistryConfig(root);
  const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, registryConfig);
  const activeCatalog = getActiveCatalog(root, { agents: merged.agents, skills: merged.skills });

  const catalog =
    activeCatalog.agents.length > 0 || activeCatalog.skills.length > 0
      ? {
          agents: activeCatalog.agents.map((a) => ({ id: a.frontmatter.id, name: a.frontmatter.name })),
          skills: activeCatalog.skills.map((s) => ({ id: s.frontmatter.id, name: s.frontmatter.name })),
          profile: merged.profiles[0],
        }
      : undefined;

  const manifests = writeAllAdapters(root, THESMOS_RULES, config, ALL_ADAPTER_TARGETS, catalog);
  return manifests.map((m) => m.outputPath);
}

// ── Path safety ───────────────────────────────────────────────────────────────

/**
 * Confirm the resolved canonical path stays within .thesmos/agents/ to prevent
 * path traversal attacks via crafted frontmatter IDs.
 */
function assertNoTraversal(root: string, id: string): void {
  const agentsDir = resolve(root, '.thesmos', 'agents');
  const targetAbs = resolve(agentsDir, `${id}.md`);
  const rel = relative(agentsDir, targetAbs);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new AgentInstallError(
      `agent:install: ID "${id}" resolves outside the agents directory (path traversal rejected).`
    );
  }
}

// ── Core install operation ────────────────────────────────────────────────────

/**
 * Install a single agent document.
 *
 * All validation runs before any mutation.
 * Returns a structured result describing what happened (or would happen in dry-run).
 */
export function installAgent(input: AgentLifecycleInput): AgentLifecycleResult {
  const { content, sourcePath, targetId, force = false, dryRun = false, noSync = false, root } = input;

  if (!content.trim()) {
    throw new AgentInstallError(`agent:install: "${sourcePath}" is empty.`);
  }

  // ── Derive ID ──────────────────────────────────────────────────────────────
  const rawId = targetId ?? deriveAgentId(content, sourcePath);

  if (!rawId || !isValidAgentId(rawId)) {
    throw new AgentInstallError(
      `agent:install: could not derive a valid ID from "${sourcePath}" (got "${rawId}"). ` +
      `Add \`id: your-agent-id\` frontmatter, or use a descriptive filename.`
    );
  }

  // Path-traversal guard (pure check, no I/O)
  assertNoTraversal(root, rawId);

  // ── Check destination ──────────────────────────────────────────────────────
  const agentsDir = join(root, '.thesmos', 'agents');
  const canonicalPath = join(agentsDir, `${rawId}.md`);
  const canonicalRel = `.thesmos/agents/${rawId}.md`;
  const warnings: string[] = [];

  // Source-equals-destination: the source file IS the canonical file — skip write.
  const sourceAbs = isAbsolute(sourcePath) ? sourcePath : resolve(root, sourcePath);
  const sourceIsCanonical = sourceAbs === resolve(canonicalPath);

  if (!sourceIsCanonical && existsSync(canonicalPath) && !force) {
    throw new AgentInstallError(
      `agent:install: "${canonicalRel}" already exists. Use --force to overwrite.`
    );
  }

  if (!sourceIsCanonical && existsSync(canonicalPath) && force) {
    warnings.push(`Overwrote existing file: ${canonicalRel}`);
  }

  // ── All validation passed — begin mutations (skipped in dry-run) ───────────
  if (dryRun) {
    return {
      agentId: rawId,
      canonicalFile: canonicalRel,
      registryResult: 'dry-run',
      adapterPaths: [],
      warnings,
    };
  }

  // Capture rollback state before any writes.
  // destinationExisted=true + originalContent=string → forced replacement → restore on failure.
  // destinationExisted=false                          → new file          → unlink on failure.
  // sourceIsCanonical=true                            → no write at all   → no rollback needed.
  const destinationExisted = !sourceIsCanonical && existsSync(canonicalPath);
  let originalContent: string | null = null;
  if (destinationExisted && force) {
    originalContent = readFileSync(canonicalPath, 'utf8');
  }

  // Write canonical file (skipped when source IS the canonical path)
  if (!sourceIsCanonical) {
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(canonicalPath, content, 'utf8');
  }

  // Update registry — if this throws, roll back the canonical file to its pre-call state.
  let registryResult: 'added' | 'already-present';
  try {
    registryResult = addAgentToRegistry(root, rawId);
  } catch (err) {
    if (!sourceIsCanonical) {
      try {
        if (!destinationExisted) {
          // New file — remove it entirely.
          unlinkSync(canonicalPath);
        } else if (originalContent !== null) {
          // Forced replacement — restore original bytes rather than deleting the file.
          writeFileSync(canonicalPath, originalContent, 'utf8');
        }
        // If destinationExisted=true but originalContent=null (shouldn't happen with --force
        // logic above), leave the file as-is; the caller sees the AgentInstallError below.
      } catch { /* rollback failure is non-fatal; the real error surfaces below */ }
    }
    throw new AgentInstallError(
      `agent:install: registry update failed: ${String(err)}`
    );
  }

  // Audit entry (recorded after all mutations succeed; adapter sync is separate).
  // Action label 'AgentCanonicalInstall' covers the canonical-file write + registry update.
  // A second event 'AgentAdapterSync' is appended by callers after adapter sync completes.
  try {
    appendAuditEntry(root, 'AgentCanonicalInstall', canonicalRel, 'INFO', []);
  } catch {
    warnings.push('audit trail write failed (non-fatal)');
  }

  // Adapter sync is intentionally deferred: callers (agent-install.ts / agent-create.ts)
  // run syncAdapters once per batch after all installAgent calls complete.
  return {
    agentId: rawId,
    canonicalFile: canonicalRel,
    registryResult,
    adapterPaths: [],  // populated by caller after batch adapter sync
    warnings,
  };
}

// ── Filename filters ──────────────────────────────────────────────────────────

/** Files that should be silently skipped during directory installs. */
const IGNORED_FILENAMES = new Set(['README.md', 'readme.md', 'CHANGELOG.md', 'LICENSE.md']);

export function isIgnoredAgentFile(filename: string): boolean {
  return IGNORED_FILENAMES.has(filename) || IGNORED_FILENAMES.has(filename.toLowerCase());
}
