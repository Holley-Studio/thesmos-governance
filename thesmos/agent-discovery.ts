// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Federated agent discovery — project, user, plugin metadata, Pantheon managed,
 * and Thesmos canonical agents.
 *
 * Discovery never mutates `.thesmos/registry.json`.
 * Precedence mirrors Claude Code: project > user > plugin.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { parseFrontmatter } from './catalog.js';
import { deriveAgentId, isValidAgentId, toKebabCase } from './agent-lifecycle.js';
import {
  type AgentOrigin,
  type AgentOwnership,
  type AgentStatus,
  type ManagedAgentsManifest,
  contentHash,
  defaultOwnershipFs,
  inspectManagedFile,
  isManagedPath,
  loadManagedManifest,
  managedClaudeAgentRel,
  normalizeRelPath,
  parseManagedMarker,
  type OwnershipFs,
} from './agent-ownership.js';
import { loadRegistryConfig } from './registry.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DiscoveredAgent {
  id: string;
  name: string;
  invocationName: string;
  origin: AgentOrigin;
  ownership: AgentOwnership;
  status: AgentStatus;
  sourcePath?: string;
  pluginName?: string;
  shadows?: string[];
  shadowedBy?: string;
  /** Frontmatter name as declared (for duplicate-name diagnostics). */
  frontmatterName?: string;
  hash?: string;
}

export interface DiscoveryConflict {
  kind:
    | 'duplicate_id'
    | 'duplicate_name'
    | 'shadow'
    | 'modified_managed'
    | 'missing_managed'
    | 'legacy_collision';
  message: string;
  agentId?: string;
  paths?: string[];
  details?: Record<string, string>;
}

export interface DiscoveryResult {
  agents: DiscoveredAgent[];
  conflicts: DiscoveryConflict[];
}

export interface PluginAgentMeta {
  /** Scoped or unscoped invocation name, e.g. tools:security-reviewer */
  invocationName: string;
  id: string;
  name: string;
  pluginName: string;
  /** Optional absolute or relative path when known. */
  sourcePath?: string;
}

export interface DiscoveryOptions {
  root: string;
  /** Injectable home directory (tests). Default: os.homedir(). */
  homeDir?: string;
  /** Registered plugin agent metadata (no speculative FS crawling). */
  pluginAgents?: PluginAgentMeta[];
  /** Optional manifest override (tests). */
  manifest?: ManagedAgentsManifest;
  fs?: OwnershipFs;
  /** Extra listDir / exists for scanning agent directories. */
  listDir?: (absPath: string) => string[];
  fileExists?: (absPath: string) => boolean;
  readFile?: (absPath: string) => string;
}

interface RawCandidate {
  id: string;
  name: string;
  invocationName: string;
  origin: AgentOrigin;
  ownership: AgentOwnership;
  sourcePath: string;
  pluginName?: string;
  frontmatterName?: string;
  hash?: string;
  /** Precedence rank: lower wins for "active". */
  rank: number;
  managedRel?: string;
  statusHint?: AgentStatus;
}

const RANK = {
  project: 1,
  user: 2,
  plugin: 3,
  pantheon_managed: 4,
  thesmos_canonical: 5,
} as const;

// ── Scanning helpers ──────────────────────────────────────────────────────────

function defaultListDir(absPath: string): string[] {
  if (!existsSync(absPath)) return [];
  try {
    return readdirSync(absPath);
  } catch {
    return [];
  }
}

function listMarkdownAgents(
  absDir: string,
  listDir: (p: string) => string[],
  fileExists: (p: string) => boolean,
  recursive = false
): string[] {
  if (!fileExists(absDir)) return [];
  const out: string[] = [];
  for (const name of listDir(absDir)) {
    if (name.startsWith('.')) continue;
    const abs = join(absDir, name);
    if (name.endsWith('.md') && name.toLowerCase() !== 'readme.md') {
      out.push(abs);
      continue;
    }
    if (recursive) {
      try {
        if (statSync(abs).isDirectory()) {
          out.push(...listMarkdownAgents(abs, listDir, fileExists, true));
        }
      } catch {
        /* skip */
      }
    }
  }
  return out.sort();
}

function readAgentMeta(
  absPath: string,
  content: string
): { id: string; name: string; frontmatterName?: string } {
  const { frontmatter } = parseFrontmatter(content);
  const id = deriveAgentId(content, absPath);
  const fmName =
    typeof frontmatter['name'] === 'string' ? frontmatter['name'].trim() : undefined;
  const name = fmName || basename(absPath, extname(absPath));
  return { id, name, frontmatterName: fmName };
}

