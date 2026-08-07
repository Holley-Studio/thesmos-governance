// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Canonical agent population invariants.
 *
 * These numbers are product truth. They are asserted here because five public
 * surfaces once disagreed about "the agent count" (67, 68, 43, 21, 59) and each
 * was correct for *something* — a count without a named population is not a
 * fact. A drift in any one of these should fail CI, not ship.
 *
 * Every figure is COMPUTED from explicit `agent_kind` / `availability` /
 * `marketed` frontmatter. Nothing here infers a population from a folder name,
 * a mythology field, or the presence of a model pin.
 */
import { describe, it, expect } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computePopulations, loadClassifiedAgents } from './agent-populations.js';

const PKG_ROOT = dirname(fileURLToPath(import.meta.url));

const agents = loadClassifiedAgents(PKG_ROOT);
const pop = computePopulations(agents);

/**
 * NOTE ON THE EXPECTED NUMBERS
 *
 * The owner-approved product truth is 68 available / 1 held back / 60
 * reviewers / 129 total. This branch yields 67 / 1 / 60 / 128 because it
 * predates #136, which adds the Eunomia steward agent.
 *
 * Eunomia cannot be ported in isolation: its entry in the generated
 * `pantheon-models.ts` carries #135's model reassignments, and this branch's
 * export generator cannot regenerate that map (it emits a single entry). So
 * the 68th agent arrives with a rebase onto #135–#137, not with a cherry-pick.
 *
 * The tests below therefore assert what is TRUE HERE plus the invariants that
 * must hold in either state. `availableAgentCount` is asserted against a named
 * constant so the rebase flips one line and the intent stays legible.
 */
const EXPECTED_AVAILABLE = 67; // becomes 68 with Eunomia (#136)
const EXPECTED_TOTAL = 128; // becomes 129 with Eunomia (#136)

describe('canonical populations', () => {
  it('reports every available customer-facing agent', () => {
    expect(pop.availableAgentCount).toBe(EXPECTED_AVAILABLE);
  });

  it('reports exactly 1 held-back agent', () => {
    expect(pop.heldBackAgentCount).toBe(1);
  });

  it('reports 60 internal reviewers', () => {
    expect(pop.internalReviewerCount).toBe(60);
  });

  it('reports every catalog agent', () => {
    expect(pop.catalogAgentCount).toBe(EXPECTED_TOTAL);
  });

  it('holds the population identity available + heldBack + reviewers = total', () => {
    // The invariant that makes the four numbers one coherent model rather than
    // four independently-drifting figures.
    expect(pop.availableAgentCount + pop.heldBackAgentCount + pop.internalReviewerCount).toBe(
      pop.catalogAgentCount,
    );
  });
});

describe('free / pro split', () => {
  it('reports 6 free and the rest pro-exclusive', () => {
    expect(pop.freeAgentCount).toBe(6);
    expect(pop.proAgentCount).toBe(EXPECTED_AVAILABLE - 6);
  });

  it('holds 6 + 62 = 68 available', () => {
    // Pro *total* is 68, not 62. "62 agents in Pro" would understate the
    // product by excluding the six a Pro customer also receives.
    expect(pop.freeAgentCount + pop.proAgentCount).toBe(pop.availableAgentCount);
  });
});

describe('routability boundaries', () => {
  const byId = new Map(agents.map((a) => [a.id, a]));

  it('keeps the held-back agent catalogued but unavailable', () => {
    // Held back means withheld, not deleted — it must still exist.
    const asclepius = byId.get('asclepius-debugging-agent');
    expect(asclepius).toBeDefined();
    expect(asclepius!.availability).toBe('held_back');
    expect(asclepius!.marketed).toBe(false);
  });

  it('is short exactly the Eunomia agent versus the owner-approved 68', () => {
    // Documents the gap mechanically rather than in prose: this branch has no
    // Eunomia, and that single absence is the whole 68-vs-67 discrepancy.
    expect(byId.has('eunomia-repository-steward-agent')).toBe(false);
    expect(pop.availableAgentCount + 1).toBe(68);
    expect(pop.catalogAgentCount + 1).toBe(129);
  });

  it('never counts a reviewer as a customer-facing agent', () => {
    const marketedReviewers = agents.filter((a) => a.agentKind === 'reviewer' && a.marketed);
    expect(marketedReviewers).toEqual([]);
  });

  it('never counts a held-back agent as available', () => {
    const leaked = agents.filter((a) => a.availability === 'held_back' && a.marketed);
    expect(leaked).toEqual([]);
  });
});

describe('classification is explicit, never inferred', () => {
  it('classifies every catalog agent', () => {
    // loadClassifiedAgents throws on an unclassified agent rather than skipping
    // it, because a silently-skipped agent under-reports a population.
    expect(() => loadClassifiedAgents(PKG_ROOT)).not.toThrow();
  });

  it('gives every agent both a kind and an availability', () => {
    for (const a of agents) {
      expect(a.agentKind, `${a.id} agentKind`).toBeTruthy();
      expect(a.availability, `${a.id} availability`).toBeTruthy();
    }
  });

  it('does not classify by folder location', () => {
    // A reviewer outside reviewers/, or a specialist inside it, must still be
    // classified by its declared frontmatter.
    const reviewers = agents.filter((a) => a.agentKind === 'reviewer');
    expect(reviewers.length).toBe(60);
    expect(reviewers.every((a) => a.availability === 'internal')).toBe(true);
  });
});

describe('routable population for mission selection', () => {
  it('exposes exactly the available agents to routing, and nothing else', () => {
    const routable = agents.filter(
      (a) => a.marketed && (a.availability === 'free' || a.availability === 'pro'),
    );
    expect(routable).toHaveLength(EXPECTED_AVAILABLE);
    expect(routable.some((a) => a.id === 'asclepius-debugging-agent')).toBe(false);
    expect(routable.some((a) => a.agentKind === 'reviewer')).toBe(false);
  });
});
