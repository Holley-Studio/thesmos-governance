// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { JWT_AUTH_RULES } from './jwt';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

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

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const r = JWT_AUTH_RULES.find((r) => r.id === ruleId);
  if (!r) throw new Error(`Rule ${ruleId} not found`);
  return r.detect({ scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files });
}

// ── JWT_001 — hardcoded fallback secret ───────────────────────────────────────

describe('JWT_001 — hardcoded JWT fallback secret', () => {
  it('fires on process.env.JWT_SECRET || "secret"', () => {
    const findings = detect('JWT_001', [{
      path: 'src/auth.ts',
      content: `const secret = process.env.JWT_SECRET || "secret"`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on ?? "fallback-key-change-me" pattern', () => {
    const findings = detect('JWT_001', [{
      path: 'src/auth.ts',
      content: `const key = process.env.NEXTAUTH_SECRET ?? "fallback-key-change-me"`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('fires on jwt.sign with fallback secret', () => {
    const findings = detect('JWT_001', [{
      path: 'src/auth.ts',
      content: `jwt.sign(payload, process.env.JWT_KEY || "dev-secret")`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when secret throws on undefined', () => {
    const findings = detect('JWT_001', [{
      path: 'src/auth.ts',
      content: `
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error("JWT_SECRET required");
        jwt.sign(payload, secret);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on test files', () => {
    const findings = detect('JWT_001', [{
      path: 'src/auth.test.ts',
      content: `const secret = process.env.JWT_SECRET || "test-secret"`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── JWT_002 — no algorithm pin ────────────────────────────────────────────────

describe('JWT_002 — JWT verify no algorithm pin', () => {
  it('fires when jwt.verify called with only 2 args', () => {
    const findings = detect('JWT_002', [{
      path: 'src/auth.ts',
      content: `const payload = jwt.verify(token, secret)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('fires on jwt.verify with simple variable args and no options', () => {
    const findings = detect('JWT_002', [{
      path: 'src/middleware.ts',
      content: `const decoded = jwt.verify(bearerToken, publicKey)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when algorithms option is provided', () => {
    const findings = detect('JWT_002', [{
      path: 'src/auth.ts',
      content: `const payload = jwt.verify(token, secret, { algorithms: ['HS256'] })`,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire in test files', () => {
    const findings = detect('JWT_002', [{
      path: 'src/auth.test.ts',
      content: `const payload = jwt.verify(token, secret)`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── JWT_003 — refresh token in localStorage ───────────────────────────────────

describe('JWT_003 — refresh token in localStorage', () => {
  it('fires on localStorage.setItem("refreshToken", ...)', () => {
    const findings = detect('JWT_003', [{
      path: 'src/auth/client.ts',
      content: `localStorage.setItem("refreshToken", data.refreshToken)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on localStorage.setItem("refresh_token", ...)', () => {
    const findings = detect('JWT_003', [{
      path: 'src/auth.ts',
      content: `localStorage.setItem("refresh_token", token)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when storing access token (not refresh)', () => {
    const findings = detect('JWT_003', [{
      path: 'src/auth.ts',
      content: `localStorage.setItem("accessToken", data.accessToken)`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── JWT_004 — no expiry ────────────────────────────────────────────────────────

describe('JWT_004 — JWT signed without expiry', () => {
  it('fires on jwt.sign({userId}, secret) with no expiresIn', () => {
    const findings = detect('JWT_004', [{
      path: 'src/auth.ts',
      content: `const token = jwt.sign({ userId: user.id }, secret)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when expiresIn is present', () => {
    const findings = detect('JWT_004', [{
      path: 'src/auth.ts',
      content: `jwt.sign({ userId }, secret, { expiresIn: "15m", algorithm: "HS256" })`,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on test file JWT sign', () => {
    const findings = detect('JWT_004', [{
      path: 'src/auth.test.ts',
      content: `jwt.sign({ userId }, secret)`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── JWT_005 — OAuth missing state ─────────────────────────────────────────────

describe('JWT_005 — OAuth callback no state validation', () => {
  it('fires when OAuth callback exchanges code with no state check', () => {
    const findings = detect('JWT_005', [{
      path: 'src/api/auth/callback/github/route.ts',
      content: `
        export async function GET(req) {
          const { code } = req.nextUrl.searchParams;
          await exchangeCode(code);
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when state is validated', () => {
    const findings = detect('JWT_005', [{
      path: 'src/api/auth/callback/github/route.ts',
      content: `
        export async function GET(req) {
          const { code, state } = req.nextUrl.searchParams;
          const storedState = await session.getOAuthState();
          if (state !== storedState) throw new Error("OAuth state mismatch");
          await exchangeCode(code);
        }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── JWT_006 — social login no reauth ─────────────────────────────────────────

describe('JWT_006 — social login account linking no reauth', () => {
  it('fires on linkProvider without reauth check', () => {
    const findings = detect('JWT_006', [{
      path: 'src/api/auth/link/route.ts',
      content: `
        export async function POST(req) {
          await linkProvider(session.userId, provider, providerAccountId);
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when reauth is checked', () => {
    const findings = detect('JWT_006', [{
      path: 'src/api/auth/link/route.ts',
      content: `
        const lastAuth = session.lastAuthenticatedAt;
        if (Date.now() - lastAuth > REAUTH_WINDOW_MS) return requireReauthentication();
        await linkProvider(session.userId, provider, providerAccountId);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── JWT_007 — sensitive payload ────────────────────────────────────────────────

describe('JWT_007 — sensitive data in JWT payload', () => {
  it('fires on jwt.sign with email in payload', () => {
    const findings = detect('JWT_007', [{
      path: 'src/auth.ts',
      content: `jwt.sign({ userId, email, phone }, secret, { expiresIn: '15m' })`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('fires on jwt.sign with ssn in payload', () => {
    const findings = detect('JWT_007', [{
      path: 'src/auth.ts',
      content: `jwt.sign({ userId, ssn, address }, secret)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when only sub is in payload', () => {
    const findings = detect('JWT_007', [{
      path: 'src/auth.ts',
      content: `jwt.sign({ sub: user.id }, secret, { expiresIn: '15m' })`,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── AUTH_008 — client-only auth guard ─────────────────────────────────────────

describe('AUTH_008 — client-only auth guard', () => {
  it('fires on "use client" component with !session redirect and no server check', () => {
    const findings = detect('AUTH_008', [{
      path: 'src/components/Dashboard.tsx',
      content: `
        "use client";
        export default function Dashboard() {
          const { session } = useSession();
          if (!session) { router.push("/login"); return null; }
          return <div>Dashboard</div>;
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('BLOCKER');
  });

  it('does NOT fire when getServerSession is also used', () => {
    const findings = detect('AUTH_008', [{
      path: 'src/app/dashboard/page.tsx',
      content: `
        "use client";
        export default async function DashboardPage() {
          const session = await getServerSession();
          if (!session) redirect("/login");
          return <Dashboard />;
        }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on server components (no "use client")', () => {
    const findings = detect('AUTH_008', [{
      path: 'src/app/dashboard/page.tsx',
      content: `
        export default async function DashboardPage() {
          const session = await getServerSession();
          if (!session) redirect("/login");
          return <Dashboard />;
        }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── AUTH_009 — IDOR numeric ID ────────────────────────────────────────────────

describe('AUTH_009 — IDOR numeric ID no ownership check', () => {
  it('fires on findFirst by id with no userId check', () => {
    const findings = detect('AUTH_009', [{
      path: 'src/app/api/orders/[id]/route.ts',
      content: `
        const order = await db.order.findFirst({ where: { id: params.id } });
        return NextResponse.json(order);
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when userId is included in where clause', () => {
    const findings = detect('AUTH_009', [{
      path: 'src/app/api/orders/[id]/route.ts',
      content: `
        const order = await db.order.findFirst({ where: { id: params.id, userId: session.user.id } });
        if (!order) return notFound();
      `,
    }]);
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on routes without [id] segment', () => {
    const findings = detect('AUTH_009', [{
      path: 'src/app/api/orders/route.ts',
      content: `
        const orders = await db.order.findFirst({ where: { id: params.id } });
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── AUTH_010 — brute force unprotected ────────────────────────────────────────

describe('AUTH_010 — login endpoint no rate limit', () => {
  it('fires on login route without rate limiting', () => {
    const findings = detect('AUTH_010', [{
      path: 'src/api/auth/login/route.ts',
      content: `
        export async function POST(req) {
          const { email, pass } = await req.json();
          await login(email, pass);
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on password reset route without rate limit', () => {
    const findings = detect('AUTH_010', [{
      path: 'src/api/auth/reset/route.ts',
      content: `
        export async function POST(req) {
          const { email } = await req.json();
          await sendResetEmail(email);
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when rateLimiter is present', () => {
    const findings = detect('AUTH_010', [{
      path: 'src/api/auth/login/route.ts',
      content: `
        await rateLimiter.check(req.ip, { max: 5, window: '15m' });
        const user = await verifyCredentials(email, password);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── AUTH_011 — password reset token not deleted ───────────────────────────────

describe('AUTH_011 — password reset token not deleted after use', () => {
  it('fires when password is updated but reset token is not deleted', () => {
    const findings = detect('AUTH_011', [{
      path: 'src/api/auth/reset-password/route.ts',
      content: `
        await db.user.update({ where: { id }, data: { password: hash } });
        // token stays in DB
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('does NOT fire when token is deleted atomically', () => {
    const findings = detect('AUTH_011', [{
      path: 'src/api/auth/reset-password/route.ts',
      content: `
        await db.$transaction([
          db.user.update({ where: { id }, data: { password: hash } }),
          db.resetToken.delete({ where: { token } }),
        ]);
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── AUTH_012 — session no revalidation ───────────────────────────────────────

describe('AUTH_012 — getServerSession no DB revalidation', () => {
  it('fires when getServerSession is used without DB user lookup', () => {
    const findings = detect('AUTH_012', [{
      path: 'src/api/data/route.ts',
      content: `
        const session = await getServerSession();
        const data = await db.items.findMany({ where: { userId: session.user.id } });
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('does NOT fire when user is re-fetched from DB', () => {
    const findings = detect('AUTH_012', [{
      path: 'src/api/data/route.ts',
      content: `
        const session = await getServerSession();
        const user = await db.user.findUnique({ where: { id: session?.user?.id } });
        if (!user || user.deletedAt) return unauthorized();
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── AUTH_013 — auto-increment ID exposed ─────────────────────────────────────

describe('AUTH_013 — auto-increment integer ID exposed', () => {
  it('fires on Prisma model with @default(autoincrement())', () => {
    const findings = detect('AUTH_013', [{
      path: 'prisma/schema.prisma',
      content: `
        model User {
          id  Int  @id @default(autoincrement())
          name String
        }
      `,
    }]);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('fires on id: z.number() in API params', () => {
    const findings = detect('AUTH_013', [{
      path: 'src/api/users/route.ts',
      content: `const params = z.object({ id: z.number().int() }).parse(req.query)`,
    }]);
    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT fire when using cuid()', () => {
    const findings = detect('AUTH_013', [{
      path: 'prisma/schema.prisma',
      content: `
        model User {
          id  String  @id @default(cuid())
          name String
        }
      `,
    }]);
    expect(findings).toHaveLength(0);
  });
});

// ── Registry contract ──────────────────────────────────────────────────────────

describe('JWT_AUTH_RULES registry contract', () => {
  it('exports exactly 13 rules', () => {
    expect(JWT_AUTH_RULES).toHaveLength(13);
  });

  it('all rule IDs are unique', () => {
    const ids = JWT_AUTH_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all rules have a sinceVersion', () => {
    for (const rule of JWT_AUTH_RULES) {
      expect(typeof rule.sinceVersion, `[${rule.id}] sinceVersion`).toBe('string');
    }
  });

  it('all detect() methods return an array', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const rule of JWT_AUTH_RULES) {
      expect(Array.isArray(rule.detect(input)), `[${rule.id}] returns array`).toBe(true);
    }
  });
});
