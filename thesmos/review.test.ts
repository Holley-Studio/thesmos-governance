// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS } from './config';
import {
  runReview,
  formatFindingsMarkdown,
  formatFindingsJson,
  type ChangedFile,
  type ReviewInput,
} from './review';
import type { ScanResult } from './types';

// ── Test fixtures ──────────────────────────────────────────────────────────────

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function makeInput(
  overrides: Partial<ReviewInput> = {},
  changedFiles: ChangedFile[] = []
): ReviewInput {
  return {
    scan: EMPTY_SCAN,
    config: CONFIG_DEFAULTS,
    changedFiles,
    root: '/tmp', // hermetic: no .claude or .thesmos here, prevents filesystem-dependent rules from firing
    ...overrides,
  };
}

// ── runReview — returns empty for clean input ─────────────────────────────────

describe('runReview — clean input', () => {
  it('returns empty findings when no changed files and no issues in scan', () => {
    expect(runReview(makeInput())).toHaveLength(0);
  });

  it('returns sorted findings by severity then file', () => {
    const input = makeInput(
      {
        scan: {
          ...EMPTY_SCAN,
          largeFiles: [{ file: 'z.ts', lines: 500 }, { file: 'a.ts', lines: 600 }],
          apiRoutes: [
            { path: '/api/users', file: 'app/api/users/route.ts', methods: ['POST'], auth: false, desc: '' },
          ],
        },
      },
      []
    );
    const findings = runReview(input);
    // HIGH (missing_api_auth) should come before TECH_DEBT (large_file)
    expect(findings[0].severity).toBe('HIGH');
    expect(findings[findings.length - 1].severity).toBe('TECH_DEBT');
  });
});

// ── direct_env_access ─────────────────────────────────────────────────────────

describe('direct_env_access check', () => {
  it('flags process.env.VAR in source files', () => {
    const files: ChangedFile[] = [
      { path: 'lib/config.ts', content: 'const url = process.env.DATABASE_URL;' },
    ];
    const findings = runReview(makeInput({}, files));
    const match = findings.find((f) => f.category === 'direct_env_access');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('BLOCKER');
    expect(match!.line).toBe(1);
    expect(match!.file).toBe('lib/config.ts');
  });

  it('does not flag scripts/ files', () => {
    const files: ChangedFile[] = [
      { path: 'scripts/seed.ts', content: 'const url = process.env.DATABASE_URL;' },
    ];
    const findings = runReview(makeInput({}, files));
    expect(findings.filter((f) => f.category === 'direct_env_access')).toHaveLength(0);
  });

  it('reports line numbers', () => {
    const content = 'const a = 1;\nconst b = process.env.SECRET;\nconst c = 3;';
    const findings = runReview(makeInput({}, [{ path: 'lib/x.ts', content }]));
    const match = findings.find((f) => f.category === 'direct_env_access');
    expect(match!.line).toBe(2);
  });

  it('includes a suggestion referencing the variable name', () => {
    const files: ChangedFile[] = [
      { path: 'lib/config.ts', content: 'process.env.MY_KEY' },
    ];
    const findings = runReview(makeInput({}, files));
    expect(findings[0].suggestion).toContain('MY_KEY');
  });
});

// ── admin_client_in_browser ───────────────────────────────────────────────────

describe('admin_client_in_browser check', () => {
  it('flags admin client import inside use-client component', () => {
    const content = `'use client'\nimport { adminClient } from 'lib/supabase/admin';`;
    const findings = runReview(makeInput({}, [{ path: 'components/Bad.tsx', content }]));
    const match = findings.find((f) => f.category === 'admin_client_in_browser');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('BLOCKER');
  });

  it('does not flag admin import in server-only file', () => {
    const content = `import { adminClient } from 'lib/supabase/admin';`;
    const findings = runReview(makeInput({}, [{ path: 'lib/admin.ts', content }]));
    expect(findings.filter((f) => f.category === 'admin_client_in_browser')).toHaveLength(0);
  });
});

// ── missing_api_auth ──────────────────────────────────────────────────────────

