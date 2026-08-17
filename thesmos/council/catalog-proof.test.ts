// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Proof that the contract governs the agents that actually ship.
 *
 * These tests compile the real catalog rather than fixtures. A fixture proves
 * the compiler works on documents written for the compiler; this proves it
 * works on the sixty-eight documents written years before it existed.
 */

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { loadCouncilContracts } from './load.js';
import { validateContract, validateContracts } from './validate.js';
import { COUNCIL_PRIMARY_ROLES, serializeContract } from './contract.js';
import { COUNCIL_ROLE_DEFINITIONS } from './roles.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Compiled once from the shipped catalog only.
 *
 * `discovered: []` is deliberate. Real discovery also reads `~/.claude/agents`,
 * so on a developer machine with the Pantheon installed the compiled set would
 * depend on that machine's home directory — a proof that passes for one
 * operator and fails for the next proves nothing. Discovery precedence itself
 * is covered by `load.test.ts` against a temporary home.
 */
const loaded = loadCouncilContracts({ root: REPO_ROOT, discovered: [] });
const contracts = loaded.contracts;
const byId = new Map(contracts.map((c) => [c.identity.id, c]));

/** The five agents Olympus PR 1 must prove by name. */
const NAMED_AGENTS = [
  'zeus-executive-agent',
  'argus-security-agent',
  'athena-strategy-agent',
  'hephaestus-design-agent',
  'themis-legal-agent',
];

describe('catalog compilation', () => {
  it('compiles the shipped roster without unreadable documents', () => {
    expect(contracts.length).toBeGreaterThan(60);
    expect(loaded.unreadable).toEqual([]);
  });

  it.each(NAMED_AGENTS)('compiles %s into a valid contract', (id) => {
    const contract = byId.get(id);
    expect(contract, `${id} missing from compiled contracts`).toBeDefined();
    const result = validateContract(contract!);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(errors, `${id}: ${errors.map((e) => `${e.code} ${e.path}`).join('; ')}`).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it.each(COUNCIL_ROLE_DEFINITIONS.map((r) => [r.role, r.leadAgentId] as const))(
    'has a selectable lead for the %s role (%s)',
    (role, leadId) => {
      const contract = byId.get(leadId);
      expect(contract, `${leadId} (lead for ${role}) missing from the catalog`).toBeDefined();
      expect(contract!.classification.mode).not.toBe('subagent');
      expect(contract!.classification.hidden).toBe(false);
      expect(validateContract(contract!).valid).toBe(true);
    }
  );

  it('validates the whole compiled set without safety errors', () => {
    const result = validateContracts(contracts);
    const errors = result.issues.filter((i) => i.severity === 'error');
    expect(
      errors.map((e) => `${e.code} @ ${e.path}: ${e.message}`).slice(0, 10),
      'compiled catalog must contain no contract errors'
    ).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('classifies specialists as hidden subagents and leads as visible', () => {
    const leadIds = new Set(COUNCIL_ROLE_DEFINITIONS.map((r) => r.leadAgentId));
    const specialists = contracts.filter(
      (c) => !leadIds.has(c.identity.id) && c.classification.mode === 'subagent'
    );
    // The roster is overwhelmingly specialists — that is the point of the
    // eight-role selector.
    expect(specialists.length).toBeGreaterThan(contracts.length / 2);
    expect(specialists.every((c) => c.classification.hidden)).toBe(true);
  });

  it.each([
    ['zeus-executive-agent', 'plan', 'all'],
    ['argus-security-agent', 'security', 'primary'],
    ['athena-strategy-agent', 'plan', 'subagent'],
    ['hephaestus-design-agent', 'design', 'primary'],
    ['themis-legal-agent', 'operations', 'subagent'],
    ['talos-web-dev-agent', 'build', 'primary'],
    ['cassandra-qa-agent', 'debug', 'primary'],
    ['hermes-marketing-agent', 'growth', 'primary'],
  ])('classifies %s as role=%s mode=%s', (id, role, mode) => {
    const contract = byId.get(id)!;
    expect(contract).toBeDefined();
    expect(contract.classification.primaryRole).toBe(role);
    expect(contract.classification.mode).toBe(mode);
  });

  it('covers every primary role with at least one compiled agent', () => {
    const covered = new Set(contracts.map((c) => c.classification.primaryRole));
    for (const role of COUNCIL_PRIMARY_ROLES) {
      expect(covered.has(role), `no agent classified as ${role}`).toBe(true);
    }
  });

  it('never grants write access or unbounded delegation in compatibility mode', () => {
    for (const contract of contracts) {
      expect(contract.scope.writablePaths, `${contract.identity.id} may write unattended`).toEqual([]);
      expect(contract.limits.maximumChildren).toBeLessThanOrEqual(16);
      expect(contract.limits.maximumSteps).toBeLessThanOrEqual(200);
    }
  });

  it('records derived safety metadata rather than presenting it as declared', () => {
    const zeus = byId.get('zeus-executive-agent')!;
    expect(zeus.provenance.derivation).toBe('compatibility');
    expect(zeus.completeness.complete).toBe(false);
    expect(zeus.completeness.derivedFields).toContain('permissions.edit');
    expect(zeus.completeness.derivedFields).toContain('limits.maximumSteps');
    expect(zeus.completeness.derivedFields).toContain('evidence.required');
  });

  it('serializes no absolute machine path and no credential', () => {
    for (const contract of contracts) {
      const json = serializeContract(contract);
      expect(json, `${contract.identity.id} leaks a home directory`).not.toMatch(
        /\/(Users|home)\/[a-z]/i
      );
      expect(contract.provenance.sourcePath).not.toMatch(/^([a-zA-Z]:)?\//);
    }
  });

  it('is deterministic — recompiling the catalog produces identical bytes', () => {
    const again = loadCouncilContracts({ root: REPO_ROOT, discovered: [] });
    expect(serializeContract(again.contracts[0]!)).toBe(serializeContract(contracts[0]!));
    expect(again.contracts.map((c) => c.identity.id)).toEqual(contracts.map((c) => c.identity.id));
    expect(again.contracts.map((c) => c.provenance.contentHash)).toEqual(
      contracts.map((c) => c.provenance.contentHash)
    );
  });
});
