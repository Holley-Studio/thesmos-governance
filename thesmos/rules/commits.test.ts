// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { COMMIT_RULES } from './commits.js';
import type { DetectInput, Finding } from '../types.js';

const COMMIT_EDITMSG = '.git/COMMIT_EDITMSG';

const CONFIG = {
  preset: 'base', rules: [], severityRules: [], ignorePatterns: [], baseline: null,
} as unknown as DetectInput['config'];

const EMPTY_SCAN = {
  _generatedSections: [], generatedAt: '', scanVersion: '0',
  pages: [], apiRoutes: [], componentCount: 0, sharedUiFiles: [],
  designSystemFiles: [], storeFiles: [], testFiles: [], largeFiles: [],
  riskyFiles: [], scriptFiles: [], envFiles: [], clientBoundaryRisks: [],
  languages: [], detectedStacks: [],
} as DetectInput['scan'];

function detect(ruleId: string, message: string, configOverride?: Partial<DetectInput['config']>): Finding[] {
  const rule = COMMIT_RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  return rule.detect({
    scan: EMPTY_SCAN,
    config: { ...CONFIG, ...configOverride },
    changedFiles: [{ path: COMMIT_EDITMSG, content: message }],
  });
}

function detectNone(ruleId: string): Finding[] {
  const rule = COMMIT_RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  return rule.detect({ scan: EMPTY_SCAN, config: CONFIG, changedFiles: [] });
}

function detectOtherFile(ruleId: string, message: string): Finding[] {
  const rule = COMMIT_RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  return rule.detect({
    scan: EMPTY_SCAN,
    config: CONFIG,
    changedFiles: [{ path: 'src/index.ts', content: message }],
  });
}

// ── COMMIT_001 — invalid format ────────────────────────────────────────────────

describe('COMMIT_001 — commit_invalid_format', () => {
  it('fires when first line has no type prefix', () => {
    const findings = detect('COMMIT_001', 'Added login page');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('commit_invalid_format');
  });

  it('fires on "fix login" (missing colon and space)', () => {
    const findings = detect('COMMIT_001', 'fix login page');
    expect(findings).toHaveLength(1);
  });

  it('fires on "Feature: added auth" (uppercase type)', () => {
    const findings = detect('COMMIT_001', 'Feature: added auth');
    expect(findings).toHaveLength(1);
  });

  it('does NOT fire on valid format', () => {
    expect(detect('COMMIT_001', 'feat(auth): add login redirect')).toHaveLength(0);
    expect(detect('COMMIT_001', 'fix: handle null session')).toHaveLength(0);
    expect(detect('COMMIT_001', 'chore!: remove deprecated endpoint')).toHaveLength(0);
  });

  it('does NOT fire on valid format with scope', () => {
    expect(detect('COMMIT_001', 'refactor(user-service): simplify session handling')).toHaveLength(0);
  });

  it('ignores git comment lines (lines starting with #)', () => {
    const msg = 'feat: add login\n# This is a git comment line\n# Please enter the commit message';
    expect(detect('COMMIT_001', msg)).toHaveLength(0);
  });

  it('does not fire when changedFiles is empty', () => {
    expect(detectNone('COMMIT_001')).toHaveLength(0);
  });

  it('does not fire for non-COMMIT_EDITMSG paths', () => {
    expect(detectOtherFile('COMMIT_001', 'invalid message')).toHaveLength(0);
  });
});

// ── COMMIT_002 — unknown type ──────────────────────────────────────────────────

