import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, TS_EXT, isTestPath, isCommentLine } from './helpers';

function isTrpcFile(content: string): boolean {
  return /from ['"]@trpc\/|require\(['"]@trpc\//.test(content) || /router\(|procedure\.|publicProcedure\.|protectedProcedure\./.test(content);
}

export const TRPC_RULES: PrometheusRule[] = [
  {
    id: 'TRPC_001',
    category: 'trpc_no_input_validation',
    description: 'tRPC procedures without .input() validation accept any payload — a type-unsafe API boundary.',
    severity: 'HIGH',
    tags: ['trpc', 'validation', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without .input(schema), tRPC infers the input as unknown at runtime. Any caller can send unexpected shapes that crash in the resolver. All procedures that accept arguments must declare an input schema.',
      commonViolations: ['publicProcedure.query(async () => {...})', 'protectedProcedure.mutation(async ({ ctx }) => {...})'],
      goodExample: 'publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ input }) => {...})',
      badExample: 'publicProcedure.mutation(async ({ ctx, input }) => { /* input is unknown */ })',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_no_input_validation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:publicProcedure|protectedProcedure|procedure)\.(query|mutation)\(/.test(line) && !lines.slice(Math.max(0, i - 3), i + 1).join('\n').includes('.input(')) {
            findings.push({ severity, category: 'trpc_no_input_validation', file: path, line: i + 1, message: 'tRPC procedure without .input() validation — accepts any payload.', suggestion: 'Add .input(z.object({...})) before .query() or .mutation().' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_002',
    category: 'trpc_throw_non_trpc_error',
    description: 'Throwing a plain Error instead of TRPCError in a procedure exposes the full error message to the client.',
    severity: 'HIGH',
    tags: ['trpc', 'security', 'errors'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'tRPC wraps TRPCError cleanly. Plain Error objects are re-thrown as INTERNAL_SERVER_ERROR with the full message visible to clients in development (and potentially in production depending on config). Use TRPCError to control code and message.',
      commonViolations: ["throw new Error('User not found')", "throw new Error('Database connection failed')"],
      goodExample: "throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' })",
      badExample: "throw new Error('Internal DB error: ' + err.message)  // leaks DB details to client",
      relatedPlaybooks: ['api-errors.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_throw_non_trpc_error', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/throw\s+new\s+Error\(/.test(line) && !line.includes('TRPCError')) {
            findings.push({ severity, category: 'trpc_throw_non_trpc_error', file: path, line: i + 1, message: 'Plain Error thrown in tRPC procedure — use TRPCError for controlled client-facing messages.', suggestion: "throw new TRPCError({ code: 'NOT_FOUND', message: '...' }) from '@trpc/server'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_003',
    category: 'trpc_unprotected_mutation',
    description: 'Mutations that modify data using publicProcedure should be audited — they require no authentication.',
    severity: 'HIGH',
    tags: ['trpc', 'security', 'auth'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'publicProcedure mutations are callable by unauthenticated users. Creating/modifying/deleting resources without authentication is almost always a security bug. Use protectedProcedure or adminProcedure instead.',
      commonViolations: ['publicProcedure.input(schema).mutation(async ({ input }) => { await db.insert(...) })'],
      goodExample: 'protectedProcedure.input(schema).mutation(async ({ ctx, input }) => { ... })',
      badExample: 'publicProcedure.mutation(async ({ input }) => { await db.users.create(input) })  // anyone can create users',
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_unprotected_mutation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/publicProcedure(?:\.\w+)*\.mutation\(/.test(line)) {
            findings.push({ severity, category: 'trpc_unprotected_mutation', file: path, line: i + 1, message: 'publicProcedure mutation — callable by unauthenticated users.', suggestion: 'Use protectedProcedure (or adminProcedure) for all data-modifying operations.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_004',
    category: 'trpc_console_in_procedure',
    description: 'console.log inside tRPC procedures bypasses structured logging and will leak sensitive data in production.',
    severity: 'MEDIUM',
    tags: ['trpc', 'logging', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'console.log in server-side procedures dumps to stdout/stderr as plain text, often including request bodies, user data, or tokens. Use a structured logger (Pino, Winston) that supports log levels and redaction.',
      commonViolations: ['console.log(ctx.session)', 'console.log(input)', 'console.error(err)'],
      goodExample: 'logger.info({ userId: ctx.session.userId }, "Processing request")',
      badExample: 'console.log("input:", JSON.stringify(input))  // may log passwords/tokens',
      relatedPlaybooks: ['logging.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_console_in_procedure', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/console\.(log|error|warn|debug)\(/.test(line)) {
            findings.push({ severity, category: 'trpc_console_in_procedure', file: path, line: i + 1, message: 'console.* in tRPC procedure — use a structured logger.', suggestion: 'Replace with logger.info/error from your logging library. Redact sensitive fields.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_005',
    category: 'trpc_input_spread_to_db',
    description: 'Spreading tRPC input directly into database operations is a mass-assignment vulnerability.',
    severity: 'HIGH',
    tags: ['trpc', 'security', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Even with a Zod schema, spreading input into a DB operation forwards all schema-defined fields. If the schema ever adds a field like "isAdmin" and the DB column exists, it becomes settable. Explicitly pick the fields you intend to write.',
      commonViolations: ['await db.users.create({ data: input })', 'await prisma.post.update({ data: { ...input } })'],
      goodExample: 'await prisma.post.update({ where: { id: input.id }, data: { title: input.title, body: input.body } })',
      badExample: 'await prisma.user.update({ where: { id: input.id }, data: { ...input } })  // forwards all fields including future ones',
      relatedPlaybooks: ['database-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_input_spread_to_db', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/data\s*:\s*\{?\s*\.{3}input\b/.test(line) || /data\s*:\s*input\b/.test(line)) {
            findings.push({ severity, category: 'trpc_input_spread_to_db', file: path, line: i + 1, message: 'tRPC input spread directly into DB — mass-assignment risk.', suggestion: 'Explicitly pick fields: { data: { title: input.title, body: input.body } }.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_006',
    category: 'trpc_ctx_passed_to_service',
    description: 'Passing the full tRPC ctx to service functions couples your business logic to the tRPC request context.',
    severity: 'LOW',
    tags: ['trpc', 'architecture', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Service functions that accept ctx are impossible to test outside of tRPC (they need a fake request context). Extract only the needed values (userId, db, logger) and pass those as plain arguments.',
      commonViolations: ['await userService.getProfile(ctx)', 'await createPost(ctx, input)'],
      goodExample: 'await userService.getProfile({ userId: ctx.session.userId, db: ctx.db })',
      badExample: 'await postService.create(ctx, input)  // service is now coupled to HTTP request',
      relatedPlaybooks: ['architecture.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_ctx_passed_to_service', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bService\.\w+\(ctx\b|\bService\.\w+\(ctx,/.test(line) || /await \w+\(ctx\)|await \w+\(ctx,/.test(line)) {
            findings.push({ severity, category: 'trpc_ctx_passed_to_service', file: path, line: i + 1, message: 'Full ctx passed to service function — couples business logic to tRPC context.', suggestion: 'Destructure and pass specific values: service.fn({ userId: ctx.session.userId, db: ctx.db }).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_007',
    category: 'trpc_large_query_no_limit',
    description: 'tRPC query procedures that fetch lists without a limit parameter return unbounded results.',
    severity: 'HIGH',
    tags: ['trpc', 'performance', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'A query returning all records crashes production systems when tables grow. Always require a limit/cursor in the input schema. Enforce it server-side even if the client is trusted.',
      commonViolations: ['publicProcedure.query(async ({ ctx }) => ctx.db.posts.findMany())'],
      goodExample: 'publicProcedure.input(z.object({ limit: z.number().int().max(100).default(20), cursor: z.string().optional() })).query(...)',
      badExample: 'publicProcedure.query(async ({ ctx }) => ctx.db.posts.findMany())  // returns all posts',
      relatedPlaybooks: ['api-design.md'],
      relatedAgents: ['api-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_large_query_no_limit', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/findMany\(\)|findMany\(\{(?![^}]*take)[^}]*\}\)/.test(line)) {
            const surroundingContext = lines.slice(Math.max(0, i - 10), i + 5).join('\n');
            if (!surroundingContext.includes('take:') && !surroundingContext.includes('limit:') && !surroundingContext.includes('input.take') && !surroundingContext.includes('input.limit')) {
              findings.push({ severity, category: 'trpc_large_query_no_limit', file: path, line: i + 1, message: 'findMany() without a take/limit — unbounded result set.', suggestion: 'Add take: input.limit to all findMany calls and require limit in the input schema.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_008',
    category: 'trpc_no_output_schema',
    description: 'tRPC procedures without .output() validation can leak fields added to the database model.',
    severity: 'MEDIUM',
    tags: ['trpc', 'security', 'privacy'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without .output(), the response type is inferred from the resolver return. If a new field (passwordHash, stripeCustomerId) is added to the Prisma model, it ships to clients automatically. .output() acts as an explicit allowlist.',
      commonViolations: ['query returning prisma model directly without field selection'],
      goodExample: 'protectedProcedure.output(z.object({ id: z.string(), name: z.string() })).query(...)',
      badExample: 'query(async () => prisma.user.findUnique({ where: { id } }))  // leaks passwordHash on schema change',
      relatedPlaybooks: ['privacy.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_no_output_schema', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!TS_EXT.test(path) || !isTrpcFile(content)) continue;
        if (!content.includes('.output(') && content.includes('prisma.') && content.includes('.query(')) {
          findings.push({ severity, category: 'trpc_no_output_schema', file: path, message: 'tRPC queries return Prisma records without .output() — new model fields ship to clients automatically.', suggestion: 'Add .output(z.object({...})) to explicitly allowlist response fields.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_009',
    category: 'trpc_any_context',
    description: 'Using any or unknown for the tRPC context type removes all type safety in procedures.',
    severity: 'MEDIUM',
    tags: ['trpc', 'typescript'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'The ctx type flows into every procedure. If it is typed as any, accessing ctx.session, ctx.db, or ctx.user returns any, masking missing auth checks and enabling property access that fails at runtime.',
      commonViolations: ['({ ctx }: { ctx: any })', 'createContext = async (): Promise<any> => ({...})'],
      goodExample: 'type Context = { session: Session | null; db: PrismaClient };\ncreateContext = async (): Promise<Context> => ({...})',
      badExample: 'createContext = async (): Promise<any> => ({ session, db })  // all ctx access is any',
      relatedPlaybooks: ['typescript-conventions.md'],
      relatedAgents: ['type-safety-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_any_context', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/createContext[^=]*=.*Promise<any>|Context\s*=\s*any\b|ctx\s*:\s*any\b/.test(line)) {
            findings.push({ severity, category: 'trpc_any_context', file: path, line: i + 1, message: 'tRPC context typed as any — removes type safety from all procedures.', suggestion: 'Define a typed Context interface: type Context = { session: Session | null; db: PrismaClient }.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_010',
    category: 'trpc_missing_not_found',
    description: 'Queries that can return null should throw TRPCError NOT_FOUND instead of returning null to clients.',
    severity: 'MEDIUM',
    tags: ['trpc', 'api', 'dx'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Returning null from a query leaks "this resource exists as null vs. does not exist" ambiguity and forces every client to handle null. A NOT_FOUND TRPCError gives clients a clean HTTP 404 with a useful message.',
      commonViolations: ['const user = await prisma.user.findUnique(...); return user;'],
      goodExample: 'const user = await prisma.user.findUnique(...);\nif (!user) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });\nreturn user;',
      badExample: 'return await prisma.user.findUnique({ where: { id: input.id } });  // null if missing',
      relatedPlaybooks: ['api-errors.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_missing_not_found', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/return await (?:prisma|db)\.\w+\.findUnique\(/.test(line) || /return await (?:prisma|db)\.\w+\.findFirst\(/.test(line)) {
            findings.push({ severity, category: 'trpc_missing_not_found', file: path, line: i + 1, message: 'findUnique/findFirst returned directly — returns null if not found.', suggestion: "Check the result and throw new TRPCError({ code: 'NOT_FOUND' }) when null." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_011',
    category: 'trpc_sequential_awaits',
    description: 'Sequential independent await calls in tRPC procedures should be parallelized with Promise.all().',
    severity: 'LOW',
    tags: ['trpc', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Sequential awaits for independent async operations add latencies: 50ms + 50ms = 100ms. Promise.all([op1, op2]) runs them in parallel: max(50ms, 50ms) = 50ms. Critical for API procedures called on every page load.',
      commonViolations: ['const user = await ctx.db.user.findUnique(...)\nconst posts = await ctx.db.post.findMany(...)'],
      goodExample: 'const [user, posts] = await Promise.all([ctx.db.user.findUnique(...), ctx.db.post.findMany(...)])',
      badExample: 'const user = await db.user.findUnique(...);\nconst posts = await db.post.findMany(...);  // 2× latency',
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_sequential_awaits', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length - 2; i++) {
          const line1 = lines[i]!;
          const line2 = lines[i + 1] ?? '';
          const line3 = lines[i + 2] ?? '';
          if (/^\s+const \w+ = await (?:ctx\.db|prisma|db)\./.test(line1) &&
              /^\s+const \w+ = await (?:ctx\.db|prisma|db)\./.test(line2)) {
            if (!line3.includes('Promise.all') && !line1.includes('.findUnique') && !line1.includes('// parallel')) {
              findings.push({ severity, category: 'trpc_sequential_awaits', file: path, line: i + 1, message: 'Sequential independent database awaits — combine with Promise.all() for parallel execution.', suggestion: 'const [a, b] = await Promise.all([db.query1(), db.query2()]).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_012',
    category: 'trpc_no_rate_limit',
    description: 'Public tRPC endpoints without rate limiting are vulnerable to abuse and enumeration attacks.',
    severity: 'HIGH',
    tags: ['trpc', 'security', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Endpoints like getUser, sendVerificationEmail, or checkUsername without rate limiting can be hammered to enumerate users, exhaust email quotas, or DoS the service. Implement rate limiting at middleware or edge layer.',
      commonViolations: ['publicProcedure.input(EmailSchema).mutation(sendVerificationEmail)'],
      goodExample: 'const rateLimitedProcedure = publicProcedure.use(rateLimitMiddleware)\nrateLimitedProcedure.input(EmailSchema).mutation(sendVerificationEmail)',
      badExample: 'publicProcedure.input(EmailSchema).mutation(async ({ input }) => sendEmail(input.email))  // no rate limit',
      relatedPlaybooks: ['security-review.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_no_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        if (content.includes('rateLimit') || content.includes('rate_limit') || content.includes('rateLimiter')) return findings;
        if (content.includes('publicProcedure') && /send(?:Email|Otp|Code|Sms|Verification)|check(?:Email|Username|Availability)/.test(content)) {
          findings.push({ severity, category: 'trpc_no_rate_limit', file: path, message: 'Public procedure sends messages or checks availability without rate limiting.', suggestion: 'Add rate limit middleware (e.g. upstash-ratelimit) to sensitive public procedures.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_013',
    category: 'trpc_missing_error_boundary',
    description: 'tRPC onError handler not configured — unhandled errors emit raw stack traces to server logs.',
    severity: 'MEDIUM',
    tags: ['trpc', 'errors', 'observability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without an onError callback on the tRPC router, errors from procedures are not centrally logged or monitored. Add an onError handler to send errors to Sentry/Datadog and sanitize messages before they reach clients.',
      commonViolations: ['createTRPCRouter({...}) without onError'],
      goodExample: "createTRPCRouter({...})\nrouter.createCaller({ onError: ({ error }) => captureException(error) })",
      badExample: 'const appRouter = createTRPCRouter({ ... });  // no error callback',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_missing_error_boundary', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        if (content.includes('createTRPCRouter') && !content.includes('onError')) {
          findings.push({ severity, category: 'trpc_missing_error_boundary', file: path, message: 'tRPC router without onError handler — errors not centrally monitored.', suggestion: 'Add onError: ({ error, path }) => captureException(error) to your tRPC server config.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_014',
    category: 'trpc_no_transformer',
    description: 'tRPC without a data transformer (superjson) cannot serialize Date, Map, Set, or undefined correctly.',
    severity: 'MEDIUM',
    tags: ['trpc', 'dx', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Without a transformer, tRPC uses JSON serialization which converts Date to string, drops undefined, and cannot handle Map or Set. superjson preserves these types end-to-end between server and client.',
      commonViolations: ['initTRPC.create()  // no transformer'],
      goodExample: "import superjson from 'superjson';\nconst t = initTRPC.create({ transformer: superjson })",
      badExample: 'const t = initTRPC.create();  // Dates become strings on the client',
      relatedPlaybooks: ['trpc-setup.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_no_transformer', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        if (/initTRPC\.create\(/.test(content) && !content.includes('transformer:') && !content.includes('superjson')) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (/initTRPC\.create\(/.test(lines[i]!)) {
              findings.push({ severity, category: 'trpc_no_transformer', file: path, line: i + 1, message: 'initTRPC.create() without a data transformer — Date/undefined/Map not serialized correctly.', suggestion: "Install superjson and add transformer: superjson to initTRPC.create({...})." });
              break;
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_015',
    category: 'trpc_procedure_too_long',
    description: 'Procedure resolvers over 50 lines are doing too much — extract business logic into service functions.',
    severity: 'LOW',
    tags: ['trpc', 'quality', 'architecture'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Long resolvers mix HTTP transport concerns with business logic, are impossible to unit test, and become maintenance nightmares. Resolvers should parse input, call a service, and return the result — nothing more.',
      commonViolations: ['query(async ({ ctx, input }) => { // 80 lines of business logic })'],
      goodExample: 'query(async ({ ctx, input }) => userService.getProfile({ userId: input.id, db: ctx.db }))',
      badExample: 'query(async ({ ctx, input }) => { /* 80 lines: DB queries, transforms, email sends */ })',
      relatedPlaybooks: ['architecture.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_procedure_too_long', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\.(query|mutation)\(async/.test(line)) {
            let depth = 0;
            let start = i;
            let end = i;
            for (let j = i; j < Math.min(lines.length, i + 120); j++) {
              depth += (lines[j]!.match(/\{/g) || []).length;
              depth -= (lines[j]!.match(/\}/g) || []).length;
              if (depth <= 0 && j > i) { end = j; break; }
            }
            if (end - start > 50) {
              findings.push({ severity, category: 'trpc_procedure_too_long', file: path, line: i + 1, message: `Procedure resolver is ${end - start} lines — extract into a service function.`, suggestion: 'Move business logic to a service layer; keep the resolver as a thin adapter.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_016',
    category: 'trpc_cors_wildcard',
    description: 'tRPC handler with CORS origin: "*" allows any website to call your API with credentials.',
    severity: 'BLOCKER',
    tags: ['trpc', 'security', 'cors'],
    sinceVersion: '3.0.0',
    explain: {
      why: "CORS origin: '*' with credentials:true is a browser security error. Even without credentials, wildcard CORS on an authenticated API lets any website make cross-origin requests and read the response.",
      commonViolations: ["cors({ origin: '*' })", "origins: ['*']"],
      goodExample: "cors({ origin: process.env.ALLOWED_ORIGIN, credentials: true })",
      badExample: "cors({ origin: '*', credentials: true })  // browser blocks this — but catches developers off guard",
      relatedPlaybooks: ['security-review.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_cors_wildcard', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/origin\s*:\s*['"][*]['"]/.test(line)) {
            findings.push({ severity, category: 'trpc_cors_wildcard', file: path, line: i + 1, message: "CORS wildcard origin '*' — restricts to specific allowed origins.", suggestion: "Use origin: process.env.ALLOWED_ORIGIN or an allowlist array of trusted origins." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_017',
    category: 'trpc_sync_io_in_procedure',
    description: 'Synchronous file I/O inside tRPC procedures blocks the Node.js event loop.',
    severity: 'HIGH',
    tags: ['trpc', 'performance', 'node'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'fs.readFileSync(), fs.writeFileSync() block the single Node.js thread. While one request reads a file, all other concurrent requests stall. Use fs.promises (async) alternatives.',
      commonViolations: ['fs.readFileSync(path)', 'fs.writeFileSync(path, data)'],
      goodExample: 'const data = await fs.promises.readFile(path, "utf8")',
      badExample: 'const template = fs.readFileSync(templatePath, "utf8");  // blocks all concurrent requests',
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_sync_io_in_procedure', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bfs\.(?:readFileSync|writeFileSync|existsSync|mkdirSync|readdirSync)\(/.test(line)) {
            findings.push({ severity, category: 'trpc_sync_io_in_procedure', file: path, line: i + 1, message: 'Synchronous fs operation in tRPC procedure blocks the event loop.', suggestion: 'Use fs.promises.readFile / fs.promises.writeFile (async/await).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_018',
    category: 'trpc_no_abort_signal',
    description: 'Long-running tRPC queries should pass the abort signal from the request to cancellable operations.',
    severity: 'LOW',
    tags: ['trpc', 'performance', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: "When a client navigates away, tRPC cancels the request. Without forwarding the AbortSignal, the server continues running expensive DB queries for no one. Prisma's findMany supports a signal option.",
      commonViolations: ['await prisma.post.findMany({ where: {...} })  // no signal'],
      goodExample: 'await prisma.post.findMany({ where: {...}, signal: opts?.signal })',
      badExample: 'query(async ({ input }) => { return await db.heavyQuery(input) })  // runs to completion even if client left',
      relatedPlaybooks: ['performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_no_abort_signal', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        if (content.includes('AbortSignal') || content.includes('signal:') || !content.includes('findMany')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/findMany\(/.test(line) && !line.includes('signal')) {
            findings.push({ severity, category: 'trpc_no_abort_signal', file: path, line: i + 1, message: 'findMany without an AbortSignal — query runs even after client disconnects.', suggestion: 'Pass signal: opts?.signal to findMany to cancel in-flight queries.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_019',
    category: 'trpc_secret_in_context',
    description: 'Storing raw secrets (tokens, keys) on the tRPC context makes them accessible from all procedures.',
    severity: 'HIGH',
    tags: ['trpc', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If ctx.apiKey or ctx.secretToken is set, every procedure and middleware in the call chain can access the raw secret. Pass pre-initialized service clients (e.g. ctx.stripe, ctx.sendgrid) with the secret already embedded.',
      commonViolations: ['return { session, apiKey: process.env.API_KEY }', 'ctx.stripeSecret = process.env.STRIPE_SECRET'],
      goodExample: 'return { session, db, stripe: new Stripe(process.env.STRIPE_SECRET_KEY!) }  // client, not raw key',
      badExample: "return { session, stripeKey: process.env.STRIPE_SECRET_KEY }  // raw secret on ctx",
      relatedPlaybooks: ['security-review.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_secret_in_context', config.severityRules);
      const SECRET_RE = /(?:apiKey|secretKey|secret|token|password|privateKey)\s*:\s*process\.env\./;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SECRET_RE.test(line) && /createContext|return\s*\{/.test(lines.slice(Math.max(0, i - 5), i + 1).join('\n'))) {
            findings.push({ severity, category: 'trpc_secret_in_context', file: path, line: i + 1, message: 'Raw secret/token stored on tRPC context — accessible from all procedures.', suggestion: 'Pass pre-initialized service clients instead of raw keys.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_020',
    category: 'trpc_missing_auth_check',
    description: 'Accessing ctx.session.user without a null check will crash when called by an unauthenticated user.',
    severity: 'HIGH',
    tags: ['trpc', 'auth', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If a publicProcedure or improperly-protected procedure accesses ctx.session.user.id without checking session existence, it throws a TypeError when called without authentication, creating an unhandled 500.',
      commonViolations: ['const userId = ctx.session.user.id  // in publicProcedure'],
      goodExample: 'if (!ctx.session?.user) throw new TRPCError({ code: "UNAUTHORIZED" });\nconst userId = ctx.session.user.id;',
      badExample: 'query(async ({ ctx }) => {\n  const userId = ctx.session.user.id;  // crashes if unauthenticated\n})',
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_missing_auth_check', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/ctx\.session\.user\.\w+/.test(line) && !/ctx\.session\?\.user/.test(line)) {
            findings.push({ severity, category: 'trpc_missing_auth_check', file: path, line: i + 1, message: 'ctx.session.user accessed without null check — crashes for unauthenticated callers.', suggestion: "Check if (!ctx.session?.user) and throw TRPCError UNAUTHORIZED, or use protectedProcedure." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_021',
    category: 'trpc_hardcoded_id',
    description: 'Hardcoded IDs or user references in procedures create data isolation bugs in multi-tenant systems.',
    severity: 'HIGH',
    tags: ['trpc', 'security', 'multi-tenant'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Hardcoding "admin" user IDs, tenant IDs, or magic values in server-side code bypasses the authorization model. What looks like a test shortcut becomes a production security hole.',
      commonViolations: ["userId: 'user_admin'", "tenantId: 'default'", "ownerId: '00000000-0000-...'"],
      goodExample: 'const userId = ctx.session.user.id;  // always from authenticated session',
      badExample: "const userId = 'admin';  // hardcoded — bypasses auth",
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_hardcoded_id', config.severityRules);
      const HARDCODED_RE = /(?:userId|user_id|tenantId|tenant_id|ownerId|owner_id)\s*[=:]\s*['"][a-z0-9_-]{3,}['"]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (HARDCODED_RE.test(line)) {
            findings.push({ severity, category: 'trpc_hardcoded_id', file: path, line: i + 1, message: 'Hardcoded user/tenant ID in procedure — use authenticated session identity.', suggestion: 'Replace with ctx.session.user.id from the verified session context.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_022',
    category: 'trpc_subscription_no_cleanup',
    description: 'tRPC subscriptions without a cleanup function leak memory when clients disconnect.',
    severity: 'HIGH',
    tags: ['trpc', 'reliability', 'memory'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Subscriptions open event listeners, database watches, or polling intervals. Without returning a cleanup function, these run forever after the client disconnects, leaking memory and connections.',
      commonViolations: ['subscription(async function* () { /* no cleanup */ })'],
      goodExample: "subscription(async function* () {\n  const cleanup = subscribeToEvents(emit);\n  try { yield* events; } finally { cleanup(); }\n})",
      badExample: "subscription(async function* () {\n  setInterval(() => emit.next(data), 1000);\n  // interval never cleared on disconnect\n})",
      relatedPlaybooks: ['trpc-subscriptions.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_subscription_no_cleanup', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.subscription\(/.test(line) && (/setInterval|addEventListener|EventEmitter/.test(content))) {
            const block = lines.slice(i, Math.min(lines.length, i + 30)).join('\n');
            if (!block.includes('finally') && !block.includes('cleanup') && !block.includes('clearInterval') && !block.includes('removeEventListener')) {
              findings.push({ severity, category: 'trpc_subscription_no_cleanup', file: path, line: i + 1, message: 'tRPC subscription with event listeners but no cleanup — memory leak on disconnect.', suggestion: 'Use try/finally to clean up intervals, listeners, or subscriptions when the generator exits.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_023',
    category: 'trpc_authorization_by_role_string',
    description: 'Role-based authorization using raw string comparison is fragile — a typo silently grants or denies access.',
    severity: 'HIGH',
    tags: ['trpc', 'auth', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Checking ctx.session.user.role === 'admin' fails silently if the stored value is 'ADMIN' or 'Admin'. Use an enum or const and strict equality via a type-safe guard function.",
      commonViolations: ["if (ctx.session.user.role !== 'admin') throw ...", "if (ctx.session.user.role === 'superuser')"],
      goodExample: "if (ctx.session.user.role !== UserRole.ADMIN) throw new TRPCError({ code: 'FORBIDDEN' })",
      badExample: "if (ctx.session.user.role !== 'admin') throw new TRPCError({ code: 'FORBIDDEN' })  // typo = silent bug",
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['auth-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_authorization_by_role_string', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.role\s*[!=]==\s*['"][a-z_]+['"]/.test(line)) {
            findings.push({ severity, category: 'trpc_authorization_by_role_string', file: path, line: i + 1, message: 'Role check using string literal — use an enum to prevent typo-driven security bugs.', suggestion: 'Define const enum UserRole { ADMIN = "ADMIN" } and compare against UserRole.ADMIN.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_024',
    category: 'trpc_missing_pagination_cursor',
    description: 'Offset-based pagination (skip/offset) breaks at scale — use cursor-based pagination for reliability.',
    severity: 'MEDIUM',
    tags: ['trpc', 'performance', 'api'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Skip-based pagination requires the database to scan and discard rows. At offset 10000, this is extremely slow. Cursor-based pagination (WHERE id > cursor) is O(1) regardless of page depth.',
      commonViolations: ['skip: input.page * input.limit', 'offset: pageNumber * pageSize'],
      goodExample: 'findMany({ take: limit + 1, cursor: cursor ? { id: cursor } : undefined, orderBy: { id: "asc" } })',
      badExample: 'findMany({ skip: input.page * 20, take: 20 })  // O(n) scan at deep pages',
      relatedPlaybooks: ['api-design.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_missing_pagination_cursor', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/skip\s*:\s*(?:input\.page|page)\s*\*/.test(line) || /offset\s*:\s*(?:input\.page|pageNum)/.test(line)) {
            findings.push({ severity, category: 'trpc_missing_pagination_cursor', file: path, line: i + 1, message: 'Offset-based pagination — slow at scale. Use cursor-based pagination instead.', suggestion: 'Use cursor: { id: lastSeenId } with take: N+1 to detect next page.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'TRPC_025',
    category: 'trpc_missing_zod_import',
    description: 'tRPC files importing validation schemas should import directly from "zod" for tree-shaking.',
    severity: 'LOW',
    tags: ['trpc', 'dx', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Re-exporting Zod types through barrel files (import { z } from "@/lib/validations") prevents bundlers from tree-shaking unused validators and creates circular dependency risk.',
      commonViolations: ["import { z } from '@/lib/validations'", "import { z } from '@/utils/schema'"],
      goodExample: "import { z } from 'zod'",
      badExample: "import { z } from '@/lib/validations'  // barrel re-export — prevents tree-shaking",
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('trpc_missing_zod_import', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isTrpcFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/import\s*\{[^}]*\bz\b[^}]*\}\s*from\s*['"](?!zod)@?[^'"]+['"]/.test(line) && !line.includes("from 'zod'")) {
            if (/lib\/valid|utils\/schema|lib\/schema|utils\/zod/.test(line)) {
              findings.push({ severity, category: 'trpc_missing_zod_import', file: path, line: i + 1, message: 'Importing z from a barrel file instead of "zod" directly.', suggestion: "Import directly: import { z } from 'zod'" });
            }
          }
        }
      }
      return findings;
    },
  },
];