describe('missing_api_auth check', () => {
  it('flags POST route without auth', () => {
    const scan: ScanResult = {
      ...EMPTY_SCAN,
      apiRoutes: [
        { path: '/api/items', file: 'app/api/items/route.ts', methods: ['GET', 'POST'], auth: false, desc: '' },
      ],
    };
    const findings = runReview(makeInput({ scan }));
    const match = findings.find((f) => f.category === 'missing_api_auth');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('HIGH');
    expect(match!.file).toBe('app/api/items/route.ts');
  });

  it('does not flag GET-only routes even without auth', () => {
    const scan: ScanResult = {
      ...EMPTY_SCAN,
      apiRoutes: [
        { path: '/api/public', file: 'app/api/public/route.ts', methods: ['GET'], auth: false, desc: '' },
      ],
    };
    const findings = runReview(makeInput({ scan }));
    expect(findings.filter((f) => f.category === 'missing_api_auth')).toHaveLength(0);
  });

  it('does not flag authenticated POST routes', () => {
    const scan: ScanResult = {
      ...EMPTY_SCAN,
      apiRoutes: [
        { path: '/api/secure', file: 'app/api/secure/route.ts', methods: ['POST'], auth: true, desc: '' },
      ],
    };
    const findings = runReview(makeInput({ scan }));
    expect(findings.filter((f) => f.category === 'missing_api_auth')).toHaveLength(0);
  });

  it('includes the route path in the finding message', () => {
    const scan: ScanResult = {
      ...EMPTY_SCAN,
      apiRoutes: [
        { path: '/api/users', file: 'app/api/users/route.ts', methods: ['DELETE'], auth: false, desc: '' },
      ],
    };
    const findings = runReview(makeInput({ scan }));
    expect(findings[0].message).toContain('/api/users');
  });
});

// ── rls_disabled ──────────────────────────────────────────────────────────────

describe('rls_disabled check', () => {
  it('flags SQL files that disable RLS', () => {
    const content = 'ALTER TABLE users DISABLE ROW LEVEL SECURITY;';
    const findings = runReview(makeInput({}, [{ path: 'migrations/001.sql', content }]));
    const match = findings.find((f) => f.category === 'rls_disabled');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('BLOCKER');
  });

  it('does not flag non-SQL files', () => {
    const content = 'DISABLE ROW LEVEL SECURITY;';
    const findings = runReview(makeInput({}, [{ path: 'lib/db.ts', content }]));
    expect(findings.filter((f) => f.category === 'rls_disabled')).toHaveLength(0);
  });
});

// ── secret_in_diff ────────────────────────────────────────────────────────────

describe('secret_in_diff check', () => {
  it('flags OpenAI-style key in content', () => {
    const content = 'const key = "sk-proj-abc123def456ghi789jklmno";';
    const findings = runReview(makeInput({}, [{ path: 'lib/ai.ts', content }]));
    const match = findings.find((f) => f.category === 'secret_in_diff');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('BLOCKER');
  });

  it('scans diff content when diff is provided', () => {
    const diff = '+const key = "sk-proj-abc123def456ghi789jklmno";';
    const findings = runReview(
      makeInput({}, [{ path: 'lib/ai.ts', content: '', diff }])
    );
    expect(findings.find((f) => f.category === 'secret_in_diff')).toBeDefined();
  });

  it('does not flag clean files', () => {
    const findings = runReview(
      makeInput({}, [{ path: 'lib/clean.ts', content: 'const name = "hello";' }])
    );
    expect(findings.filter((f) => f.category === 'secret_in_diff')).toHaveLength(0);
  });
});

// ── console_log ───────────────────────────────────────────────────────────────