describe('COMMIT_002 — commit_unknown_type', () => {
  it('fires on unknown type "update:"', () => {
    const findings = detect('COMMIT_002', 'update: improve performance');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('update');
  });

  it('fires on "change: refactor auth"', () => {
    expect(detect('COMMIT_002', 'change: refactor auth')).toHaveLength(1);
  });

  it('fires on "added: new user model"', () => {
    expect(detect('COMMIT_002', 'added: new user model')).toHaveLength(1);
  });

  it('does NOT fire on valid types', () => {
    for (const t of ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore', 'ci', 'build', 'revert']) {
      expect(detect('COMMIT_002', `${t}: some change`)).toHaveLength(0);
    }
  });

  it('respects custom types from commitLint config', () => {
    const findings = detect('COMMIT_002', 'wip: half done', {
      commitLint: { types: ['wip', 'feat', 'fix'] },
    } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when message is not valid conventional format', () => {
    // COMMIT_001 fires, COMMIT_002 should skip (no valid type to check)
    expect(detect('COMMIT_002', 'not a conventional commit at all')).toHaveLength(0);
  });
});

// ── COMMIT_003 — subject too long ─────────────────────────────────────────────

describe('COMMIT_003 — commit_subject_too_long', () => {
  it('fires MEDIUM when subject exceeds 72 chars', () => {
    const long = 'feat(auth): add the new OAuth2 PKCE flow that is needed for mobile clients because they cannot use implicit flow';
    const findings = detect('COMMIT_003', long);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('MEDIUM');
    expect(findings[0]!.message).toContain('characters');
  });

  it('does NOT fire when exactly 72 chars', () => {
    // "feat: " = 6 chars, need 66 more to hit exactly 72
    const subject = 'a'.repeat(66);
    expect(detect('COMMIT_003', `feat: ${subject}`)).toHaveLength(0);
  });

  it('does NOT fire on short subjects', () => {
    expect(detect('COMMIT_003', 'fix: handle null session')).toHaveLength(0);
  });

  it('respects custom maxSubjectLength from commitLint config', () => {
    const msg = 'feat: add login'; // 15 chars
    const findings = detect('COMMIT_003', msg, {
      commitLint: { maxSubjectLength: 10 },
    } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(1);
  });
});

// ── COMMIT_004 — subject ends with period ─────────────────────────────────────

describe('COMMIT_004 — commit_subject_ends_period', () => {
  it('fires when subject ends with period', () => {
    const findings = detect('COMMIT_004', 'feat(auth): add login page.');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('commit_subject_ends_period');
  });

  it('does NOT fire when no trailing period', () => {
    expect(detect('COMMIT_004', 'feat(auth): add login page')).toHaveLength(0);
  });

  it('does NOT fire on invalid-format messages (no subject to check)', () => {
    expect(detect('COMMIT_004', 'not a conventional commit')).toHaveLength(0);
  });
});

// ── COMMIT_005 — subject starts uppercase ─────────────────────────────────────

describe('COMMIT_005 — commit_subject_starts_uppercase', () => {
  it('fires when subject starts with uppercase', () => {
    const findings = detect('COMMIT_005', 'feat(auth): Add login redirect');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('"A"');
  });

  it('fires on past-tense uppercase: "Added login"', () => {
    expect(detect('COMMIT_005', 'feat: Added login')).toHaveLength(1);
  });

  it('does NOT fire when subject starts lowercase', () => {
    expect(detect('COMMIT_005', 'feat(auth): add login redirect')).toHaveLength(0);
  });

  it('does NOT fire on numbers or special chars at start', () => {
    expect(detect('COMMIT_005', 'fix: 404 page not found handling')).toHaveLength(0);
  });
});

// ── COMMIT_006 — WIP message ───────────────────────────────────────────────────

describe('COMMIT_006 — commit_wip_message', () => {
  it('fires on "WIP: adding feature"', () => {
    const findings = detect('COMMIT_006', 'WIP: adding new feature');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('commit_wip_message');
  });

  it('fires on "[WIP] auth refactor"', () => {
    expect(detect('COMMIT_006', '[WIP] auth refactor')).toHaveLength(1);
  });

  it('fires on "wip: half done" (lowercase)', () => {
    expect(detect('COMMIT_006', 'wip: half done')).toHaveLength(1);
  });

  it('does NOT fire on valid conventional commits', () => {
    expect(detect('COMMIT_006', 'feat(auth): add login')).toHaveLength(0);
    expect(detect('COMMIT_006', 'fix: resolve WIPRO payment issue')).toHaveLength(0);
  });
});

// ── COMMIT_007 — scope uppercase ──────────────────────────────────────────────

describe('COMMIT_007 — commit_scope_uppercase', () => {
  it('fires when scope has uppercase', () => {
    const findings = detect('COMMIT_007', 'feat(Auth): add login');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('commit_scope_uppercase');
  });

  it('fires when scope has spaces', () => {
    const findings = detect('COMMIT_007', 'fix(User Service): handle null');
    expect(findings).toHaveLength(1);
  });

  it('does NOT fire on valid kebab-case scope', () => {
    expect(detect('COMMIT_007', 'feat(auth-flow): add login')).toHaveLength(0);
    expect(detect('COMMIT_007', 'fix(user-service): handle null')).toHaveLength(0);
  });

  it('does NOT fire when no scope', () => {
    expect(detect('COMMIT_007', 'feat: add login')).toHaveLength(0);
  });
});

// ── COMMIT_008 — breaking no footer ───────────────────────────────────────────

describe('COMMIT_008 — commit_breaking_no_footer', () => {
  it('fires when ! used but no BREAKING CHANGE footer', () => {
    const findings = detect('COMMIT_008', 'feat(api)!: remove deprecated endpoint');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('commit_breaking_no_footer');
  });

  it('does NOT fire when BREAKING CHANGE footer is present', () => {
    const msg = 'feat(api)!: remove /v1/users endpoint\n\nBREAKING CHANGE: The /v1/users endpoint is removed.';
    expect(detect('COMMIT_008', msg)).toHaveLength(0);
  });

  it('does NOT fire on non-breaking commits', () => {
    expect(detect('COMMIT_008', 'feat(auth): add login')).toHaveLength(0);
    expect(detect('COMMIT_008', 'fix: resolve session bug')).toHaveLength(0);
  });
});

// ── COMMIT_009 — no ticket ref ────────────────────────────────────────────────

describe('COMMIT_009 — commit_no_ticket_ref', () => {
  it('does NOT fire when requireTicket is false (default)', () => {
    expect(detect('COMMIT_009', 'feat: add login with no ticket')).toHaveLength(0);
  });

  it('fires MEDIUM when requireTicket is true and no ticket found', () => {
    const findings = detect('COMMIT_009', 'feat(auth): add login redirect', {
      commitLint: { requireTicket: true },
    } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('does NOT fire when ticket ref JIRA-1234 is in body', () => {
    const msg = 'feat(auth): add login\n\nCloses JIRA-1234';
    const findings = detect('COMMIT_009', msg, {
      commitLint: { requireTicket: true },
    } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when #42 style ref found', () => {
    const msg = 'fix: handle null session\n\nFixes #42';
    const findings = detect('COMMIT_009', msg, {
      commitLint: { requireTicket: true },
    } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(0);
  });

  it('respects custom ticketPattern', () => {
    const msg = 'feat: add login\n\nRefs PROJ-999';
    const findings = detect('COMMIT_009', msg, {
      commitLint: { requireTicket: true, ticketPattern: 'PROJ-\\d+' },
    } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(0);
  });
});

// ── COMMIT_010 — raw merge commit ─────────────────────────────────────────────

describe('COMMIT_010 — commit_merge_commit_raw', () => {
  it("fires on \"Merge branch 'feature/auth' into 'main'\"", () => {
    const findings = detect('COMMIT_010', "Merge branch 'feature/auth' into 'main'");
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('commit_merge_commit_raw');
  });

  it('does NOT fire on conventional merge description', () => {
    expect(detect('COMMIT_010', 'feat(auth): add OAuth flow (squash-merged from feature/auth)')).toHaveLength(0);
  });

  it('does NOT fire on normal commits', () => {
    expect(detect('COMMIT_010', 'fix: handle null session')).toHaveLength(0);
  });
});

// ── Cross-rule: valid message fires nothing ────────────────────────────────────

describe('All COMMIT rules — valid messages fire nothing', () => {
  const VALID_MESSAGES = [
    'feat(auth): add login redirect',
    'fix: handle null session on reload',
    'docs(readme): update installation steps',
    'refactor(user-service): simplify session handling',
    'chore: bump dependencies',
    'ci: add GitHub Actions lint step',
    'perf(db): add index on user_id for faster queries',
    'test(auth): add unit tests for session expiry',
  ];

  for (const msg of VALID_MESSAGES) {
    it(`no rule fires for: "${msg}"`, () => {
      for (const rule of COMMIT_RULES) {
        const findings = rule.detect({
          scan: EMPTY_SCAN,
          config: CONFIG,
          changedFiles: [{ path: COMMIT_EDITMSG, content: msg }],
        });
        expect(findings, `${rule.id} unexpectedly fired for: "${msg}"`).toHaveLength(0);
      }
    });
  }
});
