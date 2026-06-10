// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatAuditConsole } from './audit.ts';
import type { DoctorCheck, Finding } from '../../types.ts';

const PASSING_CHECKS: DoctorCheck[] = [
  { name: 'config.json exists', pass: true, message: 'Found .prometheus/config.json' },
  { name: 'report.json exists', pass: true, message: 'Found .prometheus/report.json' },
];

const FAILING_CHECKS: DoctorCheck[] = [
  {
    name: 'prometheus:scan script',
    pass: false,
    message: 'Missing package.json script',
    fixHint: 'Add "prometheus:scan" to scripts in package.json',
  },
];

const FINDINGS: Finding[] = [
  {
    rule: 'large_file',
    severity: 'HIGH',
    category: 'Large Files',
    file: 'app/api/monster/route.ts',
    message: 'File is 800 lines — split into smaller modules',
    suggestion: 'Extract helper functions',
  },
];

describe('formatAuditConsole', () => {
  it('shows project name', () => {
    const out = formatAuditConsole(PASSING_CHECKS, [], 'MyProject');
    expect(out).toContain('MyProject');
  });

  it('shows passed / failed counts', () => {
    const out = formatAuditConsole([...PASSING_CHECKS, ...FAILING_CHECKS], [], 'P');
    expect(out).toContain('2 passed');
    expect(out).toContain('1 failed');
  });

  it('shows fix hints for failed checks', () => {
    const out = formatAuditConsole(FAILING_CHECKS, [], 'P');
    expect(out).toContain('prometheus:scan script');
    expect(out).toContain('Add "prometheus:scan"');
  });

  it('shows finding count', () => {
    const out = formatAuditConsole(PASSING_CHECKS, FINDINGS, 'P');
    expect(out).toContain('1 finding');
  });

  it('shows severity in finding summary', () => {
    const out = formatAuditConsole(PASSING_CHECKS, FINDINGS, 'P');
    expect(out).toContain('HIGH');
  });

  it('shows zero findings gracefully', () => {
    const out = formatAuditConsole(PASSING_CHECKS, [], 'P');
    expect(out).toContain('0 findings');
  });
});
