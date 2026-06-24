// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  SUMMARY_MARKER,
  formatSummaryComment,
  formatInlineComment,
  buildInlineComments,
  shouldFail,
} from './formatter.js';
import type { Finding } from './types.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const blocker: Finding = {
  severity: 'BLOCKER',
  file: 'src/auth.ts',
  line: 42,
  category: 'sec_sql_injection',
  message: 'Raw SQL interpolation — use parameterized queries.',
  suggestion: 'Replace with `db.query("SELECT * FROM users WHERE id = ?", [id])`',
};

const high: Finding = {
  severity: 'HIGH',
  file: 'src/api/users.ts',
  line: 10,
  category: 'auth_missing_middleware',
  message: 'Route has no authentication middleware.',
};

const medium: Finding = {
  severity: 'MEDIUM',
  file: 'lib/config.ts',
  category: 'direct_env_access',
  message: 'Direct process.env access outside of config module.',
};

const low: Finding = {
  severity: 'LOW',
  file: 'src/utils.ts',
  line: 7,
  category: 'qual_large_function',
  message: 'Function exceeds recommended length.',
};

const techDebt: Finding = {
  severity: 'TECH_DEBT',
  file: 'src/old.ts',
  category: 'debt_magic_number',
  message: 'Magic number should be a named constant.',
};

// ── SUMMARY_MARKER ─────────────────────────────────────────────────────────────

describe('SUMMARY_MARKER', () => {
  it('is the expected HTML comment string', () => {
    expect(SUMMARY_MARKER).toBe('<!-- thesmos-governance:summary -->');
  });
});

// ── formatSummaryComment ───────────────────────────────────────────────────────

describe('formatSummaryComment — no findings', () => {
  it('contains the summary marker', () => {
    const out = formatSummaryComment([], 'acme/app', 1);
    expect(out).toContain(SUMMARY_MARKER);
  });

  it('shows all-passed message when no findings', () => {
    const out = formatSummaryComment([], 'acme/app', 1);
    expect(out).toContain('All governance checks passed');
  });

  it('shows no-violation status line when no findings', () => {
    const out = formatSummaryComment([], 'acme/app', 1);
    expect(out).toContain('No governance violations found');
  });

  it('includes repo name and PR number in footer', () => {
    const out = formatSummaryComment([], 'acme/app', 99);
    expect(out).toContain('acme/app');
    expect(out).toContain('PR #99');
  });
});

describe('formatSummaryComment — with BLOCKER', () => {
  it('uses blocker status line for blockers', () => {
    const out = formatSummaryComment([blocker], 'repo', 5);
    expect(out).toContain('blocker');
  });

  it('shows finding count', () => {
    const out = formatSummaryComment([blocker, high], 'repo', 5);
    expect(out).toContain('2 findings');
  });

  it('shows 1 finding (singular)', () => {
    const out = formatSummaryComment([blocker], 'repo', 5);
    expect(out).toContain('1 finding');
  });

  it('contains the file path', () => {
    const out = formatSummaryComment([blocker], 'repo', 5);
    expect(out).toContain('src/auth.ts');
  });

  it('contains the category', () => {
    const out = formatSummaryComment([blocker], 'repo', 5);
    expect(out).toContain('sec_sql_injection');
  });

  it('contains the suggestion when present', () => {
    const out = formatSummaryComment([blocker], 'repo', 5);
    expect(out).toContain('parameterized queries');
  });

  it('includes line number in output', () => {
    const out = formatSummaryComment([blocker], 'repo', 5);
    expect(out).toContain(':42');
  });
});

describe('formatSummaryComment — HIGH only', () => {
  it('uses high-severity warning status line', () => {
    const out = formatSummaryComment([high], 'repo', 3);
    expect(out).toContain('high-severity finding');
  });
});

describe('formatSummaryComment — LOW and MEDIUM only', () => {
  it('uses informational status line when no blockers or highs', () => {
    const out = formatSummaryComment([medium, low], 'repo', 2);
    expect(out).toContain('no blockers');
  });
});

describe('formatSummaryComment — all severities', () => {
  const all = [blocker, high, medium, low, techDebt];

  it('contains all severity emoji', () => {
    const out = formatSummaryComment(all, 'repo', 1);
    expect(out).toContain('🔴');
    expect(out).toContain('🟠');
    expect(out).toContain('🟡');
    expect(out).toContain('🔵');
    expect(out).toContain('💡');
  });

  it('contains severity table', () => {
    const out = formatSummaryComment(all, 'repo', 1);
    expect(out).toContain('BLOCKER');
    expect(out).toContain('HIGH');
    expect(out).toContain('MEDIUM');
    expect(out).toContain('LOW');
    expect(out).toContain('TECH_DEBT');
  });

  it('escapes HTML special chars in file paths and messages', () => {
    const xss: Finding = {
      severity: 'HIGH',
      file: 'src/<script>.ts',
      category: 'xss',
      message: 'Found <script> & "xss"',
    };
    const out = formatSummaryComment([xss], 'repo', 1);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&amp;');
    expect(out).toContain('&quot;');
  });

  it('omits finding sections for zero-count severities in details', () => {
    const out = formatSummaryComment([blocker], 'repo', 1);
    // Only BLOCKER has findings so only one <details> section should appear
    const detailsCount = (out.match(/<details>/g) ?? []).length;
    expect(detailsCount).toBe(1);
  });
});