function pantheonInvocation(agentId: string): string {
  return `pantheon:${agentId}`;
}

// ── Core discovery ────────────────────────────────────────────────────────────

export function discoverAgents(opts: DiscoveryOptions): DiscoveryResult {
  const root = resolve(opts.root);
  const home = opts.homeDir ?? homedir();
  const fs = opts.fs ?? defaultOwnershipFs();
  const listDir = opts.listDir ?? defaultListDir;
  const fileExists = opts.fileExists ?? ((p) => existsSync(p));
  const readFile = opts.readFile ?? ((p) => readFileSync(p, 'utf8'));

  let manifest: ManagedAgentsManifest;
  try {
    manifest = opts.manifest ?? loadManagedManifest(root, fs);
  } catch {
    manifest = { version: 1, files: {} };
  }

  const candidates: RawCandidate[] = [];
  const conflicts: DiscoveryConflict[] = [];

  // 1) Project agents under .claude/agents/ (including thesmos/ subdir)
  const projectAgentsDir = join(root, '.claude', 'agents');
  for (const abs of listMarkdownAgents(projectAgentsDir, listDir, fileExists, true)) {
    let content: string;
    try {
      content = readFile(abs);
    } catch {
      continue;
    }
    const relPath = normalizeRelPath(
      abs.startsWith(root) ? abs.slice(root.length).replace(/^[/\\]+/, '') : abs
    );
    const meta = readAgentMeta(abs, content);
    const managed = isManagedPath(manifest, relPath);
    const marker = parseManagedMarker(content);
    const underManagedNs = relPath.startsWith('.claude/agents/thesmos/');

    if (managed || (underManagedNs && marker)) {
      const inspection = inspectManagedFile(root, relPath, manifest, fs);
      let statusHint: AgentStatus = 'active';
      if (inspection.state === 'modified') {
        statusHint = 'modified';
        conflicts.push({
          kind: 'modified_managed',
          agentId: meta.id,
          message: `Managed file was modified outside Thesmos: ${relPath}`,
          paths: [relPath],
        });
      }
      candidates.push({
        id: meta.id,
        name: meta.name,
        invocationName: pantheonInvocation(meta.id),
        origin: 'pantheon',
        ownership: 'managed',
        sourcePath: abs,
        frontmatterName: meta.frontmatterName,
        hash: contentHash(content),
        rank: RANK.pantheon_managed,
        managedRel: relPath,
        statusHint,
      });
      // Also expose unscoped name when under thesmos/ — Claude Code uses filename stem
      candidates.push({
        id: meta.id,
        name: meta.name,
        invocationName: meta.id,
        origin: 'pantheon',
        ownership: 'managed',
        sourcePath: abs,
        frontmatterName: meta.frontmatterName,
        hash: contentHash(content),
        rank: RANK.pantheon_managed + 0.5,
        managedRel: relPath,
        statusHint,
      });
    } else {
      // External project agent (including legacy root copies)
      candidates.push({
        id: meta.id,
        name: meta.name,
        invocationName: meta.id,
        origin: 'project',
        ownership: 'external',
        sourcePath: abs,
        frontmatterName: meta.frontmatterName,
        hash: contentHash(content),
        rank: RANK.project,
      });
      if (
        fileExists(join(root, '.claude', 'agents', 'thesmos', `${meta.id}.md`)) ||
        manifest.files[managedClaudeAgentRel(meta.id)]
      ) {
        conflicts.push({
          kind: 'legacy_collision',
          agentId: meta.id,
          message:
            `External project agent "${meta.id}" collides with a Pantheon managed path. ` +
            `Active override: ${relPath}. Pantheon scoped name remains pantheon:${meta.id}.`,
          paths: [relPath, managedClaudeAgentRel(meta.id)],
        });
      }
    }
  }

  // 2) User agents ~/.claude/agents/ (injectable home)
  const userAgentsDir = join(home, '.claude', 'agents');
  for (const abs of listMarkdownAgents(userAgentsDir, listDir, fileExists, true)) {
    let content: string;
    try {
      content = readFile(abs);
    } catch {
      continue;
    }
    const meta = readAgentMeta(abs, content);
    const underManaged = abs.replace(/\\/g, '/').includes('/.claude/agents/thesmos/');
    const marker = parseManagedMarker(content);
    if (underManaged || marker) {
      candidates.push({
        id: meta.id,
        name: meta.name,
        invocationName: pantheonInvocation(meta.id),
        origin: 'pantheon',
        ownership: 'managed',
        sourcePath: abs,
        frontmatterName: meta.frontmatterName,
        hash: contentHash(content),
        rank: RANK.user + 0.1,
      });
      candidates.push({
        id: meta.id,
        name: meta.name,
        invocationName: meta.id,
        origin: 'user',
        ownership: underManaged ? 'managed' : 'external',
        sourcePath: abs,
        frontmatterName: meta.frontmatterName,
        hash: contentHash(content),
        rank: RANK.user,
      });
    } else {
      candidates.push({
        id: meta.id,
        name: meta.name,
        invocationName: meta.id,
        origin: 'user',
        ownership: 'external',
        sourcePath: abs,
        frontmatterName: meta.frontmatterName,
        hash: contentHash(content),
        rank: RANK.user,
      });
    }
  }

  // 3) Plugin agents from registered metadata only
  for (const plugin of opts.pluginAgents ?? []) {
    candidates.push({
      id: plugin.id,
      name: plugin.name,
      invocationName: plugin.invocationName,
      origin: 'plugin',
      ownership: 'external',
      sourcePath: plugin.sourcePath ?? '',
      pluginName: plugin.pluginName,
      frontmatterName: plugin.name,
      rank: RANK.plugin,
    });
  }

  // 4) Canonical Thesmos agents (.thesmos/agents/) — registry-listed and on-disk
  const canonicalDir = join(root, '.thesmos', 'agents');
  const registry = loadRegistryConfig(root);
  const registryIds = new Set(registry.agents ?? []);
  for (const abs of listMarkdownAgents(canonicalDir, listDir, fileExists, false)) {
    let content: string;
    try {
      content = readFile(abs);
    } catch {
      continue;
    }
    const meta = readAgentMeta(abs, content);
    const adopted = registryIds.has(meta.id);
    candidates.push({
      id: meta.id,
      name: meta.name,
      invocationName: meta.id,
      origin: 'thesmos',
      ownership: adopted ? 'adopted' : 'external',
      sourcePath: abs,
      frontmatterName: meta.frontmatterName,
      hash: contentHash(content),
      rank: RANK.thesmos_canonical,
    });
  }

  // Missing managed files
  for (const [path, record] of Object.entries(manifest.files)) {
    const inspection = inspectManagedFile(root, path, manifest, fs);
    if (inspection.state === 'missing') {
      conflicts.push({
        kind: 'missing_managed',
        agentId: record.agentId,
        message: `Managed agent file is missing: ${path}`,
        paths: [path],
      });
    }
  }

  // Resolve active vs shadowed by invocation name, then by id
  return resolveDiscovery(candidates, conflicts);
}

