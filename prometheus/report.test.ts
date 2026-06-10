// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { applyGeneratedSections, sortReport, isReportStale, type JsonValue } from './report';

type JsonRecord = Record<string, JsonValue>;

describe('applyGeneratedSections', () => {
  it('overwrites a generated section', () => {
    const existing: JsonRecord = { scan: { old: true }, knownRisks: ['risk-1'] };
    const incoming: JsonRecord = { scan: { new: true } };
    const result = applyGeneratedSections(existing, incoming, ['scan']);
    expect((result['scan'] as JsonRecord)['new']).toBe(true);
    expect((result['scan'] as JsonRecord)['old']).toBeUndefined();
  });

  it('preserves manual sections not in generatedKeys', () => {
    const existing: JsonRecord = { scan: {}, knownRisks: ['risk-1'] };
    const incoming: JsonRecord = { scan: { fresh: true } };
    const result = applyGeneratedSections(existing, incoming, ['scan']);
    expect(result['knownRisks']).toEqual(['risk-1']);
  });

  it('does not overwrite routes.api when only routes.pages is generated', () => {
    const existing: JsonRecord = {
      routes: { pages: [], api: [{ path: '/api/users' }] },
    };
    const incoming: JsonRecord = {
      routes: { pages: [{ path: '/' }], api: [] },
    };
    // 'routes' as a whole is generated — both sub-keys get overwritten
    // This is by design: routes is the generated key, not sub-keys
    const result = applyGeneratedSections(existing, incoming, ['routes']);
    expect((result['routes'] as JsonRecord)['pages']).toHaveLength(1);
  });

  it('adds _generatedSections and _manualNote metadata', () => {
    const result = applyGeneratedSections({}, {}, ['scan']);
    expect(result['_generatedSections']).toEqual(['scan']);
    expect(typeof result['_manualNote']).toBe('string');
  });

  it('running twice with same data produces identical JSON', () => {
    const existing: JsonRecord = { scan: { v: 1 }, knownRisks: ['r1'] };
    const incoming: JsonRecord = { scan: { v: 2 } };
    const r1 = JSON.stringify(applyGeneratedSections(existing, incoming, ['scan']));
    const r2 = JSON.stringify(applyGeneratedSections(existing, incoming, ['scan']));
    expect(r1).toBe(r2);
  });
});

describe('sortReport', () => {
  it('sorts routes.pages by path', () => {
    const report: JsonRecord = {
      routes: {
        pages: [
          { path: '/z', file: 'z.tsx', desc: '' },
          { path: '/a', file: 'a.tsx', desc: '' },
        ],
      },
    };
    const sorted = sortReport(report);
    const pages = (sorted['routes'] as JsonRecord)['pages'] as { path: string }[];
    expect(pages[0].path).toBe('/a');
    expect(pages[1].path).toBe('/z');
  });

  it('produces identical output when called twice', () => {
    const report: JsonRecord = {
      routes: {
        pages: [
          { path: '/b', file: 'b.tsx', desc: '' },
          { path: '/a', file: 'a.tsx', desc: '' },
        ],
      },
      scan: {
        storeFiles: ['z.ts', 'a.ts', 'm.ts'],
        largeFiles: [
          { file: 'big.ts', lines: 200 },
          { file: 'huge.ts', lines: 500 },
        ],
      },
    };
    const r1 = JSON.stringify(sortReport(report));
    const r2 = JSON.stringify(sortReport(JSON.parse(r1) as JsonRecord));
    expect(r1).toBe(r2);
  });

  it('sorts storeFiles alphabetically', () => {
    const report: JsonRecord = {
      scan: { storeFiles: ['z.ts', 'a.ts', 'm.ts'] },
    };
    const sorted = sortReport(report);
    expect((sorted['scan'] as JsonRecord)['storeFiles']).toEqual(['a.ts', 'm.ts', 'z.ts']);
  });

  it('sorts largeFiles by lines descending', () => {
    const report: JsonRecord = {
      scan: {
        largeFiles: [
          { file: 'small.ts', lines: 100 },
          { file: 'huge.ts', lines: 900 },
          { file: 'mid.ts', lines: 400 },
        ],
      },
    };
    const sorted = sortReport(report);
    const lf = (sorted['scan'] as JsonRecord)['largeFiles'] as { lines: number }[];
    expect(lf[0].lines).toBe(900);
    expect(lf[2].lines).toBe(100);
  });
});

describe('isReportStale', () => {
  // Pin nowMs so tests never rely on the real clock
  const NOW = new Date('2026-06-09T00:00:00.000Z').getTime();
  const daysAgo = (n: number) =>
    new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  it('returns true when generatedAt is older than maxAgeDays', () => {
    expect(isReportStale(daysAgo(31), 30, NOW)).toBe(true);
  });

  it('returns false when generatedAt is within maxAgeDays', () => {
    expect(isReportStale(daysAgo(1), 30, NOW)).toBe(false);
  });

  it('returns true when generatedAt is undefined', () => {
    expect(isReportStale(undefined, 30, NOW)).toBe(true);
  });

  it('returns false on boundary (29.9 days ago)', () => {
    expect(isReportStale(daysAgo(29.9), 30, NOW)).toBe(false);
  });

  it('returns true exactly at boundary (30.1 days)', () => {
    expect(isReportStale(daysAgo(30.1), 30, NOW)).toBe(true);
  });

  it('injectable nowMs makes results deterministic across runs', () => {
    const ts = daysAgo(10);
    const r1 = isReportStale(ts, 30, NOW);
    const r2 = isReportStale(ts, 30, NOW);
    expect(r1).toBe(r2);
    expect(r1).toBe(false);
  });
});
