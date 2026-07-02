// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  SUMMARY_MARKER,
  formatSummaryComment,
  formatInlineComment,
  buildInlineComments,
  shouldFail,
  computeScore,
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

const preExistingFinding: Finding = {
  severity: 'MEDIUM',
  file: 'legacy/old-module.ts',
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
    // Only BLOCKER has findings — one <details> section (may be <details open>)
    const detailsCount = (out.match(/<details/g) ?? []).length;
    expect(detailsCount).toBe(1);
  });

  it('uses <details open> for BLOCKER and HIGH sections', () => {
    const out = formatSummaryComment([blocker, high, medium], 'repo', 1);
    expect(out).toContain('<details open>');
  });

  it('uses plain <details> (collapsed) for MEDIUM sections', () => {
    const out = formatSummaryComment([medium], 'repo', 1);
    expect(out).toContain('<details>');
    expect(out).not.toContain('<details open>');
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

// ── computeScore ───────────────────────────────────────────────────────────────

describe('computeScore', () => {
  it('returns 100 for no findings', () => {
    expect(computeScore([])).toBe(100);
  });

  it('deducts 15 per BLOCKER', () => {
    expect(computeScore([blocker])).toBe(85);
  });

  it('deducts 3 per HIGH', () => {
    expect(computeScore([high])).toBe(97);
  });

  it('deducts 1 per MEDIUM', () => {
    expect(computeScore([medium])).toBe(99);
  });

  it('does not deduct for LOW or TECH_DEBT', () => {
    expect(computeScore([low, techDebt])).toBe(100);
  });

  it('floors at 0', () => {
    const manyBlockers = Array.from({ length: 10 }, () => blocker);
    expect(computeScore(manyBlockers)).toBe(0);
  });

  it('combines penalties correctly', () => {
    // 1 BLOCKER (-15) + 1 HIGH (-3) + 1 MEDIUM (-1) = 81
    expect(computeScore([blocker, high, medium])).toBe(81);
  });

  it('shows score in summary comment', () => {
    const out = formatSummaryComment([blocker], 'repo', 1);
    expect(out).toContain('PR Score:');
    expect(out).toContain('85/100');
  });

  it('shows 100/100 when no findings', () => {
    const out = formatSummaryComment([], 'repo', 1);
    expect(out).toContain('100/100');
  });
});

// ── dedup ──────────────────────────────────────────────────────────────────────

describe('dedup — categories spanning many files', () => {
  function makeFindings(category: string, count: number, sev: Finding['severity'] = 'HIGH'): Finding[] {
    return Array.from({ length: count }, (_, i) => ({
      severity: sev,
      file: `src/file${i}.ts`,
      line: 1,
      category,
      message: `Rule ${category} fired`,
    }));
  }

  it('collapses category with >3 distinct files to one summary row', () => {
    const findings = makeFindings('missing_ts_extension', 7);
    const out = formatSummaryComment(findings, 'repo', 1);
    // Should show "7 files" collapsed summary with fix command
    expect(out).toContain('7 files');
    expect(out).toContain('thesmos fix --rule=missing_ts_extension');
    // Files beyond the 5-file preview window are hidden (+2 more)
    expect(out).not.toContain('src/file6.ts');
    expect(out).toContain('+2 more');
  });

  it('shows individual rows for categories with ≤3 distinct files', () => {
    const findings = makeFindings('sec_sql_injection', 2);
    const out = formatSummaryComment(findings, 'repo', 1);
    expect(out).toContain('src/file0.ts');
    expect(out).toContain('src/file1.ts');
  });

  it('suppresses bulk categories from inline comments', () => {
    const findings = makeFindings('missing_ts_extension', 5);
    const changed = new Set(findings.map((f) => f.file));
    const inline = buildInlineComments(findings, changed);
    // Bulk category (5 files > threshold 3) suppressed from inline
    expect(inline).toHaveLength(0);
  });

  it('allows inline comments for non-bulk categories', () => {
    const findings = makeFindings('sec_sql_injection', 2);
    const changed = new Set(findings.map((f) => f.file));
    const inline = buildInlineComments(findings, changed);
    expect(inline).toHaveLength(2);
  });
});

// ── formatSummaryComment — pre-existing section & baseline note (Task 4a/4b) ───

describe('formatSummaryComment — pre-existing findings section', () => {
  it('omits the pre-existing section entirely when there are no pre-existing findings', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, { preExisting: [] });
    expect(out).not.toContain('Pre-existing findings in touched files');
  });

  it('renders the collapsed pre-existing section when present', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, { preExisting: [preExistingFinding] });
    expect(out).toContain('Pre-existing findings in touched files');
    expect(out).toContain('1 finding');
    expect(out).toContain('not blocking');
  });

  it('pre-existing section contains the finding file and category', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, { preExisting: [preExistingFinding] });
    expect(out).toContain('legacy/old-module.ts');
    expect(out).toContain('debt_magic_number');
  });

  it('the pre-existing section is a plain (collapsed) <details>, not <details open>', () => {
    const out = formatSummaryComment([], 'repo', 1, { preExisting: [preExistingFinding] });
    expect(out).toContain('<details>\n<summary>📋');
    expect(out).not.toContain('<details open>\n<summary>📋');
  });

  it('respects reportPreexisting: false — section is suppressed even when findings exist', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, {
      preExisting: [preExistingFinding],
      reportPreexisting: false,
    });
    expect(out).not.toContain('Pre-existing findings in touched files');
  });

  it('main findings sections are unaffected by the pre-existing bucket', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, { preExisting: [preExistingFinding] });
    expect(out).toContain('sec_sql_injection');
  });

  it('omitting options entirely behaves exactly as before (backward compatible)', () => {
    const out = formatSummaryComment([blocker, high], 'repo', 5);
    expect(out).toContain('2 findings');
    expect(out).not.toContain('Pre-existing findings in touched files');
  });
});

