// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DEBT_RULES } from './debt.js';
import type { PrometheusConfig, DetectInput } from '../types';

// Minimal config used for all detect() calls
const CONFIG: PrometheusConfig = {
  preset: 'base',
  rules: [],
  severityRules: [],
  ignorePatterns: [],
  baseline: null,
} as unknown as PrometheusConfig;

function detect(ruleId: string, changedFiles: DetectInput['changedFiles']): ReturnType<typeof DEBT_RULES[0]['detect']> {
  const rule = DEBT_RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  return rule.detect({ scan: {} as DetectInput['scan'], config: CONFIG, changedFiles });
}

function src(path: string, content: string): NonNullable<DetectInput['changedFiles']>[0] {
  return { path, content, bytes: 0, additions: content.split('\n').length, deletions: 0 };
}

// ── Rule metadata ─────────────────────────────────────────────────────────────

describe('DEBT_RULES metadata', () => {
  it('exports exactly 20 rules', () => {
    expect(DEBT_RULES).toHaveLength(20);
  });

  it('each rule has required fields', () => {
    for (const rule of DEBT_RULES) {
      expect(rule.id).toMatch(/^DEBT_0\d\d$/);
      expect(rule.category).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(['HIGH', 'MEDIUM', 'LOW']).toContain(rule.severity);
      expect(typeof rule.detect).toBe('function');
    }
  });

  it('rule IDs are unique', () => {
    const ids = DEBT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all rules have sinceVersion 1.2.0', () => {
    for (const rule of DEBT_RULES) {
      expect(rule.sinceVersion).toBe('1.2.0');
    }
  });
});

// ── DEBT_001: Duplicate function body ─────────────────────────────────────────

describe('DEBT_001 — duplicate function body', () => {
  it('returns no findings for a file with a single function', () => {
    const content = `
function doWork() {
  const x = 1;
  const y = 2;
  return x + y;
}
`;
    expect(detect('DEBT_001', [src('src/file.ts', content)])).toHaveLength(0);
  });

  it('skips test files', () => {
    const content = `
function doWork() { const x = 1; }
function doWork2() { const x = 1; }
`;
    expect(detect('DEBT_001', [src('src/file.test.ts', content)])).toHaveLength(0);
  });

  it('skips non-source files', () => {
    const content = `function a() { return 1; }\nfunction b() { return 1; }`;
    expect(detect('DEBT_001', [src('README.md', content)])).toHaveLength(0);
  });
});

// ── DEBT_002: Exported function with no test ──────────────────────────────────