function resolveDiscovery(
  candidates: RawCandidate[],
  seedConflicts: DiscoveryConflict[]
): DiscoveryResult {
  const conflicts = [...seedConflicts];
  const byInvocation = new Map<string, RawCandidate[]>();
  for (const c of candidates) {
    const key = c.invocationName.toLowerCase();
    const list = byInvocation.get(key) ?? [];
    list.push(c);
    byInvocation.set(key, list);
  }

  const agents: DiscoveredAgent[] = [];
  const seenInvocation = new Set<string>();

  for (const [invKey, group] of byInvocation) {
    group.sort((a, b) => a.rank - b.rank);
    const winner = group[0]!;
    const losers = group.slice(1);

    if (seenInvocation.has(invKey)) continue;
    seenInvocation.add(invKey);

    const shadows = losers.map((l) => l.invocationName);
    const status: AgentStatus =
      winner.statusHint === 'modified'
        ? 'modified'
        : losers.length > 0
          ? 'active'
          : winner.statusHint ?? 'active';

    agents.push({
      id: winner.id,
      name: winner.name,
      invocationName: winner.invocationName,
      origin: winner.origin,
      ownership: winner.ownership,
      status,
      sourcePath: winner.sourcePath || undefined,
      pluginName: winner.pluginName,
      frontmatterName: winner.frontmatterName,
      hash: winner.hash,
      shadows: shadows.length > 0 ? shadows : undefined,
    });

    for (const loser of losers) {
      agents.push({
        id: loser.id,
        name: loser.name,
        invocationName: loser.invocationName,
        origin: loser.origin,
        ownership: loser.ownership,
        status: 'shadowed',
        sourcePath: loser.sourcePath || undefined,
        pluginName: loser.pluginName,
        frontmatterName: loser.frontmatterName,
        hash: loser.hash,
        shadowedBy: winner.invocationName,
      });
      conflicts.push({
        kind: 'shadow',
        agentId: loser.id,
        message:
          `${loser.invocationName}\n` +
          `Status: shadowed\n` +
          (loser.origin === 'pantheon' || loser.invocationName.startsWith('pantheon:')
            ? `Pantheon invocation: ${pantheonInvocation(loser.id)}\n`
            : '') +
          `Active override: ${winner.sourcePath || winner.invocationName}`,
        paths: [winner.sourcePath, loser.sourcePath].filter(Boolean),
        details: {
          active: winner.invocationName,
          shadowed: loser.invocationName,
        },
      });
    }
  }

  // Duplicate IDs with different source paths that are both active unscoped.
  // Scoped pantheon: companions of an override are expected, not a conflict.
  const byId = new Map<string, DiscoveredAgent[]>();
  for (const a of agents) {
    if (a.status === 'shadowed') continue;
    if (a.invocationName.startsWith('pantheon:')) continue;
    const list = byId.get(a.id) ?? [];
    list.push(a);
    byId.set(a.id, list);
  }
  for (const [id, group] of byId) {
    const uniquePaths = new Set(group.map((g) => g.sourcePath).filter(Boolean));
    if (uniquePaths.size > 1) {
      conflicts.push({
        kind: 'duplicate_id',
        agentId: id,
        message: `Duplicate agent id "${id}" across ${uniquePaths.size} locations.`,
        paths: [...uniquePaths] as string[],
      });
      for (const g of group) {
        if (g.status === 'active') g.status = 'conflict';
      }
    }
  }

  // Duplicate frontmatter names (active only)
  const byName = new Map<string, DiscoveredAgent[]>();
  for (const a of agents) {
    if (a.status === 'shadowed' || !a.frontmatterName) continue;
    const key = a.frontmatterName.toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(a);
    byName.set(key, list);
  }
  for (const [name, group] of byName) {
    const uniqueIds = new Set(group.map((g) => g.id));
    if (uniqueIds.size > 1) {
      conflicts.push({
        kind: 'duplicate_name',
        message: `Duplicate frontmatter name "${name}" used by: ${[...uniqueIds].join(', ')}`,
        paths: group.map((g) => g.sourcePath).filter((p): p is string => !!p),
      });
    }
  }

  // Deduplicate conflict messages
  const seen = new Set<string>();
  const uniqueConflicts = conflicts.filter((c) => {
    const key = `${c.kind}:${c.agentId ?? ''}:${c.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  agents.sort((a, b) => a.invocationName.localeCompare(b.invocationName));
  return { agents, conflicts: uniqueConflicts };
}

/** Load optional plugin agent metadata from `.thesmos/plugin-agents.json` if present. */
export function loadPluginAgentMetadata(root: string): PluginAgentMeta[] {
  const path = join(root, '.thesmos', 'plugin-agents.json');
  if (!existsSync(path)) return [];
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object') return [];
    const agents = (raw as { agents?: unknown }).agents;
    if (!Array.isArray(agents)) return [];
    const out: PluginAgentMeta[] = [];
    for (const entry of agents) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      if (
        typeof e['invocationName'] === 'string' &&
        typeof e['id'] === 'string' &&
        typeof e['name'] === 'string' &&
        typeof e['pluginName'] === 'string'
      ) {
        out.push({
          invocationName: e['invocationName'],
          id: e['id'],
          name: e['name'],
          pluginName: e['pluginName'],
          sourcePath: typeof e['sourcePath'] === 'string' ? e['sourcePath'] : undefined,
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function formatAgentsTable(agents: DiscoveredAgent[]): string {
  const header =
    'AGENT                           ORIGIN       OWNERSHIP   STATUS';
  const lines = [header];
  for (const a of agents) {
    const status =
      a.status === 'active' && a.shadows && a.shadows.length > 0
        ? a.origin === 'project' || a.origin === 'user'
          ? 'Shadows Pantheon'
          : `Shadows ${a.shadows[0]}`
        : a.status === 'shadowed' && a.shadowedBy
          ? `Shadowed by ${a.shadowedBy}`
          : a.status === 'modified'
            ? 'Modified'
            : a.status.charAt(0).toUpperCase() + a.status.slice(1);
    const originLabel =
      a.origin === 'pantheon'
        ? 'Pantheon'
        : a.origin.charAt(0).toUpperCase() + a.origin.slice(1);
    const ownership =
      a.ownership.charAt(0).toUpperCase() + a.ownership.slice(1);
    lines.push(
      `${a.invocationName.padEnd(31)} ${originLabel.padEnd(12)} ${ownership.padEnd(11)} ${status}`
    );
  }
  return lines.join('\n');
}

/** Pure helper for tests: normalize an agent id string. */
export function normalizeDiscoveredId(raw: string): string {
  const id = toKebabCase(raw);
  return isValidAgentId(id) ? id : id;
}
