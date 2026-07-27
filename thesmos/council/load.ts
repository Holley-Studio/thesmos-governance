// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Bridge from the existing agent world to compiled contracts.
 *
 * Sources, in the same precedence order discovery already uses:
 *   1. discovered agents — project, user, plugin, managed Pantheon, adopted
 *   2. the built-in catalog — the shipped Pantheon and reviewer roster
 *
 * Nothing here writes. Compiling a contract must never adopt an external agent,
 * rewrite a document, or touch `.thesmos/managed-agents.json` — ownership is
 * decided by the manifest and by `agent:adopt`, and this module only reads what
 * those already decided.
 */

import { existsSync, readFileSync } from 'node:fs';
import { loadBuiltInCatalog } from '../catalog.js';
import { discoverAgents, loadPluginAgentMetadata, type DiscoveredAgent } from '../agent-discovery.js';
import type { CouncilAgentContract, CouncilOwnership } from './contract.js';
import {
  compileAgentContract,
  type CouncilCompileNote,
  type CouncilCompileSource,
} from './compiler.js';

export interface CouncilLoadOptions {
  root: string;
  /** Injectable home directory, so discovery is not machine-dependent in tests. */
  homeDir?: string;
  /** Injected for tests; defaults to real discovery. */
  discovered?: DiscoveredAgent[];
  /** Injected for tests; defaults to the shipped catalog. */
  builtIn?: Array<{ path: string; content: string; owner: string }>;
  readFile?: (absPath: string) => string | null;
  /** Skip the built-in roster (used by tests that want only project agents). */
  includeBuiltIn?: boolean;
}

export interface CouncilLoadResult {
  contracts: CouncilAgentContract[];
  notesByAgent: Record<string, CouncilCompileNote[]>;
  /** Documents that could not be read. Reported, never silently dropped. */
  unreadable: string[];
}

function defaultReadFile(absPath: string): string | null {
  try {
    return existsSync(absPath) ? readFileSync(absPath, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * Built-in catalog documents ship inside the Thesmos package, so they are
 * Thesmos-owned by construction. User-space files are a different question
 * entirely — those are only `managed` when `.thesmos/managed-agents.json` says
 * so, which is what discovery already reports.
 */
const BUILT_IN_OWNERSHIP: CouncilOwnership = 'managed';

/**
 * Compile every agent this repo can route to.
 *
 * Precedence: a discovered agent wins over a built-in of the same id, mirroring
 * Claude Code's project > user > plugin ordering. The built-in is not dropped
 * silently — it simply is not compiled twice under one id, which is what would
 * make a duplicate-id error meaningless.
 */
export function loadCouncilContracts(options: CouncilLoadOptions): CouncilLoadResult {
  const root = options.root;
  const readFile = options.readFile ?? defaultReadFile;
  const unreadable: string[] = [];
  const sources: CouncilCompileSource[] = [];
  const seen = new Set<string>();

  const discovered =
    options.discovered ??
    discoverAgents({
      root,
      ...(options.homeDir ? { homeDir: options.homeDir } : {}),
      pluginAgents: loadPluginAgentMetadata(root),
    }).agents;

  for (const agent of discovered) {
    // Scoped duplicates (`pantheon:x` alongside `x`) describe one document.
    if (seen.has(agent.id)) continue;
    if (!agent.sourcePath) continue;
    if (agent.status === 'shadowed') continue;
    const content = readFile(agent.sourcePath);
    if (content === null) {
      unreadable.push(agent.sourcePath);
      continue;
    }
    seen.add(agent.id);
    sources.push({
      content,
      sourcePath: agent.sourcePath,
      ownership: agent.ownership,
      root,
      agentId: agent.id,
    });
  }

  if (options.includeBuiltIn !== false) {
    const builtIn =
      options.builtIn ??
      loadBuiltInCatalog().agents.map((entry) => ({
        path: entry.path,
        content: entry.content,
        owner: entry.frontmatter.owner,
      }));

    for (const entry of builtIn) {
      const source: CouncilCompileSource = {
        content: entry.content,
        sourcePath: entry.path,
        ownership: BUILT_IN_OWNERSHIP,
        root,
        owner: entry.owner,
      };
      const compiled = compileAgentContract(source);
      if (seen.has(compiled.contract.identity.id)) continue;
      seen.add(compiled.contract.identity.id);
      sources.push(source);
    }
  }

  const results = sources
    .map((source) => compileAgentContract(source))
    .sort((a, b) => a.contract.identity.id.localeCompare(b.contract.identity.id));

  const notesByAgent: Record<string, CouncilCompileNote[]> = {};
  for (const result of results) {
    if (result.notes.length > 0) notesByAgent[result.contract.identity.id] = result.notes;
  }

  return {
    contracts: results.map((r) => r.contract),
    notesByAgent,
    unreadable: [...new Set(unreadable)].sort(),
  };
}

/** Find one compiled contract by normalized id. */
export function findContract(
  contracts: readonly CouncilAgentContract[],
  agentId: string
): CouncilAgentContract | undefined {
  return contracts.find((c) => c.identity.id === agentId);
}
