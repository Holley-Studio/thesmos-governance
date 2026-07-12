import { describe, it, expect } from 'vitest';
import {
  findRule,
  findRulesForFile,
  findRuleForFingerprint,
  listRules,
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
