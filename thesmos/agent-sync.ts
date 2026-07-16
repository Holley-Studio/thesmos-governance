// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Ownership-aware synchronization of Pantheon fallback agents into
 * `.claude/agents/thesmos/` (project) or `~/.claude/agents/thesmos/` (user).
 *
 * Never overwrites or deletes unowned files. Matching filenames alone are
 * never treated as proof of ownership.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import {
  type ManagedAgentsManifest,
  type OwnershipFs,
  contentHash,
  defaultOwnershipFs,
  ensureManagedMarker,
  inspectManagedFile,
  loadManagedManifest,
  managedClaudeAgentRel,
  managedMarker,
  normalizeRelPath,
  parseManagedMarker,
  removeManagedRecord,
  resolveSafePath,
  upsertManagedRecord,
  writeManagedManifestAtomic,
  MANAGED_CLAUDE_DIR_REL,
} from './agent-ownership.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DesiredManagedAgent {
  agentId: string;
  content: string;
  source?: 'pantheon' | 'adopted' | 'thesmos';
}

export interface SyncAction {
  action:
    | 'written'
    | 'updated'
    | 'skipped_unmodified'
    | 'collision'
    | 'preserved_modified'
    | 'removed'
    | 'skipped_remove_modified'
    | 'migrated'
    | 'would_write'
    | 'would_update'
    | 'would_remove'
    | 'would_migrate';
  path: string;
  agentId: string;
  message: string;
}

export interface SyncResult {
  actions: SyncAction[];
  written: number;
  updated: number;
  removed: number;
  collisions: number;
  preserved: number;
  dryRun: boolean;
  manifest: ManagedAgentsManifest;
}

export interface SyncOptions {
  root: string;
  desired: DesiredManagedAgent[];
  dryRun?: boolean;
  fs?: OwnershipFs;
  /**
   * When true, also attempt safe migration of legacy Pantheon files from
   * `.claude/agents/<id>.md` into the managed namespace using strong evidence.
   */
  migrateLegacy?: boolean;
}

export interface LocalInstallOptions {
  /** Absolute path to pantheon/exports/claude-code */
  exportsDir: string;
  /** Injectable home. Default: os.homedir(). */
  homeDir?: string;
  dryRun?: boolean;
  /** Former export filenames to retire when still unmodified managed files. */
  retired?: string[];
  fs?: OwnershipFs;
}

// ── Strong evidence for legacy Pantheon files ─────────────────────────────────

/**
 * Legacy ownership requires either:
 *  - a THESMOS:MANAGED marker with matching agent id, or
 *  - content hash equal to the current desired export for that id
 * Filename alone is never enough.
 */
export function isStrongLegacyEvidence(
  content: string,
  agentId: string,
  desiredHash?: string
): boolean {
  const marker = parseManagedMarker(content);
  if (marker?.agent === agentId) return true;
  if (desiredHash && contentHash(content) === desiredHash) return true;
  return false;
}

// ── Project sync ──────────────────────────────────────────────────────────────

