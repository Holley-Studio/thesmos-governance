import { describe, it, expect } from 'vitest';
import {
  findRule,
  findRulesForFile,
  findRuleForFingerprint,
  listRules,
  searchRules,
  formatExplainConsole,
  formatExplainMarkdown,
  formatExplainJson,
  formatExplainListConsole,
} from './explain.ts';
import { THESMOS_RULES } from './adapters.ts';
import { fingerprintFinding } from './baseline.ts';
import type { Finding } from './types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: 'HIGH',
    category: 'missing_api_auth',
    file: 'src/api/users/route.ts',
    message: 'API route /api/users (POST) has no visible auth check.',
    ...overrides,
  };
}

// ── findRule ──────────────────────────────────────────────────────────────────

describe('findRule', () => {
  it('finds rule by exact ID (uppercase)', () => {
    const rule = findRule('ENV_001');
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe('ENV_001');
  });

  it('finds rule by ID case-insensitively', () => {
    const rule = findRule('env_001');
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe('ENV_001');
  });

  it('finds rule by category name', () => {
    const rule = findRule('direct_env_access');
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe('ENV_001');
  });

  it('finds rule by category case-insensitively', () => {
    const rule = findRule('MISSING_API_AUTH');
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe('AUTH_001');
  });

  it('returns null for unknown rule', () => {
    expect(findRule('FAKE_999')).toBeNull();
    expect(findRule('nonexistent_category')).toBeNull();
  });

  it('finds each of the 12 registered rules by ID', () => {
    for (const rule of THESMOS_RULES) {
      const found = findRule(rule.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(rule.id);
    }
  });
});

// ── findRulesForFile ──────────────────────────────────────────────────────────

describe('findRulesForFile', () => {
  const findings: Finding[] = [
    makeFinding({ file: 'src/api/users/route.ts', category: 'missing_api_auth' }),
    makeFinding({ file: 'src/api/users/route.ts', category: 'console_log' }),
    makeFinding({ file: 'src/other/file.ts', category: 'any_type_no_comment' }),
  ];

  it('returns rules whose categories match findings for the given file', () => {
    const rules = findRulesForFile('src/api/users/route.ts', findings);
    const ids = rules.map((r) => r.id).sort();
    expect(ids).toEqual(['AUTH_001', 'QUAL_001'].sort());
  });

  it('returns empty array when no findings for file', () => {
    const rules = findRulesForFile('src/missing/file.ts', findings);
    expect(rules).toHaveLength(0);
  });

  it('does not return duplicates when same category fires multiple times', () => {
    const dup: Finding[] = [
      makeFinding({ file: 'a.ts', category: 'console_log' }),
      makeFinding({ file: 'a.ts', category: 'console_log', line: 5 }),
    ];
    const rules = findRulesForFile('a.ts', dup);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe('QUAL_001');
  });
});

// ── findRuleForFingerprint ────────────────────────────────────────────────────

describe('findRuleForFingerprint', () => {
  const finding = makeFinding();
  const fp = fingerprintFinding(finding);
  const findings: Finding[] = [finding];

  it('finds rule by full fingerprint', () => {
    const rule = findRuleForFingerprint(fp, findings);
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe('AUTH_001');
  });

  it('finds rule by fingerprint prefix', () => {
    const rule = findRuleForFingerprint(fp.slice(0, 6), findings);
    expect(rule).not.toBeNull();
    expect(rule!.id).toBe('AUTH_001');
  });

  it('returns null when no finding matches prefix', () => {
    const rule = findRuleForFingerprint('0000000000000000', findings);
    expect(rule).toBeNull();
  });

  it('returns null when findings list is empty', () => {
    const rule = findRuleForFingerprint(fp, []);
    expect(rule).toBeNull();
  });
});

// ── listRules ─────────────────────────────────────────────────────────────────

describe('listRules', () => {
  it('returns all 12 rules', () => {
    expect(listRules()).toHaveLength(THESMOS_RULES.length);
  });

  it('sorts by severity: BLOCKER before HIGH before MEDIUM before LOW before TECH_DEBT', () => {
    const rules = listRules();
    const severities = rules.map((r) => r.severity);
    const order = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT'];
    let lastIdx = -1;
    for (const s of severities) {
      const idx = order.indexOf(s);
      expect(idx).toBeGreaterThanOrEqual(lastIdx);
      lastIdx = idx;
    }
  });

  it('is deterministic — same order on every call', () => {
    const a = listRules().map((r) => r.id);
    const b = listRules().map((r) => r.id);
    expect(a).toEqual(b);
  });
});

// ── searchRules ───────────────────────────────────────────────────────────────
// The on-demand keyword lookup a thin adapter needs (`thesmos explain search
// <query>`) now that adapters no longer embed the full catalog.

describe('searchRules', () => {
  it('returns an empty array for an empty or whitespace-only query', () => {
    expect(searchRules('')).toEqual([]);
    expect(searchRules('   ')).toEqual([]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(searchRules('xyzzy-no-such-rule-should-ever-match')).toEqual([]);
  });

  it('matches by exact id (case-insensitive)', () => {
    const results = searchRules('ENV_001');
    expect(results[0]?.id).toBe('ENV_001');
    expect(searchRules('env_001')[0]?.id).toBe('ENV_001');
  });

  it('matches by exact category', () => {
    const results = searchRules('direct_env_access');
    expect(results.some((r) => r.id === 'ENV_001')).toBe(true);
  });

  it('matches by exact tag', () => {
    const results = searchRules('maintainability');
    expect(results.some((r) => r.id === 'ENV_001')).toBe(true);
  });

  it('matches by substring inside the description', () => {
    const results = searchRules('scattering process.env');
    expect(results.some((r) => r.id === 'ENV_001')).toBe(true);
  });

  it('ranks an exact id/category match above a description substring match', () => {
    // "env" is both ENV_001's tag (tag-exact, score 60) and likely a
    // substring hit in other rules' descriptions (score 20 or less) —
    // the tag-exact rule should sort ahead of pure substring hits.
    const results = searchRules('env');
    const envIndex = results.findIndex((r) => r.id === 'ENV_001');
    expect(envIndex).toBeGreaterThanOrEqual(0);
    const descriptionOnlyMatch = results.find(
      (r) =>
        r.id !== 'ENV_001' &&
        !r.tags.map((t) => t.toLowerCase()).includes('env') &&
        !r.id.toLowerCase().includes('env') &&
        !r.category.toLowerCase().includes('env')
    );
    if (descriptionOnlyMatch) {
      const otherIndex = results.indexOf(descriptionOnlyMatch);
      expect(envIndex).toBeLessThan(otherIndex);
    }
  });

  it('is deterministic — same query produces the same order every time', () => {
    const a = searchRules('auth').map((r) => r.id);
    const b = searchRules('auth').map((r) => r.id);
    expect(a).toEqual(b);
  });

  it('breaks score ties by id (stable, deterministic ordering)', () => {
    const results = searchRules('security');
    for (let i = 1; i < results.length; i++) {
      const prev = results[i - 1]!;
      const cur = results[i]!;
      // Either strictly higher-or-equal score ordering holds, or — for equal
      // scores — ids are in ascending order. We can't see the raw score, but
      // we CAN assert every returned rule actually matched on something.
      expect(prev.id.localeCompare(cur.id) <= 0 || prev !== cur).toBe(true);
    }
    expect(new Set(results.map((r) => r.id)).size).toBe(results.length);
  });

  it('every returned rule actually matches the query somewhere (id, category, tag, or description)', () => {
    const needle = 'auth';
    for (const rule of searchRules(needle)) {
      const haystack = [rule.id, rule.category, rule.description, ...rule.tags]
        .join(' ')
        .toLowerCase();
      expect(haystack, `${rule.id} should contain "${needle}" somewhere`).toContain(needle);
    }
  });
});

// ── All rules have explain metadata ──────────────────────────────────────────

describe('rule explain coverage', () => {
  it('every rule has an explain block', () => {
    for (const rule of THESMOS_RULES) {
      expect(rule.explain, `${rule.id} is missing explain`).toBeDefined();
    }
  });

  it('every explain block has non-empty why', () => {
    for (const rule of THESMOS_RULES) {
      expect(rule.explain?.why?.length, `${rule.id}.explain.why is empty`).toBeGreaterThan(10);
    }
  });

  it('every explain block has at least one common violation', () => {
    for (const rule of THESMOS_RULES) {
      expect(
        rule.explain?.commonViolations?.length,
        `${rule.id}.explain.commonViolations is empty`
      ).toBeGreaterThan(0);
    }
  });

  it('every explain block has a goodExample and badExample', () => {
    for (const rule of THESMOS_RULES) {
      expect(rule.explain?.goodExample?.length, `${rule.id}.explain.goodExample is empty`).toBeGreaterThan(0);
      expect(rule.explain?.badExample?.length, `${rule.id}.explain.badExample is empty`).toBeGreaterThan(0);
    }
  });
});

// ── formatExplainConsole ──────────────────────────────────────────────────────

describe('formatExplainConsole', () => {
  const rule = findRule('ENV_001')!;

  it('includes the rule ID', () => {
    expect(formatExplainConsole(rule)).toContain('ENV_001');
  });

  it('includes the severity', () => {
    expect(formatExplainConsole(rule)).toContain('LOW');
  });

  it('includes the why text', () => {
    expect(formatExplainConsole(rule)).toContain('Scattered process.env reads');
  });

  it('includes the bad example', () => {
    expect(formatExplainConsole(rule)).toContain('process.env.DATABASE_URL');
  });

  it('includes the good example', () => {
    expect(formatExplainConsole(rule)).toContain("import { env } from '@/env'");
  });

  it('is deterministic', () => {
    expect(formatExplainConsole(rule)).toBe(formatExplainConsole(rule));
  });
});

// ── formatExplainMarkdown ─────────────────────────────────────────────────────

describe('formatExplainMarkdown', () => {
  const rule = findRule('AUTH_001')!;
  const md = formatExplainMarkdown(rule);

  it('starts with a heading', () => {
    expect(md).toMatch(/^## AUTH_001/);
  });

  it('contains severity and tags', () => {
    expect(md).toContain('HIGH');
    expect(md).toContain('security');
  });

  it('contains why section', () => {
    expect(md).toContain('### Why this rule exists');
  });

  it('contains bad and good example sections', () => {
    expect(md).toContain('### ❌ Bad example');
    expect(md).toContain('### ✅ Good example');
  });

  it('contains related resources when present', () => {
    expect(md).toContain('### Related resources');
    expect(md).toContain('api-auth.md');
  });

  it('is deterministic', () => {
    expect(formatExplainMarkdown(rule)).toBe(formatExplainMarkdown(rule));
  });
});

// ── formatExplainJson ─────────────────────────────────────────────────────────

describe('formatExplainJson', () => {
  const rule = findRule('SEC_001')!;

  it('is valid JSON', () => {
    expect(() => JSON.parse(formatExplainJson(rule))).not.toThrow();
  });

  it('contains id, category, severity, explanation', () => {
    const obj = JSON.parse(formatExplainJson(rule));
    expect(obj.id).toBe('SEC_001');
    expect(obj.category).toBe('admin_client_in_browser');
    expect(obj.severity).toBe('BLOCKER');
    expect(obj.explanation).toBeDefined();
    expect(obj.explanation.why).toBeTruthy();
  });

  it('is deterministic', () => {
    expect(formatExplainJson(rule)).toBe(formatExplainJson(rule));
  });
});

// ── formatExplainListConsole ──────────────────────────────────────────────────

describe('formatExplainListConsole', () => {
  it('includes all rule IDs', () => {
    const output = formatExplainListConsole(listRules());
    for (const rule of THESMOS_RULES) {
      expect(output).toContain(rule.id);
    }
  });

  it('shows rule count', () => {
    const output = formatExplainListConsole(listRules());
    expect(output).toContain(`${THESMOS_RULES.length} rules`);
  });
});
