import { describe, it, expect } from 'vitest';
import {
  parseSuppression,
  extractSuppressions,
  resolveCategory,
  applySuppressions,
  auditSuppressions,
  formatSuppressionAuditConsole,
  formatSuppressionAuditMarkdown,
  formatSuppressionAuditJson,
  formatReviewWithSuppressions,
} from './suppress.ts';
import type { Finding } from './types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FILE = 'src/api/users/route.ts';
const NOW = new Date('2026-06-10T00:00:00Z');

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'HIGH',
    category: 'missing_api_auth',
    file: FILE,
    line: 42,
    message: 'API route has no auth check.',
    ...overrides,
  };
}

// ── parseSuppression ──────────────────────────────────────────────────────────

describe('parseSuppression', () => {
  it('parses a complete suppression comment', () => {
    const line = '// thesmos-disable-next-line missing_api_auth -- reason: protected by middleware -- owner: @alice -- expires: 2027-01-01';
    const s = parseSuppression(line, 41, FILE);
    expect(s).not.toBeNull();
    expect(s!.ruleId).toBe('missing_api_auth');
    expect(s!.reason).toBe('protected by middleware');
    expect(s!.owner).toBe('@alice');
    expect(s!.expiresAt).toBe('2027-01-01');
    expect(s!.line).toBe(41);
    expect(s!.suppressedLine).toBe(42);
    expect(s!.file).toBe(FILE);
  });

  it('parses minimal suppression (rule + reason only)', () => {
    const line = '// thesmos-disable-next-line missing_api_auth -- reason: gateway auth';
    const s = parseSuppression(line, 10, FILE);
    expect(s).not.toBeNull();
    expect(s!.ruleId).toBe('missing_api_auth');
    expect(s!.reason).toBe('gateway auth');
    expect(s!.owner).toBeNull();
    expect(s!.expiresAt).toBeNull();
  });

  it('parses suppression without reason (will trigger audit finding)', () => {
    const line = '// thesmos-disable-next-line missing_api_auth';
    const s = parseSuppression(line, 5, FILE);
    expect(s).not.toBeNull();
    expect(s!.ruleId).toBe('missing_api_auth');
    expect(s!.reason).toBeNull();
  });

  it('is case-insensitive for the directive', () => {
    const line = '// THESMOS-DISABLE-NEXT-LINE missing_api_auth -- reason: test';
    const s = parseSuppression(line, 1, FILE);
    expect(s).not.toBeNull();
  });

  it('returns null for a non-suppression line', () => {
    expect(parseSuppression('// regular comment', 1, FILE)).toBeNull();
    expect(parseSuppression('const x = 1;', 1, FILE)).toBeNull();
    expect(parseSuppression('', 1, FILE)).toBeNull();
  });

  it('handles rule ID with no rest text (blanket-style)', () => {
    const line = '// thesmos-disable-next-line';
    const s = parseSuppression(line, 1, FILE);
    expect(s).not.toBeNull();
    expect(s!.ruleId).toBe('');
    expect(s!.reason).toBeNull();
  });
});

// ── extractSuppressions ───────────────────────────────────────────────────────

describe('extractSuppressions', () => {
  it('extracts all suppression comments from file content', () => {
    const content = [
      'const x = 1;',
      '// thesmos-disable-next-line console_log -- reason: debug temp',
      'console.log("x:", x);',
      '// thesmos-disable-next-line any_type_no_comment -- reason: external SDK',
      'const data: any = sdk.get();',
    ].join('\n');

    const sups = extractSuppressions(content, FILE);
    expect(sups).toHaveLength(2);
    expect(sups[0]!.ruleId).toBe('console_log');
    expect(sups[0]!.line).toBe(2);
    expect(sups[0]!.suppressedLine).toBe(3);
    expect(sups[1]!.ruleId).toBe('any_type_no_comment');
    expect(sups[1]!.line).toBe(4);
  });

  it('returns empty array when no suppressions present', () => {
    expect(extractSuppressions('const x = 1;\nconst y = 2;', FILE)).toHaveLength(0);
  });

  it('returns empty array for empty content', () => {
    expect(extractSuppressions('', FILE)).toHaveLength(0);
  });
});