describe('DEBT_002 — exported function no test', () => {
  it('flags exported function not covered by any test file', () => {
    const findings = detect('DEBT_002', [src('src/utils.ts', 'export function processUserData(x) { return x; }')]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain('processUserData');
  });

  it('does not flag if test file references the function name', () => {
    const findings = detect('DEBT_002', [
      src('src/utils.ts', 'export function processUserData(x) { return x; }'),
      src('src/utils.test.ts', 'it("works", () => processUserData(1));'),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('skips short names (< 4 chars)', () => {
    const findings = detect('DEBT_002', [src('src/utils.ts', 'export function foo(x) { return x; }')]);
    expect(findings).toHaveLength(0);
  });

  it('skips framework-pattern names', () => {
    const findings = detect('DEBT_002', [src('src/page.tsx', 'export function Page() { return null; }')]);
    expect(findings).toHaveLength(0);
  });

  it('skips test files themselves', () => {
    const findings = detect('DEBT_002', [src('src/utils.test.ts', 'export function testHelper() {}')]);
    expect(findings).toHaveLength(0);
  });
});

// ── DEBT_003: File complexity spike ──────────────────────────────────────────

describe('DEBT_003 — file complexity spike', () => {
  it('flags files > 400 lines', () => {
    const content = Array.from({ length: 401 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const findings = detect('DEBT_003', [src('src/monster.ts', content)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('401 lines');
  });

  it('does not flag files at or below 400 lines', () => {
    const content = Array.from({ length: 400 }, (_, i) => `const x${i} = ${i};`).join('\n');
    expect(detect('DEBT_003', [src('src/ok.ts', content)])).toHaveLength(0);
  });

  it('skips test files', () => {
    const content = Array.from({ length: 500 }, () => 'const x = 1;').join('\n');
    expect(detect('DEBT_003', [src('src/big.test.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_004: API endpoint no error response type ─────────────────────────────

describe('DEBT_004 — API no error response type', () => {
  it('flags route handler with no error type', () => {
    const content = `export async function GET(req: Request): Promise<User> { return getUser(); }`;
    const findings = detect('DEBT_004', [src('src/app/api/users/route.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain('GET');
  });

  it('does not flag route handler with error union type', () => {
    const content = `export async function GET(req: Request): Promise<User | ApiError> { return getUser(); }`;
    expect(detect('DEBT_004', [src('src/app/api/users/route.ts', content)])).toHaveLength(0);
  });

  it('does not flag non-API files', () => {
    const content = `export async function GET(): Promise<User> { return getUser(); }`;
    expect(detect('DEBT_004', [src('src/components/Button.tsx', content)])).toHaveLength(0);
  });
});

// ── DEBT_005: Swallowed error ─────────────────────────────────────────────────

describe('DEBT_005 — swallowed error', () => {
  it('flags empty catch block', () => {
    const findings = detect('DEBT_005', [src('src/app.ts', 'try { doThing(); } catch(e) {}')]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('debt_swallowed_error');
  });

  it('flags catch with underscore param', () => {
    const findings = detect('DEBT_005', [src('src/app.ts', 'try { doThing(); } catch(_) {}')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('flags promise swallow', () => {
    const findings = detect('DEBT_005', [src('src/app.ts', 'fetchData().catch((e) => {})')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag catch that logs the error', () => {
    const content = 'try { doThing(); } catch(e) { console.error(e); }';
    expect(detect('DEBT_005', [src('src/app.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_006: Vague variable name ─────────────────────────────────────────────

describe('DEBT_006 — vague variable name', () => {
  it('flags const result = ...', () => {
    const findings = detect('DEBT_006', [src('src/api.ts', 'const result = await fetch(url);')]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain('"result"');
  });

  it('flags const data = ...', () => {
    const findings = detect('DEBT_006', [src('src/api.ts', 'const data = response.json();')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag descriptive names', () => {
    expect(detect('DEBT_006', [src('src/api.ts', 'const user = await getUser();')])).toHaveLength(0);
  });

  it('skips test files', () => {
    const findings = detect('DEBT_006', [src('src/api.test.ts', 'const result = doThing();')]);
    expect(findings).toHaveLength(0);
  });
});

// ── DEBT_007: Commented-out block ─────────────────────────────────────────────

describe('DEBT_007 — commented-out code block', () => {
  it('flags 5+ line commented-out code', () => {
    const content = `
// const user = getUser();
// const token = user.token;
// if (!token) return null;
// const result = await fetch(url, { token });
// return result.json();
`;
    const findings = detect('DEBT_007', [src('src/auth.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag short comment runs (< 5 lines)', () => {
    const content = `
// simple comment
// another line
// third line
const x = 1;
`;
    expect(detect('DEBT_007', [src('src/auth.ts', content)])).toHaveLength(0);
  });

  it('skips JSDoc blocks (/**)', () => {
    const content = `
/**
 * @param x - the value
 * @example const r = doThing(1);
 * @returns the result
 */
function doThing(x: number) { return x; }
`;
    expect(detect('DEBT_007', [src('src/utils.ts', content)])).toHaveLength(0);
  });

  it('catches commented-out block at end of file', () => {
    const content = `const x = 1;
// const old = getUser();
// const check = old.isAdmin;
// if (check) doSomething();
// await doOtherThing(old);
// return old.id;`;
    const findings = detect('DEBT_007', [src('src/utils.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
  });
});

// ── DEBT_008: `as any` type assertion ────────────────────────────────────────

describe('DEBT_008 — type assertion as any', () => {
  it('flags `as any`', () => {
    const findings = detect('DEBT_008', [src('src/handler.ts', 'const x = response as any;')]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain('as any');
  });

  it('flags `as unknown as`', () => {
    const findings = detect('DEBT_008', [src('src/handler.ts', 'const x = data as unknown as User;')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('skips test files', () => {
    expect(detect('DEBT_008', [src('src/handler.test.ts', 'const x = mock as any;')])).toHaveLength(0);
  });

  it('skips non-TypeScript files', () => {
    expect(detect('DEBT_008', [src('src/file.js', 'const x = data as any;')])).toHaveLength(0);
  });
});

// ── DEBT_009: Hardcoded URL ───────────────────────────────────────────────────

describe('DEBT_009 — hardcoded URL', () => {
  it('flags hardcoded http URL in source', () => {
    const findings = detect('DEBT_009', [src('src/api.ts', 'fetch("http://localhost:3000/api/users")')]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('debt_hardcoded_url');
  });

  it('flags hardcoded https URL', () => {
    const findings = detect('DEBT_009', [src('src/service.ts', 'axios.get("https://api.mycompany.com/v1/data")')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag comment lines', () => {
    const content = '// See https://api.example.com/docs for reference\nconst x = 1;';
    expect(detect('DEBT_009', [src('src/api.ts', content)])).toHaveLength(0);
  });

  it('does not flag schema/documentation URLs', () => {
    const content = `const schema = "https://json-schema.org/draft/2020-12/schema";`;
    expect(detect('DEBT_009', [src('src/validate.ts', content)])).toHaveLength(0);
  });

  it('skips test files', () => {
    const findings = detect('DEBT_009', [src('src/api.test.ts', 'fetch("http://localhost:3000")')]);
    expect(findings).toHaveLength(0);
  });
});

// ── DEBT_010: console.log object dump ────────────────────────────────────────

describe('DEBT_010 — console.log object dump', () => {
  it('flags console.log with an object argument', () => {
    const findings = detect('DEBT_010', [src('src/handler.ts', 'console.log("user:", userData)')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('flags console.log with a bare variable argument', () => {
    const findings = detect('DEBT_010', [src('src/handler.ts', 'console.log(responseData)')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('skips test files', () => {
    expect(detect('DEBT_010', [src('src/handler.test.ts', 'console.log("test data:", data)')])).toHaveLength(0);
  });
});

// ── DEBT_011: Magic number ────────────────────────────────────────────────────

describe('DEBT_011 — magic number', () => {
  it('flags magic number in arithmetic', () => {
    const findings = detect('DEBT_011', [src('src/session.ts', 'const expires = Date.now() + 3600000;')]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain('3600000');
  });

  it('does not flag HTTP status codes (200, 400, 404, etc.)', () => {
    const content = 'if (status === 404) throw new Error("not found");\nif (code !== 200) return;';
    expect(detect('DEBT_011', [src('src/api.ts', content)])).toHaveLength(0);
  });

  it('does not flag UPPER_SNAKE_CASE constant definitions', () => {
    const content = 'const SESSION_TIMEOUT_MS = 3600000;';
    expect(detect('DEBT_011', [src('src/constants.ts', content)])).toHaveLength(0);
  });

  it('skips test files', () => {
    expect(detect('DEBT_011', [src('src/session.test.ts', 'expect(x).toBe(86400);')])).toHaveLength(0);
  });
});

// ── DEBT_012: Deep nesting ────────────────────────────────────────────────────

describe('DEBT_012 — deep nesting', () => {
  it('flags 4+ levels of nesting', () => {
    const content = `
function process(a: any) {
  if (a) {
    if (a.b) {
      if (a.b.c) {
        if (a.b.c.d) {
          return a.b.c.d;
        }
      }
    }
  }
}`;
    const findings = detect('DEBT_012', [src('src/process.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag shallow code', () => {
    const content = `
function greet(name: string) {
  if (name) {
    return \`Hello, \${name}\`;
  }
  return "Hello";
}`;
    expect(detect('DEBT_012', [src('src/greet.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_013: TODO/FIXME without ticket ──────────────────────────────────────

describe('DEBT_013 — TODO/FIXME no ticket', () => {
  it('flags TODO without ticket reference', () => {
    const findings = detect('DEBT_013', [src('src/api.ts', '// TODO: handle the edge case')]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('debt_todo_fixme_no_ticket');
  });

  it('flags FIXME without ticket', () => {
    const findings = detect('DEBT_013', [src('src/api.ts', '// FIXME: this is broken')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag TODO with ticket reference', () => {
    const findings = detect('DEBT_013', [src('src/api.ts', '// TODO(JIRA-1234): handle edge case')]);
    expect(findings).toHaveLength(0);
  });
});

// ── DEBT_014: Unused import ───────────────────────────────────────────────────

describe('DEBT_014 — unused import', () => {
  it('flags an import name not used after the import line', () => {
    const content = `import { useState, useEffect } from "react";\nconst x = useState(0);`;
    const findings = detect('DEBT_014', [src('src/comp.tsx', content)]);
    expect(findings.some((f) => f.message.includes('useEffect'))).toBe(true);
  });

  it('does not flag imports that are used', () => {
    const content = `import { useState } from "react";\nconst [x, setX] = useState(0);`;
    expect(detect('DEBT_014', [src('src/comp.tsx', content)])).toHaveLength(0);
  });

  it('skips non-TypeScript files', () => {
    const content = `import { a, b } from "module";\nconst x = a();`;
    expect(detect('DEBT_014', [src('src/comp.js', content)])).toHaveLength(0);
  });
});

// ── DEBT_015: Missing finally on resource ─────────────────────────────────────

describe('DEBT_015 — missing finally resource', () => {
  it('flags try/catch after openSync with no finally', () => {
    const content = `
const fd = fs.openSync(path, 'r');
try {
  const data = fs.readFileSync(fd);
  return data;
} catch (e) {
  throw e;
}`;
    const findings = detect('DEBT_015', [src('src/reader.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag try block with finally', () => {
    const content = `
const fd = fs.openSync(path, 'r');
try {
  return fs.readFileSync(fd);
} catch(e) {
  throw e;
} finally {
  fs.closeSync(fd);
}`;
    expect(detect('DEBT_015', [src('src/reader.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_016: Exponential loop ────────────────────────────────────────────────

describe('DEBT_016 — exponential loop', () => {
  it('flags nested for-of loops', () => {
    const content = `
for (const a of items) {
  for (const b of items) {
    compare(a, b);
  }
}`;
    const findings = detect('DEBT_016', [src('src/compare.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('debt_exponential_loop');
  });

  it('does not flag a single for-of loop', () => {
    const content = `for (const item of items) { process(item); }`;
    expect(detect('DEBT_016', [src('src/process.ts', content)])).toHaveLength(0);
  });

  it('skips test files', () => {
    const content = `for (const a of xs) { for (const b of xs) { expect(a).not.toBe(b); } }`;
    expect(detect('DEBT_016', [src('src/check.test.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_017: Dead code after return ─────────────────────────────────────────

describe('DEBT_017 — dead code after return', () => {
  it('flags code on the line immediately after a return', () => {
    const content = `function getUser() {\n  return user;\n  const processed = transform(user);\n}`;
    const findings = detect('DEBT_017', [src('src/user.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('debt_dead_code_return');
  });

  it('does not flag code in a different block after return', () => {
    const content = `function a() {\n  return 1;\n}\nconst x = a();`;
    expect(detect('DEBT_017', [src('src/a.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_018: Magic regex ─────────────────────────────────────────────────────

describe('DEBT_018 — magic regex', () => {
  it('flags complex inline regex used directly in a method call', () => {
    // Inline .test() call — not assigned to a named const
    const content = `if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(email)) {}`;
    const findings = detect('DEBT_018', [src('src/validate.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag regex assigned to a named constant', () => {
    const content = `const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;`;
    expect(detect('DEBT_018', [src('src/validate.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_019: catch returns null ──────────────────────────────────────────────

describe('DEBT_019 — catch returns null', () => {
  it('flags catch block returning null', () => {
    const content = `try { return doThing(); } catch(e) { return null; }`;
    const findings = detect('DEBT_019', [src('src/service.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.category).toBe('debt_catch_returns_null');
  });

  it('flags promise .catch(() => null)', () => {
    const findings = detect('DEBT_019', [src('src/service.ts', 'const x = fetch(url).catch(() => null);')]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does not flag catch that rethrows', () => {
    const content = `try { doThing(); } catch(e) { throw e; }`;
    expect(detect('DEBT_019', [src('src/service.ts', content)])).toHaveLength(0);
  });
});

// ── DEBT_020: Over-parameterized function ─────────────────────────────────────

describe('DEBT_020 — over-parameterized function', () => {
  it('flags const arrow function with 5+ parameters (50+ char param string)', () => {
    // DEBT_020 regex works with const arrow form: `const fn = (params) => {}`
    // The function keyword form includes `(` in the captured param string which skews depth counting
    const content = `const createUserAccount = (firstName: string, lastName: string, emailAddress: string, roleName: string, orgIdentifier: string) => { return {}; };`;
    const findings = detect('DEBT_020', [src('src/user.ts', content)]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]!.message).toContain('createUserAccount');
  });

  it('does not flag function with 4 parameters', () => {
    const content = `const makeRequest = (url: string, method: string, body: unknown, headers: Record<string, string>) => fetch(url);`;
    expect(detect('DEBT_020', [src('src/http.ts', content)])).toHaveLength(0);
  });

  it('skips test files', () => {
    const content = `function setup(a, b, c, d, e, f) { return {}; }`;
    expect(detect('DEBT_020', [src('src/setup.test.ts', content)])).toHaveLength(0);
  });
});
