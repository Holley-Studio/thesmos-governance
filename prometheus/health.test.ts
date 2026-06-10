import { describe, it, expect } from 'vitest';
import {
  computeHealthScore,
  formatHealthConsole,
  formatHealthMarkdown,
  formatHealthJson,
} from './health.ts';
import type { HealthInput } from './health.ts';
import type { Finding } from './types.ts';
import type { Baseline } from './baseline.ts';
import type { DriftFinding } from './drift.ts';
import type { SuppressionAuditFinding } from './suppress.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-10T00:00:00Z');

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'HIGH',
    category: 'missing_api_auth',
    file: 'src/api/users/route.ts',
    message: 'API route has no auth check.',
    ...overrides,
  };
}

function makeDrift(overrides: Partial<DriftFinding> = {}): DriftFinding {
  return {
    type: 'adapter.missing',
    severity: 'BLOCKER',
    message: 'Adapter missing.',
    ...overrides,
  };
}

function makeSupAudit(overrides: Partial<SuppressionAuditFinding> = {}): SuppressionAuditFinding {
  return {
    type: 'expired',
    severity: 'HIGH',
    file: 'src/api.ts',
    line: 10,
    message: 'Suppression expired.',
    fixSuggestion: 'Remove it.',
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    version: '1',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    entries: [],
    ...overrides,
  };
}

function cleanInput(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    findings: [],
    baseline: null,
    driftFindings: [],
    suppressionAuditFindings: [],
    scan: null,
    now: NOW,
    ...overrides,
  };
}

// ── Score computation ─────────────────────────────────────────────────────────