describe('console_log check', () => {
  it('flags console.log in source files', () => {
    const content = 'function doStuff() { console.log("debug"); }';
    const findings = runReview(makeInput({}, [{ path: 'lib/stuff.ts', content }]));
    const match = findings.find((f) => f.category === 'console_log');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('LOW');
  });

  it('flags console.warn and console.error', () => {
    const content = 'console.warn("warn");\nconsole.error("err");';
    const findings = runReview(makeInput({}, [{ path: 'lib/x.ts', content }]));
    expect(findings.filter((f) => f.category === 'console_log')).toHaveLength(2);
  });

  it('does not flag console.log in test files', () => {
    const content = 'console.log("test output");';
    const findings = runReview(makeInput({}, [{ path: 'lib/x.test.ts', content }]));
    expect(findings.filter((f) => f.category === 'console_log')).toHaveLength(0);
  });
});

// ── large_file ────────────────────────────────────────────────────────────────

describe('large_file check', () => {
  it('flags files from scan.largeFiles', () => {
    const scan: ScanResult = {
      ...EMPTY_SCAN,
      largeFiles: [{ file: 'lib/big.ts', lines: 500 }],
    };
    const findings = runReview(makeInput({ scan }));
    const match = findings.find((f) => f.category === 'large_file');
    expect(match).toBeDefined();
    expect(match!.file).toBe('lib/big.ts');
    expect(match!.message).toContain('500');
    expect(match!.severity).toBe('TECH_DEBT');
  });

  it('returns no large_file findings when scan has none', () => {
    const findings = runReview(makeInput());
    expect(findings.filter((f) => f.category === 'large_file')).toHaveLength(0);
  });
});

// ── missing_test_for_risky_change ─────────────────────────────────────────────

describe('missing_test_for_risky_change check', () => {
  const configWithRisky = {
    ...CONFIG_DEFAULTS,
    scan: { riskyFilePatterns: ['migrations/'] },
  };

  it('flags risky files changed without test files', () => {
    const files: ChangedFile[] = [
      { path: 'migrations/001.sql', content: '' },
    ];
    const findings = runReview(makeInput({ config: configWithRisky }, files));
    const match = findings.find((f) => f.category === 'missing_test_for_risky_change');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('MEDIUM');
  });

  it('does not flag when test files are also changed', () => {
    const files: ChangedFile[] = [
      { path: 'migrations/001.sql', content: '' },
      { path: 'migrations/001.test.ts', content: '' },
    ];
    const findings = runReview(makeInput({ config: configWithRisky }, files));
    expect(findings.filter((f) => f.category === 'missing_test_for_risky_change')).toHaveLength(0);
  });

  it('returns nothing when no risky patterns configured', () => {
    const files: ChangedFile[] = [{ path: 'migrations/001.sql', content: '' }];
    const findings = runReview(makeInput({}, files));
    expect(findings.filter((f) => f.category === 'missing_test_for_risky_change')).toHaveLength(0);
  });
});

// ── design_system_bypass ──────────────────────────────────────────────────────

describe('design_system_bypass check', () => {
  it('flags hardcoded hex colour in component file', () => {
    const content = 'const style = { color: "#ff0000" };';
    const findings = runReview(makeInput({}, [{ path: 'components/Box.tsx', content }]));
    const match = findings.find((f) => f.category === 'design_system_bypass');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('LOW');
  });

  it('does not flag colours in design-system files', () => {
    const scan: ScanResult = { ...EMPTY_SCAN, designSystemFiles: ['tokens/colors.ts'] };
    const content = 'export const red = "#ff0000";';
    const findings = runReview(
      makeInput({ scan }, [{ path: 'tokens/colors.ts', content }])
    );
    expect(findings.filter((f) => f.category === 'design_system_bypass')).toHaveLength(0);
  });

  it('does not flag colour in comment lines', () => {
    const content = '// background: #ff0000 was the old color';
    const findings = runReview(makeInput({}, [{ path: 'components/Box.tsx', content }]));
    expect(findings.filter((f) => f.category === 'design_system_bypass')).toHaveLength(0);
  });

  it('does not flag non-source files', () => {
    const content = 'background: #ff0000';
    const findings = runReview(makeInput({}, [{ path: 'README.md', content }]));
    expect(findings.filter((f) => f.category === 'design_system_bypass')).toHaveLength(0);
  });
});

// ── duplicate_component_pattern ───────────────────────────────────────────────

