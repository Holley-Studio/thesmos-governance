// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * WS4 routing-evidence proof suite.
 *
 * The load-bearing property: a LONG task is not a HARD task. Length alone can
 * never reach the frontier threshold, no matter how long it runs.
 */
import { describe, it, expect } from 'vitest';
import {
  FABLE_MIN_COMPLEXITY_SCORE,
  MAX_SCORE_FROM_LENGTH,
  assessComplexity,
  costTierFor,
  isModelFreeWork,
} from './complexity.js';
import { routeModel, type RoutingSignals } from './routing.js';

const approval = {
  approvedBy: 'matthew',
  reasonOpusInsufficient: 'Opus 5 lost coherence across the coupled packages in evaluation.',
  approvedAt: '2026-08-04T00:00:00Z',
};

describe('complexity rubric', () => {
  it('scores trivial work in the routine band', () => {
    const a = assessComplexity({ boundedMechanical: true });
    expect(a.band).toBe('routine');
    expect(a.score).toBeLessThan(30);
  });

  it('scores normal implementation in the substantive band', () => {
    const a = assessComplexity({ riskTier: 'medium', affectedSubsystems: 2, ambiguity: 'medium', expectedSteps: 20 });
    expect(a.band).toBe('substantive');
  });

  it('scores consequential architecture in the high-judgment band or above', () => {
    const a = assessComplexity({ architecturalImpact: true, affectedSubsystems: 3, riskTier: 'high' });
    expect(a.score).toBeGreaterThanOrEqual(70);
  });

  it('CAPS the contribution of task length below the frontier threshold', () => {
    // A 10,000-step mechanical job is long, not hard.
    const a = assessComplexity({ expectedSteps: 10_000 });
    expect(a.score).toBeLessThanOrEqual(MAX_SCORE_FROM_LENGTH);
    expect(a.score).toBeLessThan(FABLE_MIN_COMPLEXITY_SCORE);
    expect(a.hasExceptionalReasonBeyondLength).toBe(false);
  });

  it('is deterministic', () => {
    const s: RoutingSignals = { architecturalImpact: true, expectedSteps: 100 };
    expect(assessComplexity(s).score).toBe(assessComplexity(s).score);
  });

  it('maps cost tiers without inventing dollar figures', () => {
    expect(costTierFor('fast-mechanical')).toBe('efficient');
    expect(costTierFor('balanced-agentic')).toBe('efficient');
    expect(costTierFor('deep-reasoning')).toBe('premium');
    expect(costTierFor('frontier-long-horizon')).toBe('exceptional');
  });

  it('identifies deterministic work that needs no model', () => {
    expect(isModelFreeWork({ boundedMechanical: true })).toBe(true);
    expect(isModelFreeWork({ boundedMechanical: true, securitySensitive: true })).toBe(false);
    expect(isModelFreeWork({})).toBe(false);
  });
});

describe('route decision evidence', () => {
  it('exposes score, band, cost tier and reason codes on every route', () => {
    const d = routeModel({});
    expect(typeof d.complexityScore).toBe('number');
    expect(d.complexityBand).toBeTruthy();
    expect(d.costTier).toBeTruthy();
    expect(d.reasonCodes.length).toBeGreaterThan(0);
    expect(d.selectedAlias).toBe('balanced-agentic');
  });

  it('marks escalation only when the tier rose above the balanced default', () => {
    expect(routeModel({}).escalated).toBe(false);
    expect(routeModel({ securitySensitive: true }).escalated).toBe(true);
  });

  it('never sets fallbackUsed without a fallback record', () => {
    const plain = routeModel({});
    expect(plain.fallbackUsed).toBe(false);
    expect(plain.fallback).toBeNull();

    const fell = routeModel({ architecturalImpact: true, providerAvailability: ['openai'] }, { provider: 'anthropic' });
    expect(fell.fallbackUsed).toBe(fell.fallback !== null);
  });

  it('routes normal substantive work to Sonnet 5', () => {
    const d = routeModel({ riskTier: 'medium' });
    expect(d.resolvedModelId).toBe('claude-sonnet-5');
  });

  it('routes high-consequence architecture and security to Opus 5', () => {
    expect(routeModel({ architecturalImpact: true }).resolvedModelId).toBe('claude-opus-5');
    expect(routeModel({ securitySensitive: true }).resolvedModelId).toBe('claude-opus-5');
  });
});

describe('Fable gate', () => {
  it('refuses a merely LONG task even with approval', () => {
    const d = routeModel({
      userOverride: 'frontier-long-horizon',
      expectedSteps: 100_000,
      frontierApproval: approval,
    });
    expect(d.resolvedModelId).not.toBe('claude-fable-5');
    expect(d.reasonCodes).toContain('frontier-denied-below-threshold');
  });

  it('refuses when the score clears 90 but no approval is recorded', () => {
    const signals: RoutingSignals = {
      userOverride: 'frontier-long-horizon',
      architecturalImpact: true,
      securitySensitive: true,
      riskTier: 'critical',
      affectedSubsystems: 5,
      ambiguity: 'high',
      expectedSteps: 300,
    };
    expect(assessComplexity(signals).score).toBeGreaterThanOrEqual(FABLE_MIN_COMPLEXITY_SCORE);

    const d = routeModel(signals);
    expect(d.resolvedModelId).not.toBe('claude-fable-5');
    expect(d.approvalRequired).toBe(true);
    expect(d.reasonCodes).toContain('frontier-denied-no-approval');
  });

  it('grants the frontier tier only with score >= 90, exceptional evidence AND approval', () => {
    const d = routeModel({
      userOverride: 'frontier-long-horizon',
      architecturalImpact: true,
      securitySensitive: true,
      riskTier: 'critical',
      affectedSubsystems: 5,
      ambiguity: 'high',
      expectedSteps: 300,
      frontierApproval: approval,
    });
    expect(d.complexityScore).toBeGreaterThanOrEqual(FABLE_MIN_COMPLEXITY_SCORE);
    expect(d.resolvedModelId).toBe('claude-fable-5');
    expect(d.costTier).toBe('exceptional');
    expect(d.approval).toBe('granted');
    expect(d.reasonCodes).toContain('frontier-approved');
  });

  it('never reaches the frontier tier without an explicit request', () => {
    const d = routeModel({
      architecturalImpact: true, securitySensitive: true, releaseSensitive: true,
      riskTier: 'critical', affectedSubsystems: 12, ambiguity: 'high', expectedSteps: 5000,
    });
    expect(d.resolvedModelId).not.toBe('claude-fable-5');
  });

  it('keeps the documented threshold at 90', () => {
    expect(FABLE_MIN_COMPLEXITY_SCORE).toBe(90);
  });
});
