// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Agent populations (WS3).
 *
 * Every count here is COMPUTED from explicit `agent_kind` / `availability` /
 * `marketed` frontmatter. Nothing infers a population from a folder name, a
 * mythology field, or the presence of a model pin.
 *
 * ── The problem this replaces ───────────────────────────────────────────────
 * The repository carried a single ambiguous `agentCount`, and five public
 * surfaces disagreed about it (67, 68, 43, 21, 59). Each number was correct for
 * *something*; none said what. A count without a named population is not a fact.
 *
 * ── The public number ───────────────────────────────────────────────────────
 * `availableAgentCount` = every currently available, customer-facing Thesmos
 * Agent across Free and Pro, EXCLUDING held-back, internal and reviewer-only
 * agents. It is derived, never chosen to match marketing copy.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type AgentKind = 'specialist' | 'utility' | 'reviewer' | 'internal';
export type AgentAvailability = 'free' | 'pro' | 'held_back' | 'internal';

export interface ClassifiedAgent {
  id: string;
  file: string;
  agentKind: AgentKind;
  availability: AgentAvailability;
  marketed: boolean;
  routable: boolean;
  exportable: boolean;
}

export interface AgentPopulations {
  /** Mythology-inspired specialist personas available to customers. */
  specialistPersonaCount: number;
  /** Utility/operational agents available to customers. */
  utilityAgentCount: number;
  /** THE PUBLIC NUMBER: all customer-available agents (free + pro). */
  availableAgentCount: number;
  freeAgentCount: number;
  proAgentCount: number;
  /** Catalog agents deliberately withheld from customers. */
  heldBackAgentCount: number;
  /** Reviewers and internal agents never marketed as customer agents. */
  internalReviewerCount: number;
  /** Every unique catalog agent definition, marketed or not. */
  catalogAgentCount: number;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n---/;

function scalar(block: string, key: string): string | null {
  const m = block.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'));
  return m ? m[1]!.replace(/^["']|["']$/g, '').trim() : null;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Read every classified agent. Throws when an agent lacks explicit
 * classification — a silently-skipped agent would under-report a population,
 * which is the failure mode this module exists to prevent.
 */
export function loadClassifiedAgents(pkgRoot: string): ClassifiedAgent[] {
  const dir = join(pkgRoot, 'catalog', 'agents');
  const out: ClassifiedAgent[] = [];
  const unclassified: string[] = [];

  for (const full of walk(dir)) {
    const src = readFileSync(full, 'utf8');
    const fm = src.match(FM);
    if (!fm) continue; // prose/README files are not agents
    const block = fm[1]!;
    const id = scalar(block, 'id');
    if (!id) continue;

    const agentKind = scalar(block, 'agent_kind') as AgentKind | null;
    const availability = scalar(block, 'availability') as AgentAvailability | null;
    if (!agentKind || !availability) {
      unclassified.push(id);
      continue;
    }

    out.push({
      id,
      file: full,
      agentKind,
      availability,
      marketed: scalar(block, 'marketed') === 'true',
      routable: scalar(block, 'routable') === 'true',
      exportable: scalar(block, 'exportable') === 'true',
    });
  }

  if (unclassified.length > 0) {
    throw new Error(
      `${unclassified.length} agent(s) lack explicit agent_kind/availability and cannot be counted: ` +
        `${unclassified.slice(0, 5).join(', ')}${unclassified.length > 5 ? ', …' : ''}. ` +
        `Run \`node scripts/classify-agents.mjs\`.`,
    );
  }
  return out;
}

export function computePopulations(agents: readonly ClassifiedAgent[]): AgentPopulations {
  const customerAvailable = (a: ClassifiedAgent) =>
    a.marketed && (a.availability === 'free' || a.availability === 'pro');

  return {
    specialistPersonaCount: agents.filter((a) => a.agentKind === 'specialist' && customerAvailable(a)).length,
    utilityAgentCount: agents.filter((a) => a.agentKind === 'utility' && customerAvailable(a)).length,
    availableAgentCount: agents.filter(customerAvailable).length,
    freeAgentCount: agents.filter((a) => a.availability === 'free').length,
    proAgentCount: agents.filter((a) => a.availability === 'pro').length,
    heldBackAgentCount: agents.filter((a) => a.availability === 'held_back').length,
    internalReviewerCount: agents.filter((a) => a.agentKind === 'reviewer').length,
    catalogAgentCount: agents.length,
  };
}

/**
 * Invariants that must hold for the populations to be coherent.
 * Returns problems rather than throwing so a caller can report them all.
 */
export function checkPopulationInvariants(p: AgentPopulations): string[] {
  const problems: string[] = [];
  if (p.freeAgentCount + p.proAgentCount !== p.availableAgentCount) {
    problems.push(
      `free (${p.freeAgentCount}) + pro (${p.proAgentCount}) != available (${p.availableAgentCount})`,
    );
  }
  if (p.specialistPersonaCount + p.utilityAgentCount !== p.availableAgentCount) {
    problems.push(
      `specialist (${p.specialistPersonaCount}) + utility (${p.utilityAgentCount}) != available (${p.availableAgentCount})`,
    );
  }
  if (p.availableAgentCount > p.catalogAgentCount) {
    problems.push(`available (${p.availableAgentCount}) exceeds catalog total (${p.catalogAgentCount})`);
  }
  if (p.availableAgentCount === 0) {
    problems.push('availableAgentCount is 0 — classification almost certainly failed');
  }
  return problems;
}

export function computePopulationsForRoot(pkgRoot: string): AgentPopulations {
  return computePopulations(loadClassifiedAgents(pkgRoot));
}
