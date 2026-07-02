// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { partitionNewVsPreExisting, type FileDiffInfo } from './partition.js';
import { ALL_LINES } from './diff-lines.js';
import type { Finding } from './types.js';

function f(file: string, line: number | undefined, category = 'CAT'): Finding {
  return { severity: 'HIGH', file, line, category, message: 'msg' };
}

describe('partitionNewVsPreExisting — added files', () => {
  it('every finding in an added file is NEW, regardless of line', () => {
    const findings = [f('new-file.ts', 5), f('new-file.ts', undefined)];
    const filesByPath = new Map<string, FileDiffInfo>([
      ['new-file.ts', { status: 'added', changedLines: new Set([5]) }],
    ]);

    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toHaveLength(2);
    expect(preExistingFindings).toHaveLength(0);
  });
});

describe('partitionNewVsPreExisting — modified files, line-level findings', () => {
  it('a finding on a changed line is NEW', () => {
    const findings = [f('existing.ts', 10)];
    const filesByPath = new Map<string, FileDiffInfo>([
      ['existing.ts', { status: 'modified', changedLines: new Set([10, 11]) }],
    ]);

    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toEqual([findings[0]]);
    expect(preExistingFindings).toHaveLength(0);
  });

  it('a finding on an untouched line is PRE-EXISTING', () => {
    const findings = [f('existing.ts', 200)];
    const filesByPath = new Map<string, FileDiffInfo>([
      ['existing.ts', { status: 'modified', changedLines: new Set([10, 11]) }],
    ]);

    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toHaveLength(0);
    expect(preExistingFindings).toEqual([findings[0]]);
  });

  it('ALL_LINES (missing patch) treats every line as changed — NEW', () => {
    const findings = [f('huge-file.ts', 9999)];
    const filesByPath = new Map<string, FileDiffInfo>([
      ['huge-file.ts', { status: 'modified', changedLines: ALL_LINES }],
    ]);

    const { newFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toHaveLength(1);
  });
});

describe('partitionNewVsPreExisting — no-line-number findings on existing files', () => {
  it('a file-level finding (no line) on an existing file is PRE-EXISTING, never blocks', () => {
    const findings = [f('existing.ts', undefined, 'large_file')];
    const filesByPath = new Map<string, FileDiffInfo>([
      ['existing.ts', { status: 'modified', changedLines: new Set([1, 2, 3]) }],
    ]);

    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toHaveLength(0);
    expect(preExistingFindings).toEqual([findings[0]]);
  });

  it('a file-level finding on an existing file is PRE-EXISTING even with ALL_LINES', () => {
    const findings = [f('existing.ts', undefined, 'large_file')];
    const filesByPath = new Map<string, FileDiffInfo>([
      ['existing.ts', { status: 'modified', changedLines: ALL_LINES }],
    ]);

    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toHaveLength(0);
    expect(preExistingFindings).toEqual([findings[0]]);
  });
});

describe('partitionNewVsPreExisting — missing file info', () => {
  it('a finding whose file has no entry in the map defaults to PRE-EXISTING (safe default)', () => {
    const findings = [f('unknown.ts', 5)];
    const filesByPath = new Map<string, FileDiffInfo>();

    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toHaveLength(0);
    expect(preExistingFindings).toEqual([findings[0]]);
  });
});

describe('partitionNewVsPreExisting — unknown-file split via fileExists (Argus, item 2)', () => {
  it('a missing-artifact finding (file does not exist) is NEW — compliance rules keep gating', () => {
    // e.g. EU_AI_001 BLOCKER attaches to '.thesmos/conformity-assessment.md',
    // which does not exist — that is precisely why the rule fired.
    const findings = [f('.thesmos/conformity-assessment.md', undefined, 'eu_ai_high_risk_no_conformity')];
    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(
      findings,
      new Map(),
      { fileExists: () => false },
    );
    expect(newFindings).toEqual([findings[0]]);
    expect(preExistingFindings).toHaveLength(0);
  });

  it('a scan finding on a real untouched file is PRE-EXISTING — repo debt does not gate', () => {
    const findings = [f('app/api/users/route.ts', undefined, 'missing_api_auth')];
    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(
      findings,
      new Map(),
      { fileExists: () => true },
    );
    expect(newFindings).toHaveLength(0);
    expect(preExistingFindings).toEqual([findings[0]]);
  });

  it('without the fileExists callback, unknown-file findings keep the PRE-EXISTING default', () => {
    const findings = [f('.thesmos/conformity-assessment.md', undefined)];
    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, new Map());
    expect(newFindings).toHaveLength(0);
    expect(preExistingFindings).toHaveLength(1);
  });
});

describe('partitionNewVsPreExisting — mixed batch', () => {
  it('correctly splits a mixed batch across multiple files', () => {
    const findings = [
      f('new.ts', undefined),           // added file, no line -> NEW
      f('existing.ts', 5),              // changed line -> NEW
      f('existing.ts', 500),            // untouched line -> PRE-EXISTING
      f('existing.ts', undefined, 'large_file'), // no line, existing file -> PRE-EXISTING
      f('renamed-only.ts', 1),          // renamed, no patch changes -> PRE-EXISTING
    ];
    const filesByPath = new Map<string, FileDiffInfo>([
      ['new.ts', { status: 'added', changedLines: new Set() }],
      ['existing.ts', { status: 'modified', changedLines: new Set([5, 6, 7]) }],
      ['renamed-only.ts', { status: 'renamed', changedLines: new Set() }],
    ]);

    const { newFindings, preExistingFindings } = partitionNewVsPreExisting(findings, filesByPath);
    expect(newFindings).toHaveLength(2);
    expect(preExistingFindings).toHaveLength(3);
  });

  it('returns empty arrays for empty findings input', () => {
    const { newFindings, preExistingFindings } = partitionNewVsPreExisting([], new Map());
    expect(newFindings).toEqual([]);
    expect(preExistingFindings).toEqual([]);
  });
});