export function syncManagedClaudeAgents(opts: SyncOptions): SyncResult {
  const root = resolve(opts.root);
  const dryRun = opts.dryRun === true;
  const fs = opts.fs ?? defaultOwnershipFs();
  let manifest = loadManagedManifest(root, fs);
  const actions: SyncAction[] = [];
  let written = 0;
  let updated = 0;
  let removed = 0;
  let collisions = 0;
  let preserved = 0;

  const desiredById = new Map<string, DesiredManagedAgent>();
  for (const d of opts.desired) {
    desiredById.set(d.agentId, d);
  }

  // Desired managed paths we intend to own
  const desiredRels = new Set<string>();
  for (const d of opts.desired) {
    const body = ensureManagedMarker(d.content, d.agentId, d.source ?? 'pantheon');
    const rel = managedClaudeAgentRel(d.agentId);
    desiredRels.add(rel);
    const abs = resolveSafePath(root, rel);
    const inspection = inspectManagedFile(root, rel, manifest, fs);

    if (inspection.state === 'unowned') {
      if (fs.exists(abs)) {
        // Path occupied by untracked file — never overwrite
        collisions++;
        actions.push({
          action: 'collision',
          path: rel,
          agentId: d.agentId,
          message:
            `Target path is occupied by an untracked file. ` +
            `Leaving it untouched. Use a different name or adopt/release explicitly.`,
        });
        continue;
      }
      if (dryRun) {
        written++;
        actions.push({
          action: 'would_write',
          path: rel,
          agentId: d.agentId,
          message: 'Would create managed agent file.',
        });
        manifest = upsertManagedRecord(manifest, rel, d.agentId, body, d.source ?? 'pantheon');
        continue;
      }
      fs.mkdir(dirname(abs));
      fs.write(abs, body);
      manifest = upsertManagedRecord(manifest, rel, d.agentId, body, d.source ?? 'pantheon');
      written++;
      actions.push({
        action: 'written',
        path: rel,
        agentId: d.agentId,
        message: 'Created managed agent file.',
      });
      continue;
    }

    if (inspection.state === 'modified') {
      preserved++;
      actions.push({
        action: 'preserved_modified',
        path: rel,
        agentId: d.agentId,
        message:
          `Managed file was modified outside Thesmos. Preserving local edits. ` +
          `Run \`thesmos agent:release ${d.agentId}\` to stop managing, or restore the file to resume sync.`,
      });
      continue;
    }

    if (inspection.state === 'unmodified' || inspection.state === 'missing') {
      const currentHash = contentHash(body);
      if (inspection.state === 'unmodified' && inspection.hash === currentHash) {
        actions.push({
          action: 'skipped_unmodified',
          path: rel,
          agentId: d.agentId,
          message: 'Already up to date.',
        });
        continue;
      }
      if (dryRun) {
        updated++;
        actions.push({
          action: 'would_update',
          path: rel,
          agentId: d.agentId,
          message: 'Would update managed agent file.',
        });
        manifest = upsertManagedRecord(manifest, rel, d.agentId, body, d.source ?? 'pantheon');
        continue;
      }
      fs.mkdir(dirname(abs));
      fs.write(abs, body);
      manifest = upsertManagedRecord(manifest, rel, d.agentId, body, d.source ?? 'pantheon');
      updated++;
      actions.push({
        action: 'updated',
        path: rel,
        agentId: d.agentId,
        message: inspection.state === 'missing' ? 'Restored missing managed file.' : 'Updated managed agent file.',
      });
    }
  }

  // Optional legacy migration (project root .claude/agents/<id>.md → thesmos/)
  if (opts.migrateLegacy) {
    for (const d of opts.desired) {
      const legacyRel = normalizeRelPath(`.claude/agents/${d.agentId}.md`);
      const legacyAbs = resolveSafePath(root, legacyRel);
      if (!fs.exists(legacyAbs)) continue;
      // Skip if already the managed path
      if (legacyRel === managedClaudeAgentRel(d.agentId)) continue;
      // Never migrate if already managed at destination
      const destRel = managedClaudeAgentRel(d.agentId);
      if (fs.exists(resolveSafePath(root, destRel))) continue;

      let content: string;
      try {
        content = fs.read(legacyAbs);
      } catch {
        continue;
      }
      const desiredBody = ensureManagedMarker(d.content, d.agentId, d.source ?? 'pantheon');
      if (!isStrongLegacyEvidence(content, d.agentId, contentHash(desiredBody))) {
        actions.push({
          action: 'collision',
          path: legacyRel,
          agentId: d.agentId,
          message:
            `Legacy file exists but ownership cannot be proven (filename alone is insufficient). ` +
            `Leaving it as an external agent.`,
        });
        collisions++;
        continue;
      }
      if (dryRun) {
        actions.push({
          action: 'would_migrate',
          path: legacyRel,
          agentId: d.agentId,
          message: `Would migrate to ${destRel}.`,
        });
        continue;
      }
      const destAbs = resolveSafePath(root, destRel);
      const body = ensureManagedMarker(content, d.agentId, d.source ?? 'pantheon');
      fs.mkdir(dirname(destAbs));
      fs.write(destAbs, body);
      // Remove legacy only when hash still matches what we just migrated from
      // (same content with marker possibly added — if marker was added, remove original carefully)
      try {
        fs.unlink(legacyAbs);
      } catch {
        /* non-fatal */
      }
      manifest = upsertManagedRecord(manifest, destRel, d.agentId, body, d.source ?? 'pantheon');
      written++;
      actions.push({
        action: 'migrated',
        path: destRel,
        agentId: d.agentId,
        message: `Migrated legacy managed file from ${legacyRel}.`,
      });
    }
  }

  // Remove stale managed files (in manifest but not desired) only when unmodified
  for (const [rel, record] of Object.entries(manifest.files)) {
    if (!rel.startsWith(`${MANAGED_CLAUDE_DIR_REL}/`)) continue;
    if (desiredRels.has(rel)) continue;
    const inspection = inspectManagedFile(root, rel, manifest, fs);
    if (inspection.state === 'modified') {
      preserved++;
      actions.push({
        action: 'skipped_remove_modified',
        path: rel,
        agentId: record.agentId,
        message: 'Stale managed file was modified — preserving and keeping ownership record.',
      });
      continue;
    }
    if (dryRun) {
      removed++;
      actions.push({
        action: 'would_remove',
        path: rel,
        agentId: record.agentId,
        message: 'Would remove stale unmodified managed file.',
      });
      manifest = removeManagedRecord(manifest, rel);
      continue;
    }
    const abs = resolveSafePath(root, rel);
    if (fs.exists(abs) && (inspection.state === 'unmodified' || inspection.state === 'missing')) {
      if (inspection.state === 'unmodified') {
        try {
          fs.unlink(abs);
        } catch {
          /* non-fatal */
        }
      }
    }
    manifest = removeManagedRecord(manifest, rel);
    removed++;
    actions.push({
      action: 'removed',
      path: rel,
      agentId: record.agentId,
      message: 'Removed stale unmodified managed file.',
    });
  }

  if (!dryRun) {
    writeManagedManifestAtomic(root, manifest, fs);
  }

  return {
    actions,
    written,
    updated,
    removed,
    collisions,
    preserved,
    dryRun,
    manifest,
  };
}