describe('duplicate_component_pattern check', () => {
  it('flags a component that duplicates a shared UI component name', () => {
    const scan: ScanResult = {
      ...EMPTY_SCAN,
      sharedUiFiles: ['components/ui/Button.tsx'],
    };
    const files: ChangedFile[] = [{ path: 'components/Button.tsx', content: '' }];
    const findings = runReview(makeInput({ scan }, files));
    const match = findings.find((f) => f.category === 'duplicate_component_pattern');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('TECH_DEBT');
    expect(match!.message).toContain('button');
  });

  it('does not flag components/ui/ files (they are shared UI)', () => {
    const scan: ScanResult = {
      ...EMPTY_SCAN,
      sharedUiFiles: ['components/ui/Button.tsx'],
    };
    const files: ChangedFile[] = [{ path: 'components/ui/Button.tsx', content: '' }];
    const findings = runReview(makeInput({ scan }, files));
    expect(findings.filter((f) => f.category === 'duplicate_component_pattern')).toHaveLength(0);
  });

  it('does not flag when no shared UI files exist', () => {
    const files: ChangedFile[] = [{ path: 'components/Button.tsx', content: '' }];
    const findings = runReview(makeInput({}, files));
    expect(findings.filter((f) => f.category === 'duplicate_component_pattern')).toHaveLength(0);
  });
});

// ── any_type_no_comment ───────────────────────────────────────────────────────

describe('any_type_no_comment check', () => {
  it('flags `: any` without inline comment in TypeScript files', () => {
    const content = 'function foo(x: any) { return x; }';
    const findings = runReview(makeInput({}, [{ path: 'lib/foo.ts', content }]));
    const match = findings.find((f) => f.category === 'any_type_no_comment');
    expect(match).toBeDefined();
    expect(match!.severity).toBe('MEDIUM');
  });

  it('flags `as any` without inline comment', () => {
    const content = 'const val = data as any;';
    const findings = runReview(makeInput({}, [{ path: 'lib/foo.ts', content }]));
    expect(findings.filter((f) => f.category === 'any_type_no_comment')).toHaveLength(1);
  });

  it('does not flag `: any` when there is an inline comment', () => {
    const content = 'function foo(x: any) { return x; } // legacy API shape, cannot type safely';
    const findings = runReview(makeInput({}, [{ path: 'lib/foo.ts', content }]));
    expect(findings.filter((f) => f.category === 'any_type_no_comment')).toHaveLength(0);
  });

  it('does not flag JavaScript files', () => {
    const content = 'function foo(x: any) {}';
    const findings = runReview(makeInput({}, [{ path: 'lib/foo.js', content }]));
    expect(findings.filter((f) => f.category === 'any_type_no_comment')).toHaveLength(0);
  });
});

// ── formatFindingsMarkdown ────────────────────────────────────────────────────

describe('formatFindingsMarkdown', () => {
  it('returns a no-findings message when findings is empty', () => {
    expect(formatFindingsMarkdown([])).toContain('No Findings');
  });

  it('includes a markdown table with severity column', () => {
    const input = makeInput(
      { scan: { ...EMPTY_SCAN, largeFiles: [{ file: 'lib/big.ts', lines: 500 }] } },
      []
    );
    const findings = runReview(input);
    const md = formatFindingsMarkdown(findings);
    expect(md).toContain('| Severity |');
    expect(md).toContain('TECH_DEBT');
    expect(md).toContain('large_file');
  });

  it('includes total finding count', () => {
    const input = makeInput(
      { scan: { ...EMPTY_SCAN, largeFiles: [{ file: 'lib/big.ts', lines: 500 }, { file: 'lib/other.ts', lines: 600 }] } },
      []
    );
    const findings = runReview(input);
    const md = formatFindingsMarkdown(findings);
    expect(md).toContain('2 findings');
  });
});

// ── formatFindingsJson ────────────────────────────────────────────────────────

