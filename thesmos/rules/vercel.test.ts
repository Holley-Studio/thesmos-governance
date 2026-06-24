// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VERCEL_RULES } from './vercel.js';
import type { DetectInput, Finding } from '../types.js';

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

function detect(ruleId: string, changedFiles: DetectInput['changedFiles'], configOverride?: Partial<DetectInput['config']>): Finding[] {
  const rule = VERCEL_RULES.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} not found`);
  return rule.detect({
    scan: EMPTY_SCAN,
    config: { ...CONFIG, ...configOverride },
    changedFiles: changedFiles ?? [],
  });
}

function vercelFile(content: string) {
  return { path: 'vercel.json', content };
}

function src(path: string, content: string) {
  return { path, content };
}

// ── VERCEL_001 — secret in config ─────────────────────────────────────────────

describe('VERCEL_001 — vercel_secret_in_config', () => {
  it('fires when a Bearer token is in vercel.json', () => {
    const content = JSON.stringify({
      headers: [{ source: '/(.*)', headers: [{ key: 'Authorization', value: 'Bearer sk-abc123xyzlongtoken123abc' }] }],
    }, null, 2);
    const findings = detect('VERCEL_001', [vercelFile(content)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('vercel_secret_in_config');
  });

  it('fires on Supabase service role key pattern', () => {
    const content = '{ "env": { "DB": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.realtoken.sig" } }';
    const findings = detect('VERCEL_001', [vercelFile(content)]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire for @env-var-reference style values', () => {
    const content = JSON.stringify({ env: { DATABASE_URL: '@database-url', API_KEY: '@api-key' } }, null, 2);
    expect(detect('VERCEL_001', [vercelFile(content)])).toHaveLength(0);
  });

  it('does NOT fire for non-vercel.json files', () => {
    const content = '{ "env": { "DB": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.realtoken.sig" } }';
    expect(detect('VERCEL_001', [src('config/other.json', content)])).toHaveLength(0);
  });

  it('does NOT fire on empty vercel.json', () => {
    expect(detect('VERCEL_001', [vercelFile('{}')])).toHaveLength(0);
  });
});

// ── VERCEL_002 — server secret with NEXT_PUBLIC_ prefix ───────────────────────

describe('VERCEL_002 — vercel_server_secret_public_prefix', () => {
  it('fires on NEXT_PUBLIC_DATABASE_PASSWORD in source', () => {
    const findings = detect('VERCEL_002', [
      src('src/lib/db.ts', 'const url = process.env.NEXT_PUBLIC_DATABASE_PASSWORD;'),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('NEXT_PUBLIC_DATABASE_PASSWORD');
  });

  it('fires on NEXT_PUBLIC_API_SECRET', () => {
    const findings = detect('VERCEL_002', [
      src('src/config.ts', 'const key = process.env.NEXT_PUBLIC_API_SECRET;'),
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on NEXT_PUBLIC_SERVICE_ROLE_KEY', () => {
    const findings = detect('VERCEL_002', [
      src('src/supabase.ts', 'const srv = process.env.NEXT_PUBLIC_SERVICE_ROLE_KEY;'),
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does NOT fire on safe NEXT_PUBLIC_ vars (site URL, app name)', () => {
    const findings = detect('VERCEL_002', [
      src('src/config.ts', 'const url = process.env.NEXT_PUBLIC_SITE_URL;\nconst name = process.env.NEXT_PUBLIC_APP_NAME;'),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire for non-source files (.d.ts)', () => {
    const findings = detect('VERCEL_002', [
      src('src/types.d.ts', 'declare const k: typeof process.env.NEXT_PUBLIC_API_SECRET;'),
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── VERCEL_003 — cron no secret check ────────────────────────────────────────

describe('VERCEL_003 — vercel_cron_no_secret_check', () => {
  it('fires on cron route without CRON_SECRET check', () => {
    const findings = detect('VERCEL_003', [
      src('app/api/cron/send-emails/route.ts', 'export async function GET() { await sendEmails(); }'),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('vercel_cron_no_secret_check');
  });

  it('fires on /api/cron/* path pattern', () => {
    const findings = detect('VERCEL_003', [
      src('pages/api/cron/process-queue.ts', 'export default function handler(req, res) { processQueue(); }'),
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does NOT fire when CRON_SECRET check is present', () => {
    const content = `