// ── resolveCategory ───────────────────────────────────────────────────────────

describe('resolveCategory', () => {
  it('resolves category name to itself', () => {
    expect(resolveCategory('missing_api_auth')).toBe('missing_api_auth');
  });

  it('resolves rule ID to category name', () => {
    expect(resolveCategory('AUTH_001')).toBe('missing_api_auth');
    expect(resolveCategory('ENV_001')).toBe('direct_env_access');
  });

  it('is case-insensitive', () => {
    expect(resolveCategory('auth_001')).toBe('missing_api_auth');
    expect(resolveCategory('MISSING_API_AUTH')).toBe('missing_api_auth');
  });

  it('returns unknown IDs unchanged', () => {
    expect(resolveCategory('FAKE_999')).toBe('FAKE_999');
  });
});

// ── applySuppressions ─────────────────────────────────────────────────────────

describe('applySuppressions', () => {
  it('suppresses a finding that matches suppression file, line, and category', () => {
    const finding = makeFinding({ file: FILE, line: 42, category: 'missing_api_auth' });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'gateway auth',
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };

    const result = applySuppressions([finding], [sup], NOW);
    expect(result.suppressedFindings).toHaveLength(1);
    expect(result.activeFindings).toHaveLength(0);
    expect(result.activeSuppressions).toHaveLength(1);
    expect(result.unusedSuppressions).toHaveLength(0);
  });

  it('does not suppress when file differs', () => {
    const finding = makeFinding({ file: 'other.ts', line: 42 });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'test',
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };

    const result = applySuppressions([finding], [sup], NOW);
    expect(result.activeFindings).toHaveLength(1);
    expect(result.suppressedFindings).toHaveLength(0);
    expect(result.unusedSuppressions).toHaveLength(1);
  });

  it('does not suppress when line differs', () => {
    const finding = makeFinding({ line: 99 });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'test',
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };

    const result = applySuppressions([finding], [sup], NOW);
    expect(result.activeFindings).toHaveLength(1);
  });

  it('does not apply expired suppressions', () => {
    const finding = makeFinding({ line: 42 });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'test',
      owner: null,
      expiresAt: '2025-01-01', // in the past relative to NOW (2026-06-10)
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };

    const result = applySuppressions([finding], [sup], NOW);
    expect(result.activeFindings).toHaveLength(1);
    expect(result.suppressedFindings).toHaveLength(0);
  });

  it('applies non-expired suppressions', () => {
    const finding = makeFinding({ line: 42 });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'test',
      owner: null,
      expiresAt: '2027-01-01', // future
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };

    const result = applySuppressions([finding], [sup], NOW);
    expect(result.suppressedFindings).toHaveLength(1);
  });

  it('resolves rule ID to category for matching', () => {
    const finding = makeFinding({ category: 'missing_api_auth', line: 10 });
    const sup = {
      ruleId: 'AUTH_001', // rule ID instead of category
      reason: 'test',
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 9,
      suppressedLine: 10,
    };

    const result = applySuppressions([finding], [sup], NOW);
    expect(result.suppressedFindings).toHaveLength(1);
  });

  it('handles findings with no line number — match by file and category', () => {
    const finding = makeFinding({ line: undefined });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'test',
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };

    // Without a line number on the finding, line matching is skipped
    const result = applySuppressions([finding], [sup], NOW);
    expect(result.suppressedFindings).toHaveLength(1);
  });

  it('handles multiple findings and suppressions correctly', () => {
    const findings = [
      makeFinding({ line: 10, category: 'console_log' }),
      makeFinding({ line: 20, category: 'missing_api_auth' }),
      makeFinding({ line: 30, category: 'any_type_no_comment' }),
    ];
    const sups = [
      { ruleId: 'console_log', reason: 'temp', owner: null, expiresAt: null, file: FILE, line: 9, suppressedLine: 10 },
    ];

    const result = applySuppressions(findings, sups, NOW);
    expect(result.suppressedFindings).toHaveLength(1);
    expect(result.activeFindings).toHaveLength(2);
  });
});

