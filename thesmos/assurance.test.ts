// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, expect, it } from 'vitest';
import {
  assuranceFromEnforcedEvents,
  assuranceFromRuleCounts,
  exitCodeForAssurance,
  formatAssuranceScore,
} from './assurance.js';

describe('assuranceFromRuleCounts', () => {
  it('returns INCOMPLETE with null score when evidence is missing', () => {
    const r = assuranceFromRuleCounts(10, 10, { evidenceMissing: true });
    expect(r.state).toBe('INCOMPLETE');
    expect(r.score).toBeNull();
    expect(r.rulesEvaluated).toBe(0);
    expect(r.reason).toMatch(/scan/i);
  });

  it('returns INCOMPLETE with null score when zero rules evaluated', () => {
    const r = assuranceFromRuleCounts(0, 0);
    expect(r.state).toBe('INCOMPLETE');
    expect(r.score).toBeNull();
    expect(r.reason).toMatch(/zero rules/i);
  });

  it('never reports 100 when total is zero', () => {
    const r = assuranceFromRuleCounts(0, 0);
    expect(r.score).not.toBe(100);
    expect(r.state).not.toBe('PASS');
  });

  it('returns PASS when all rules passed', () => {
    const r = assuranceFromRuleCounts(5, 5, { evidenceSource: '.thesmos/report.json' });
    expect(r.state).toBe('PASS');
    expect(r.score).toBe(100);
    expect(r.rulesFailed).toBe(0);
    expect(r.evidenceSource).toBe('.thesmos/report.json');
  });

  it('returns FAIL with partial score when some rules failed', () => {
    const r = assuranceFromRuleCounts(3, 4);
    expect(r.state).toBe('FAIL');
    expect(r.score).toBe(75);
    expect(r.rulesPassed).toBe(3);
    expect(r.rulesFailed).toBe(1);
  });

  it('returns ERROR for invalid counts', () => {
    const r = assuranceFromRuleCounts(-1, 5);
    expect(r.state).toBe('ERROR');
    expect(r.score).toBeNull();
  });

  it('caps passed at total', () => {
    const r = assuranceFromRuleCounts(99, 10);
    expect(r.rulesPassed).toBe(10);
    expect(r.score).toBe(100);
    expect(r.state).toBe('PASS');
  });
});

describe('assuranceFromEnforcedEvents', () => {
  it('returns INCOMPLETE when no enforced events (empty log)', () => {
    const r = assuranceFromEnforcedEvents(0, 0);
    expect(r.state).toBe('INCOMPLETE');
    expect(r.score).toBeNull();
  });

  it('returns PASS when all enforced events are compliant', () => {
    const r = assuranceFromEnforcedEvents(10, 10);
    expect(r.state).toBe('PASS');
    expect(r.score).toBe(100);
  });

  it('returns FAIL when some events are non-compliant', () => {
    const r = assuranceFromEnforcedEvents(7, 10);
    expect(r.state).toBe('FAIL');
    expect(r.score).toBe(70);
  });
});

describe('exitCodeForAssurance / formatAssuranceScore', () => {
  it('exits 0 only for PASS', () => {
    expect(exitCodeForAssurance('PASS')).toBe(0);
    expect(exitCodeForAssurance('FAIL')).toBe(1);
    expect(exitCodeForAssurance('INCOMPLETE')).toBe(1);
    expect(exitCodeForAssurance('ERROR')).toBe(1);
  });

  it('formats null score as n/a', () => {
    expect(formatAssuranceScore(null)).toBe('n/a');
    expect(formatAssuranceScore(88)).toBe('88%');
  });
});
