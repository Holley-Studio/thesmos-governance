// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, SQL_EXT, isTestPath, isCommentLine } from './helpers';

function isPrismaFile(content: string): boolean {
  return /from ['"]@prisma\/client['"]|prisma\.\w+\.\w+\(|PrismaClient/.test(content);
}

export const PRISMA_RULES: ThesmosRule[] = [
  {
    id: 'PRISMA_001',
    category: 'prisma_findmany_no_limit',
    description: 'prisma.findMany() without a take limit returns the full table — catastrophic on large datasets.',
    severity: 'HIGH',
    tags: ['prisma', 'performance', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'An unbounded findMany loads every row into Node.js memory. A 1M-row table kills the process. Always require a take (or limit from the caller) as a defensive cap.',
      commonViolations: ['prisma.post.findMany()', 'prisma.user.findMany({ where: { active: true } })'],
      goodExample: 'prisma.post.findMany({ take: 50, cursor: { id: cursor }, orderBy: { id: "asc" } })',
      badExample: 'const allUsers = await prisma.user.findMany();  // crashes when table has 500k rows',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_findmany_no_limit', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.findMany\(\)/.test(line)) {
            findings.push({ severity, category: 'prisma_findmany_no_limit', file: path, line: i + 1, message: 'findMany() with no arguments returns the entire table.', suggestion: 'Always pass take: N. For lists, require a limit input from the caller.' });
          } else if (/prisma\.\w+\.findMany\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
            if (!block.includes('take:') && !block.includes('limit:') && !block.includes('take ')) {
              findings.push({ severity, category: 'prisma_findmany_no_limit', file: path, line: i + 1, message: 'findMany() without take — unbounded result set.', suggestion: 'Add take: input.limit (max 100) to prevent full-table loads.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_002',
    category: 'prisma_n_plus_one',
    description: 'Fetching related records inside a loop is an N+1 query — use include or select to eager-load.',
    severity: 'HIGH',
    tags: ['prisma', 'performance', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'For 100 posts, querying each author separately produces 101 database queries. Use include: { author: true } to fetch authors in one JOIN. N+1 is the single most common cause of slow API responses.',
      commonViolations: ['posts.map(post => prisma.user.findUnique({ where: { id: post.authorId } }))'],
      goodExample: 'prisma.post.findMany({ include: { author: true } })',
      badExample: 'const authors = await Promise.all(posts.map(p => prisma.user.findUnique({ where: { id: p.authorId } })));',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_n_plus_one', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.map\s*\(\s*(?:async\s*)?\w+\s*=>/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
            if (/prisma\.\w+\.(?:findUnique|findFirst|findMany)\(/.test(block)) {
              findings.push({ severity, category: 'prisma_n_plus_one', file: path, line: i + 1, message: 'Prisma query inside .map() — N+1 query pattern.', suggestion: 'Use include: { relation: true } on the parent query to eager-load related records.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_003',
    category: 'prisma_raw_query_injection',
    description: '$queryRaw and $executeRaw with template literals are vulnerable to SQL injection if user input is interpolated.',
    severity: 'BLOCKER',
    tags: ['prisma', 'security', 'sql-injection'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'prisma.$queryRaw`SELECT * FROM users WHERE id = ${userId}` is safe (parameterized). But prisma.$queryRaw(`SELECT * FROM users WHERE id = ${userId}`) — with a regular string — is direct SQL injection.',
      commonViolations: ['prisma.$queryRaw(`SELECT * WHERE id = ${input.id}`)', 'prisma.$executeRaw(`UPDATE users SET role = "${role}"`)'],
      goodExample: 'prisma.$queryRaw`SELECT * FROM users WHERE id = ${input.id}`  // tagged template = parameterized',
      badExample: 'prisma.$queryRaw(`SELECT * WHERE name = "${input.name}"`)  // ⚠ SQL injection',
      relatedPlaybooks: ['database-security.md'],
      relatedAgents: ['security-reviewer', 'database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_raw_query_injection', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\$(?:queryRaw|executeRaw)\(/.test(line) && !line.includes('Prisma.sql')) {
            findings.push({ severity, category: 'prisma_raw_query_injection', file: path, line: i + 1, message: '$queryRaw/$executeRaw called as function (not tagged template) — SQL injection risk.', suggestion: 'Use tagged template: prisma.$queryRaw`SELECT ... WHERE id = ${param}` or Prisma.sql``.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_004',
    category: 'prisma_multi_op_no_transaction',
    description: 'Multiple related Prisma writes without a transaction leave the database in a partial state on failure.',
    severity: 'HIGH',
    tags: ['prisma', 'reliability', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If you create a User then a Subscription, a crash between the two writes leaves an orphaned User without a Subscription. Wrap related writes in prisma.$transaction([...]) for atomicity.',
      commonViolations: ['await prisma.user.create(...)\nawait prisma.subscription.create(...)'],
      goodExample: 'await prisma.$transaction([prisma.user.create(...), prisma.subscription.create(...)])',
      badExample: 'const user = await prisma.user.create(...);\nconst sub = await prisma.subscription.create(...);  // if second fails, user exists with no subscription',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_multi_op_no_transaction', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isPrismaFile(content)) continue;
        if (content.includes('$transaction')) return findings;
        const WRITE_RE = /await prisma\.\w+\.(?:create|update|upsert|delete|createMany|updateMany|deleteMany)\(/g;
        const matches = [...content.matchAll(WRITE_RE)];
        if (matches.length >= 2) {
          const lines = content.split('\n');
          let firstLine = -1;
          for (let i = 0; i < lines.length; i++) {
            if (/await prisma\.\w+\.(?:create|update|upsert|delete)\(/.test(lines[i]!)) {
              if (firstLine === -1) firstLine = i + 1;
            }
          }
          if (firstLine > 0) {
            findings.push({ severity, category: 'prisma_multi_op_no_transaction', file: path, line: firstLine, message: 'Multiple Prisma writes without $transaction — partial writes on failure.', suggestion: 'Wrap related writes in await prisma.$transaction([write1, write2]) for atomicity.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_005',
    category: 'prisma_select_star',
    description: 'Fetching all fields with findMany/findUnique (no select) returns sensitive fields and wastes bandwidth.',
    severity: 'MEDIUM',
    tags: ['prisma', 'security', 'performance'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Prisma defaults to SELECT *. If the model has passwordHash, stripeCustomerId, or deletedAt, those ship to the API caller. Explicit select:{} documents intent and acts as a data minimization safeguard.',
      commonViolations: ['prisma.user.findUnique({ where: { id } })', 'prisma.post.findMany({ where: { published: true } })'],
      goodExample: "prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })",
      badExample: 'prisma.user.findUnique({ where: { id } })  // returns passwordHash, stripeCustomerId, etc.',
      relatedPlaybooks: ['privacy.md', 'database-patterns.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_select_star', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.(?:findUnique|findFirst|findMany)\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
            if (!block.includes('select:') && !block.includes('include:') && /(?:user|profile|account|member)/.test(line.toLowerCase())) {
              findings.push({ severity, category: 'prisma_select_star', file: path, line: i + 1, message: 'Fetching user/account without select — may expose sensitive fields.', suggestion: 'Add select: { id: true, name: true, email: true } to allowlist returned fields.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_006',
    category: 'prisma_no_client_singleton',
    description: 'Instantiating PrismaClient inside a function creates a new connection pool on every call.',
    severity: 'HIGH',
    tags: ['prisma', 'performance', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Each PrismaClient instance opens a new connection pool (up to 10 connections by default). Creating one per request exhausts database connections in seconds under load. Singleton pattern is required.',
      commonViolations: ['const prisma = new PrismaClient() inside a handler', 'export async function handler() { const prisma = new PrismaClient(); }'],
      goodExample: '// lib/prisma.ts — singleton\nconst globalForPrisma = globalThis as { prisma?: PrismaClient };\nexport const prisma = globalForPrisma.prisma ?? new PrismaClient();\nif (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;',
      badExample: 'export async function getUser(id: string) { const prisma = new PrismaClient(); ... }  // new pool every call',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_no_client_singleton', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        let insideFunction = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^(?:export\s+)?(?:async\s+)?function\s+|^(?:export\s+)?const\s+\w+\s*=\s*async/.test(line)) insideFunction = 1;
          if (insideFunction > 0) {
            insideFunction += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
            if (/new\s+PrismaClient\(\)/.test(line)) {
              findings.push({ severity, category: 'prisma_no_client_singleton', file: path, line: i + 1, message: 'new PrismaClient() inside a function — creates a new connection pool every call.', suggestion: "Use a module-level singleton. See Next.js Prisma best practices for the globalThis pattern." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_007',
    category: 'prisma_unique_constraint_unhandled',
    description: 'Prisma unique constraint violations (P2002) should be caught and returned as 409 Conflict, not 500.',
    severity: 'HIGH',
    tags: ['prisma', 'errors', 'api'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'When create() fails due to a unique constraint (duplicate email, slug), Prisma throws a PrismaClientKnownRequestError with code P2002. Uncaught, this becomes a 500. Catch it and return 409 Conflict with a user-facing message.',
      commonViolations: ['await prisma.user.create({ data: { email } })  // P2002 → uncaught 500'],
      goodExample: 'try { await prisma.user.create({...}) } catch (e) { if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new TRPCError({ code: "CONFLICT" }); throw e; }',
      badExample: 'const user = await prisma.user.create({ data: { email } });  // P2002 leaks as 500',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_unique_constraint_unhandled', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        if (content.includes('P2002') || content.includes('PrismaClientKnownRequestError')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.create\(\{/.test(line)) {
            const context = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
            if (!context.includes('try {') && !context.includes('catch')) {
              findings.push({ severity, category: 'prisma_unique_constraint_unhandled', file: path, line: i + 1, message: 'prisma.create() without P2002 (unique constraint) error handling — duplicate → 500.', suggestion: 'Catch PrismaClientKnownRequestError with code P2002 and return 409 Conflict.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_008',
    category: 'prisma_soft_delete_missing_filter',
    description: 'Queries that do not filter deleted_at IS NULL silently return soft-deleted records.',
    severity: 'HIGH',
    tags: ['prisma', 'data-integrity', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If your model has a deletedAt column but queries do not filter deletedAt: null, soft-deleted records appear in results. This leaks deleted data and confuses clients that assume returned records are active.',
      commonViolations: ['prisma.post.findMany({ where: { authorId: userId } })  // missing deletedAt: null'],
      goodExample: 'prisma.post.findMany({ where: { authorId: userId, deletedAt: null } })',
      badExample: 'prisma.post.findMany({ where: { authorId: userId } })  // deleted posts appear in list',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_soft_delete_missing_filter', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        if (!content.includes('deletedAt') && !content.includes('deleted_at')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.(?:findMany|findFirst)\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
            if (block.includes('where:') && !block.includes('deletedAt') && !block.includes('deleted_at')) {
              findings.push({ severity, category: 'prisma_soft_delete_missing_filter', file: path, line: i + 1, message: 'Query on soft-delete model missing deletedAt: null filter — returns deleted records.', suggestion: "Add deletedAt: null to the where clause, or use a Prisma middleware that applies it globally." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_009',
    category: 'prisma_updatemany_no_where',
    description: 'updateMany() and deleteMany() without a restrictive where clause affect the entire table.',
    severity: 'BLOCKER',
    tags: ['prisma', 'database', 'data-integrity'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'prisma.post.updateMany({ data: { status: "archived" } }) without a where clause archives every post in the table. This is typically a developer error with catastrophic impact.',
      commonViolations: ['prisma.post.updateMany({ data: { archived: true } })', 'prisma.session.deleteMany({})'],
      goodExample: 'prisma.post.updateMany({ where: { authorId: userId, status: "draft" }, data: { status: "archived" } })',
      badExample: 'prisma.session.deleteMany()  // deletes ALL sessions for ALL users',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_updatemany_no_where', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.(?:updateMany|deleteMany)\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
            if (!block.includes('where:')) {
              findings.push({ severity, category: 'prisma_updatemany_no_where', file: path, line: i + 1, message: 'updateMany/deleteMany without a where clause affects the entire table.', suggestion: 'Always provide a restrictive where clause. Double-check the scope before applying bulk operations.' });
            }
          } else if (/prisma\.\w+\.(?:updateMany|deleteMany)\(\)/.test(line)) {
            findings.push({ severity, category: 'prisma_updatemany_no_where', file: path, line: i + 1, message: 'updateMany/deleteMany with no arguments — affects every row in the table.', suggestion: 'Provide { where: {...}, data: {...} } with a restrictive scope.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_010',
    category: 'prisma_count_no_where',
    description: 'prisma.model.count() without a where clause runs a full-table count — expensive on large tables.',
    severity: 'MEDIUM',
    tags: ['prisma', 'performance', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'SELECT COUNT(*) with no WHERE clause reads every row (or index) in the table. On tables with millions of rows this can take seconds. Cache the count, use an approximate count, or scope with a where clause.',
      commonViolations: ['await prisma.user.count()', 'await prisma.post.count()'],
      goodExample: 'await prisma.user.count({ where: { tenantId: tenant.id } })',
      badExample: 'const total = await prisma.user.count();  // full table scan on 10M-row table',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_count_no_where', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.count\(\)/.test(line)) {
            findings.push({ severity, category: 'prisma_count_no_where', file: path, line: i + 1, message: 'prisma.model.count() with no where clause — full-table count.', suggestion: 'Scope with where: { tenantId: ... } or cache the count value.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_011',
    category: 'prisma_expose_password_hash',
    description: 'Queries on the user model without excluding passwordHash risk exposing the hash in API responses.',
    severity: 'BLOCKER',
    tags: ['prisma', 'security', 'auth'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'If a Prisma User model has a passwordHash field and queries do not exclude it, the hash ships to API clients in any code path that spreads or returns the user object. Even bcrypt hashes are sensitive.',
      commonViolations: ['return await prisma.user.findUnique({ where: { id } })', 'const user = await prisma.user.findFirst(...)'],
      goodExample: "prisma.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })",
      badExample: 'return await prisma.user.findUnique({ where: { id } });  // passwordHash ships to client',
      relatedPlaybooks: ['auth.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_expose_password_hash', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        if (!content.includes('passwordHash') && !content.includes('password_hash') && !content.includes('hashedPassword')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.user\.(?:findUnique|findFirst|findMany)\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
            if (!block.includes('select:') && !block.includes('omit:')) {
              findings.push({ severity, category: 'prisma_expose_password_hash', file: path, line: i + 1, message: 'User query without select — passwordHash may be returned to API caller.', suggestion: 'Add select: { id: true, email: true, name: true } to exclude sensitive auth fields.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_012',
    category: 'prisma_transaction_no_timeout',
    description: 'Interactive Prisma transactions without a timeout can hold locks indefinitely, causing database gridlock.',
    severity: 'HIGH',
    tags: ['prisma', 'reliability', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'prisma.$transaction(async (tx) => {...}) holds a database transaction open until the callback resolves. Without a timeout, a slow network call or bug inside the callback holds table locks for minutes, blocking all other writes.',
      commonViolations: ['prisma.$transaction(async (tx) => { await externalApiCall(); ... })'],
      goodExample: "prisma.$transaction(async (tx) => { ... }, { timeout: 5000, maxWait: 2000 })",
      badExample: 'prisma.$transaction(async (tx) => { await fetch(externalUrl); await tx.user.update(...) })  // fetch hanging = locked table',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_transaction_no_timeout', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\$transaction\(async/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
            if (!block.includes('timeout') && (block.includes('fetch(') || block.includes('await '))) {
              findings.push({ severity, category: 'prisma_transaction_no_timeout', file: path, line: i + 1, message: 'Interactive transaction without timeout — can hold DB locks indefinitely.', suggestion: 'Add { timeout: 5000, maxWait: 2000 } as the second argument to $transaction().' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_013',
    category: 'prisma_in_array_unbounded',
    description: 'WHERE IN queries with a potentially large array can exceed database parameter limits or degrade performance.',
    severity: 'MEDIUM',
    tags: ['prisma', 'performance', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'PostgreSQL has a limit of 65535 bind parameters. A WHERE id IN (...) with 10000 UUIDs can hit this limit or create terrible query plans. Batch IN queries or use a JOIN with a CTE instead.',
      commonViolations: ['prisma.user.findMany({ where: { id: { in: userIds } } })  // userIds may be huge'],
      goodExample: '// For large arrays, process in batches of 1000\nconst chunks = chunk(userIds, 1000);\nconst results = await Promise.all(chunks.map(ids => prisma.user.findMany({ where: { id: { in: ids } } })));',
      badExample: 'prisma.user.findMany({ where: { id: { in: allUserIds } } })  // allUserIds may be 100k items',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_in_array_unbounded', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\bin\s*:\s*\w+(?:Ids|List|Array|s)\b/.test(line) && /findMany|findFirst/.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n'))) {
            findings.push({ severity, category: 'prisma_in_array_unbounded', file: path, line: i + 1, message: 'IN query with potentially large array — may hit DB parameter limits.', suggestion: 'Batch in chunks of 1000 or use a JOIN-based approach for large ID sets.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_014',
    category: 'prisma_cascade_delete_risk',
    description: 'Cascading deletes in migrations require review — accidental parent deletion removes all children.',
    severity: 'HIGH',
    tags: ['prisma', 'database', 'data-integrity'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'onDelete: Cascade means deleting a User also deletes all their Posts, Comments, Likes, Subscriptions. A bug that deletes the wrong user wipes their entire data history. Prefer Restrict (prevents deletion if children exist) for critical data.',
      commonViolations: ['onDelete: Cascade  // in schema.prisma relations'],
      goodExample: 'author  User @relation(fields: [authorId], references: [id], onDelete: Restrict)',
      badExample: 'author  User @relation(fields: [authorId], references: [id], onDelete: Cascade)  // user delete = all posts deleted',
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_cascade_delete_risk', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('schema.prisma') && !path.endsWith('.prisma')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/onDelete\s*:\s*Cascade/.test(line)) {
            findings.push({ severity, category: 'prisma_cascade_delete_risk', file: path, line: i + 1, message: 'onDelete: Cascade — parent deletion removes all children. Review intentionality.', suggestion: 'Consider Restrict (prevents deletion if children exist) for business-critical data. Document the decision.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_015',
    category: 'prisma_upsert_race_condition',
    description: 'prisma.upsert() without a unique constraint race condition guard can create duplicate records under concurrent load.',
    severity: 'HIGH',
    tags: ['prisma', 'reliability', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'upsert() is not atomic in all database configurations. Two concurrent requests can both find "not found" and both run the create path, violating uniqueness. Ensure the field used for where has a DB-level unique constraint.',
      commonViolations: ['prisma.user.upsert({ where: { email }, create: {...}, update: {...} })'],
      goodExample: '// Ensure email has @@unique([email]) in schema.prisma, and handle P2002 if it fires',
      badExample: 'prisma.user.upsert({ where: { email }, ... })  // if email is not @unique, race creates two users',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_upsert_race_condition', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.upsert\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 10)).join('\n');
            if (!block.includes('P2002') && !content.includes('$transaction') && !block.includes('// unique')) {
              findings.push({ severity, category: 'prisma_upsert_race_condition', file: path, line: i + 1, message: 'upsert() without explicit unique constraint handling — race condition under concurrent load.', suggestion: 'Verify the where field has a DB-level @unique constraint, and handle P2002 if concurrent creates occur.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_016',
    category: 'prisma_nested_write_depth',
    description: 'Deeply nested Prisma writes (3+ levels) are hard to reason about and error-prone in transactions.',
    severity: 'LOW',
    tags: ['prisma', 'quality', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Nested writes like create → connect → create → connect become ambiguous in transaction semantics and almost impossible to debug. Flatten into sequential writes inside an explicit transaction.',
      commonViolations: ['create: { author: { connect: { id: userId } }, tags: { create: tags.map(t => ({ tag: { connect: { id: t.id } } })) } }'],
      goodExample: 'await prisma.$transaction(async tx => { const post = await tx.post.create(...); await tx.post.update({ where: { id: post.id }, data: { tags: { connect: tagIds } } }) })',
      badExample: 'prisma.post.create({ data: { ..., tags: { create: [...tags.map(t => ({ tag: { connect: ... } }))] } } })',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_nested_write_depth', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.(?:create|update)\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 20)).join('\n');
            const connectCount = (block.match(/connect\s*:/g) || []).length;
            const createCount = (block.match(/create\s*:/g) || []).length;
            if (connectCount + createCount >= 4) {
              findings.push({ severity, category: 'prisma_nested_write_depth', file: path, line: i + 1, message: 'Deeply nested Prisma write (4+ nested operations) — error-prone and hard to debug.', suggestion: 'Flatten into sequential writes inside prisma.$transaction() for clarity.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_017',
    category: 'prisma_missing_index_hint',
    description: 'Filtering or ordering by non-indexed columns produces full table scans at scale.',
    severity: 'MEDIUM',
    tags: ['prisma', 'performance', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Columns like createdAt, status, or tenantId used in WHERE without an index require full sequential scans. Add @@index([columnName]) to schema.prisma for frequently-queried columns.',
      commonViolations: ['where: { status: "active" }  // status not indexed', 'orderBy: { createdAt: "desc" }  // no index on createdAt'],
      goodExample: '// In schema.prisma:\n@@index([status])\n@@index([tenantId, createdAt])',
      badExample: 'findMany({ where: { tenantId: ctx.tenantId, status: "active" } })  // full scan if no index',
      relatedPlaybooks: ['database-performance.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_missing_index_hint', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('schema.prisma') && !path.endsWith('.prisma')) continue;
        if (content.includes('@@index') || content.includes('@@unique')) return findings;
        const modelCount = (content.match(/^model\s+\w+/gm) || []).length;
        if (modelCount >= 2 && content.includes('createdAt') && !content.includes('@@index')) {
          findings.push({ severity, category: 'prisma_missing_index_hint', file: path, message: 'Prisma schema has no @@index directives — common query columns (status, tenantId, createdAt) may cause full scans.', suggestion: 'Add @@index([tenantId, createdAt]) and @@index([status]) to frequently-queried models.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_018',
    category: 'prisma_aggregate_without_scope',
    description: 'Aggregate queries (sum, avg, count) without a where clause compute across the entire table.',
    severity: 'HIGH',
    tags: ['prisma', 'performance', 'security'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'SELECT SUM(amount) with no WHERE is both slow (full scan) and a security issue in multi-tenant apps where all tenants share a table. Always scope aggregates to the current user/tenant.',
      commonViolations: ['prisma.order.aggregate({ _sum: { amount: true } })', 'prisma.event.count()'],
      goodExample: 'prisma.order.aggregate({ where: { tenantId: ctx.tenantId }, _sum: { amount: true } })',
      badExample: 'prisma.order.aggregate({ _sum: { amount: true } })  // sums all tenants — data leak',
      relatedPlaybooks: ['database-security.md'],
      relatedAgents: ['database-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_aggregate_without_scope', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.(?:aggregate|groupBy)\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
            if (!block.includes('where:')) {
              findings.push({ severity, category: 'prisma_aggregate_without_scope', file: path, line: i + 1, message: 'Aggregate without where clause — computes across all rows and all tenants.', suggestion: 'Add where: { tenantId: ctx.tenantId } to scope aggregates to the current context.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_019',
    category: 'prisma_date_string_comparison',
    description: 'Comparing dates as strings in Prisma where clauses produces incorrect results across timezones.',
    severity: 'HIGH',
    tags: ['prisma', 'reliability', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Comparing createdAt: { gte: '2024-01-01' } (string) relies on implicit casting. In timezones behind UTC, '2024-01-01' UTC 00:00 is yesterday local time. Always use JavaScript Date objects for datetime comparisons.",
      commonViolations: ["where: { createdAt: { gte: '2024-01-01' } }", "where: { updatedAt: { lt: startDate.toISOString() } }"],
      goodExample: 'where: { createdAt: { gte: new Date("2024-01-01T00:00:00.000Z") } }',
      badExample: "where: { createdAt: { gte: '2024-01-01' } }  // timezone-dependent result",
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_date_string_comparison', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:createdAt|updatedAt|deletedAt|startDate|endDate)\s*:\s*\{[^}]*(?:gte|lte|gt|lt)\s*:\s*['"]/.test(line)) {
            findings.push({ severity, category: 'prisma_date_string_comparison', file: path, line: i + 1, message: 'Date comparison using string literal — timezone-sensitive and may produce wrong results.', suggestion: 'Use new Date("...") or a Date object: { gte: new Date(input.startDate) }.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_020',
    category: 'prisma_createMany_ignore_errors',
    description: 'createMany with skipDuplicates: true silently swallows all insert errors, not just uniqueness.',
    severity: 'MEDIUM',
    tags: ['prisma', 'reliability', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'skipDuplicates: true is convenient for idempotent imports, but it masks non-duplicate errors (constraint violations, invalid references) that should surface as failures.',
      commonViolations: ['prisma.event.createMany({ data: events, skipDuplicates: true })'],
      goodExample: '// For critical data, process individually and collect errors:\nconst results = await Promise.allSettled(events.map(e => prisma.event.create({ data: e })))',
      badExample: 'prisma.user.createMany({ data: users, skipDuplicates: true })  // masks FK constraint failures too',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_createMany_ignore_errors', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/skipDuplicates\s*:\s*true/.test(line)) {
            findings.push({ severity, category: 'prisma_createMany_ignore_errors', file: path, line: i + 1, message: 'skipDuplicates: true silently ignores all insert failures, not just duplicates.', suggestion: 'For critical data, use Promise.allSettled() to surface per-record errors.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_021',
    category: 'prisma_raw_migration_risk',
    description: 'Raw SQL in migrations without a rollback strategy or comment is a deployment risk.',
    severity: 'MEDIUM',
    tags: ['prisma', 'database', 'migrations'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Prisma does not support automatic migration rollbacks. Raw SQL that alters production data (UPDATE, DELETE, column type changes) without a companion rollback script leaves you unable to recover from a failed deployment.',
      commonViolations: ['UPDATE users SET role = "user" WHERE role IS NULL', 'ALTER TABLE orders DROP COLUMN legacy_field'],
      goodExample: '-- Migration: 20240101_cleanup_nulls.sql\n-- ROLLBACK: UPDATE users SET role = NULL WHERE role = "user" AND created_at > NOW() - INTERVAL "5 minutes"\nUPDATE users SET role = "user" WHERE role IS NULL;',
      badExample: 'UPDATE users SET role = "user" WHERE role IS NULL;  // no rollback documented',
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_raw_migration_risk', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SQL_EXT.test(path) || !path.includes('migration')) continue;
        const hasDataChange = /^\s*(?:UPDATE|DELETE FROM|INSERT INTO)\s+\w+/im.test(content);
        const hasRollbackNote = /rollback|revert|undo/i.test(content);
        if (hasDataChange && !hasRollbackNote) {
          findings.push({ severity, category: 'prisma_raw_migration_risk', file: path, message: 'Migration contains data modification (UPDATE/DELETE) without a rollback comment.', suggestion: '-- ROLLBACK: [SQL to undo this change]  // document the reverse operation.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_022',
    category: 'prisma_connect_vs_set',
    description: 'Using connect instead of set for many-to-many updates appends — it does not replace. Use set to replace all.',
    severity: 'HIGH',
    tags: ['prisma', 'data-integrity', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'update({ data: { tags: { connect: newTags } } }) adds newTags to existing tags. To replace the tags list entirely, use set: newTags. Confusing connect and set creates tag accumulation bugs.',
      commonViolations: ['tags: { connect: newTags }  // inside update — appends, not replaces'],
      goodExample: 'tags: { set: newTagIds }  // replaces entire tag list\n// or: disconnect all, then connect new ones',
      badExample: 'post.update({ data: { tags: { connect: newTags } } })  // duplicates old tags',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_connect_vs_set', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\.update\(/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
            if (/connect\s*:/.test(block) && /tags|categories|permissions|roles/.test(block.toLowerCase())) {
              findings.push({ severity, category: 'prisma_connect_vs_set', file: path, line: i + 1, message: 'connect: in update() appends to existing relations — use set: to replace.', suggestion: 'If you intend to replace the full list, change connect: to set:.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_023',
    category: 'prisma_missing_created_at_filter',
    description: 'Time-range queries without an upper bound on createdAt can lock up reporting queries on append-heavy tables.',
    severity: 'LOW',
    tags: ['prisma', 'performance', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'A query "all records created after X" with no upper bound runs against an ever-growing dataset. For analytics/reporting, always bound both ends of the time window to limit scan size.',
      commonViolations: ["where: { createdAt: { gte: startDate } }  // no upper bound"],
      goodExample: 'where: { createdAt: { gte: startDate, lte: endDate } }',
      badExample: "where: { createdAt: { gte: '2023-01-01' } }  // scans everything since Jan 2023 — grows daily",
      relatedPlaybooks: ['database-performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_missing_created_at_filter', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/createdAt\s*:\s*\{\s*gte\s*:/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 5)).join('\n');
            if (!block.includes('lte:') && !block.includes('lt:')) {
              findings.push({ severity, category: 'prisma_missing_created_at_filter', file: path, line: i + 1, message: 'Time range query with gte but no upper bound (lte) — scans all future records.', suggestion: 'Add lte: endDate to bound the time window on both sides.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_024',
    category: 'prisma_select_include_conflict',
    description: 'Using both select and include in the same Prisma query causes a runtime error.',
    severity: 'HIGH',
    tags: ['prisma', 'reliability', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Prisma throws a PrismaClientValidationError if both select and include are present. They are mutually exclusive. Use select with nested selects for related records.',
      commonViolations: ['{ where: { id }, select: { name: true }, include: { posts: true } }'],
      goodExample: '{ where: { id }, select: { name: true, posts: { select: { title: true } } } }',
      badExample: '{ select: { name: true }, include: { posts: true } }  // PrismaClientValidationError at runtime',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_select_include_conflict', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\w+\.(?:findUnique|findFirst|findMany)\(\{/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 12)).join('\n');
            if (/\bselect\s*:/.test(block) && /\binclude\s*:/.test(block)) {
              findings.push({ severity, category: 'prisma_select_include_conflict', file: path, line: i + 1, message: 'Both select and include used — Prisma throws at runtime. They are mutually exclusive.', suggestion: 'Use only select with nested selects: select: { name: true, posts: { select: { title: true } } }.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_025',
    category: 'prisma_orderby_no_index',
    description: 'Ordering by a column likely missing an index causes full-table sorts on large datasets.',
    severity: 'MEDIUM',
    tags: ['prisma', 'performance', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'ORDER BY on a non-indexed column requires the database to sort all matching rows in memory. For columns like score, rank, or views, this degrades proportionally with table size.',
      commonViolations: ['orderBy: { score: "desc" }', 'orderBy: { viewCount: "asc" }'],
      goodExample: '// Add to schema.prisma: @@index([score(sort: Desc)])\n// Then: orderBy: { score: "desc" }',
      badExample: 'findMany({ orderBy: { viewCount: "desc" } })  // viewCount not indexed — filesort at scale',
      relatedPlaybooks: ['database-performance.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_orderby_no_index', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/orderBy\s*:\s*\{\s*(?:score|rank|viewCount|views|likeCount|rating|priority)\s*:/.test(line)) {
            findings.push({ severity, category: 'prisma_orderby_no_index', file: path, line: i + 1, message: 'Ordering by a potentially unindexed computed field — may cause full-table sort.', suggestion: 'Add @@index([fieldName(sort: Desc)]) to schema.prisma for frequently-sorted columns.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_026',
    category: 'prisma_schema_no_default_id',
    description: 'Models without @id or @default(cuid()/uuid()) produce tables without primary keys.',
    severity: 'HIGH',
    tags: ['prisma', 'database', 'schema'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Every relational database table should have a primary key for indexed lookups, foreign key references, and ORM tracking. A model without @id or with @id but no @default generates tables that require application-level ID assignment.',
      commonViolations: ['model Post { id String @id  // no @default — must provide ID manually }'],
      goodExample: 'model Post { id String @id @default(cuid()) ... }',
      badExample: 'model Event { id String @id  // missing @default — crashes if id not supplied }',
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_schema_no_default_id', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('schema.prisma') && !path.endsWith('.prisma')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\bid\s+\w+\s+@id\b/.test(line) && !line.includes('@default(')) {
            findings.push({ severity, category: 'prisma_schema_no_default_id', file: path, line: i + 1, message: '@id field without @default — must manually supply ID on every create.', suggestion: 'Add @default(cuid()) or @default(uuid()) to generate IDs automatically.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_027',
    category: 'prisma_json_no_type',
    description: 'Json fields in Prisma have no runtime type — store typed data as relational columns or validate at application layer.',
    severity: 'MEDIUM',
    tags: ['prisma', 'typescript', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Prisma Json fields return unknown at the TypeScript level (or JsonValue which requires casting). Data stored as JSON bypasses schema validation, breaks refactors, and produces runtime errors when structure changes.',
      commonViolations: ['metadata Json', 'settings Json?'],
      goodExample: '// Either: use typed columns\ntheme     String  @default("light")\nnotifications Boolean @default(true)\n// Or: validate with Zod on read/write',
      badExample: 'settings Json  // cast to any everywhere, breaks on schema change',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_json_no_type', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('schema.prisma') && !path.endsWith('.prisma')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\s+\w+\s+Json\??(\s+@|$)/.test(line) && !isCommentLine(line)) {
            findings.push({ severity, category: 'prisma_json_no_type', file: path, line: i + 1, message: 'Json field has no runtime type — use relational columns or add Zod validation on access.', suggestion: 'Define a Zod schema for this Json field and validate on read/write. Document the expected shape in a comment.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_028',
    category: 'prisma_middleware_no_error_handling',
    description: 'Prisma middleware without error handling can silently swallow query failures.',
    severity: 'MEDIUM',
    tags: ['prisma', 'reliability', 'observability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Prisma middleware wraps queries. If middleware throws without re-throwing, queries appear to succeed without running. Always pass errors to next() or re-throw after logging.',
      commonViolations: ['prisma.$use(async (params, next) => { try { ... } catch (e) { } })  // swallows error'],
      goodExample: 'prisma.$use(async (params, next) => { try { return await next(params); } catch (e) { logger.error(e); throw e; } })',
      badExample: 'prisma.$use(async (params, next) => { try { return await next(params) } catch (e) { /* silent */ } })',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_middleware_no_error_handling', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || !isPrismaFile(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/prisma\.\$use\(/.test(line)) {
            const block = lines.slice(i, Math.min(lines.length, i + 20)).join('\n');
            if (/catch\s*\(/.test(block) && !block.includes('throw') && !block.includes('logger') && !block.includes('captureException')) {
              findings.push({ severity, category: 'prisma_middleware_no_error_handling', file: path, line: i + 1, message: 'Prisma middleware catches errors without re-throwing — query failures may be silently swallowed.', suggestion: 'Re-throw after logging: catch (e) { logger.error(e); throw e; }' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_029',
    category: 'prisma_connection_pool_config',
    description: 'DATABASE_URL without connection pool sizing parameters may default to too many or too few connections.',
    severity: 'MEDIUM',
    tags: ['prisma', 'performance', 'reliability'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Prisma defaults to a connection pool of N*2+1 (N = CPU cores). In serverless environments (Vercel, Lambda) this creates too many connections per function instance. Add ?connection_limit=1 or use PgBouncer/Supabase Pooler.',
      commonViolations: ['DATABASE_URL=postgresql://user:pass@host/db  // no pool config'],
      goodExample: 'DATABASE_URL=postgresql://user:pass@host/db?connection_limit=5&pool_timeout=20',
      badExample: 'DATABASE_URL=postgresql://user:pass@host/db  // serverless: each instance opens up to 10 connections',
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_connection_pool_config', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('.env') && !path.endsWith('.env.example') && !path.endsWith('.env.local')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/DATABASE_URL\s*=.*postgresql:\/\//.test(line) && !line.includes('connection_limit') && !line.includes('pgbouncer')) {
            findings.push({ severity, category: 'prisma_connection_pool_config', file: path, line: i + 1, message: 'DATABASE_URL without connection pool configuration — may exhaust DB connections in serverless.', suggestion: 'Add ?connection_limit=5&pool_timeout=20 or use a PgBouncer-compatible pooler URL.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'PRISMA_030',
    category: 'prisma_enum_not_in_schema',
    description: 'String literal unions used for status/type fields should be Prisma enums for DB-level constraint enforcement.',
    severity: 'LOW',
    tags: ['prisma', 'schema', 'data-integrity'],
    sinceVersion: '3.0.0',
    explain: {
      why: 'Storing status as a plain String allows any value. A database enum constrains the column to valid values at the DB level, preventing invalid data from being inserted by external tools, migrations, or raw SQL.',
      commonViolations: ['status String  // in schema.prisma'],
      goodExample: 'enum PostStatus { DRAFT PUBLISHED ARCHIVED }\nstatus PostStatus @default(DRAFT)',
      badExample: "status String @default('draft')  // DB allows 'DRFAT' (typo) — no constraint",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_enum_not_in_schema', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('schema.prisma') && !path.endsWith('.prisma')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\b(?:status|type|state|role|tier)\s+String\b/.test(line) && !isCommentLine(line)) {
            findings.push({ severity, category: 'prisma_enum_not_in_schema', file: path, line: i + 1, message: 'Status/type field as String — consider using a Prisma enum for DB-level constraint.', suggestion: 'Define enum PostStatus { DRAFT PUBLISHED } and use: status PostStatus @default(DRAFT).' });
          }
        }
      }
      return findings;
    },
  },
];