export async function GET(request: Request) {
  if (request.headers.get('authorization') !== \`Bearer \${process.env.CRON_SECRET}\`) {
    return new Response('Unauthorized', { status: 401 });
  }
  await sendEmails();
}`;
    const findings = detect('VERCEL_003', [
      src('app/api/cron/send-emails/route.ts', content),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on non-cron routes', () => {
    const findings = detect('VERCEL_003', [
      src('app/api/users/route.ts', 'export async function GET() { return new Response("ok"); }'),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when requireCronAuth is false', () => {
    const findings = detect('VERCEL_003', [
      src('app/api/cron/send-emails/route.ts', 'export async function GET() { await sendEmails(); }'),
    ], { vercel: { requireCronAuth: false } } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(0);
  });
});

// ── VERCEL_004 — env var not in .env.example ──────────────────────────────────

describe('VERCEL_004 — vercel_env_not_in_example', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `thesmos-vercel-004-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it('fires when env var is used but absent from .env.example', () => {
    writeFileSync(join(tmpDir, '.env.example'), 'DATABASE_URL=postgres://localhost/myapp\n');
    const findings = detect('VERCEL_004', [
      src('src/lib/stripe.ts', 'const key = process.env.STRIPE_SECRET_KEY;'),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('STRIPE_SECRET_KEY');
  });

  it('does NOT fire when var is documented in .env.example', () => {
    writeFileSync(join(tmpDir, '.env.example'), 'STRIPE_SECRET_KEY=sk_test_your_key_here\n');
    const findings = detect('VERCEL_004', [
      src('src/lib/stripe.ts', 'const key = process.env.STRIPE_SECRET_KEY;'),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when .env.example does not exist (handled by VERCEL_005)', () => {
    // No .env.example written — VERCEL_004 returns [] since file doesn't exist
    const findings = detect('VERCEL_004', [
      src('src/config.ts', 'const url = process.env.DATABASE_URL;'),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('skips NODE_ENV, PORT, CI, VERCEL built-ins', () => {
    writeFileSync(join(tmpDir, '.env.example'), '# no entries\n');
    const findings = detect('VERCEL_004', [
      src('src/config.ts', 'const env = process.env.NODE_ENV;\nconst ci = process.env.CI;\nconst port = process.env.PORT;'),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('skips test files', () => {
    writeFileSync(join(tmpDir, '.env.example'), '# no entries\n');
    const findings = detect('VERCEL_004', [
      src('src/auth.test.ts', 'const key = process.env.STRIPE_SECRET_KEY;'),
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── VERCEL_005 — .env.example missing ─────────────────────────────────────────

describe('VERCEL_005 — vercel_env_example_missing', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `thesmos-vercel-005-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try { rmSync(tmpDir, { recursive: true }); } catch { /* */ }
  });

  it('fires when .env.example is missing and source uses env vars', () => {
    const findings = detect('VERCEL_005', [
      src('src/config.ts', 'const url = process.env.DATABASE_URL;'),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('vercel_env_example_missing');
  });

  it('does NOT fire when .env.example exists', () => {
    writeFileSync(join(tmpDir, '.env.example'), 'DATABASE_URL=postgres://localhost/myapp\n');
    const findings = detect('VERCEL_005', [
      src('src/config.ts', 'const url = process.env.DATABASE_URL;'),
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire when no source files use env vars', () => {
    const findings = detect('VERCEL_005', [
      src('src/utils.ts', 'export function add(a: number, b: number) { return a + b; }'),
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── VERCEL_006 — missing maxDuration ─────────────────────────────────────────

describe('VERCEL_006 — vercel_missing_max_duration', () => {
  it('fires MEDIUM when functions entry has no maxDuration', () => {
    const content = JSON.stringify({
      functions: { 'app/api/ai/route.ts': { memory: 1024 } },
    }, null, 2);
    const findings = detect('VERCEL_006', [vercelFile(content)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('MEDIUM');
    expect(findings[0]!.message).toContain('app/api/ai/route.ts');
  });

  it('does NOT fire when maxDuration is set', () => {
    const content = JSON.stringify({
      functions: { 'app/api/ai/route.ts': { maxDuration: 60 } },
    }, null, 2);
    expect(detect('VERCEL_006', [vercelFile(content)])).toHaveLength(0);
  });

  it('does NOT fire when no functions key', () => {
    expect(detect('VERCEL_006', [vercelFile('{ "version": 2 }')])).toHaveLength(0);
  });
});

// ── VERCEL_007 — edge runtime missing ────────────────────────────────────────

describe('VERCEL_007 — vercel_edge_runtime_missing', () => {
  it('fires MEDIUM when middleware.ts has no runtime export', () => {
    const findings = detect('VERCEL_007', [
      src('middleware.ts', 'export function middleware(request: NextRequest) { return NextResponse.next(); }'),
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('does NOT fire when runtime export is present', () => {
    const content = "export const runtime = 'edge';\nexport function middleware(request: NextRequest) { return NextResponse.next(); }";
    expect(detect('VERCEL_007', [src('middleware.ts', content)])).toHaveLength(0);
  });

  it('does NOT fire for non-middleware files', () => {
    const findings = detect('VERCEL_007', [
      src('src/lib/auth.ts', 'export function getSession() { return null; }'),
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── VERCEL_008 — header missing security ─────────────────────────────────────

describe('VERCEL_008 — vercel_header_missing_security', () => {
  it('fires MEDIUM when headers section lacks security headers', () => {
    const content = JSON.stringify({
      headers: [{ source: '/(.*)', headers: [{ key: 'Cache-Control', value: 'max-age=3600' }] }],
    }, null, 2);
    const findings = detect('VERCEL_008', [vercelFile(content)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('MEDIUM');
    expect(findings[0]!.message).toContain('X-Frame-Options');
  });

  it('does NOT fire when all three security headers are present', () => {
    const content = JSON.stringify({
      headers: [{
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Content-Security-Policy', value: "default-src 'self'" },
        ],
      }],
    }, null, 2);
    expect(detect('VERCEL_008', [vercelFile(content)])).toHaveLength(0);
  });

  it('does NOT fire when no headers key in vercel.json', () => {
    expect(detect('VERCEL_008', [vercelFile('{ "version": 2 }')])).toHaveLength(0);
  });

  it('does NOT fire when headers array is empty', () => {
    expect(detect('VERCEL_008', [vercelFile('{ "headers": [] }')])).toHaveLength(0);
  });
});

// ── VERCEL_009 — maxDuration exceeds plan ─────────────────────────────────────

describe('VERCEL_009 — vercel_max_duration_exceeds_plan', () => {
  it('fires when maxDuration exceeds pro plan limit (800)', () => {
    const content = JSON.stringify({
      functions: { 'app/api/export/route.ts': { maxDuration: 900 } },
    }, null, 2);
    const findings = detect('VERCEL_009', [vercelFile(content)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('800');
  });

  it('fires LOW when hobby plan maxDuration exceeds 60', () => {
    const content = JSON.stringify({
      functions: { 'app/api/ai/route.ts': { maxDuration: 300 } },
    }, null, 2);
    const findings = detect('VERCEL_009', [vercelFile(content)], {
      vercel: { plan: 'hobby' },
    } as unknown as Partial<DetectInput['config']>);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('60');
  });

  it('does NOT fire when maxDuration is within pro limit', () => {
    const content = JSON.stringify({
      functions: { 'app/api/ai/route.ts': { maxDuration: 60 } },
    }, null, 2);
    expect(detect('VERCEL_009', [vercelFile(content)])).toHaveLength(0);
  });

  it('does NOT fire when no functions config', () => {
    expect(detect('VERCEL_009', [vercelFile('{ "version": 2 }')])).toHaveLength(0);
  });
});

// ── VERCEL_010 — open redirect ────────────────────────────────────────────────

describe('VERCEL_010 — vercel_open_redirect', () => {
  it('fires on redirect with bare $1 destination', () => {
    const content = JSON.stringify({
      redirects: [{ source: '/r/(.*)', destination: '$1', permanent: false }],
    }, null, 2);
    const findings = detect('VERCEL_010', [vercelFile(content)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('vercel_open_redirect');
  });

  it('does NOT fire when destination has a fixed https:// domain', () => {
    const content = JSON.stringify({
      redirects: [{ source: '/app/:path*', destination: 'https://app.example.com/:path*', permanent: true }],
    }, null, 2);
    expect(detect('VERCEL_010', [vercelFile(content)])).toHaveLength(0);
  });

  it('does NOT fire on redirects without wildcards', () => {
    const content = JSON.stringify({
      redirects: [{ source: '/old-page', destination: '/new-page', permanent: true }],
    }, null, 2);
    expect(detect('VERCEL_010', [vercelFile(content)])).toHaveLength(0);
  });

  it('does NOT fire when no redirects key', () => {
    expect(detect('VERCEL_010', [vercelFile('{ "version": 2 }')])).toHaveLength(0);
  });
});

// ── All rules — no false positives on empty changedFiles ──────────────────────

describe('All VERCEL rules — no findings on empty changedFiles', () => {
  for (const rule of VERCEL_RULES) {
    it(`${rule.id} returns [] when changedFiles is empty`, () => {
      const findings = rule.detect({ scan: EMPTY_SCAN, config: CONFIG, changedFiles: [] });
      expect(findings).toHaveLength(0);
    });
  }
});
