import { describe, it, expect } from 'vitest';
import { partitionByConfidence, confidenceTag } from './gate.ts';
import { shouldFail, shouldWarn } from './severity.ts';
import { CONFIG_DEFAULTS } from './config.ts';
import type { Finding, ThesmosConfig } from './types.ts';

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'BLOCKER',
    file: 'src/app.ts',
    category: 'test_category',
    message: 'test',
    ...overrides,
  };
}

const CONFIG: ThesmosConfig = { ...CONFIG_DEFAULTS, failOnSeverity: ['BLOCKER'], warnOnSeverity: ['HIGH'] };

describe('partitionByConfidence', () => {
  it('treats findings without a confidence as high (gating)', () => {
    const { gating, advisory } = partitionByConfidence([finding()], 'medium');
    expect(gating).toHaveLength(1);
    expect(advisory).toHaveLength(0);
  });

  it('routes below-threshold findings to advisory', () => {
    const { gating, advisory } = partitionByConfidence(
      [finding({ confidence: 'low' }), finding({ confidence: 'medium' }), finding({ confidence: 'high' })],
      'medium',
    );
    expect(gating).toHaveLength(2);
    expect(advisory).toHaveLength(1);
    expect(advisory[0].confidence).toBe('low');
  });

  it('minConfidence low gates everything; high gates only high', () => {
    const all = [finding({ confidence: 'low' }), finding({ confidence: 'medium' }), finding({ confidence: 'high' })];
    expect(partitionByConfidence(all, 'low').gating).toHaveLength(3);
    expect(partitionByConfidence(all, 'high').gating).toHaveLength(1);
  });
});

describe('confidenceTag', () => {
  it('is empty for high/absent confidence and labels the rest', () => {
    expect(confidenceTag(finding())).toBe('');
    expect(confidenceTag(finding({ confidence: 'high' }))).toBe('');
    expect(confidenceTag(finding({ confidence: 'medium' }))).toBe('[medium-confidence]');
    expect(confidenceTag(finding({ confidence: 'low' }))).toBe('[low-confidence]');
  });
});

describe('shouldFail with confidence tiers', () => {
  it('a medium-confidence BLOCKER still fails at default minConfidence medium', () => {
    expect(shouldFail([finding({ confidence: 'medium' })], CONFIG)).toBe(true);
  });

  it('a low-confidence BLOCKER does NOT fail at default minConfidence medium', () => {
    expect(shouldFail([finding({ confidence: 'low' })], CONFIG)).toBe(false);
  });

  it('a medium-confidence BLOCKER does NOT fail when the repo raises minConfidence to high', () => {
    const strict: ThesmosConfig = { ...CONFIG, gate: { minConfidence: 'high' } };
    expect(shouldFail([finding({ confidence: 'medium' })], strict)).toBe(false);
  });

  it('low-confidence findings still WARN even when they cannot fail', () => {
    const cfg: ThesmosConfig = { ...CONFIG, failOnSeverity: ['BLOCKER'], warnOnSeverity: ['BLOCKER'] };
    const lows = [finding({ confidence: 'low' })];
    expect(shouldFail(lows, cfg)).toBe(false);
    expect(shouldWarn(lows, cfg)).toBe(true);
  });
});