// ── auditSuppressions ─────────────────────────────────────────────────────────

describe('auditSuppressions', () => {
  it('returns no findings for a valid, active, used suppression', () => {
    const finding = makeFinding({ line: 42 });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'gateway auth',
      owner: null,
      expiresAt: '2027-01-01',
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };
    const result = auditSuppressions({ suppressions: [sup], findings: [finding], now: NOW });
    expect(result).toHaveLength(0);
  });

  it('flags missing-reason', () => {
    const finding = makeFinding({ line: 42 });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: null, // missing
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };
    const result = auditSuppressions({ suppressions: [sup], findings: [finding], now: NOW });
    expect(result.some((r) => r.type === 'missing-reason')).toBe(true);
  });

  it('flags expired suppression', () => {
    const finding = makeFinding({ line: 42 });
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'test',
      owner: null,
      expiresAt: '2025-01-01', // past
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };
    const result = auditSuppressions({ suppressions: [sup], findings: [finding], now: NOW });
    expect(result.some((r) => r.type === 'expired')).toBe(true);
  });

  it('flags unused suppression (no finding at that line)', () => {
    const sup = {
      ruleId: 'missing_api_auth',
      reason: 'test',
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 41,
      suppressedLine: 42,
    };
    // No findings provided
    const result = auditSuppressions({ suppressions: [sup], findings: [], now: NOW });
    expect(result.some((r) => r.type === 'unused')).toBe(true);
  });

  it('flags blanket suppression (no rule ID)', () => {
    const sup = {
      ruleId: '', // blank
      reason: null,
      owner: null,
      expiresAt: null,
      file: FILE,
      line: 1,
      suppressedLine: 2,
    };
    const result = auditSuppressions({ suppressions: [sup], findings: [], now: NOW });
    expect(result.some((r) => r.type === 'blanket')).toBe(true);
  });

  it('sorts by severity: HIGH before MEDIUM before LOW', () => {
    const findings: Finding[] = [
      makeFinding({ line: 100, category: 'missing_api_auth' }), // to make sup non-unused
    ];
    const sups = [
      { ruleId: 'missing_api_auth', reason: null, owner: null, expiresAt: '2025-01-01', file: FILE, line: 99, suppressedLine: 100 },
    ];
    const result = auditSuppressions({ suppressions: sups, findings, now: NOW });
    const sevs = result.map((r) => r.severity);
    const order = ['HIGH', 'MEDIUM', 'LOW'];
    let last = -1;
    for (const s of sevs) {
      const idx = order.indexOf(s);
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
  });

  it('is deterministic', () => {
    const findings = [makeFinding({ line: 42 })];
    const sups = [
      { ruleId: 'missing_api_auth', reason: null, owner: null, expiresAt: '2025-01-01', file: FILE, line: 41, suppressedLine: 42 },
    ];
    const a = auditSuppressions({ suppressions: sups, findings, now: NOW });
    const b = auditSuppressions({ suppressions: sups, findings, now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ── Formatters ────────────────────────────────────────────────────────────────

describe('formatSuppressionAuditConsole', () => {
  it('shows clean state when no findings', () => {
    const out = formatSuppressionAuditConsole([], 5, 'MyRepo');
    expect(out).toContain('5 suppressions scanned');
    expect(out).toContain('All suppressions are valid');
  });

  it('shows audit findings', () => {
    const findings = [
      {
        type: 'missing-reason' as const,
        severity: 'MEDIUM' as const,
        file: FILE,
        line: 10,
        message: 'No reason',
        fixSuggestion: 'Add reason',
      },
    ];
    const out = formatSuppressionAuditConsole(findings, 1, 'MyRepo');
    expect(out).toContain('missing-reason');
    expect(out).toContain('No reason');
  });
});

describe('formatSuppressionAuditMarkdown', () => {
  it('is valid markdown with heading', () => {
    const out = formatSuppressionAuditMarkdown([], 3, 'MyRepo');
    expect(out).toContain('## Thesmos Suppressions Audit');
    expect(out).toContain('All suppressions are valid');
  });

  it('is deterministic', () => {
    const findings = [{ type: 'expired' as const, severity: 'HIGH' as const, file: FILE, line: 5, message: 'msg', fixSuggestion: 'fix' }];
    expect(formatSuppressionAuditMarkdown(findings, 1)).toBe(formatSuppressionAuditMarkdown(findings, 1));
  });
});

describe('formatSuppressionAuditJson', () => {
  it('is valid JSON', () => {
    const out = formatSuppressionAuditJson([], 4);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).clean).toBe(true);
  });

  it('includes finding count', () => {
    const findings = [{ type: 'unused' as const, severity: 'LOW' as const, file: FILE, line: 1, message: 'msg', fixSuggestion: 'fix' }];
    const obj = JSON.parse(formatSuppressionAuditJson(findings, 2));
    expect(obj.auditFindings).toBe(1);
    expect(obj.suppressionCount).toBe(2);
    expect(obj.clean).toBe(false);
  });
});

describe('formatReviewWithSuppressions', () => {
  it('shows Active Findings section', () => {
    const result = {
      activeFindings: [makeFinding()],
      suppressedFindings: [],
      activeSuppressions: [],
      unusedSuppressions: [],
    };
    const out = formatReviewWithSuppressions(result, 'MyRepo');
    expect(out).toContain('Active Findings');
    expect(out).toContain('missing_api_auth');
  });

  it('shows Suppressed Findings section when suppressions present', () => {
    const result = {
      activeFindings: [],
      suppressedFindings: [makeFinding()],
      activeSuppressions: [],
      unusedSuppressions: [],
    };
    const out = formatReviewWithSuppressions(result, 'MyRepo');
    expect(out).toContain('Suppressed Findings');
    expect(out).toContain('[suppressed]');
  });

  it('shows summary line with counts', () => {
    const result = {
      activeFindings: [makeFinding()],
      suppressedFindings: [makeFinding()],
      activeSuppressions: [],
      unusedSuppressions: [],
    };
    const out = formatReviewWithSuppressions(result, 'MyRepo');
    expect(out).toContain('1 active');
    expect(out).toContain('1 suppressed');
  });
});

// ── extractSuppressions — stacked comment chaining ────────────────────────────

describe('extractSuppressions — stacked comments chain to the next code line', () => {
  it('two stacked suppressions both target the first non-suppression line', () => {
    const content = [
      '// thesmos-disable-next-line shell_injection -- reason: static constants -- owner: @test',
      '// thesmos-disable-next-line child_process_shell_injection -- reason: static constants -- owner: @test',
      'execSync(`cd "${TMP_DIR}" && zip -r "${zipPath}" "${bundleName}"`);',
    ].join('\n');

    const sups = extractSuppressions(content, 'scripts/pack.ts');
    expect(sups).toHaveLength(2);
    expect(sups[0]!.ruleId).toBe('shell_injection');
    expect(sups[0]!.suppressedLine).toBe(3);
    expect(sups[1]!.ruleId).toBe('child_process_shell_injection');
    expect(sups[1]!.suppressedLine).toBe(3);
  });

  it('single suppression still targets the immediately following line', () => {
    const content = [
      'const a = 1;',
      '// thesmos-disable-next-line console_log -- reason: temp',
      'console.log(a);',
    ].join('\n');
    const sups = extractSuppressions(content, 'a.ts');
    expect(sups).toHaveLength(1);
    expect(sups[0]!.suppressedLine).toBe(3);
  });

  it('trailing suppression at end of file points past the last line without crashing', () => {
    const content = 'const a = 1;\n// thesmos-disable-next-line console_log -- reason: temp';
    const sups = extractSuppressions(content, 'a.ts');
    expect(sups).toHaveLength(1);
    expect(sups[0]!.suppressedLine).toBe(3);
  });
});
