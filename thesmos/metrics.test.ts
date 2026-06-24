import { describe, it, expect } from 'vitest';
import {
  computeMetrics,
  toMetricsSnapshot,
  formatMetricsConsole,
  formatMetricsMarkdown,
  formatMetricsJson,
} from './metrics.ts';
import type { MetricsInput, ThesmosMetrics } from './metrics.ts';
import type { Finding } from './types.ts';
import type { Baseline } from './baseline.ts';
import { PROMETHEUS_RULES } from './adapters.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-10T00:00:00Z');

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'HIGH',
    category: 'missing_api_auth',
    file: 'src/api/users/route.ts',
    message: 'API route /api/users (POST) has no visible auth check.',
    ...overrides,
  };
}

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    version: '1',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    entries: [],
    ...overrides,
  };
}

function makeInput(overrides: Partial<MetricsInput> = {}): MetricsInput {
  return {
    findings: [],
    scan: null,
    baseline: null,
    driftFindings: [],
    registry: null,
    now: NOW,
    ...overrides,
  };
}

// ── computeMetrics ────────────────────────────────────────────────────────────

describe('computeMetrics', () => {
  it('returns zero totals for empty input', () => {
    const m = computeMetrics(makeInput());
    expect(m.totalFindings).toBe(0);
    expect(m.newFindings).toBe(0);
    expect(m.baselineFindings).toBe(0);
    expect(m.resolvedBaselineEntries).toBe(0);
    expect(m.driftEvents).toBe(0);
    expect(m.topRiskyFiles).toHaveLength(0);
    expect(m.findingsByRule).toHaveLength(0);
  });

  it('counts total findings correctly', () => {
    const findings = [makeFinding(), makeFinding({ category: 'console_log' })];
    const m = computeMetrics(makeInput({ findings }));
    expect(m.totalFindings).toBe(2);
  });

  it('builds findingsBySeverity correctly', () => {
    const findings = [
      makeFinding({ severity: 'BLOCKER' }),
      makeFinding({ severity: 'HIGH' }),
      makeFinding({ severity: 'HIGH' }),
      makeFinding({ severity: 'LOW' }),
    ];
    const m = computeMetrics(makeInput({ findings }));
    expect(m.findingsBySeverity.BLOCKER).toBe(1);
    expect(m.findingsBySeverity.HIGH).toBe(2);
    expect(m.findingsBySeverity.LOW).toBe(1);
    expect(m.findingsBySeverity.MEDIUM).toBe(0);
  });

  it('builds findingsByRule sorted by count descending', () => {
    const findings = [
      makeFinding({ category: 'console_log' }),
      makeFinding({ category: 'console_log' }),
      makeFinding({ category: 'missing_api_auth' }),
    ];
    const m = computeMetrics(makeInput({ findings }));
    expect(m.findingsByRule[0]!.category).toBe('console_log');
    expect(m.findingsByRule[0]!.count).toBe(2);
    expect(m.findingsByRule[1]!.category).toBe('missing_api_auth');
  });

  it('reports total rule count from registry', () => {
    const m = computeMetrics(makeInput());
    expect(m.totalRuleCount).toBe(PROMETHEUS_RULES.length);
  });

  it('computes activeRuleCount as rules with at least one finding', () => {
    const findings = [makeFinding({ category: 'console_log' })];
    const m = computeMetrics(makeInput({ findings }));
    expect(m.activeRuleCount).toBe(1);
  });

  it('computes top risky files sorted by finding count', () => {
    const findings = [
      makeFinding({ file: 'a.ts' }),
      makeFinding({ file: 'b.ts' }),
      makeFinding({ file: 'b.ts' }),
      makeFinding({ file: 'b.ts' }),
    ];
    const m = computeMetrics(makeInput({ findings }));
    expect(m.topRiskyFiles[0]!.file).toBe('b.ts');
    expect(m.topRiskyFiles[0]!.findingCount).toBe(3);
    expect(m.topRiskyFiles[1]!.file).toBe('a.ts');
  });

  it('caps top risky files at 10', () => {
    const findings = Array.from({ length: 15 }, (_, i) =>
      makeFinding({ file: `file${i}.ts` })
    );
    const m = computeMetrics(makeInput({ findings }));
    expect(m.topRiskyFiles).toHaveLength(10);
  });

  it('counts drift events', () => {
    const driftFindings = [
      { type: 'adapter.missing', severity: 'BLOCKER' as const, message: 'missing', file: 'f' },
      { type: 'adapter.missing', severity: 'BLOCKER' as const, message: 'missing2', file: 'f2' },
      { type: 'report.stale', severity: 'MEDIUM' as const, message: 'stale' },
    ];
    const m = computeMetrics(makeInput({ driftFindings }));
    expect(m.driftEvents).toBe(3);
    expect(m.driftByType['adapter.missing']).toBe(2);
    expect(m.driftByType['report.stale']).toBe(1);
  });

  it('driftByType keys are sorted for determinism', () => {
    const driftFindings = [
      { type: 'z-type', severity: 'LOW' as const, message: 'z' },
      { type: 'a-type', severity: 'LOW' as const, message: 'a' },
    ];
    const m = computeMetrics(makeInput({ driftFindings }));
    const keys = Object.keys(m.driftByType);
    expect(keys).toEqual([...keys].sort());
  });

  it('partitions findings against baseline with empty entries — all findings are new', () => {
    const findings = [
      makeFinding({ file: 'src/api/users/route.ts', line: 10 }),
      makeFinding({ category: 'console_log', file: 'new.ts', line: 1 }),
    ];
    const baseline: Baseline = makeBaseline({ entries: [] });
    const m = computeMetrics(makeInput({ findings, baseline }));
    expect(m.newFindings).toBe(2);
    expect(m.baselineFindings).toBe(0);
  });

  it('sets lastScanAt from scan.generatedAt', () => {
    const scan = { generatedAt: '2026-06-01T00:00:00Z' } as any;
    const m = computeMetrics(makeInput({ scan }));
    expect(m.lastScanAt).toBe('2026-06-01T00:00:00Z');
  });

  it('sets lastScanAt to null when no scan', () => {
    const m = computeMetrics(makeInput({ scan: null }));
    expect(m.lastScanAt).toBeNull();
  });

  it('includes agent usage from registry', () => {
    const registry = {
      agents: [{ id: 'agent-a', file: '', frontmatter: { id: 'agent-a', name: 'A', type: 'agent', version: '1', owner: '', tags: [], enabled: true } }],
      skills: [],
    } as any;
    const m = computeMetrics(makeInput({ registry }));
    expect(m.agentUsage).toHaveLength(1);
    expect(m.agentUsage[0]!.agentId).toBe('agent-a');
  });

  it('computes computedAt from now', () => {
    const m = computeMetrics(makeInput({ now: NOW }));
    expect(m.computedAt).toBe(NOW.toISOString());
  });

  it('is deterministic for same input', () => {
    const findings = [makeFinding(), makeFinding({ category: 'console_log' })];
    const a = computeMetrics(makeInput({ findings, now: NOW }));
    const b = computeMetrics(makeInput({ findings, now: NOW }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── toMetricsSnapshot ─────────────────────────────────────────────────────────

describe('toMetricsSnapshot', () => {
  it('extracts compact snapshot from full metrics', () => {
    const m = computeMetrics(makeInput({ now: NOW }));
    const snap = toMetricsSnapshot(m);
    expect(snap.recordedAt).toBe(NOW.toISOString());
    expect(snap.totalFindings).toBe(0);
    expect(snap.findingsBySeverity).toBeDefined();
    expect(snap.driftEvents).toBe(0);
  });

  it('snapshot does not include full rule breakdown (compact)', () => {
    const m = computeMetrics(makeInput({ findings: [makeFinding()], now: NOW }));
    const snap = toMetricsSnapshot(m);
    expect((snap as any).findingsByRule).toBeUndefined();
    expect((snap as any).topRiskyFiles).toBeUndefined();
  });
});

// ── formatMetricsConsole ──────────────────────────────────────────────────────

describe('formatMetricsConsole', () => {
  const m = computeMetrics(makeInput({
    findings: [makeFinding({ severity: 'HIGH' }), makeFinding({ category: 'console_log', severity: 'LOW' })],
    driftFindings: [{ type: 'report.stale', severity: 'MEDIUM' as const, message: 'stale' }],
    now: NOW,
  }));

  it('includes project name', () => {
    expect(formatMetricsConsole(m, 'MyProject')).toContain('MyProject');
  });

  it('shows total findings', () => {
    expect(formatMetricsConsole(m)).toContain('Total:');
    expect(formatMetricsConsole(m)).toContain('2');
  });

  it('shows drift events', () => {
    expect(formatMetricsConsole(m)).toContain('Drift Events: 1');
  });

  it('is deterministic', () => {
    expect(formatMetricsConsole(m)).toBe(formatMetricsConsole(m));
  });
});

// ── formatMetricsMarkdown ─────────────────────────────────────────────────────

describe('formatMetricsMarkdown', () => {
  const m = computeMetrics(makeInput({ findings: [makeFinding()], now: NOW }));

  it('starts with a heading', () => {
    expect(formatMetricsMarkdown(m, 'MyRepo')).toMatch(/^## Thesmos Metrics/);
  });

  it('contains findings summary table', () => {
    const out = formatMetricsMarkdown(m);
    expect(out).toContain('### Findings Summary');
    expect(out).toContain('| Total findings |');
  });

  it('is deterministic', () => {
    expect(formatMetricsMarkdown(m)).toBe(formatMetricsMarkdown(m));
  });
});

// ── formatMetricsJson ─────────────────────────────────────────────────────────

describe('formatMetricsJson', () => {
  it('is valid JSON', () => {
    const m = computeMetrics(makeInput({ now: NOW }));
    expect(() => JSON.parse(formatMetricsJson(m))).not.toThrow();
  });

  it('contains all top-level fields', () => {
    const m = computeMetrics(makeInput({ now: NOW }));
    const obj = JSON.parse(formatMetricsJson(m));
    expect(obj.computedAt).toBeDefined();
    expect(obj.totalFindings).toBeDefined();
    expect(obj.findingsBySeverity).toBeDefined();
    expect(obj.findingsByRule).toBeDefined();
    expect(obj.topRiskyFiles).toBeDefined();
    expect(obj.driftEvents).toBeDefined();
  });

  it('is deterministic', () => {
    const m = computeMetrics(makeInput({ now: NOW }));
    expect(formatMetricsJson(m)).toBe(formatMetricsJson(m));
  });
});