describe('formatSummaryComment — finding without line number', () => {
  it('omits colon-line when no line present', () => {
    const out = formatSummaryComment([medium], 'repo', 1);
    // medium has no line property — should not show ":undefined"
    expect(out).not.toContain(':undefined');
    expect(out).not.toContain(':NaN');
  });
});

// ── formatInlineComment ────────────────────────────────────────────────────────

describe('formatInlineComment', () => {
  it('contains the severity', () => {
    const out = formatInlineComment(blocker);
    expect(out).toContain('BLOCKER');
  });

  it('contains the category', () => {
    const out = formatInlineComment(blocker);
    expect(out).toContain('sec_sql_injection');
  });

  it('contains the message', () => {
    const out = formatInlineComment(blocker);
    expect(out).toContain('Raw SQL interpolation');
  });

  it('includes suggestion when present', () => {
    const out = formatInlineComment(blocker);
    expect(out).toContain('Suggestion:');
    expect(out).toContain('parameterized queries');
  });

  it('omits suggestion section when not present', () => {
    const out = formatInlineComment(high);
    expect(out).not.toContain('Suggestion:');
  });

  it('contains the Thesmos footer', () => {
    const out = formatInlineComment(medium);
    expect(out).toContain('Thesmos Governance');
  });

  it('includes correct emoji for TECH_DEBT', () => {
    const out = formatInlineComment(techDebt);
    expect(out).toContain('💡');
  });

  it('includes correct emoji for LOW', () => {
    const out = formatInlineComment(low);
    expect(out).toContain('🔵');
  });
});

// ── buildInlineComments ────────────────────────────────────────────────────────

describe('buildInlineComments', () => {
  it('returns empty array when no changed files match', () => {
    const result = buildInlineComments([blocker, high], new Set(['other/file.ts']));
    expect(result).toHaveLength(0);
  });

  it('returns empty array when findings have no line numbers', () => {
    const result = buildInlineComments([medium], new Set(['lib/config.ts']));
    expect(result).toHaveLength(0);
  });

  it('returns matching inline comments', () => {
    const changed = new Set(['src/auth.ts', 'src/api/users.ts']);
    const result = buildInlineComments([blocker, high, medium], changed);
    expect(result).toHaveLength(2);
  });

  it('each result has path, line, and body', () => {
    const result = buildInlineComments([blocker], new Set(['src/auth.ts']));
    expect(result[0]).toMatchObject({ path: 'src/auth.ts', line: 42 });
    expect(typeof result[0]!.body).toBe('string');
    expect(result[0]!.body.length).toBeGreaterThan(0);
  });

  it('excludes findings in files not in changed set', () => {
    const result = buildInlineComments([blocker, high], new Set(['src/auth.ts']));
    // high is in src/api/users.ts which is not in the set
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/auth.ts');
  });

  it('returns empty array for empty findings', () => {
    expect(buildInlineComments([], new Set(['src/auth.ts']))).toHaveLength(0);
  });
});

// ── shouldFail ─────────────────────────────────────────────────────────────────

describe('shouldFail', () => {
  it('returns false when threshold is none', () => {
    expect(shouldFail([blocker], 'none')).toBe(false);
  });

  it('returns false for empty findings at any threshold', () => {
    expect(shouldFail([], 'BLOCKER')).toBe(false);
    expect(shouldFail([], 'HIGH')).toBe(false);
    expect(shouldFail([], 'LOW')).toBe(false);
  });

  it('returns true when BLOCKER finding meets BLOCKER threshold', () => {
    expect(shouldFail([blocker], 'BLOCKER')).toBe(true);
  });

  it('returns false when only HIGH finding and threshold is BLOCKER', () => {
    expect(shouldFail([high], 'BLOCKER')).toBe(false);
  });

  it('returns true when HIGH finding meets HIGH threshold', () => {
    expect(shouldFail([high], 'HIGH')).toBe(true);
  });

  it('returns true when BLOCKER finding meets HIGH threshold (exceeds it)', () => {
    expect(shouldFail([blocker], 'HIGH')).toBe(true);
  });

  it('returns true when MEDIUM finding meets MEDIUM threshold', () => {
    expect(shouldFail([medium], 'MEDIUM')).toBe(true);
  });

  it('returns false when only LOW finding and threshold is MEDIUM', () => {
    expect(shouldFail([low], 'MEDIUM')).toBe(false);
  });

  it('returns true when LOW finding meets LOW threshold', () => {
    expect(shouldFail([low], 'LOW')).toBe(true);
  });

  it('returns true when TECH_DEBT finding meets TECH_DEBT threshold', () => {
    expect(shouldFail([techDebt], 'TECH_DEBT')).toBe(true);
  });

  it('returns true for mixed findings when any meets the threshold', () => {
    expect(shouldFail([low, medium, techDebt], 'MEDIUM')).toBe(true);
  });

  it('returns false for mixed low/tech-debt when threshold is HIGH', () => {
    expect(shouldFail([low, techDebt], 'HIGH')).toBe(false);
  });
});