describe('formatFindingsJson', () => {
  it('returns valid JSON', () => {
    expect(() => JSON.parse(formatFindingsJson([]))).not.toThrow();
  });

  it('includes a total field', () => {
    const json = JSON.parse(formatFindingsJson([])) as { total: number };
    expect(json.total).toBe(0);
  });

  it('includes all findings in the findings array', () => {
    const input = makeInput(
      { scan: { ...EMPTY_SCAN, largeFiles: [{ file: 'big.ts', lines: 500 }] } },
      []
    );
    const findings = runReview(input);
    const json = JSON.parse(formatFindingsJson(findings)) as { total: number; findings: unknown[] };
    expect(json.total).toBe(1);
    expect(json.findings).toHaveLength(1);
  });
});

// ── runReview — inline suppression wiring ─────────────────────────────────────

describe('runReview — inline suppressions', () => {
  it('filters a finding when a thesmos-disable-next-line comment precedes the violation', () => {
    const files: ChangedFile[] = [{
      path: 'lib/config.ts',
      content: [
        '// thesmos-disable-next-line direct_env_access -- reason: test fixture -- owner: @test',
        'const url = process.env.DATABASE_URL;',
      ].join('\n'),
    }];
    const findings = runReview(makeInput({}, files));
    expect(findings.filter((f) => f.category === 'direct_env_access')).toHaveLength(0);
  });

  it('keeps the finding when no suppression comment is present', () => {
    const files: ChangedFile[] = [{
      path: 'lib/config.ts',
      content: 'const url = process.env.DATABASE_URL;',
    }];
    const findings = runReview(makeInput({}, files));
    expect(findings.filter((f) => f.category === 'direct_env_access').length).toBeGreaterThan(0);
  });

  it('suppresses two different rules on one line via stacked comments', () => {
    const files: ChangedFile[] = [{
      path: 'scripts/pack.ts',
      content: [
        'import { execSync } from "node:child_process";',
        '// thesmos-disable-next-line shell_injection -- reason: static build constants -- owner: @test',
        '// thesmos-disable-next-line child_process_shell_injection -- reason: static build constants -- owner: @test',
        'execSync(`cd "${dir}" && zip -r "${zipPath}" "${name}"`, { stdio: "pipe" });',
      ].join('\n'),
    }];
    const findings = runReview(makeInput({}, files));
    expect(findings.filter((f) => f.category === 'shell_injection')).toHaveLength(0);
    expect(findings.filter((f) => f.category === 'child_process_shell_injection')).toHaveLength(0);
  });

  it('does not apply an expired suppression', () => {
    const files: ChangedFile[] = [{
      path: 'lib/config.ts',
      content: [
        '// thesmos-disable-next-line direct_env_access -- reason: expired -- expires: 2020-01-01',
        'const url = process.env.DATABASE_URL;',
      ].join('\n'),
    }];
    const findings = runReview(makeInput({}, files));
    expect(findings.filter((f) => f.category === 'direct_env_access').length).toBeGreaterThan(0);
  });
});

// ── shell-injection rules — test-fixture paths are exempt ─────────────────────

describe('shell_injection rules skip test fixture paths', () => {
  const EXEC_CONTENT = 'execSync(`cd "${dir}" && zip -r "${zipPath}" "${name}"`, { stdio: "pipe" });';

  it('SEC_016/NODE_005 do NOT fire on the same content in a .test.ts path', () => {
    const findings = runReview(makeInput({}, [
      { path: 'scripts/pack.test.ts', content: EXEC_CONTENT },
    ]));
    expect(findings.filter((f) => f.category === 'shell_injection')).toHaveLength(0);
    expect(findings.filter((f) => f.category === 'child_process_shell_injection')).toHaveLength(0);
  });

  it('SEC_016/NODE_005 still fire on a production .ts path', () => {
    const findings = runReview(makeInput({}, [
      { path: 'scripts/pack.ts', content: EXEC_CONTENT },
    ]));
    expect(findings.filter((f) => f.category === 'shell_injection').length).toBeGreaterThan(0);
    expect(findings.filter((f) => f.category === 'child_process_shell_injection').length).toBeGreaterThan(0);
  });
});
