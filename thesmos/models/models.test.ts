// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Model Steward proof suite.
 *
 * These tests encode the policy invariants, not the implementation. If someone
 * later "simplifies" routing so a creative keyword reaches the frontier tier
 * again, or restores a price fallback, these fail loudly.
 */
import { describe, it, expect } from 'vitest';
import {
  LOGICAL_PROFILES,
  MODEL_REGISTRY,
  activeModelIds,
  isActiveModelId,
  lookupLegacyId,
  lookupModelId,
  priceOn,
  registryHash,
  resolveProfile,
} from './registry.js';
import {
  type RoutingSignals,
  explainDecision,
  hasModelMismatch,
  isLongHorizon,
  routeModel,
  selectProfile,
  withEffectiveModel,
} from './routing.js';
import { costFor, estimateTierSavingFromCost, formatSaving, savingVsBaseline } from './pricing.js';
import {
  auditModels,
  checkCliVersion,
  checkGeneratedMapDrift,
  checkNoFrontierPins,
  checkPickerDrift,
  checkRegistryIntegrity,
  compareSemver,
  parseAgentModelRecord,
  parseGeneratedMap,
} from './audit.js';

const NOW = new Date('2026-08-03T00:00:00Z');
const AFTER_INTRO = new Date('2026-09-15T00:00:00Z');

// ── Registry ─────────────────────────────────────────────────────────────────

