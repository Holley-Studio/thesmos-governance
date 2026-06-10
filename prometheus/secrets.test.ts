// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CONFIG_DEFAULTS } from './config';
import {
  matchesSecretPattern,
  isDirectEnvAccess,
  extractBracketEnvVars,
  hasAdminClientInClientFile,
  isMissingApiAuth,
  hasRlsDisable,
  extractAllEnvVars,
} from './secrets';

const SECRET_PATTERNS = CONFIG_DEFAULTS.secretPatterns;

describe('matchesSecretPattern', () => {
  it('detects OpenAI key pattern', () => {
    const line = 'const key = "sk-proj-abc123def456ghi789jklmno";';
    expect(matchesSecretPattern(line, SECRET_PATTERNS)).not.toBeNull();
  });

  it('returns null for clean lines', () => {
    expect(matchesSecretPattern('const greeting = "hello world";', SECRET_PATTERNS)).toBeNull();
  });

  it('detects JWT/Supabase token prefix', () => {
    // eyJ prefix is a base64 JSON header — used in JWTs
    const line = 'const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";';
    expect(matchesSecretPattern(line, SECRET_PATTERNS)).not.toBeNull();
  });

  it('detects SSH private key header', () => {
    const line = '-----BEGIN RSA PRIVATE KEY-----';
    expect(matchesSecretPattern(line, SECRET_PATTERNS)).not.toBeNull();
  });

  it('returns null for a variable name that looks like a key but is not', () => {
    const line = 'const MY_API_KEY_NAME = "";';
    // empty string — no actual secret value present
    expect(matchesSecretPattern(line, ['sk-[a-zA-Z0-9]{20,}'])).toBeNull();
  });

  it('handles invalid regex pattern gracefully without throwing', () => {
    expect(() => matchesSecretPattern('any line', ['[invalid('])).not.toThrow();
    expect(matchesSecretPattern('any line', ['[invalid('])).toBeNull();
  });
});

describe('isDirectEnvAccess', () => {
  it('flags process.env.VAR dot-notation', () => {
    expect(isDirectEnvAccess('const url = process.env.NEXT_PUBLIC_URL;')).not.toBeNull();
  });

  it('does not flag bracket-notation access', () => {
    expect(
      isDirectEnvAccess("const url = process['env' as 'env']['NEXT_PUBLIC_URL'];")
    ).toBeNull();
  });

  it('does not flag unrelated process references', () => {
    expect(isDirectEnvAccess('process.exit(0);')).toBeNull();
  });

  it('flags access in a template literal context', () => {
    expect(isDirectEnvAccess('const url = `${process.env.BASE_URL}/api`;')).not.toBeNull();
  });
});

describe('extractBracketEnvVars', () => {
  it('extracts variable names from bracket notation', () => {
    const source = "const url = process['env' as 'env']['MY_URL'];";
    expect(extractBracketEnvVars(source)).toEqual(['MY_URL']);
  });

  it('extracts multiple unique vars', () => {
    const source = [
      "process['env' as 'env']['VAR_A']",
      "process['env' as 'env']['VAR_B']",
      "process['env' as 'env']['VAR_A']",
    ].join('\n');
    const result = extractBracketEnvVars(source);
    expect(result).toEqual(['VAR_A', 'VAR_B']);
  });

  it('returns empty array when no bracket vars found', () => {
    expect(extractBracketEnvVars('const x = 1;')).toEqual([]);
  });
});

describe('hasAdminClientInClientFile', () => {
  it('detects admin import in use client file', () => {
    const content = `'use client'\nimport { adminClient } from 'lib/supabase/admin'`;
    expect(hasAdminClientInClientFile(content)).toBe(true);
  });

  it('does not flag admin import in server-only file', () => {
    const content = `import { adminClient } from 'lib/supabase/admin'`;
    expect(hasAdminClientInClientFile(content)).toBe(false);
  });
});

describe('isMissingApiAuth', () => {
  it('returns true when POST handler has no auth', () => {
    const content = `export async function POST(req: Request) { return new Response('ok'); }`;
    expect(isMissingApiAuth(content)).toBe(true);
  });

  it('returns false when POST handler calls getSession', () => {
    const content = `
export async function POST(req: Request) {
  const { data: { session } } = await supabase.auth.getUser();
  return new Response('ok');
}`;
    expect(isMissingApiAuth(content)).toBe(false);
  });

  it('returns false for GET-only routes (no mutation)', () => {
    const content = `export async function GET(req: Request) { return new Response('ok'); }`;
    expect(isMissingApiAuth(content)).toBe(false);
  });
});

describe('hasRlsDisable', () => {
  it('detects disable row level security', () => {
    expect(hasRlsDisable('ALTER TABLE users DISABLE ROW LEVEL SECURITY;')).toBe(true);
  });

  it('does not flag enable row level security', () => {
    expect(hasRlsDisable('ALTER TABLE users ENABLE ROW LEVEL SECURITY;')).toBe(false);
  });
});

describe('extractAllEnvVars', () => {
  it('extracts from bracket notation', () => {
    expect(extractAllEnvVars("process['env' as 'env']['MY_KEY']")).toEqual(['MY_KEY']);
  });

  it('extracts from dot notation (process.env.VAR)', () => {
    expect(extractAllEnvVars('const x = process.env.DATABASE_URL;')).toEqual(['DATABASE_URL']);
  });

  it('extracts from Vite import.meta.env', () => {
    expect(extractAllEnvVars('const k = import.meta.env.VITE_API_KEY;')).toEqual(['VITE_API_KEY']);
  });

  it('deduplicates across all patterns', () => {
    const source = [
      "process['env' as 'env']['SHARED']",
      'process.env.SHARED',
    ].join('\n');
    expect(extractAllEnvVars(source)).toEqual(['SHARED']);
  });

  it('returns sorted results', () => {
    const source = 'process.env.Z_VAR\nimport.meta.env.A_VAR';
    expect(extractAllEnvVars(source)).toEqual(['A_VAR', 'Z_VAR']);
  });

  it('returns empty array when no env vars found', () => {
    expect(extractAllEnvVars('const x = 1 + 2;')).toEqual([]);
  });

  it('collects vars from all three patterns in one source', () => {
    const source = [
      "process['env' as 'env']['BRACKET_VAR']",
      'process.env.DOT_VAR',
      'import.meta.env.VITE_VAR',
    ].join('\n');
    const result = extractAllEnvVars(source);
    expect(result).toContain('BRACKET_VAR');
    expect(result).toContain('DOT_VAR');
    expect(result).toContain('VITE_VAR');
    expect(result).toEqual([...result].sort());
  });
});
