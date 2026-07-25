// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatFindingsSarif } from './review.js';
import type { Finding } from './types.js';

const SAMPLE_FINDING: Finding = {
  severity: 'BLOCKER',
  category: 'admin_client_in_browser',
  message: 'test finding',
  file: 'src/test.ts',
};

describe('SARIF output shape', () => {
  it('has required top-level fields: version and runs', () => {
    const sarif = JSON.parse(formatFindingsSarif([SAMPLE_FINDING]));
    expect(sarif.version).toBeDefined();
    expect(Array.isArray(sarif.runs)).toBe(true);
    expect(sarif.runs.length).toBeGreaterThan(0);
  });

  it('each run has tool.driver.name and results array', () => {
    const sarif = JSON.parse(formatFindingsSarif([SAMPLE_FINDING]));
    const run = sarif.runs[0];
    expect(run.tool?.driver?.name).toBeDefined();
    expect(Array.isArray(run.results)).toBe(true);
  });

  it('each result has ruleId, level, and locations', () => {
    const sarif = JSON.parse(formatFindingsSarif([SAMPLE_FINDING]));
    const result = sarif.runs[0].results[0];
    expect(result.ruleId).toBeDefined();
    expect(result.level).toBeDefined();
    expect(Array.isArray(result.locations)).toBe(true);
  });

  it('empty findings produces valid SARIF with zero results', () => {
    const sarif = JSON.parse(formatFindingsSarif([]));
    expect(sarif.version).toBeDefined();
    expect(sarif.runs[0].results).toHaveLength(0);
  });

  it('SARIF is non-empty string (not zero bytes)', () => {
    const out = formatFindingsSarif([]);
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it('version is 2.1.0', () => {
    const sarif = JSON.parse(formatFindingsSarif([]));
    expect(sarif.version).toBe('2.1.0');
  });
});