describe('model registry', () => {
  it('resolves each Anthropic profile to the verified 2026 model id', () => {
    expect(resolveProfile('fast-mechanical', 'anthropic')?.id).toBe('claude-haiku-4-5-20251001');
    expect(resolveProfile('balanced-agentic', 'anthropic')?.id).toBe('claude-sonnet-5');
    expect(resolveProfile('deep-reasoning', 'anthropic')?.id).toBe('claude-opus-5');
    expect(resolveProfile('frontier-long-horizon', 'anthropic')?.id).toBe('claude-fable-5');
  });

  it('resolves each OpenAI profile to a GPT-5.6 id', () => {
    expect(resolveProfile('fast-mechanical', 'openai')?.id).toBe('gpt-5.6-luna');
    expect(resolveProfile('balanced-agentic', 'openai')?.id).toBe('gpt-5.6-terra');
    expect(resolveProfile('deep-reasoning', 'openai')?.id).toBe('gpt-5.6-sol');
  });

  it('maps the OpenAI frontier profile to the flagship id at higher reasoning, not an invented slug', () => {
    const frontier = resolveProfile('frontier-long-horizon', 'openai');
    expect(frontier?.id).toBe('gpt-5.6-sol');
    expect(frontier?.defaultEffort).toBe('max');
    // The bug this prevents: advise.ts used to emit "gpt-5.5-pro", which is not
    // a model. "pro" is a reasoning mode.
    for (const e of MODEL_REGISTRY) expect(e.id).not.toContain('-pro');
  });

  it('treats gpt-5.6 as an alias of the flagship', () => {
    expect(lookupModelId('gpt-5.6')?.id).toBe('gpt-5.6-sol');
    expect(isActiveModelId('gpt-5.6')).toBe(true);
  });

  it('accepts the bare Haiku alias and the dated canonical id', () => {
    expect(lookupModelId('claude-haiku-4-5')?.id).toBe('claude-haiku-4-5-20251001');
    expect(lookupModelId('claude-haiku-4-5-20251001')?.id).toBe('claude-haiku-4-5-20251001');
  });

  it('rejects superseded ids as inactive, with a stated replacement', () => {
    for (const id of ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5', 'gpt-4o']) {
      expect(isActiveModelId(id)).toBe(false);
      expect(lookupLegacyId(id)).not.toBeNull();
      expect(lookupLegacyId(id)!.replacementProfile).not.toBeNull();
    }
  });

  it('marks gpt-5.5-pro as invalid rather than merely deprecated', () => {
    const entry = lookupLegacyId('gpt-5.5-pro');
    expect(entry?.state).toBe('invalid');
    expect(entry?.reason).toContain('reasoning MODE');
  });

  it('serves every logical profile on at least one provider', () => {
    for (const profile of LOGICAL_PROFILES) {
      expect(MODEL_REGISTRY.some((e) => e.profile === profile && e.state === 'active')).toBe(true);
    }
  });

  it('produces a stable content hash across calls', () => {
    expect(registryHash()).toBe(registryHash());
    expect(registryHash()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('reports no unverified value as a number', () => {
    // OpenAI limits were not verified; they must be null, not a guess.
    const terra = resolveProfile('balanced-agentic', 'openai')!;
    expect(terra.contextTokens).toBeNull();
    expect(terra.pricing).toBeNull();
  });

  it('passes its own integrity audit', () => {
    expect(checkRegistryIntegrity(NOW).filter((f) => f.severity === 'BLOCKER')).toEqual([]);
  });
});

// ── Pricing ──────────────────────────────────────────────────────────────────

describe('pricing', () => {
  it('prices Opus 5 at the verified $5/$25 per MTok', () => {
    const r = costFor('claude-opus-5', 1_000_000, 1_000_000, NOW);
    expect(r.known).toBe(true);
    if (r.known) expect(r.costUsd).toBeCloseTo(30.0, 6);
  });

  it('prices Haiku 4.5 at the verified $1/$5, not the stale $0.25/$1.25', () => {
    const r = costFor('claude-haiku-4-5-20251001', 1_000_000, 0, NOW);
    expect(r.known).toBe(true);
    if (r.known) expect(r.costUsd).toBeCloseTo(1.0, 6);
  });

  it('honours the dated Sonnet 5 introductory window on both sides', () => {
    const during = costFor('claude-sonnet-5', 1_000_000, 0, NOW);
    const after = costFor('claude-sonnet-5', 1_000_000, 0, AFTER_INTRO);
    expect(during.known && during.costUsd).toBeCloseTo(2.0, 6);
    expect(after.known && after.costUsd).toBeCloseTo(3.0, 6);
  });

  it('NEVER fabricates a cost for an unknown model', () => {
    const r = costFor('definitely-not-a-model', 1_000, 1_000, NOW);
    expect(r.known).toBe(false);
    if (!r.known) expect(r.reason).toContain('not in the registry');
  });

  it('reports unknown when a model has no verified pricing', () => {
    const r = costFor('gpt-5.6-terra', 1_000, 1_000, NOW);
    expect(r.known).toBe(false);
    if (!r.known) expect(r.reason).toContain('No verified pricing');
  });

  it('reports Fable as a premium against the Opus 5 baseline', () => {
    const s = estimateTierSavingFromCost('claude-fable-5', 1.0, NOW);
    expect(s.known).toBe(true);
    if (s.known) {
      expect(s.estSavedUsd).toBeLessThan(0);
      expect(s.estSavedUsd).toBeCloseTo(-0.5, 6); // $1 on Fable ≈ $0.50 on Opus 5
    }
    expect(formatSaving(s)).toContain('premium');
  });

  it('computes an exact saving from real token counts', () => {
    const s = savingVsBaseline('claude-sonnet-5', 1_000_000, 0, AFTER_INTRO);
    expect(s.known).toBe(true);
    if (s.known) {
      expect(s.exact).toBe(true);
      expect(s.estSavedUsd).toBeCloseTo(2.0, 6); // $5 on Opus 5 vs $3 on Sonnet 5
    }
  });

  it('formats an unknown saving as "unknown", never as a number', () => {
    expect(formatSaving({ known: false, reason: 'x' })).toBe('unknown');
  });
});

// ── Routing ──────────────────────────────────────────────────────────────────

describe('routing policy', () => {
  it('defaults to the balanced tier with no signals', () => {
    const d = routeModel({});
    expect(d.requestedProfile).toBe('balanced-agentic');
    expect(d.resolvedModelId).toBe('claude-sonnet-5');
    expect(d.reasonCodes).toContain('default-balanced');
  });

  const escalating: [string, RoutingSignals][] = [
    ['architectural impact', { architecturalImpact: true }],
    ['security sensitivity', { securitySensitive: true }],
    ['release sensitivity', { releaseSensitive: true }],
    ['critical risk tier', { riskTier: 'critical' }],
    ['cross-subsystem work', { affectedSubsystems: 3 }],
    ['deep dependency graph', { dependencyDepth: 5 }],
    ['high ambiguity', { ambiguity: 'high' }],
  ];
  for (const [label, signals] of escalating) {
    it(`escalates to Opus 5 on ${label}`, () => {
      const d = routeModel(signals);
      expect(d.requestedProfile).toBe('deep-reasoning');
      expect(d.resolvedModelId).toBe('claude-opus-5');
    });
  }

  it('routes bounded mechanical work to Haiku 4.5', () => {
    const d = routeModel({ boundedMechanical: true });
    expect(d.requestedProfile).toBe('fast-mechanical');
    expect(d.resolvedModelId).toBe('claude-haiku-4-5-20251001');
  });

  it('never routes decision-carrying work to the fast tier, even when marked mechanical', () => {
    // "Bounded and mechanical" plus "security-sensitive" is a contradiction.
    // Decision authority wins and escalates; a cheap wrong security call is
    // not a saving. This is the invariant behind "Haiku may never make an
    // architectural, security, product, or release decision".
    for (const conflict of [
      { securitySensitive: true },
      { architecturalImpact: true },
      { releaseSensitive: true },
      { riskTier: 'critical' as const },
    ]) {
      const d = routeModel({ boundedMechanical: true, ...conflict });
      expect(d.requestedProfile).toBe('deep-reasoning');
      expect(d.resolvedModelId).not.toBe('claude-haiku-4-5-20251001');
    }
  });

  // ── The frontier gate ──────────────────────────────────────────────────────

  it('never reaches the frontier tier without an explicit request', () => {
    const everything: RoutingSignals = {
      architecturalImpact: true, securitySensitive: true, releaseSensitive: true,
      riskTier: 'critical', affectedSubsystems: 12, dependencyDepth: 9,
      ambiguity: 'high', expectedSteps: 500, evidenceRequired: true,
    };
    const d = routeModel(everything);
    expect(d.requestedProfile).toBe('deep-reasoning');
    expect(d.resolvedModelId).not.toBe('claude-fable-5');
  });

  it('denies the frontier tier when the work is not long-horizon', () => {
    const d = routeModel({
      userOverride: 'frontier-long-horizon',
      expectedSteps: 3,
      affectedSubsystems: 1,
      frontierApproval: {
        approvedBy: 'matthew', reasonOpusInsufficient: 'gut feel', approvedAt: '2026-08-03T00:00:00Z',
      },
    });
    expect(d.requestedProfile).toBe('deep-reasoning');
    expect(
      d.reasonCodes.some((c) => c.startsWith('frontier-denied-')),
      `expected a frontier denial, got ${d.reasonCodes.join(',')}`,
    ).toBe(true);
    expect(d.approval).toBe('required-but-missing');
  });

  it('denies the frontier tier when long-horizon but unapproved', () => {
    const d = routeModel({
      userOverride: 'frontier-long-horizon',
      expectedSteps: 120,
      architecturalImpact: true,
      securitySensitive: true,
      riskTier: 'critical',
      ambiguity: 'high',
      affectedSubsystems: 5,
    });
    expect(d.requestedProfile).toBe('deep-reasoning');
    expect(d.reasonCodes).toContain('frontier-denied-no-approval');
    expect(d.approval).toBe('required-but-missing');
  });

  it('denies the frontier tier when the approval has an empty rationale', () => {
    const d = routeModel({
      userOverride: 'frontier-long-horizon',
      affectedSubsystems: 5,
      frontierApproval: { approvedBy: 'matthew', reasonOpusInsufficient: '   ', approvedAt: '2026-08-03' },
    });
    expect(d.approval).toBe('required-but-missing');
    expect(d.resolvedModelId).toBe('claude-opus-5');
  });

  it('grants the frontier tier only with long-horizon evidence AND full approval', () => {
    const d = routeModel({
      userOverride: 'frontier-long-horizon',
      expectedSteps: 200,
      architecturalImpact: true,
      securitySensitive: true,
      riskTier: 'critical',
      ambiguity: 'high',
      affectedSubsystems: 5,
      frontierApproval: {
        approvedBy: 'matthew',
        reasonOpusInsufficient: 'Opus 5 lost coherence across the four coupled packages in evaluation.',
        approvedAt: '2026-08-03T00:00:00Z',
        evaluationRef: 'docs/audits/eval-001.md',
      },
    });
    expect(d.requestedProfile).toBe('frontier-long-horizon');
    expect(d.resolvedModelId).toBe('claude-fable-5');
    expect(d.approval).toBe('granted');
    expect(d.reasonCodes).toContain('frontier-approved');
  });

  it('treats long-horizon as a size test, never a topic test', () => {
    expect(isLongHorizon({ expectedSteps: 40 })).toBe(true);
    expect(isLongHorizon({ affectedSubsystems: 3 })).toBe(true);
    expect(isLongHorizon({ expectedSteps: 5, affectedSubsystems: 1 })).toBe(false);
  });

  it('honours a non-frontier override without needing approval', () => {
    const d = routeModel({ userOverride: 'deep-reasoning' });
    expect(d.resolvedModelId).toBe('claude-opus-5');
    expect(d.approval).toBe('not-required');
  });

  it('lets an agent baseline raise the floor but never reach frontier', () => {
    const d = routeModel({ baselineProfile: 'deep-reasoning' });
    expect(d.requestedProfile).toBe('deep-reasoning');
    expect(d.reasonCodes).toContain('agent-baseline');

    const f = routeModel({ baselineProfile: 'frontier-long-horizon' });
    expect(f.requestedProfile).not.toBe('frontier-long-horizon');
  });

  // ── Fallback and truth ─────────────────────────────────────────────────────

  it('falls back and records why when the provider is unavailable', () => {
    const d = routeModel({ architecturalImpact: true, providerAvailability: ['openai'] }, { provider: 'anthropic' });
    expect(d.fallback).not.toBeNull();
    expect(d.reasonCodes).toContain('fallback-applied');
    expect(d.availability.reason ?? '').not.toBe('');
  });

  it('never pre-fills the effective model', () => {
    expect(routeModel({}).effectiveModelId).toBeNull();
  });

  it('surfaces a requested-vs-effective mismatch', () => {
    const d = withEffectiveModel(routeModel({}), 'claude-haiku-4-5-20251001');
    expect(hasModelMismatch(d)).toBe(true);
    expect(explainDecision(d)).toContain('MISMATCH');
  });

  it('reports no mismatch when the runtime confirms the requested model', () => {
    const d = withEffectiveModel(routeModel({}), 'claude-sonnet-5');
    expect(hasModelMismatch(d)).toBe(false);
  });

  it('stamps every decision with the registry version and hash', () => {
    const d = routeModel({});
    expect(d.registryVersion).toBeTruthy();
    expect(d.registryHash).toBe(registryHash());
  });

  it('selects an effort the resolved model actually accepts', () => {
    expect(routeModel({}, { effort: 'xhigh' }).effort).toBe('xhigh');
    // Haiku 4.5 rejects effort entirely — an override must not invent support.
    expect(routeModel({ boundedMechanical: true }, { effort: 'max' }).effort).toBeNull();
  });
});

// ── Audit ────────────────────────────────────────────────────────────────────

describe('model audit', () => {
  const agent = (id: string, claude: string) => ({
    file: `thesmos/catalog/agents/${id}.md`,
    id,
    claudeModel: claude,
    openaiModel: null,
    chatgptModel: null,
  });

  it('flags a frontier pin as a BLOCKER', () => {
    const f = checkNoFrontierPins([agent('daedalus-product-agent', 'claude-fable-5')]);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('BLOCKER');
    expect(f[0]!.code).toBe('MODEL_AGENT_PINNED_FRONTIER');
  });

  it('accepts the migrated posture with no frontier pins', () => {
    expect(checkNoFrontierPins([
      agent('a', 'claude-sonnet-5'),
      agent('b', 'claude-opus-5'),
    ])).toEqual([]);
  });

  it('detects generated-map drift against the catalog', () => {
    const findings = checkGeneratedMapDrift(
      [agent('zeus-executive-agent', 'claude-opus-5')],
      [{ file: 'thesmos/generated/pantheon-models.ts', entries: { 'zeus-executive-agent': 'claude-sonnet-5' } }],
    );
    expect(findings.some((f) => f.code === 'MODEL_MAP_DRIFT')).toBe(true);
  });

  it('detects an agent missing from a generated map', () => {
    const findings = checkGeneratedMapDrift(
      [agent('new-agent', 'claude-sonnet-5')],
      [{ file: 'gen.ts', entries: {} }],
    );
    expect(findings.some((f) => f.code === 'MODEL_EXPORT_STALE')).toBe(true);
  });

  it('detects picker drift', () => {
    const findings = checkPickerDrift([{ file: 'picker.ts', ids: ['claude-sonnet-5', 'claude-opus-4-8'] }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('MODEL_PICKER_DRIFT');
  });

  it('classifies deprecated, invalid, and unknown ids distinctly', () => {
    const r = auditModels({
      agents: [
        { file: 'a.md', id: 'a', claudeModel: 'claude-opus-4-8', openaiModel: 'gpt-5.5-pro', chatgptModel: 'nope-9000' },
      ],
      generatedMaps: [],
      now: NOW,
    });
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain('MODEL_DEPRECATED_ID');
    expect(codes).toContain('MODEL_INVALID_ID');
    expect(codes).toContain('MODEL_UNKNOWN_ID');
  });

  it('reports a requested-vs-effective mismatch as a finding', () => {
    const d = withEffectiveModel(routeModel({}), 'claude-haiku-4-5-20251001');
    const r = auditModels({ agents: [], generatedMaps: [], decisions: [d], now: NOW });
    expect(r.findings.some((f) => f.code === 'MODEL_EFFECTIVE_MISMATCH')).toBe(true);
  });

  it('stays silent on CLI version when no verified minimum is recorded', () => {
    // Inventing a threshold would produce confidently wrong upgrade advice.
    expect(checkCliVersion('0.0.1')).toEqual([]);
    expect(checkCliVersion(null)).toEqual([]);
  });

  it('compares semver numerically, not lexically', () => {
    expect(compareSemver('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareSemver('v1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2', '1.2.0')).toBe(0);
  });

  it('parses agent frontmatter and skips disabled agents', () => {
    const doc = ['---', 'id: x-agent', 'enabled: true', 'platforms:', '  claude_model: claude-sonnet-5', '---', '# X'].join('\n');
    expect(parseAgentModelRecord(doc, 'x.md')?.claudeModel).toBe('claude-sonnet-5');
    expect(parseAgentModelRecord(doc.replace('enabled: true', 'enabled: false'), 'x.md')).toBeNull();
  });

  it('parses a generated model map', () => {
    const src = 'export const PANTHEON_MODELS = {\n  "zeus-executive-agent": "claude-opus-5",\n}';
    expect(parseGeneratedMap(src, 'g.ts').entries).toEqual({ 'zeus-executive-agent': 'claude-opus-5' });
  });
});