// ── User-level local installer ────────────────────────────────────────────────

export function syncLocalUserAgents(opts: LocalInstallOptions): SyncResult {
  const home = opts.homeDir ?? homedir();
  const dryRun = opts.dryRun === true;
  const fs = opts.fs ?? defaultOwnershipFs();
  const exportsDir = resolve(opts.exportsDir);
  const managedDir = join(home, '.claude', 'agents', 'thesmos');
  // Use a synthetic "root" at home so resolveSafePath works with .claude/...
  const root = home;

  if (!existsSync(exportsDir)) {
    throw new Error(`No exports found at ${exportsDir}`);
  }

  let manifest: ManagedAgentsManifest;
  try {
    manifest = loadManagedManifest(root, fs);
  } catch {
    manifest = { version: 1, files: {} };
  }

  const exportFiles = readdirSync(exportsDir).filter((f) => f.endsWith('.md'));
  const desired: DesiredManagedAgent[] = [];
  for (const file of exportFiles) {
    const agentId = basename(file, '.md');
    const content = readFileSync(join(exportsDir, file), 'utf8');
    desired.push({ agentId, content, source: 'pantheon' });
  }

  // Warn on collisions in the legacy user root ~/.claude/agents/<id>.md
  const actions: SyncAction[] = [];
  let collisions = 0;
  const legacyRoot = join(home, '.claude', 'agents');
  for (const d of desired) {
    const legacy = join(legacyRoot, `${d.agentId}.md`);
    if (existsSync(legacy)) {
      // Do not overwrite — warn only
      collisions++;
      actions.push({
        action: 'collision',
        path: `.claude/agents/${d.agentId}.md`,
        agentId: d.agentId,
        message:
          `Untracked file exists at ~/.claude/agents/${d.agentId}.md. ` +
          `Installing managed copy under ~/.claude/agents/thesmos/ instead (if free).`,
      });
    }
  }

  // Reuse project sync against home as root
  const result = syncManagedClaudeAgents({
    root,
    desired,
    dryRun,
    fs,
    migrateLegacy: false,
  });

  // Retire former exports only when they are managed + unmodified
  const retired = opts.retired ?? ['iris-photography-agent.md'];
  for (const file of retired) {
    const agentId = basename(file, '.md');
    const rel = managedClaudeAgentRel(agentId);
    const inspection = inspectManagedFile(root, rel, result.manifest, fs);
    if (inspection.state === 'unmodified') {
      if (!dryRun) {
        const abs = resolveSafePath(root, rel);
        try {
          fs.unlink(abs);
        } catch {
          /* */
        }
        result.manifest = removeManagedRecord(result.manifest, rel);
        writeManagedManifestAtomic(root, result.manifest, fs);
      }
      result.removed++;
      result.actions.push({
        action: dryRun ? 'would_remove' : 'removed',
        path: rel,
        agentId,
        message: 'Retired former Pantheon export (unmodified managed file).',
      });
    } else if (inspection.state === 'modified') {
      result.preserved++;
      result.actions.push({
        action: 'skipped_remove_modified',
        path: rel,
        agentId,
        message: 'Retired export was modified — preserving.',
      });
    }
    // Also never delete untracked legacy root copies of retired names
    const legacy = join(legacyRoot, file);
    if (existsSync(legacy)) {
      result.actions.push({
        action: 'collision',
        path: `.claude/agents/${file}`,
        agentId,
        message: 'Untracked retired filename left untouched (ownership not proven).',
      });
      result.collisions++;
    }
  }

  result.collisions += collisions;
  result.actions = [...actions, ...result.actions];
  // Ensure managed dir exists for discoverability message
  if (!dryRun) {
    mkdirSync(managedDir, { recursive: true });
  }
  return result;
}