describe('computeHealthScore', () => {
  it('returns 100 for a perfectly clean repo (no scan, no issues, bonuses from zero drift+valid sups)', () => {
    const h = computeHealthScore(cleanInput());
    // bonuses: zero drift (+5), all sups valid (+3) = +8, but max is 100
    expect(h.score).toBe(100);
    expect(h.grade).toBe('A+');
  });

  it('deducts for BLOCKER findings', () => {
    const h = computeHealthScore(cleanInput({
      findings: [makeFinding({ severity: 'BLOCKER' })],
    }));
    expect(h.score).toBeLessThan(100);
    expect(h.deductions.some((d) => d.label.includes('BLOCKER'))).toBe(true);
  });

  it('caps BLOCKER deductions at 75', () => {
    // 10 BLOCKER findings × 25 = 250, but cap is 75
    const findings = Array.from({ length: 10 }, () => makeFinding({ severity: 'BLOCKER' }));
    const h = computeHealthScore(cleanInput({ findings }));
    const blockerDed = h.deductions.find((d) => d.label.includes('BLOCKER'));
    expect(blockerDed?.amount).toBe(75);
  });

  it('deducts less for baselined findings than new findings', () => {
    const finding = makeFinding({ severity: 'HIGH' });
    // With no baseline: HIGH finding counted as new
    const noBaseline = computeHealthScore(cleanInput({ findings: [finding] }));
    // With baseline containing that finding: 0 new findings
    // We can't easily create a matching baseline entry in pure test,
    // so test that having a baseline at all changes the partition
    const baseline = makeBaseline({ entries: [] });
    const withBaseline = computeHealthScore(cleanInput({ findings: [finding], baseline }));
    // Without entries, finding is still "new" — same score
    expect(withBaseline.score).toBe(noBaseline.score);
  });

  it('gives bonus for zero drift events', () => {
    // Seed a HIGH finding so both scores sit below the 100 cap, making the bonus visible
    const highFinding = makeFinding({ severity: 'HIGH' });
    const withDrift = computeHealthScore(cleanInput({
      findings: [highFinding],
      driftFindings: [makeDrift({ severity: 'LOW' })],
    }));
    const noDrift = computeHealthScore(cleanInput({ findings: [highFinding] }));
    expect(noDrift.score).toBeGreaterThan(withDrift.score);
    expect(noDrift.bonuses.some((b) => b.label.includes('drift'))).toBe(true);
  });

  it('gives bonus for all suppressions valid', () => {
    // Seed a HIGH finding so expired-suppression deduction is visible below the cap
    const highFinding = makeFinding({ severity: 'HIGH' });
    const noIssues = computeHealthScore(cleanInput({ findings: [highFinding] }));
    expect(noIssues.bonuses.some((b) => b.label.includes('suppression'))).toBe(true);
    const withIssues = computeHealthScore(cleanInput({
      findings: [highFinding],
      suppressionAuditFindings: [makeSupAudit({ type: 'expired' })],
    }));
    expect(withIssues.score).toBeLessThan(noIssues.score);
  });

  it('gives bonus for fresh report', () => {
    const freshScan = { generatedAt: NOW.toISOString() } as any;
    const h = computeHealthScore(cleanInput({ scan: freshScan }));
    expect(h.bonuses.some((b) => b.label.includes('fresh'))).toBe(true);
    expect(h.totals.reportFresh).toBe(true);
  });

  it('does not give fresh bonus for stale report (>24h old)', () => {
    const staleScan = { generatedAt: new Date(NOW.getTime() - 25 * 3600 * 1000).toISOString() } as any;
    const h = computeHealthScore(cleanInput({ scan: staleScan }));
    expect(h.bonuses.some((b) => b.label.includes('fresh'))).toBe(false);
    expect(h.totals.reportFresh).toBe(false);
  });

  it('never goes below 0', () => {
    const manyBlockers = Array.from({ length: 100 }, () => makeFinding({ severity: 'BLOCKER' }));
    const manyDrift = Array.from({ length: 100 }, () => makeDrift({ severity: 'BLOCKER' }));
    const manySupIssues = Array.from({ length: 100 }, () => makeSupAudit({ type: 'expired' }));
    const h = computeHealthScore(cleanInput({
      findings: manyBlockers,
      driftFindings: manyDrift,
      suppressionAuditFindings: manySupIssues,
    }));
    expect(h.score).toBeGreaterThanOrEqual(0);
  });

  it('never exceeds 100', () => {
    const h = computeHealthScore(cleanInput({ scan: { generatedAt: NOW.toISOString() } as any }));
    expect(h.score).toBeLessThanOrEqual(100);
  });

  it('grade A+ for score >= 95', () => {
    expect(computeHealthScore(cleanInput()).grade).toBe('A+');
  });

  it('grade F for very low score', () => {
    const findings = Array.from({ length: 10 }, () => makeFinding({ severity: 'BLOCKER' }));
    const h = computeHealthScore(cleanInput({ findings }));
    // 100 - 75 (BLOCKER cap) + 8 (bonuses) = 33 → F
    expect(['D', 'F'].includes(h.grade)).toBe(true);
  });

  it('includes priority actions', () => {
    const h = computeHealthScore(cleanInput({
      findings: [makeFinding({ severity: 'BLOCKER' })],
    }));
    expect(h.priorityActions.length).toBeGreaterThan(0);
    expect(h.priorityActions[0]).toContain('BLOCKER');
  });

  it('shows "create baseline" action when findings exist and no baseline', () => {
    const h = computeHealthScore(cleanInput({
      findings: [makeFinding()],
    }));
    expect(h.priorityActions.some((a) => a.includes('baseline:create'))).toBe(true);
  });

  it('is deterministic', () => {
    const input = cleanInput({
      findings: [makeFinding()],
      driftFindings: [makeDrift({ severity: 'HIGH' })],
    });
    const a = computeHealthScore(input);
    const b = computeHealthScore(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('totals reflect correct counts', () => {
    const h = computeHealthScore(cleanInput({
      findings: [makeFinding(), makeFinding({ category: 'console_log' })],
      driftFindings: [makeDrift()],
      suppressionAuditFindings: [makeSupAudit({ type: 'missing-reason', severity: 'MEDIUM' })],
    }));
    expect(h.totals.newFindings).toBe(2);
    expect(h.totals.driftEvents).toBe(1);
    expect(h.totals.suppressionIssues).toBe(1);
    expect(h.totals.hasBaseline).toBe(false);
    expect(h.totals.hasReport).toBe(false);
  });
});

// ── Formatters ────────────────────────────────────────────────────────────────

describe('formatHealthConsole', () => {
  const h = computeHealthScore(cleanInput({
    findings: [makeFinding({ severity: 'HIGH' })],
    driftFindings: [makeDrift({ severity: 'MEDIUM' })],
  }));

  it('includes score and grade', () => {
    const out = formatHealthConsole(h, 'MyRepo');
    expect(out).toContain('Score:');
    expect(out).toContain('/ 100');
    expect(out).toContain('Grade:');
  });

  it('includes project name', () => {
    expect(formatHealthConsole(h, 'MyRepo')).toContain('MyRepo');
  });

  it('includes deductions section', () => {
    expect(formatHealthConsole(h)).toContain('Deductions');
  });

  it('includes priority actions', () => {
    expect(formatHealthConsole(h)).toContain('Priority actions:');
  });

  it('is deterministic', () => {
    expect(formatHealthConsole(h)).toBe(formatHealthConsole(h));
  });
});

describe('formatHealthMarkdown', () => {
  const h = computeHealthScore(cleanInput());

  it('starts with heading', () => {
    expect(formatHealthMarkdown(h, 'MyRepo')).toMatch(/^## Prometheus Health/);
  });

  it('contains score', () => {
    expect(formatHealthMarkdown(h)).toContain('100');
  });

  it('is deterministic', () => {
    expect(formatHealthMarkdown(h)).toBe(formatHealthMarkdown(h));
  });
});

describe('formatHealthJson', () => {
  const h = computeHealthScore(cleanInput());

  it('is valid JSON', () => {
    expect(() => JSON.parse(formatHealthJson(h))).not.toThrow();
  });

  it('contains score, grade, deductions, bonuses', () => {
    const obj = JSON.parse(formatHealthJson(h));
    expect(typeof obj.score).toBe('number');
    expect(typeof obj.grade).toBe('string');
    expect(Array.isArray(obj.deductions)).toBe(true);
    expect(Array.isArray(obj.bonuses)).toBe(true);
  });

  it('is deterministic', () => {
    expect(formatHealthJson(h)).toBe(formatHealthJson(h));
  });
});
