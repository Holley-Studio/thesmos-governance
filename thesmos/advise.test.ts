import { describe, it, expect } from 'vitest';
import {
  classifyPlan,
  recommendModel,
  suggestAgents,
  buildAdvisory,
} from './advise.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MECHANICAL_PLAN = `
# Plan: Fix stale counts across the site

Rename all references from 46 agents to 66 agents. Regenerate the export
files with a sed pass. Bump the version config. Update the .gitignore.
Fix broken links and truth table counts across every page. Move the old
ZIP files to a new directory and reformat the package.json scripts.
`;

const CREATIVE_PLAN = `
# Plan: Rewrite the Gumroad listing and landing page copy

Sharpen the brand voice on the pricing page. Write a new headline and
tagline for the campaign. Punch up the customer-facing copywriting on
the landing page hero, the pitch, and the narrative arc of the story.
Marketing needs a stronger tone for the Gumroad description.
`;

const ARCHITECTURE_PLAN = `
# Plan: Redesign the agent orchestration system

This requires a full architecture redesign: new data model, new schema,
a migration plan, and a rearchitected orchestration protocol for the
multi-agent system design. Significant refactor of the API design.
`;

const BULK_PLAN = `
# Plan: Apply a formatting fix across the entire codebase

Batch process every file in the repo. Mass rename across all pages.
Bulk update every page's footer across the entire codebase.
`;

const MIXED_PLAN = `
# Plan: Ship the new pricing page

Refactor the pricing architecture and data model slightly, then write
punchy landing page copy and a new tagline, then rename a few config
files and bump the version.
`;

const PANTHEON_MAP = {
  apollo: { emoji: '✍️', name: 'Apollo', domain: 'Content & Copywriting' },
  hephaestus: { emoji: '🔨', name: 'Hephaestus', domain: 'UI/UX & Design Systems' },
  plutus: { emoji: '💰', name: 'Plutus', domain: 'Finance, Pricing & Unit Economics' },
  talos: { emoji: '⚙️', name: 'Talos', domain: 'Web Development & Implementation' },
};

// ── classifyPlan ──────────────────────────────────────────────────────────────

describe('classifyPlan', () => {
  it('classifies a mechanical-heavy plan as mostly mechanical', () => {
    const c = classifyPlan(MECHANICAL_PLAN);
    expect(c.mechanicalPct).toBeGreaterThan(c.creativePct);
    expect(c.mechanicalPct).toBeGreaterThan(c.architecturePct);
    expect(c.mechanicalPct).toBeGreaterThan(c.bulkPct);
  });

  it('classifies a creative-heavy plan as mostly creative', () => {
    const c = classifyPlan(CREATIVE_PLAN);
    expect(c.creativePct).toBeGreaterThan(c.mechanicalPct);
    expect(c.creativePct).toBeGreaterThan(c.architecturePct);
  });

  it('classifies an architecture-heavy plan as mostly architecture', () => {
    const c = classifyPlan(ARCHITECTURE_PLAN);
    expect(c.architecturePct).toBeGreaterThan(c.mechanicalPct);
    expect(c.architecturePct).toBeGreaterThan(c.creativePct);
  });

  it('classifies a bulk-heavy plan with a high bulk percentage', () => {
    const c = classifyPlan(BULK_PLAN);
    expect(c.bulkPct).toBeGreaterThan(0);
    expect(c.bulkPct).toBeGreaterThanOrEqual(c.creativePct);
  });

  it('defaults to a mechanical-leaning mix when no keywords match', () => {
    const c = classifyPlan('Do the thing.');
    expect(c.mechanicalPct).toBeGreaterThan(c.creativePct);
    expect(c.mechanicalPct + c.creativePct + c.architecturePct + c.bulkPct).toBe(100);
  });
});

// ── recommendModel ────────────────────────────────────────────────────────────

describe('recommendModel', () => {
  it('recommends sonnet for mechanical-heavy work', () => {
    const c = classifyPlan(MECHANICAL_PLAN);
    const r = recommendModel(c);
    expect(r.model).toBe('sonnet');
  });

  it('recommends fable for architecture-heavy work', () => {
    const c = classifyPlan(ARCHITECTURE_PLAN);
    const r = recommendModel(c);
    expect(r.model).toBe('fable');
  });

  it('recommends fable for creative-heavy work', () => {
    const c = classifyPlan(CREATIVE_PLAN);
    const r = recommendModel(c);
    expect(r.model).toBe('fable');
  });

  it('recommends haiku for bulk-dominant work with low judgment content', () => {
    const c = { mechanicalPct: 10, creativePct: 5, architecturePct: 5, bulkPct: 80 };
    const r = recommendModel(c);
    expect(r.model).toBe('haiku');
  });

  it('never recommends fable as the default for mixed mechanical work', () => {
    const c = { mechanicalPct: 70, creativePct: 10, architecturePct: 10, bulkPct: 10 };
    const r = recommendModel(c);
    expect(r.model).not.toBe('fable');
  });
});

// ── suggestAgents ─────────────────────────────────────────────────────────────

describe('suggestAgents', () => {
  it('matches Apollo for copywriting-heavy text', () => {
    const agents = suggestAgents(CREATIVE_PLAN, PANTHEON_MAP);
    expect(agents.some((a) => a.name === 'Apollo')).toBe(true);
  });

  it('matches Plutus for pricing text', () => {
    const agents = suggestAgents('Review the pricing and unit economics', PANTHEON_MAP);
    expect(agents.some((a) => a.name === 'Plutus')).toBe(true);
  });

  it('returns no more than the requested limit', () => {
    const agents = suggestAgents(MIXED_PLAN, PANTHEON_MAP, 2);
    expect(agents.length).toBeLessThanOrEqual(2);
  });

  it('returns an empty array when nothing matches', () => {
    const agents = suggestAgents('zzz qqq xyz', PANTHEON_MAP);
    expect(agents).toEqual([]);
  });
});

// ── buildAdvisory (integration) ───────────────────────────────────────────────

describe('buildAdvisory', () => {
  it('produces a self-consistent advisory for a mixed plan', () => {
    const advisory = buildAdvisory(MIXED_PLAN, PANTHEON_MAP);
    expect(['haiku', 'sonnet', 'fable']).toContain(advisory.recommendation.model);
    expect(advisory.classification.mechanicalPct + advisory.classification.creativePct +
      advisory.classification.architecturePct + advisory.classification.bulkPct).toBe(100);
  });
});