describe('formatSummaryComment — baseline suppression note', () => {
  it('omits the baseline note when baselinedCount is 0 or absent', () => {
    const out = formatSummaryComment([blocker], 'repo', 1);
    expect(out).not.toContain('suppressed as accepted baseline debt');
  });

  it('shows the baseline note with the correct count (plural)', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, { baselinedCount: 5 });
    expect(out).toContain('5 findings suppressed as accepted baseline debt');
    expect(out).toContain('thesmos baseline:report');
  });

  it('shows the baseline note with singular wording for count of 1', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, { baselinedCount: 1 });
    expect(out).toContain('1 finding suppressed as accepted baseline debt');
  });

  it('shows both the pre-existing section and the baseline note together', () => {
    const out = formatSummaryComment([blocker], 'repo', 1, {
      preExisting: [preExistingFinding],
      baselinedCount: 3,
    });
    expect(out).toContain('Pre-existing findings in touched files');
    expect(out).toContain('3 findings suppressed as accepted baseline debt');
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

// ── governance-tamper warning (Argus, Phase 4b item 3) ────────────────────────

describe('formatSummaryComment — governance control file warning', () => {
  it('renders a prominent warning when the PR modifies the baseline', () => {
    const out = formatSummaryComment([], 'acme/app', 7, {
      governanceFilesModified: ['.thesmos/baseline.json'],
    });
    expect(out).toContain('modifies governance control files');
    expect(out).toContain('.thesmos/baseline.json');
    // Must not be inside a collapsed <details> block
    const warnIdx = out.indexOf('modifies governance control files');
    const detailsIdx = out.indexOf('<details>');
    expect(detailsIdx === -1 || warnIdx < detailsIdx).toBe(true);
  });

  it('lists config.json too when both control files are touched', () => {
    const out = formatSummaryComment([], 'acme/app', 7, {
      governanceFilesModified: ['.thesmos/baseline.json', '.thesmos/config.json'],
    });
    expect(out).toContain('.thesmos/baseline.json');
    expect(out).toContain('.thesmos/config.json');
  });

  it('renders no warning when governance files are untouched', () => {
    const out = formatSummaryComment([], 'acme/app', 7, {});
    expect(out).not.toContain('modifies governance control files');
  });
});
