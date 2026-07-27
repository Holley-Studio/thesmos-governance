// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Prompt-context protection.
 *
 * Operation Signal removed 130–165KB of always-loaded adapter content by
 * refusing to inline the rule catalog and the agent roster into every generated
 * file. The Council Contract is exactly the kind of rich, structured, *useful*
 * metadata that invites the same mistake back in — sixty-eight contracts with
 * permissions and evidence schemas would dwarf the rule table that was removed.
 *
 * These tests fail if any of it reaches a generated adapter. Discovery is a
 * command to run (`thesmos agents:list --primary`), not a payload to memorize.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { buildAdapterContent, ADAPTER_OUTPUT_PATHS, type AdapterTarget, type Rule } from '../adapters.js';
import { CONFIG_DEFAULTS } from '../config.js';
import { loadCouncilContracts } from './load.js';
import { serializeContract } from './contract.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const TARGETS = Object.keys(ADAPTER_OUTPUT_PATHS) as AdapterTarget[];
const BUDGET_BYTES = 8192;

const rules: Rule[] = [
  { id: 'SEC_001', category: 'security', description: 'x', severity: 'BLOCKER', tags: ['security'] },
];

/** The full compiled roster — everything that must stay out of prompt context. */
const contracts = loadCouncilContracts({ root: REPO_ROOT, discovered: [] }).contracts;

function generatedSection(target: AdapterTarget): string {
  const content = buildAdapterContent(target, '', rules, CONFIG_DEFAULTS, {
    agents: contracts.map((c) => ({ id: c.identity.id, name: c.identity.displayName })),
    skills: [],
    profile: 'default',
  });
  // The Claude preamble *mentions* the markers in its instructions, so slice on
  // the real comment, not on the bare words.
  const start = content.indexOf('<!-- THESMOS:GENERATED START rules -->');
  const end = content.indexOf('<!-- THESMOS:GENERATED END rules -->');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return content.slice(start, end);
}

describe('adapters stay thin with the full roster available', () => {
  it.each(TARGETS)('%s does not enumerate the roster', (target) => {
    const section = generatedSection(target);
    const named = contracts.filter((c) => section.includes(c.identity.id));
    expect(
      named.map((c) => c.identity.id),
      'generated adapters must not name individual agents'
    ).toEqual([]);
  });

  it.each(TARGETS)('%s does not embed contract payloads', (target) => {
    const section = generatedSection(target);
    for (const marker of [
      'schemaVersion',
      'primaryRole',
      'preferredProfiles',
      'requiresHumanApproval',
      'maximumParallelChildren',
      'contentHash',
      'COUNCIL_',
    ]) {
      expect(section, `${target} leaked "${marker}" into prompt context`).not.toContain(marker);
    }
  });

  it.each(TARGETS)('%s does not embed permission or evidence schemas', (target) => {
    const section = generatedSection(target);
    for (const marker of ['**/.env', 'files-reviewed', 'residual-risk', 'trust-boundaries']) {
      expect(section, `${target} leaked "${marker}"`).not.toContain(marker);
    }
  });

  it.each(TARGETS)('%s stays inside the 8KB generated-section budget', (target) => {
    expect(Buffer.byteLength(generatedSection(target), 'utf8')).toBeLessThan(BUDGET_BYTES);
  });

  it('is orders of magnitude smaller than the roster it describes', () => {
    const rosterBytes = contracts.reduce(
      (total, c) => total + Buffer.byteLength(serializeContract(c), 'utf8'),
      0
    );
    const adapterBytes = Buffer.byteLength(generatedSection('claude'), 'utf8');
    expect(rosterBytes).toBeGreaterThan(200_000);
    expect(adapterBytes * 20).toBeLessThan(rosterBytes);
  });

  it('reports agent availability as a count and a command, not a list', () => {
    const section = generatedSection('claude');
    expect(section).toContain(`**Active agents:** ${contracts.length}`);
    expect(section).toContain('thesmos agents:list');
  });

  it('remains deterministic', () => {
    for (const target of TARGETS) {
      expect(generatedSection(target)).toBe(generatedSection(target));
    }
  });

  it('does not grow when the roster grows', () => {
    const small = buildAdapterContent('claude', '', rules, CONFIG_DEFAULTS, {
      agents: [{ id: 'a', name: 'A' }],
      skills: [],
    });
    const large = buildAdapterContent('claude', '', rules, CONFIG_DEFAULTS, {
      agents: contracts.map((c) => ({ id: c.identity.id, name: c.identity.displayName })),
      skills: [],
    });
    // The only difference a bigger roster may make is the count itself.
    expect(Math.abs(large.length - small.length)).toBeLessThan(64);
  });

  it('preserves user-authored content outside the generated markers', () => {
    const existing = '# My notes\n\nKeep this.\n\n<!-- THESMOS:GENERATED START rules -->\nold\n<!-- THESMOS:GENERATED END rules -->\n\nAnd this.\n';
    const updated = buildAdapterContent('claude', existing, rules, CONFIG_DEFAULTS, {
      agents: contracts.map((c) => ({ id: c.identity.id, name: c.identity.displayName })),
      skills: [],
    });
    expect(updated).toContain('# My notes');
    expect(updated).toContain('Keep this.');
    expect(updated).toContain('And this.');
    expect(updated).not.toContain('\nold\n');
  });
});
