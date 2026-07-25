// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import {
  parseAdvice,
  shouldGate,
  budgetState,
  type DispatchAdvice,
} from '../chat/dispatchAdvisor.js';

const SAMPLE_ADVICE_JSON = JSON.stringify({
  planPath: '(inline --text)',
  classification: { mechanicalPct: 60, creativePct: 15, architecturePct: 20, bulkPct: 5 },
  recommendation: {
    model: 'sonnet',
    claudeModel: 'claude-sonnet-5',
    codexModel: 'gpt-5.5',
    costMultiple: 'baseline (~5x cheaper than the top tier)',
    rationale: '60% mechanical execution',
  },
  agents: [
    { key: 'chrysos', emoji: '💳', name: 'Chrysos', domain: 'Stripe & Payment Security', score: 3 },
    { key: 'argus', emoji: '👁', name: 'Argus', domain: 'Security & Threat Modeling', score: 1 },
  ],
});

function sample(): DispatchAdvice {
  const parsed = parseAdvice(SAMPLE_ADVICE_JSON);
  if (!parsed) throw new Error('sample must parse');
  return parsed;
}

describe('parseAdvice', () => {
  it('parses valid advise JSON', () => {
    const advice = sample();
    expect(advice.recommendation.claudeModel).toBe('claude-sonnet-5');
    expect(advice.agents).toHaveLength(2);
    expect(advice.agents[0].name).toBe('Chrysos');
  });

  it('returns null on malformed JSON', () => {
    expect(parseAdvice('{nope')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseAdvice('{"agents": []}')).toBeNull();
  });

  it('tolerates an empty agents array', () => {
    const raw = JSON.stringify({
      classification: { mechanicalPct: 100, creativePct: 0, architecturePct: 0, bulkPct: 0 },
      recommendation: { model: 'haiku', claudeModel: 'claude-haiku-4-5', codexModel: 'x', costMultiple: 'y', rationale: 'z' },
      agents: [],
    });
    expect(parseAdvice(raw)?.agents).toEqual([]);
  });
});

describe('shouldGate', () => {
  it('always gates in auto mode — the dispatch order is the one human approval', () => {
    const single = { ...sample(), agents: [sample().agents[0]] };
    expect(shouldGate(single, 'auto')).toBe(true);
    expect(shouldGate({ ...sample(), agents: [] }, 'auto')).toBe(true);
  });

  it('gates council-scale work (2+ gods) in any mode', () => {
    expect(shouldGate(sample(), 'default')).toBe(true);
    expect(shouldGate(sample(), 'acceptEdits')).toBe(true);
  });

  it('does not gate single-god work outside auto mode', () => {
    const single = { ...sample(), agents: [sample().agents[0]] };
    expect(shouldGate(single, 'default')).toBe(false);
  });

  it('does not gate god-less prompts outside auto mode', () => {
    expect(shouldGate({ ...sample(), agents: [] }, 'plan')).toBe(false);
  });
});

describe('budgetState', () => {
  it('is ok with no budget configured', () => {
    expect(budgetState(999, undefined)).toBe('ok');
  });

  it('is ok below 80%', () => {
    expect(budgetState(3.99, 5)).toBe('ok');
  });

  it('warns at 80% and above', () => {
    expect(budgetState(4.0, 5)).toBe('warn');
    expect(budgetState(4.9, 5)).toBe('warn');
  });

  it('is exceeded at 100% and above', () => {
    expect(budgetState(5.0, 5)).toBe('exceeded');
    expect(budgetState(7.2, 5)).toBe('exceeded');
  });
});