/** Format a human-readable sync summary. */
export function formatSyncSummary(result: SyncResult, title = 'Agent sync'): string {
  const lines = [
    `${title}${result.dryRun ? ' (dry-run)' : ''}`,
    `  written: ${result.written}`,
    `  updated: ${result.updated}`,
    `  removed: ${result.removed}`,
    `  collisions: ${result.collisions}`,
    `  preserved (modified): ${result.preserved}`,
  ];
  for (const a of result.actions) {
    if (
      a.action === 'skipped_unmodified' ||
      a.action === 'would_write' ||
      a.action === 'would_update' ||
      a.action === 'written' ||
      a.action === 'updated'
    ) {
      continue; // keep summary compact; collisions/preserves printed below
    }
    if (
      a.action === 'collision' ||
      a.action === 'preserved_modified' ||
      a.action === 'skipped_remove_modified' ||
      a.action === 'migrated' ||
      a.action === 'would_migrate'
    ) {
      lines.push(`  ! ${a.path}: ${a.message}`);
    }
  }
  return lines.join('\n');
}

/** Build desired list from a directory of .md exports. */
export function desiredFromExportsDir(exportsDir: string): DesiredManagedAgent[] {
  if (!existsSync(exportsDir)) return [];
  return readdirSync(exportsDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((file) => ({
      agentId: basename(file, '.md'),
      content: readFileSync(join(exportsDir, file), 'utf8'),
      source: 'pantheon' as const,
    }));
}

/** Convenience: sync project from pantheon exports directory. */
export function syncProjectFromExports(
  root: string,
  exportsDir: string,
  opts: { dryRun?: boolean; migrateLegacy?: boolean } = {}
): SyncResult {
  return syncManagedClaudeAgents({
    root,
    desired: desiredFromExportsDir(exportsDir),
    dryRun: opts.dryRun,
    migrateLegacy: opts.migrateLegacy ?? true,
  });
}

// Re-export marker helper for adapters
export { managedMarker, ensureManagedMarker };
