// Copyright (c) 2026 Holley Studios. All rights reserved.
import { describe, it, expect } from 'vitest';
import { filterBySeverity, SEVERITY_ORDER } from '../severityFilter.js';
import type { Finding } from '../types.js';

function makeFinding(severity: Finding['severity'], file = 'a.ts'): Finding {
  return { severity, file, category: 'CAT', message: 'msg' };
}

const ALL_SEVERITIES: Finding[] = [
  makeFinding('BLOCKER'),
  makeFinding('HIGH'),
  makeFinding('MEDIUM'),
  makeFinding('LOW'),
  makeFinding('TECH_DEBT'),
];

describe('SEVERITY_ORDER', () => {
  it('is ordered most-severe first', () => {
    expect(SEVERITY_ORDER).toEqual(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT']);
  });
});

describe('filterBySeverity', () => {
  it('"ALL" returns every finding unfiltered', () => {
    expect(filterBySeverity(ALL_SEVERITIES, 'ALL')).toHaveLength(5);
  });

  it('"BLOCKER" returns only BLOCKER findings', () => {
    const result = filterBySeverity(ALL_SEVERITIES, 'BLOCKER');
    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('BLOCKER');
  });

  it('"HIGH" returns BLOCKER and HIGH', () => {
    const result = filterBySeverity(ALL_SEVERITIES, 'HIGH');
    expect(result.map((f) => f.severity)).toEqual(['BLOCKER', 'HIGH']);
  });

  it('"MEDIUM" returns BLOCKER, HIGH, MEDIUM', () => {
    const result = filterBySeverity(ALL_SEVERITIES, 'MEDIUM');
    expect(result.map((f) => f.severity)).toEqual(['BLOCKER', 'HIGH', 'MEDIUM']);
  });

  it('"LOW" excludes only TECH_DEBT', () => {
    const result = filterBySeverity(ALL_SEVERITIES, 'LOW');
    expect(result.map((f) => f.severity)).toEqual(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']);
  });

  it('"TECH_DEBT" returns everything (least severe threshold)', () => {
    expect(filterBySeverity(ALL_SEVERITIES, 'TECH_DEBT')).toHaveLength(5);
  });

  it('unknown/garbage value fails open — returns everything', () => {
    expect(filterBySeverity(ALL_SEVERITIES, 'NOT_A_SEVERITY')).toHaveLength(5);
  });

  it('empty input returns empty output regardless of threshold', () => {
    expect(filterBySeverity([], 'BLOCKER')).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const copy = [...ALL_SEVERITIES];
    filterBySeverity(ALL_SEVERITIES, 'HIGH');
    expect(ALL_SEVERITIES).toEqual(copy);
  });
});
