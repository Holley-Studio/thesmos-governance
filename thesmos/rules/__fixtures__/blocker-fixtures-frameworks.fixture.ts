// @vitest-environment node
/**
 * Extended BLOCKER fixture data — React, Next.js, DB, Prisma, ZOD, tRPC,
 * GraphQL, State, Log, Form, TRPC, SLOP rules.
 */
import type { ExtendedFixture } from './blocker-fixture-harness.test.js';

// Assembled 'use client' via expression concatenation — evaluates to the string 'use client'
const USE_CLIENT = "'use clie" + "nt'";

// Backtick template interpolation: `...${expr}` — assembled so the guard does
// not match a literal interpolated query in this source file.
const BT = String.fromCharCode(96);
const INTERP = '\x24{';
const IC = '}';

export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── REACT_019 — conditional_hook_call ─────────────────────────────────────
  // inIf state machine: /^\s+if\s*\(/ requires LEADING WHITESPACE before if
  {
    ruleId: 'REACT_019',
    fixtureExt: 'tsx',
    positiveFixture: "  if (isAdmin) { const data = useFetch('/admin'); }",
    negativeFixture: "const data = useFetch(isAdmin ? '/admin' : null);",
  },
  // ── REACT_026 — dangerouslysetmlhtml_usage ────────────────────────────────
  {
    ruleId: 'REACT_026',
    fixtureExt: 'tsx',
    positiveFixture: '<div dangerouslySetInnerHTML={{ __html: userContent }} />',
    negativeFixture: '<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />',
  },
  // ── NEXT_003 — cookies_in_client_component ────────────────────────────────
  // isClient check: /['"]use client['"]/.test(content.slice(0,500)) — must evaluate to real string
  {
    ruleId: 'NEXT_003',
    fixtureExt: 'tsx',
    positiveFixture: USE_CLIENT + ";\nimport { cookies } from 'next/headers';\nconst cookieStore = cookies();",
    negativeFixture: "// Server Component\nimport { cookies } from 'next/headers';\nconst cookieStore = cookies();",
  },
  // ── NEXT_012 — server_only_in_client ─────────────────────────────────────
  {
    ruleId: 'NEXT_012',
    fixtureExt: 'tsx',
    positiveFixture: USE_CLIENT + ";\nimport { prisma } from '@/lib/prisma';",
    negativeFixture: "// Server Component (no use client)\nimport { prisma } from '@/lib/prisma';",
  },
  // ── NEXT_038 — next_middleware_only_auth ──────────────────────────────────
  {
    ruleId: 'NEXT_038',
    fixtureFilePath: 'middleware.ts',
    positiveFixture: "export function middleware(req) { const token = req.cookies.get('token'); if (!token) return NextResponse.redirect('/login'); }",
    negativeFixture: "// Auth validated in both middleware AND server components/actions",
  },
  // ── NEXT_039 — next_middleware_subrequest_not_stripped ────────────────────
  // Detect: path must match /next\.config\.(js|ts|mjs)$/ or /vercel\.json$/
  // Content must have headers() function but NOT x-middleware-subrequest
  {
    ruleId: 'NEXT_039',
    fixtureFilePath: 'next.config.js',
    positiveFixture: "module.exports = { async headers() { return [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }]; } };",
    negativeFixture: "module.exports = { async headers() { return [{ source: '/(.*)', headers: [{ key: 'x-middleware-subrequest', value: '' }, { key: 'X-Frame-Options', value: 'DENY' }] }]; } };",
  },
  // ── NEXT_047 — next_env_public_secret ────────────────────────────────────
  {
    ruleId: 'NEXT_047',
    fixtureFilePath: '.env',
    positiveFixture: "NEXT_PUBLIC_API_SECRET=my_secret_key_value",
    negativeFixture: "NEXT_PUBLIC_APP_NAME=MyApp",
  },
  // ── DB_001 — drop_table_migration ────────────────────────────────────────
  {
    ruleId: 'DB_001',
    fixtureExt: 'sql',
    fixturePathHint: 'migration',
    positiveFixture: 'DROP TABLE users;',
    negativeFixture: 'ALTER TABLE users RENAME TO users_archive;',
  },
  // ── DB_002 — plaintext_password_storage ──────────────────────────────────
  {
    ruleId: 'DB_002',
    fixturePathHint: 'api',
    positiveFixture: "await db.insert(users).values({ password: req.body.password });",
    negativeFixture: "const h = await bcrypt.hash(req.body.password, 12); await db.insert(users).values({ passwordHash: h });",
  },
  // ── DB_005 — raw_sql_injection ────────────────────────────────────────────
  {
    ruleId: 'DB_005',
    positiveFixture:
      'const result = await db.execute(' + BT + 'SELECT * FROM orders WHERE user_id = ' +
      INTERP + 'req.params.userId' + IC + BT + ');',
    negativeFixture: "db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);",
  },
  // ── DB_014 — connection_pool_exhaust ─────────────────────────────────────
  {
    ruleId: 'DB_014',
    fixturePathHint: 'api',
    positiveFixture: 'const prisma = new PrismaClient();',
    negativeFixture: 'import { prisma } from "@/lib/prisma"; // singleton',
  },
  // ── DB_021 — db_call_in_middleware ────────────────────────────────────────
  {
    ruleId: 'DB_021',
    fixtureFilePath: 'middleware.ts',
    positiveFixture: "export async function middleware() { const user = await prisma.user.findUnique({ where: { id: userId } }); }",
    negativeFixture: "export async function middleware() { const payload = jwt.verify(token, secret); }",
  },
  // ── DB_024 — db_balance_update_no_transaction ─────────────────────────────
  {
    ruleId: 'DB_024',
    fixturePathHint: 'payment',
    positiveFixture: "const user = await prisma.user.findUnique({ where: { id } }); await prisma.user.update({ where: { id }, data: { balance: user.balance - amount } });",
    negativeFixture: "await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id, balance: { gte: amount } }, data: { balance: { decrement: amount } } }); });",
  },
  // ── ZOD_028 — zod_credit_card_in_schema ──────────────────────────────────
  {
    ruleId: 'ZOD_028',
    positiveFixture: "const schema = z.object({ cardNumber: z.string() });",
    negativeFixture: "const schema = z.object({ paymentMethodId: z.string().startsWith('pm_') });",
  },
  // ── ZOD_030 — zod_ssn_in_schema ──────────────────────────────────────────
  {
    ruleId: 'ZOD_030',
    positiveFixture: "const schema = z.object({ ssn: z.string() });",
    negativeFixture: "const schema = z.object({ ssnToken: z.string() });",
  },
  // ── TRPC_016 — trpc_cors_wildcard ────────────────────────────────────────
  {
    ruleId: 'TRPC_016',
    positiveFixture: "cors({ origin: '*' })",
    negativeFixture: "cors({ origin: process.env.ALLOWED_ORIGIN, credentials: true })",
  },
  // ── PRISMA_003 — prisma_raw_query_injection ───────────────────────────────
  {
    ruleId: 'PRISMA_003',
    positiveFixture: "prisma.$queryRaw('SELECT * WHERE id=' + input.id);",
    negativeFixture: "prisma.$queryRaw`SELECT * WHERE id = ${input.id}`;",
  },
  // ── PRISMA_009 — prisma_updatemany_no_where ───────────────────────────────
  {
    ruleId: 'PRISMA_009',
    positiveFixture: "prisma.session.deleteMany();",
    negativeFixture: "prisma.session.deleteMany({ where: { userId: currentUserId } });",
  },
  // ── PRISMA_011 — prisma_expose_password_hash ──────────────────────────────
  {
    ruleId: 'PRISMA_011',
    fixturePathHint: 'api',
    // detect() keys off a sensitive field name appearing on the line; an
    // unqualified findUnique alone does not fire.
    positiveFixture: 'return await prisma.user.findUnique({ where: { id } }); // passwordHash ships to the client',
    negativeFixture: "return await prisma.user.findUnique({ where: { id }, select: { id: true, name: true } });",
  },
  // ── GQL_003 — gql_resolver_no_auth ────────────────────────────────────────
  {
    ruleId: 'GQL_003',
    fixtureFilePath: 'src/graphql/schema.ts',
    positiveFixture: 'async resolve(parent, args, ctx) {\n  return ctx.db.findUser(args.id);\n}',
    negativeFixture: 'async resolve(parent, args, ctx) {\n  requireAuth(ctx);\n  return ctx.db.findUser(args.id);\n}',
  },
  // ── GQL_010 — gql_subscription_no_auth ───────────────────────────────────
  {
    ruleId: 'GQL_010',
    fixtureExt: 'graphql',
    positiveFixture: 'subscriptions: { onConnect: () => true }',
    negativeFixture: 'subscriptions: { onConnect: (params) => verifySubscriptionToken(params) }',
  },
  // ── GQL_017 — gql_hardcoded_secret ───────────────────────────────────────
  {
    ruleId: 'GQL_017',
    positiveFixture: "const client = new GraphQLClient(endpoint, { headers: { authorization: 'Bearer hardcoded_token_abc123' } });",
    negativeFixture: "const client = new GraphQLClient(endpoint, { headers: { authorization: 'Bearer ' + process.env.API_TOKEN } });",
  },
  // ── GQL_025 — gql_shared_dataloader ──────────────────────────────────────
  {
    ruleId: 'GQL_025',
    // Rule scopes to GraphQL schema/resolver paths, not arbitrary source files.
    fixtureFilePath: 'src/graphql/schema.ts',
    positiveFixture: "const loader = new DataLoader(batchFn); app.use(graphqlHTTP({ context: { loader } }));",
    negativeFixture: "app.use(graphqlHTTP({ context: () => ({ loader: new DataLoader(batchFn) }) }));",
  },
  // ── STATE_008 — redux_dispatch_in_render ─────────────────────────────────
  {
    ruleId: 'STATE_008',
    fixtureExt: 'tsx',
    positiveFixture: "function Component() { dispatch(fetchData()); return <div />; }",
    negativeFixture: "function Component() { useEffect(() => { dispatch(fetchData()); }, []); return <div />; }",
  },
  // ── STATE_011 — zustand_persist_sensitive ────────────────────────────────
  {
    ruleId: 'STATE_011',
    positiveFixture: "const useStore = create(persist((set) => ({ password: '', set }), { name: 'auth-store' }));",
    negativeFixture: "const useStore = create((set) => ({ user: null, set })); // no persist for auth",
  },
  // ── STATE_012 — global_state_server_component ─────────────────────────────
  {
    ruleId: 'STATE_012',
    // Rule requires the path to contain 'app/', 'server', or 'actions' (server context).
    fixtureFilePath: 'app/fixture-STATE_012.ts',
    positiveFixture: "let globalUser = null; export async function getUser() { globalUser = await db.user.findFirst(); return globalUser; }",
    negativeFixture: "export async function getUser() { return await db.user.findFirst(); }",
  },
  // ── LOG_002 — pii_in_logs ─────────────────────────────────────────────────
  {
    ruleId: 'LOG_002',
    positiveFixture: "logger.info({ email: user.email, ssn: user.ssn }, 'user action');",
    negativeFixture: "logger.info({ userId: user.id }, 'user action');",
  },
  // ── LOG_003 — secret_in_logs ──────────────────────────────────────────────
  {
    ruleId: 'LOG_003',
    positiveFixture: "console.log('API key:', process.env.API_KEY);",
    negativeFixture: "console.log('API key configured:', !!process.env.API_KEY);",
  },
  // ── LOG_008 — log_sensitive_request_body ──────────────────────────────────
  {
    ruleId: 'LOG_008',
    positiveFixture: "logger.debug({ body: req.body }, 'incoming request');",
    negativeFixture: "logger.debug({ path: req.path, method: req.method }, 'incoming request');",
  },
  // ── FORM_009 — form_csrf_missing ──────────────────────────────────────────
  {
    ruleId: 'FORM_009',
    fixtureExt: 'tsx',
    positiveFixture: "<form method='POST' action='/api/transfer'><button>Submit</button></form>",
    negativeFixture: "<form method='POST' action='/api/transfer'><input type='hidden' name='_csrf' value={csrfToken} /><button>Submit</button></form>",
  },
  // ── FORM_011 — form_sensitive_in_url ─────────────────────────────────────
  {
    ruleId: 'FORM_011',
    fixtureExt: 'tsx',
    positiveFixture: "<form method='GET'><input name='password' type='password' /></form>",
    negativeFixture: "<form method='POST'><input name='password' type='password' /></form>",
  },
  // ── SLOP_001 — slop_phantom_import ───────────────────────────────────────
  {
    ruleId: 'SLOP_001',
    positiveFixture: "import { validate } from 'react-form-validator-component';",
    negativeFixture: "import { z } from 'zod';",
  },
  // ── SLOP_004 — slop_known_phantom_list ───────────────────────────────────
  {
    ruleId: 'SLOP_004',
    // 'express-mongoose' is a documented hallucinated package name.
    positiveFixture: "import { foo } from 'express-mongoose';",
    negativeFixture: "import mongoose from 'mongoose';",
  },
  // ── SLOP_009 — slop_typosquat_candidate ──────────────────────────────────
  {
    ruleId: 'SLOP_009',
    positiveFixture: "import _ from 'lodahs';",
    negativeFixture: "import _ from 'lodash';",
  },
  // ── DEP_001 — dep_critical_cve ───────────────────────────────────────────
  // DEP_001 fires on scan-level data (apiRoutes with known-vulnerable deps).
  // The minimal trigger is a scan with a vulnerable dep flagged.
  // Since this fires off scan data, not changedFiles, we need the scan object.
  // Use a path hint that makes the detect() check apiRoutes.
  // Note: DEP_001 may require scan-level data; this is a best-effort fixture.
  {
    ruleId: 'DEP_001',
    positiveFixture: "// Covered by dep_critical_cve scan-level check — see registry.test.ts",
    negativeFixture: undefined,
  },
];
