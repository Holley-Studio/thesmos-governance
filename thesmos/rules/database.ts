import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, SQL_EXT, isTestPath, isCommentLine } from './helpers';

export const DATABASE_RULES: ThesmosRule[] = [
  // ── Database ──────────────────────────────────────────────────────────────

  {
    id: 'DB_001',
    category: 'drop_table_migration',
    description: '`DROP TABLE` in a migration permanently destroys data and is unrecoverable without a backup.',
    severity: 'BLOCKER',
    tags: ['database', 'migrations', 'data-safety'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Migrations run automatically in CI/CD. A DROP TABLE on a live table destroys all data instantly. This must be a manual, reviewed, and explicitly confirmed step — never automatic.',
      commonViolations: ['DROP TABLE users;', 'DROP TABLE IF EXISTS sessions;'],
      goodExample: "-- Step 1: Rename (reversible)\nALTER TABLE users RENAME TO users_deprecated;\n-- Step 2: Delete only after verifying no traffic for 30 days",
      badExample: "-- migration 045\nDROP TABLE orders;\nCREATE TABLE orders_v2 (...);  -- irreversible data loss",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('drop_table_migration', config.severityRules);
      const RE = /\bDROP\s+TABLE\b/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SQL_EXT.test(path) && !/migrat/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'drop_table_migration', file: path, line: i + 1, message: 'DROP TABLE in migration — permanent data loss.', suggestion: 'Rename the table first. Delete only after confirming no active reads/writes for 30+ days.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_002',
    category: 'plaintext_password_storage',
    description: 'Storing passwords in plaintext or with reversible encoding is a critical security vulnerability.',
    severity: 'BLOCKER',
    tags: ['database', 'security', 'auth'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Any database breach exposes all user passwords immediately. Passwords must be stored as one-way hashes using bcrypt, argon2, or scrypt. These are slow by design to resist brute-force attacks.',
      commonViolations: ['user.password = req.body.password', 'password: btoa(plaintext)', 'password: md5(input)'],
      goodExample: "import { hash } from 'bcrypt';\nconst hashed = await hash(password, 12);\nawait db.insert(users).values({ passwordHash: hashed });",
      badExample: "await db.insert(users).values({ password: req.body.password });  // stored raw",
      relatedPlaybooks: ['auth-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('plaintext_password_storage', config.severityRules);
      const RAW_PW_RE = /\bpassword\s*[:=]\s*(?:req\.|body\.|input\.|data\.)(?:body\.)?password\b/i;
      const HASH_RE = /\b(?:bcrypt|argon2|scrypt|pbkdf2|hash)\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        const hasHashImport = HASH_RE.test(content);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RAW_PW_RE.test(line) && !hasHashImport) {
            findings.push({ severity, category: 'plaintext_password_storage', file: path, line: i + 1, message: 'Password stored without hashing — use bcrypt or argon2.', suggestion: "import { hash } from 'bcrypt'; const passwordHash = await hash(password, 12);" });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_003',
    category: 'missing_transaction',
    description: 'Multi-step writes without a transaction leave the database in a partially-updated state if any step fails.',
    severity: 'HIGH',
    tags: ['database', 'reliability', 'atomicity'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'If step 2 of a 3-step write fails without a transaction, you have partial data that is now inconsistent. Transactions guarantee atomicity — either all steps succeed or all are rolled back.',
      commonViolations: ['await db.insert(orders)...; await db.update(inventory)...; await db.insert(billing)...'],
      goodExample: "await db.transaction(async (tx) => {\n  await tx.insert(orders).values(order);\n  await tx.update(inventory).set({ stock: sql`${inventory.stock} - 1` }).where(...);\n  await tx.insert(billing).values(charge);\n});",
      badExample: "// No transaction — inventory may decrement but billing may fail\nconst order = await db.insert(orders).values(data).returning();\nawait db.update(inventory).set({ stock: sql`stock - 1` }).where(eq(inventory.id, data.itemId));\nawait db.insert(billing).values({ orderId: order.id, amount: data.total });",
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_transaction', config.severityRules);
      const MULTI_WRITE_RE = /await\s+(?:db|tx|prisma|supabase)\.\s*(?:insert|update|delete|create|upsert)\s*\(/g;
      const TX_RE = /\b(?:transaction|withTransaction|$transaction|beginTransaction)\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/api\/|route\.|service\.|repository\./.test(path)) continue;
        const hasTx = TX_RE.test(content);
        if (hasTx) continue;
        const matches = [...content.matchAll(MULTI_WRITE_RE)];
        if (matches.length >= 3) {
          findings.push({ severity, category: 'missing_transaction', file: path, message: `${matches.length} separate DB writes without a transaction — partial-write risk.`, suggestion: 'Wrap multi-step writes in db.transaction(async (tx) => { ... }).' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_004',
    category: 'soft_delete_no_filter',
    description: 'Querying a soft-delete table without filtering deleted_at returns deleted records as if they were active.',
    severity: 'MEDIUM',
    tags: ['database', 'correctness', 'data-integrity'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Soft-delete patterns add a deleted_at column to preserve records. But every query against that table must filter WHERE deleted_at IS NULL — otherwise deleted items appear as active, leaking data.',
      commonViolations: ['db.select().from(users)', 'prisma.user.findMany({ where: { id } })'],
      goodExample: "db.select().from(users).where(isNull(users.deletedAt));\nprisma.user.findMany({ where: { deletedAt: null, id } });",
      badExample: "// deleted users appear as active\nconst user = await prisma.user.findFirst({ where: { email } });",
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('soft_delete_no_filter', config.severityRules);
      const FIND_RE = /\b(?:findMany|findFirst|findUnique|select\s*\()\b/;
      const DELETED_FILTER_RE = /deleted(?:At|_at)\s*(?::|:?\s*null|:\s*IS)/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const hasDeletedAt = /deleted(?:At|_at)/.test(content);
        if (!hasDeletedAt) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line) || !FIND_RE.test(line)) continue;
          const block = lines.slice(i, Math.min(i + 6, lines.length)).join('\n');
          if (!DELETED_FILTER_RE.test(block)) {
            findings.push({ severity, category: 'soft_delete_no_filter', file: path, line: i + 1, message: 'Query on soft-delete table without filtering deletedAt — deleted records will appear.', suggestion: "Add .where(isNull(table.deletedAt)) or { where: { deletedAt: null } } to every query on this table." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_005',
    category: 'raw_sql_injection',
    description: 'SQL constructed with template literals and user input is vulnerable to SQL injection.',
    severity: 'BLOCKER',
    tags: ['database', 'security', 'sql-injection'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'String-interpolated SQL bypasses the database driver\'s parameterization, allowing attackers to inject arbitrary SQL. Use parameterized queries or ORM query builders exclusively for any user-supplied data.',
      commonViolations: ['db.execute(`SELECT * FROM users WHERE id = ${req.params.id}`)', 'query(`DELETE FROM sessions WHERE token = \'${token}\'`)'],
      goodExample: "db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);\n// or: prepared statements\nconst stmt = db.prepare('SELECT * FROM users WHERE id = ?');\nstmt.get(userId);",
      badExample: "const result = await db.execute(`SELECT * FROM orders WHERE user_id = ${req.params.userId}`);  // SQL injection",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('raw_sql_injection', config.severityRules);
      const RE = /\.(?:execute|query|raw)\s*\(`[^`]*\$\{(?!sql)[^}]*(?:req\.|params\.|query\.|body\.)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'raw_sql_injection', file: path, line: i + 1, message: 'SQL built with user-input interpolation — SQL injection vulnerability.', suggestion: 'Use parameterized queries: db.execute(sql`... WHERE id = ${userId}`) or prepared statements.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_006',
    category: 'unlimited_query_result',
    description: 'Queries returning all rows from a table without LIMIT will degrade as data grows.',
    severity: 'MEDIUM',
    tags: ['database', 'performance', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Tables grow. A query returning all rows works fine at 1k rows, uses 100MB RAM at 100k rows, and crashes at 1M rows. Default to paginated queries — there is almost never a valid reason to load an entire table.',
      commonViolations: ['await prisma.post.findMany()', 'db.select().from(posts)'],
      goodExample: "prisma.post.findMany({ take: 50, cursor: { id: lastId }, orderBy: { id: 'asc' } })",
      badExample: "const all = await prisma.post.findMany();  // returns entire table",
      relatedPlaybooks: ['database-patterns.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      // Covered by PERF_006 for ORM patterns; this catches raw SQL
      const severity = classifySeverity('unlimited_query_result', config.severityRules);
      const SELECT_NO_LIMIT_RE = /SELECT\b(?:(?!LIMIT|FETCH\s+FIRST|ROWNUM|TOP\s+\d).)*;\s*$/im;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SQL_EXT.test(path)) continue;
        const stmts = content.split(/;/).filter(s => /SELECT\b/i.test(s) && !/JOIN\s+.*\s+ON|COUNT\(|EXISTS\(|GROUP\s+BY/i.test(s));
        for (const stmt of stmts) {
          if (!/\bLIMIT\b|\bFETCH\s+FIRST\b|\bROWNUM\b|\bTOP\s+\d/i.test(stmt)) {
            findings.push({ severity, category: 'unlimited_query_result', file: path, message: 'SQL SELECT without LIMIT — unbounded result set.', suggestion: 'Add LIMIT N to all queries that could return many rows.' });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_007',
    category: 'migration_no_rollback',
    description: 'Migrations without a rollback (down migration) cannot be reverted safely in production incidents.',
    severity: 'LOW',
    tags: ['database', 'migrations', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'When a deployment fails and you need to roll back, down migrations let you revert schema changes automatically. Without them, manual SQL surgery is required under incident pressure.',
      commonViolations: ['migration file with only "up" exports, no "down"', 'Drizzle migration with no revert'],
      goodExample: "// migrations/0042_add_user_tier.ts\nexport async function up(db) { await db.execute('ALTER TABLE users ADD COLUMN tier TEXT DEFAULT \"free\"'); }\nexport async function down(db) { await db.execute('ALTER TABLE users DROP COLUMN tier'); }",
      badExample: "// migrations/0042_add_user_tier.ts\nexport async function up(db) { await db.execute('ALTER TABLE users ADD COLUMN tier TEXT'); }\n// no down() — cannot revert",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('migration_no_rollback', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/migrat/.test(path) || !SOURCE_EXT.test(path)) continue;
        const hasUp = /export\s+(?:async\s+)?function\s+up\b|exports\.up\s*=/.test(content);
        const hasDown = /export\s+(?:async\s+)?function\s+down\b|exports\.down\s*=/.test(content);
        if (hasUp && !hasDown) {
          findings.push({ severity, category: 'migration_no_rollback', file: path, message: 'Migration has no down() rollback function.', suggestion: 'Add a down() that reverses the up() change so deployments can be rolled back safely.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_008',
    category: 'sensitive_data_logged',
    description: 'Logging database rows that contain passwords, tokens, or PII creates audit and compliance exposure.',
    severity: 'HIGH',
    tags: ['database', 'security', 'privacy', 'logging'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Application logs are often shipped to third-party services, stored long-term, and accessible to many engineers. Logging full DB rows exposes password hashes, tokens, and personal data to this wider audience.',
      commonViolations: ['console.log(user)', 'logger.debug(row)', 'console.log(JSON.stringify(result))'],
      goodExample: "logger.info({ userId: user.id, action: 'login' });  // log only non-sensitive fields",
      badExample: "const user = await db.select().from(users).where(eq(users.email, email));\nconsole.log(user);  // logs passwordHash, sessionToken, etc.",
      relatedPlaybooks: ['logging-privacy.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sensitive_data_logged', config.severityRules);
      const DB_VAR_RE = /\b(?:const|let)\s+(user|account|session|token|record|row|result)\s*=/;
      const LOG_RE = /\bconsole\.\w+\s*\(\s*(?:JSON\.stringify\s*\()?\s*(user|account|session|token|record|row|result)\s*[,)]/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        const dbVars = new Set<string>();
        for (const line of lines) {
          const m = DB_VAR_RE.exec(line);
          if (m) dbVars.add(m[1]!);
        }
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          const m = LOG_RE.exec(line);
          if (m && dbVars.has(m[1]!)) {
            findings.push({ severity, category: 'sensitive_data_logged', file: path, line: i + 1, message: `Logging DB result variable '${m[1]}' — may contain passwords, tokens, or PII.`, suggestion: 'Log only specific safe fields: logger.info({ id: result.id, action: "..." }).' });
          }
        }
      }
      return findings;
    },
  },

  // ── API Design ─────────────────────────────────────────────────────────────

  {
    id: 'API_001',
    category: 'error_with_200_status',
    description: 'Returning HTTP 200 for error responses breaks API contracts — clients cannot detect errors.',
    severity: 'HIGH',
    tags: ['api', 'http', 'correctness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'HTTP status codes are the contract. Returning 200 with `{ error: "..." }` breaks every HTTP client, logging aggregator, and monitoring tool that relies on status codes to detect failures.',
      commonViolations: ["return Response.json({ error: 'Not found' }, { status: 200 })", "res.status(200).json({ success: false, message: 'Unauthorized' })"],
      goodExample: "return Response.json({ error: 'Not found' }, { status: 404 });\nreturn Response.json({ error: 'Unauthorized' }, { status: 401 });",
      badExample: "if (!user) {\n  return Response.json({ error: 'User not found' });  // 200 status for a 404 condition\n}",
      relatedPlaybooks: ['api-design.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('error_with_200_status', config.severityRules);
      const RE = /Response\.json\s*\(\s*\{[^}]*error[^}]*\}\s*\)(?!\s*,\s*\{\s*status\s*:)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/api\/|route\./.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'error_with_200_status', file: path, line: i + 1, message: 'Error response returned without HTTP error status code.', suggestion: 'Pass a status option: Response.json({ error }, { status: 400 }).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'API_002',
    category: 'sensitive_data_in_query_param',
    description: 'Sensitive data in URL query parameters is logged in server access logs, browser history, and referrer headers.',
    severity: 'HIGH',
    tags: ['api', 'security', 'privacy'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Query strings are logged everywhere: web server access logs, CDN logs, browser history, analytics, and HTTP referer headers. Never put tokens, passwords, or PII in query params — use POST body or headers.',
      commonViolations: ['?token=abc123', '?password=secret', '?email=user@example.com&ssn=123'],
      goodExample: "// Tokens in headers:\nfetch('/api', { headers: { Authorization: `Bearer ${token}` } })\n// POST body for sensitive operations",
      badExample: "/api/reset-password?token=secret123&email=user@example.com  // logged everywhere",
      relatedPlaybooks: ['api-security.md', 'logging-privacy.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sensitive_data_in_query_param', config.severityRules);
      const RE = /['"`].*\?.*(?:token|password|secret|api[_-]?key|ssn|credit[_-]?card)=/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'sensitive_data_in_query_param', file: path, line: i + 1, message: 'Sensitive data in URL query parameter — will appear in access logs and browser history.', suggestion: 'Move tokens and credentials to request headers (Authorization) or POST body.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'API_003',
    category: 'missing_request_validation',
    description: 'API route handlers that read request body or params without schema validation trust unverified client input.',
    severity: 'HIGH',
    tags: ['api', 'security', 'validation'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without validation, any caller can send malformed data, unexpected types, or extra fields that reach your database. Zod/Valibot parse at the boundary and reject bad input before it touches business logic.',
      commonViolations: ['const { name, email } = await req.json()', 'const body = JSON.parse(event.body)'],
      goodExample: "const schema = z.object({ name: z.string().min(1), email: z.string().email() });\nconst body = schema.parse(await req.json());",
      badExample: "export async function POST(req: Request) {\n  const { name, role } = await req.json();  // role could be 'admin'\n  await db.insert(users).values({ name, role });  // mass assignment\n}",
      relatedPlaybooks: ['api-validation.md', 'security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_request_validation', config.severityRules);
      const BODY_READ_RE = /(?:await\s+req\.json\(\)|await\s+request\.json\(\)|JSON\.parse\s*\((?:event|req)\.body)/;
      const VALIDATE_RE = /\b(?:z\.object|z\.parse|schema\.parse|schema\.safeParse|valibot\.parse|validate\s*\()/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/api\/|route\./.test(path)) continue;
        if (!BODY_READ_RE.test(content)) continue;
        if (!VALIDATE_RE.test(content)) {
          findings.push({ severity, category: 'missing_request_validation', file: path, message: 'API route reads request body without schema validation.', suggestion: "Parse with Zod: const body = z.object({ ... }).parse(await req.json());" });
        }
      }
      return findings;
    },
  },

  {
    id: 'API_004',
    category: 'password_in_api_response',
    description: 'API responses that include the password hash field expose sensitive data to API consumers.',
    severity: 'BLOCKER',
    tags: ['api', 'security', 'data-exposure'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Even a bcrypt hash in an API response is a security exposure — it can be used for offline brute-force attacks. Never include password, passwordHash, or password_hash in any API response.',
      commonViolations: ['return Response.json(user)', 'res.json(await prisma.user.findUnique(...))'],
      goodExample: "const { passwordHash, ...safeUser } = user;\nreturn Response.json(safeUser);",
      badExample: "const user = await prisma.user.findUnique({ where: { id } });\nreturn Response.json(user);  // includes passwordHash in response",
      relatedPlaybooks: ['api-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('password_in_api_response', config.severityRules);
      const RETURN_USER_RE = /return\s+(?:Response\.json|NextResponse\.json|res\.json)\s*\(\s*(?:await\s+)?(?:user|account|member|profile)\s*\)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/api\/|route\./.test(path)) continue;
        const hasPasswordField = /password(?:Hash)?.*(?:findUnique|findFirst|findOne|select)/.test(content) ||
          /select\s*\(/.test(content) && !/omit|exclude|passwordHash/.test(content);
        if (!hasPasswordField) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RETURN_USER_RE.test(line)) {
            findings.push({ severity, category: 'password_in_api_response', file: path, line: i + 1, message: 'Returning full user object in API response may include passwordHash.', suggestion: 'Destructure: const { passwordHash, ...safe } = user; return Response.json(safe);' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'API_005',
    category: 'cors_dynamic_no_allowlist',
    description: 'Setting CORS `origin` to a dynamic request value without an allowlist allows any domain to make credentialed requests.',
    severity: 'HIGH',
    tags: ['api', 'security', 'cors'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Reflecting the request Origin header without validating it against an allowlist means any domain can read responses from your API with credentials. This effectively disables CORS protection.',
      commonViolations: ["origin: req.headers.origin", "res.setHeader('Access-Control-Allow-Origin', req.headers.get('origin'))"],
      goodExample: "const ALLOWED = new Set(['https://app.example.com', 'https://admin.example.com']);\nconst requestOrigin = req.headers.get('origin') ?? '';\nconst origin = ALLOWED.has(requestOrigin) ? requestOrigin : '';",
      badExample: "res.setHeader('Access-Control-Allow-Origin', req.headers.get('origin'));  // reflects any origin",
      relatedPlaybooks: ['api-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_dynamic_no_allowlist', config.severityRules);
      const RE = /Access-Control-Allow-Origin['"]\s*,\s*req\.headers/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RE.test(line)) {
            findings.push({ severity, category: 'cors_dynamic_no_allowlist', file: path, line: i + 1, message: 'CORS origin set from request header without allowlist — any domain can access this API.', suggestion: 'Validate against a Set of allowed origins before reflecting.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'API_006',
    category: 'unlimited_file_upload',
    description: 'File upload endpoints without size limits allow denial-of-service via large file uploads.',
    severity: 'HIGH',
    tags: ['api', 'security', 'dos'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without a size limit, attackers can upload arbitrarily large files (or many concurrent uploads) to exhaust disk space, memory, and bandwidth. Always set a maximum file size at the server layer.',
      commonViolations: ['formidable()', 'multer()', 'busboy without limits'],
      goodExample: "multer({ limits: { fileSize: 5 * 1024 * 1024 } })  // 5MB max\n// Next.js: export const config = { api: { bodyParser: { sizeLimit: '5mb' } } }",
      badExample: "const upload = multer({ dest: 'uploads/' });  // no size limit",
      relatedPlaybooks: ['api-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('unlimited_file_upload', config.severityRules);
      const UPLOAD_RE = /\b(?:multer|formidable|busboy|multipart)\s*\(/;
      const LIMIT_RE = /\blimits?\s*:|fileSize\s*:|maxFileSize\s*:/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!UPLOAD_RE.test(content)) continue;
        if (!LIMIT_RE.test(content)) {
          findings.push({ severity, category: 'unlimited_file_upload', file: path, message: 'File upload without size limit configured.', suggestion: 'Set limits: multer({ limits: { fileSize: 5 * 1024 * 1024 } }).' });
        }
      }
      return findings;
    },
  },

  {
    id: 'API_007',
    category: 'missing_idempotency',
    description: 'Non-idempotent POST endpoints for payments or orders without idempotency key support may cause duplicate charges on retry.',
    severity: 'MEDIUM',
    tags: ['api', 'reliability', 'payments'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Network failures cause clients to retry. Without idempotency keys, retried payment requests can charge the user twice. Accept an idempotency key header and store processed key+result pairs.',
      commonViolations: ['POST /api/payments/charge without idempotency check', 'POST /api/orders without duplicate detection'],
      goodExample: "const idempotencyKey = req.headers.get('idempotency-key');\nif (idempotencyKey) {\n  const cached = await cache.get(idempotencyKey);\n  if (cached) return Response.json(cached);\n}",
      badExample: "// POST /api/payments — no idempotency — duplicate charges on network retry\nexport async function POST(req: Request) {\n  const result = await stripe.charges.create(...);\n  return Response.json(result);\n}",
      relatedPlaybooks: ['api-design.md', 'payments.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_idempotency', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/payment|charge|order|purchase|checkout/.test(path)) continue;
        if (!/POST|export\s+async\s+function\s+POST/.test(content)) continue;
        if (!/idempotency|idempotent/.test(content)) {
          findings.push({ severity, category: 'missing_idempotency', file: path, message: 'Payment/order endpoint without idempotency key support — duplicate charges on retry.', suggestion: "Check for an 'idempotency-key' header and cache the result to deduplicate retries." });
        }
      }
      return findings;
    },
  },

  {
    id: 'API_008',
    category: 'api_key_in_client_request',
    description: 'Making API requests with secret keys from client-side code exposes the key to anyone who inspects network traffic.',
    severity: 'BLOCKER',
    tags: ['api', 'security', 'secrets'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Any request made from a browser can be inspected in DevTools. API secret keys sent from the client are visible in the request headers to every user. All secret key usage must stay server-side.',
      commonViolations: ["fetch('https://api.openai.com', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }) in client component", "Stripe key in browser fetch"],
      goodExample: "// All secret API calls in route.ts / api/*.ts (server-side)\nexport async function POST(req: Request) {\n  const result = await openai.chat.completions.create(...);\n  return Response.json(result);\n}",
      badExample: "'use client'\n// API key sent from browser — visible in DevTools\nconst res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.OPENAI_KEY}` } });",
      relatedPlaybooks: ['security.md', 'ai-integration.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('api_key_in_client_request', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const isClient = /['"]use client['"]/.test(content.slice(0, 200));
        if (!isClient) continue;
        const SECRET_KEY_RE = /Authorization.*Bearer.*process\.env\.\w+(?:API_KEY|SECRET|TOKEN)/;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SECRET_KEY_RE.test(line)) {
            findings.push({ severity, category: 'api_key_in_client_request', file: path, line: i + 1, message: 'Secret API key used in client component fetch — visible in browser DevTools.', suggestion: 'Move this API call to a server route (route.ts) and call your route from the client instead.' });
          }
        }
      }
      return findings;
    },
  },

  // ── Database expansions ───────────────────────────────────────────────────

  {
    id: 'DB_009',
    category: 'n_plus_one_query',
    description: "N+1 query pattern: fetching a list then querying each item individually inside a loop.",
    severity: 'HIGH',
    tags: ['database', 'performance', 'prisma'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Fetching 100 posts then running findUnique() for each post's author makes 101 queries instead of 1. Use include/join or DataLoader to batch. N+1 is the most common database performance killer in ORMs.",
      commonViolations: ['const posts = await prisma.post.findMany()\nfor (const p of posts) { p.author = await prisma.user.findUnique({ where: { id: p.userId } }) }'],
      goodExample: "const posts = await prisma.post.findMany({ include: { author: true } })  // 1 query with JOIN",
      badExample: "const items = await db.select().from(orders)\nfor (const item of items) {\n  item.user = await db.select().from(users).where(eq(users.id, item.userId))\n}",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('n_plus_one_query', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/for\s*(?:const|let)\s+\w+\s+of\s+\w+/.test(line) || /\.forEach\s*\(/.test(line)) {
            const block = lines.slice(i, Math.min(i + 8, lines.length)).join('\n');
            if (/await\s+\w+\.(findUnique|findOne|findById|select|query)\s*\(/.test(block) && /prisma\.|db\.|repository\./.test(block)) {
              findings.push({ severity, category: 'n_plus_one_query', file: path, line: i + 1, message: 'Database query inside a loop — N+1 query pattern detected.', suggestion: 'Use include/join (Prisma: include: { relation: true }) or DataLoader to batch queries.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_010',
    category: 'prisma_missing_fk_index',
    description: "Prisma schema with a foreign key field but no @@index causes full table scans on related-record lookups.",
    severity: 'HIGH',
    tags: ['database', 'performance', 'schema', 'prisma'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A WHERE or ORDER BY on an un-indexed column scans every row. On a 1M-row table, that's hundreds of milliseconds vs microseconds with an index. Always index foreign keys and frequently-filtered columns.",
      commonViolations: ['// schema.prisma: model Post { userId String } — no @@index([userId])'],
      goodExample: "model Post {\n  userId  String\n  status  String\n  @@index([userId])\n  @@index([status, createdAt])\n}",
      badExample: "// Prisma schema with foreign key userId but no @@index([userId])\n// All user.posts queries do full table scan",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prisma_missing_fk_index', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('.prisma')) continue;
        const models = content.split(/^model\s+/m).slice(1);
        for (const model of models) {
          const modelName = model.match(/^(\w+)/)?.[1] ?? 'unknown';
          const foreignKeys = [...model.matchAll(/(\w+)\s+String(?:\s+@\w+)*\s*\/\/.*(?:id|Id)|(\w+Id)\s+String/g)].map(m => m[1] || m[2]);
          const indexes = content.match(/@@index\(\[([^\]]+)\]\)/g) ?? [];
          for (const fk of foreignKeys) {
            if (fk && !indexes.some(ix => ix.includes(fk))) {
              findings.push({ severity, category: 'prisma_missing_fk_index', file: path, message: `Prisma model '${modelName}': foreign key field '${fk}' has no @@index — may cause full table scans.`, suggestion: `Add @@index([${fk}]) to the model's attributes.` });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_011',
    category: 'select_star_prisma',
    description: "Selecting all fields with findMany() when only a subset is needed sends excess data over the wire.",
    severity: 'LOW',
    tags: ['database', 'performance', 'prisma'],
    sinceVersion: '3.0.0',
    explain: {
      why: "prisma.user.findMany() returns all fields including large text blobs, timestamps, and internal columns. Use select to fetch only the fields the UI needs — reduces payload size and query time.",
      commonViolations: ['const users = await prisma.user.findMany()  // fetches all 20 columns'],
      goodExample: "const users = await prisma.user.findMany({ select: { id: true, name: true, email: true } })",
      badExample: "const posts = await prisma.post.findMany({ where: { published: true } })  // includes content, metadata, internal fields",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('select_star_prisma', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/prisma\.\w+\.findMany\s*\(\s*\{/.test(line) && !line.includes('select:') && !line.includes('include:')) {
            const block = lines.slice(i, Math.min(i + 5, lines.length)).join('\n');
            if (!block.includes('select:') && !block.includes('include:')) {
              findings.push({ severity, category: 'select_star_prisma', file: path, line: i + 1, message: 'prisma.model.findMany() without select — returns all fields including large/unused columns.', suggestion: "Add select: { id: true, name: true } to return only the fields your UI needs." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_012',
    category: 'transaction_missing',
    description: "Multiple related database writes not wrapped in a transaction risk partial failures leaving data inconsistent.",
    severity: 'HIGH',
    tags: ['database', 'transactions', 'data-integrity'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If you create an order and then deduct inventory in separate queries, a crash between them leaves you with an order and no deducted inventory. Transactions guarantee atomicity: all succeed or all roll back.",
      commonViolations: ['await prisma.order.create({ ... })\nawait prisma.inventory.update({ ... })  // no transaction'],
      goodExample: "await prisma.$transaction([\n  prisma.order.create({ ... }),\n  prisma.inventory.update({ ... }),\n])",
      badExample: "// Two separate writes — server crash between them = inconsistent state\nawait db.insert(orders).values(order)\nawait db.update(inventory).set({ qty: qty - 1 })",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('transaction_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (content.includes('$transaction') || content.includes('db.transaction')) return findings;
        const writeLines: number[] = [];
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/await\s+(?:prisma|db)\.\w+\.(?:create|update|delete|upsert|deleteMany|updateMany)\s*\(/.test(line)) writeLines.push(i + 1);
        }
        if (writeLines.length >= 3) {
          findings.push({ severity, category: 'transaction_missing', file: path, line: writeLines[0], message: `${writeLines.length} database writes without a transaction — partial failure can corrupt data.`, suggestion: "Wrap related writes in prisma.$transaction([...]) to ensure atomicity." });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_013',
    category: 'soft_delete_missing',
    description: "Hard-deleting records permanently destroys data — implement soft delete with a deletedAt timestamp.",
    severity: 'MEDIUM',
    tags: ['database', 'data-safety', 'patterns'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Hard deletes are irreversible. Soft deletes (deletedAt: Date | null) allow data recovery, audit trails, and referential integrity. Any table that users \"own\" data in should support soft delete.",
      commonViolations: ['await prisma.user.delete({ where: { id } })  // permanent'],
      goodExample: "await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } })\n// Then filter: { where: { deletedAt: null } }",
      badExample: "await db.delete(users).where(eq(users.id, userId))  // cannot be undone",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('soft_delete_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/await\s+(?:prisma|db|repository)\.\w+\.delete(?:Many)?\s*\(\s*\{/.test(line) && !isCommentLine(line)) {
            if (!content.includes('deletedAt') && !content.includes('deleted_at')) {
              findings.push({ severity, category: 'soft_delete_missing', file: path, line: i + 1, message: 'Hard delete detected with no soft-delete pattern in this file.', suggestion: "Consider updating deletedAt instead of deleting: prisma.model.update({ where: { id }, data: { deletedAt: new Date() } })." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_014',
    category: 'connection_pool_exhaust',
    description: "Creating a new database connection per request instead of using a singleton connection pool will exhaust connections.",
    severity: 'BLOCKER',
    tags: ['database', 'connection-pool', 'nextjs'],
    sinceVersion: '3.0.0',
    explain: {
      why: "In serverless (Vercel, Lambda), modules re-execute in cold starts. A new PrismaClient() per module creates a new connection pool per invocation. With 100 concurrent lambdas, that's 100×20 = 2000 connections on a default Postgres pool of 100. Use a global singleton.",
      commonViolations: ['export const prisma = new PrismaClient()  // in lib/prisma.ts — re-created on each lambda cold start'],
      goodExample: "// lib/prisma.ts — singleton pattern\nconst globalForPrisma = globalThis as { prisma?: PrismaClient }\nexport const prisma = globalForPrisma.prisma ?? new PrismaClient()\nif (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma",
      badExample: "// api/users/route.ts\nconst prisma = new PrismaClient()  // new pool per route module",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('connection_pool_exhaust', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (path.includes('lib/prisma') || path.includes('db/client') || path.includes('db/prisma')) return findings;
        if (/new\s+PrismaClient\s*\(\s*\)/.test(content)) {
          findings.push({ severity, category: 'connection_pool_exhaust', file: path, message: 'new PrismaClient() in a non-singleton file — creates a new connection pool per lambda invocation.', suggestion: "Import the singleton from lib/prisma.ts which uses the globalThis pattern to reuse connections." });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_015',
    category: 'migration_without_rollback',
    description: "Migrations without a corresponding down/rollback script make production incidents harder to recover from.",
    severity: 'MEDIUM',
    tags: ['database', 'migrations', 'operations'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A bad deploy with a schema migration that can't be rolled back can leave production broken for hours. Always pair up/down scripts so you can revert. Prisma uses a different model (generate rollback via squash), but raw SQL migrations need both.",
      commonViolations: ['-- migration.sql: Only has up logic, no down migration'],
      goodExample: "-- migration_up.sql: ALTER TABLE users ADD COLUMN avatar_url TEXT\n-- migration_down.sql: ALTER TABLE users DROP COLUMN avatar_url",
      badExample: "-- 001_add_avatar.sql (only up migration)\nALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('migration_without_rollback', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SQL_EXT.test(path) || !path.includes('migrat')) continue;
        if (path.includes('_up') || path.includes('_down') || path.includes('.up.') || path.includes('.down.')) return findings;
        if (/ALTER\s+TABLE|CREATE\s+TABLE|DROP\s+COLUMN|ADD\s+COLUMN/i.test(content) && !content.toLowerCase().includes('-- down') && !content.toLowerCase().includes('-- rollback')) {
          findings.push({ severity, category: 'migration_without_rollback', file: path, message: 'Schema migration without a rollback/down section — hard to recover from in production incidents.', suggestion: "Add a -- Down: section or companion _down.sql file with the reversal SQL." });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_016',
    category: 'query_timeout_missing',
    description: "Database queries without a timeout can block indefinitely, exhausting the connection pool.",
    severity: 'HIGH',
    tags: ['database', 'resilience', 'timeouts'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A slow or stuck query holds a connection from the pool. Without a timeout, 10 slow queries can exhaust a 10-connection pool and lock the entire application. Set query_timeout or use Prisma's timeout extension.",
      commonViolations: ['const prisma = new PrismaClient()  // no timeout configuration'],
      goodExample: "const prisma = new PrismaClient({ \n  datasources: { db: { url: process.env.DATABASE_URL } }\n})\n// Or use Prisma's @prisma/extension-accelerate with timeout",
      badExample: "// No timeout set — one bad query can hang indefinitely and drain the pool",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('query_timeout_missing', config.severityRules);
      const findings: Finding[] = [];
      const prismaFile = changedFiles.find(f => f.path.includes('lib/prisma') || f.path.includes('db/client'));
      if (!prismaFile) return findings;
      if (/new\s+PrismaClient/.test(prismaFile.content) && !prismaFile.content.includes('timeout') && !prismaFile.content.includes('query_timeout')) {
        findings.push({ severity, category: 'query_timeout_missing', file: prismaFile.path, message: 'PrismaClient created without query timeout — slow queries can exhaust the connection pool.', suggestion: "Set a timeout via DATABASE_URL parameter (e.g., ?connect_timeout=10&pool_timeout=10) or Prisma Accelerate." });
      }
      return findings;
    },
  },

  {
    id: 'DB_017',
    category: 'pagination_missing',
    description: "Fetching all records without LIMIT/take causes slow queries and huge memory usage as data grows.",
    severity: 'HIGH',
    tags: ['database', 'performance', 'pagination'],
    sinceVersion: '3.0.0',
    explain: {
      why: "findMany() without take returns ALL rows. A table with 100K rows transfers gigabytes over time. Always add take/limit and cursor or skip-based pagination for any user-facing list query.",
      commonViolations: ['const allOrders = await prisma.order.findMany()  // returns every row'],
      goodExample: "const orders = await prisma.order.findMany({\n  take: 20,\n  skip: page * 20,\n  orderBy: { createdAt: 'desc' },\n})",
      badExample: "const products = await prisma.product.findMany({ where: { categoryId } })  // grows unbounded",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('pagination_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/prisma\.\w+\.findMany\s*\(\s*\{/.test(line)) {
            const block = lines.slice(i, Math.min(i + 8, lines.length)).join('\n');
            if (!block.includes('take:') && !block.includes('limit:') && !block.includes('cursor:')) {
              findings.push({ severity, category: 'pagination_missing', file: path, line: i + 1, message: 'prisma.findMany() without take/limit — returns all rows, grows unbounded as data grows.', suggestion: "Add take: 20, skip: page * 20 for offset pagination or cursor-based pagination for large datasets." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_018',
    category: 'optimistic_lock_missing',
    description: "Concurrent updates to the same record without optimistic locking cause lost updates.",
    severity: 'MEDIUM',
    tags: ['database', 'concurrency', 'data-integrity'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Two users read version=1 of a record, both modify it, both write — the second write overwrites the first's changes silently. Add a version or updatedAt check to detect and reject stale writes.",
      commonViolations: ['await prisma.order.update({ where: { id }, data: { status } })  // no version check'],
      goodExample: "await prisma.order.update({\n  where: { id, version: currentVersion },  // fails if already updated\n  data: { status, version: { increment: 1 } },\n})",
      badExample: "// Two concurrent requests both read order{version:1}, both update — second silently overwrites first",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('optimistic_lock_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!content.includes('concurrentl') && !content.includes('version') && !content.includes('optimistic')) return findings;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/prisma\.\w+\.update\s*\(\s*\{/.test(line)) {
            const block = lines.slice(i, Math.min(i + 6, lines.length)).join('\n');
            if (!block.includes('version') && !block.includes('updatedAt') && block.includes('status')) {
              findings.push({ severity, category: 'optimistic_lock_missing', file: path, line: i + 1, message: 'Status update without optimistic lock — concurrent updates may silently overwrite each other.', suggestion: "Add version field to where clause: { id, version: current } and increment version in data." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_019',
    category: 'seed_data_in_migration',
    description: "Inserting seed/test data in migrations couples environment-specific data with schema changes.",
    severity: 'MEDIUM',
    tags: ['database', 'migrations', 'patterns'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Migrations run in all environments (dev, staging, prod). Hard-coded INSERT statements with test users or sample data pollute production databases. Keep migrations schema-only; use db/seed.ts for data seeding.",
      commonViolations: ["INSERT INTO users (email) VALUES ('admin@example.com')  -- inside a migration"],
      goodExample: "// Keep in prisma/seed.ts — runs only in development:\n// await prisma.user.create({ data: { email: 'admin@example.com' } })",
      badExample: "-- migration 023\nALTER TABLE users ADD COLUMN tier VARCHAR(20);\nINSERT INTO users (email, tier) VALUES ('test@example.com', 'admin');  -- seed data in migration",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('seed_data_in_migration', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SQL_EXT.test(path) || !path.includes('migrat')) continue;
        if (/^\s*INSERT\s+INTO\b/im.test(content)) {
          findings.push({ severity, category: 'seed_data_in_migration', file: path, message: 'INSERT statement inside a migration — seed data belongs in prisma/seed.ts, not migrations.', suggestion: "Remove INSERT statements from migrations. Place seed data in prisma/seed.ts and run with 'prisma db seed'." });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_020',
    category: 'raw_sql_prisma',
    description: "prisma.$queryRaw with template literals bypasses type safety and may allow SQL injection.",
    severity: 'HIGH',
    tags: ['database', 'security', 'prisma', 'sql-injection'],
    sinceVersion: '3.0.0',
    explain: {
      why: "prisma.$queryRaw`...${userInput}` uses tagged template literals for parameterization — safe. But prisma.$queryRawUnsafe(string) or string concatenation bypasses this and allows SQL injection.",
      commonViolations: ["prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`)"],
      goodExample: "prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`  // parameterized",
      badExample: "const q = `SELECT * FROM ${table} WHERE id = '${id}'`\nawait prisma.$queryRawUnsafe(q)  // SQL injection risk",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('raw_sql_prisma', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\$queryRawUnsafe\s*\(/.test(line) || (/\$queryRaw\s*\(/.test(line) && line.includes('+'))) {
            findings.push({ severity, category: 'raw_sql_prisma', file: path, line: i + 1, message: 'Unsafe raw SQL with string interpolation — SQL injection risk.', suggestion: "Use tagged template literals: prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_021',
    category: 'db_call_in_middleware',
    description: "Database calls in Next.js middleware run on the Edge Runtime which doesn't support standard TCP connections.",
    severity: 'BLOCKER',
    tags: ['database', 'nextjs', 'edge-runtime'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Next.js middleware runs on the Edge Runtime (V8 isolates), which doesn't support Node.js TCP sockets. Prisma Client and most database drivers require TCP. Use HTTP-based APIs (Prisma Accelerate, Planetscale HTTP) for Edge-compatible DB access.",
      commonViolations: ["// middleware.ts\nimport { prisma } from '@/lib/prisma'\nexport async function middleware() { const user = await prisma.user.findUnique(...) }"],
      goodExample: "// middleware.ts — use JWT verification or HTTP-based lookups\n// DB calls: use Prisma Accelerate (HTTP) for Edge compatibility",
      badExample: "// middleware.ts (Edge Runtime)\nexport async function middleware(req: NextRequest) {\n  const session = await prisma.session.findUnique({ where: { token } })\n}",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_call_in_middleware', config.severityRules);
      const findings: Finding[] = [];
      const mwFile = changedFiles.find(f => f.path.endsWith('middleware.ts') || f.path.endsWith('middleware.js'));
      if (!mwFile) return findings;
      if (/prisma\.|new\s+PrismaClient|drizzle\(|mongoose\.|sequelize\./.test(mwFile.content)) {
        findings.push({ severity, category: 'db_call_in_middleware', file: mwFile.path, message: "Database client used in Next.js middleware — Edge Runtime doesn't support TCP connections.", suggestion: "Use Prisma Accelerate (HTTP-based) or check session via JWT/cookie without a DB call in middleware." });
      }
      return findings;
    },
  },

  {
    id: 'DB_022',
    category: 'cascade_delete_risk',
    description: "onDelete: Cascade on a parent relation can silently delete thousands of child records.",
    severity: 'HIGH',
    tags: ['database', 'schema', 'data-safety'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A Cascade delete on a User → Posts relation means deleting one user instantly deletes all their posts, comments, likes, etc. This is often unintentional. Use Restrict to prevent accidental cascades and handle deletions explicitly.",
      commonViolations: ['// schema.prisma: @relation(fields: [userId], references: [id], onDelete: Cascade)'],
      goodExample: "// Use Restrict to prevent accidental parent deletion:\n@relation(fields: [userId], references: [id], onDelete: Restrict)",
      badExample: "// Cascade on a table that owns user-generated content:\nuserId String\nuser   User @relation(..., onDelete: Cascade)  // deletes all user content when user is deleted",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['database-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cascade_delete_risk', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('.prisma')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/onDelete:\s*Cascade/.test(line)) {
            findings.push({ severity, category: 'cascade_delete_risk', file: path, line: i + 1, message: "onDelete: Cascade detected — may silently delete large numbers of child records if parent is deleted.", suggestion: "Consider onDelete: Restrict (block parent deletion while children exist) and handle deletion explicitly." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_023',
    category: 'db_enum_vs_string',
    description: "Using String instead of a database enum for finite-state fields loses type safety and allows invalid values.",
    severity: 'LOW',
    tags: ['database', 'schema', 'type-safety'],
    sinceVersion: '3.0.0',
    explain: {
      why: "A status column as String accepts 'aktive', 'ACTIVEE', 'deleted' — any typo becomes valid data. A Postgres enum or Prisma enum rejects invalid values at the database level, ensuring data integrity.",
      commonViolations: ["// Prisma: status String  // accepts any string"],
      goodExample: "// schema.prisma:\nenum OrderStatus { PENDING PAID SHIPPED DELIVERED CANCELLED }\nstatus OrderStatus @default(PENDING)",
      badExample: "// Prisma schema:\nstatus String @default(\"pending\")  // 'Pending', 'PENDING', 'pendinh' all accepted",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_enum_vs_string', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.endsWith('.prisma')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/\b(?:status|state|role|type|tier|plan)\s+String\b/.test(line)) {
            findings.push({ severity, category: 'db_enum_vs_string', file: path, line: i + 1, message: `Finite-state field '${line.trim().split(' ')[0]}' typed as String — use a Prisma enum for type safety.`, suggestion: "Define an enum: enum Status { ACTIVE INACTIVE PENDING } and use it as the field type." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_024',
    category: 'db_balance_update_no_transaction',
    description: 'Balance or inventory updated outside a transaction — concurrent requests can produce incorrect totals (TOCTOU).',
    severity: 'BLOCKER',
    tags: ['database', 'race-condition', 'concurrency', 'transactions'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Read-then-write patterns on numeric fields (balances, inventory counts, seat counts) without a transaction or atomic increment are vulnerable to TOCTOU (Time Of Check, Time Of Use) race conditions. Two concurrent requests both read the same value and both write a new value, losing one update.',
      commonViolations: [
        'const user = await prisma.user.findFirst(...);\nawait prisma.user.update({ data: { balance: user.balance - amount } });',
      ],
      goodExample: 'await prisma.user.update({ where: { id, balance: { gte: amount } }, data: { balance: { decrement: amount } } });',
      badExample: 'const u = await prisma.user.findUnique({ where: { id } });\nawait prisma.user.update({ data: { balance: u.balance - amount } });  // ❌ race',
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_balance_update_no_transaction', config.severityRules);
      const findings: Finding[] = [];
      const FIND_RE = /await\s+\w+\.(?:findFirst|findUnique|findOne)\s*\(/i;
      const BALANCE_UPDATE_RE = /\.balance\s*[+-]\s*|\.credits?\s*[+-]\s*|\.inventory\s*[+-]\s*|\.quantity\s*[+-]\s*/i;
      const ATOMIC_RE = /\$transaction|decrement|increment|atomic|\bselectForUpdate\b/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!FIND_RE.test(content)) continue;
        if (!BALANCE_UPDATE_RE.test(content)) continue;
        if (!ATOMIC_RE.test(content)) {
          findings.push({ severity, category: 'db_balance_update_no_transaction', file: path, message: 'Balance/inventory updated via read-then-write outside a transaction — race condition risk.', suggestion: 'Use atomic increment/decrement: prisma.user.update({ data: { balance: { decrement: amount } } })' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_025',
    category: 'db_find_then_update_toctou',
    description: '`findFirst` + `update` pattern without `$transaction` — classic TOCTOU race condition.',
    severity: 'HIGH',
    tags: ['database', 'race-condition', 'concurrency', 'prisma'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'The pattern `const x = await prisma.model.findFirst(...)` followed by `await prisma.model.update(...)` in the same function is a classic TOCTOU race. Between the read and the write, another request can modify the row, corrupting data. Must use $transaction with select-for-update or an upsert.',
      commonViolations: [
        'const existing = await prisma.order.findFirst(...);\nif (existing.status === "PENDING") { await prisma.order.update(...) }',
      ],
      goodExample: "await prisma.$transaction(async (tx) => {\n  const existing = await tx.order.findFirst({ where: { id }, select: { id: true, status: true } });\n  if (existing?.status !== 'PENDING') throw new Error('Not pending');\n  return tx.order.update({ where: { id }, data: { status: 'PROCESSING' } });\n});",
      badExample: "const order = await prisma.order.findFirst({ where: { id } });\nif (order?.status === 'PENDING') {\n  await prisma.order.update({ data: { status: 'PROCESSING' } });  // ❌ TOCTOU\n}",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_find_then_update_toctou', config.severityRules);
      const findings: Finding[] = [];
      const FIND_THEN_UPDATE_RE = /await\s+\w+\.findFirst[\s\S]{1,400}?await\s+\w+\.update\s*\(/;
      const TRANSACTION_RE = /\$transaction|tx\./i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (FIND_THEN_UPDATE_RE.test(content) && !TRANSACTION_RE.test(content)) {
          findings.push({ severity, category: 'db_find_then_update_toctou', file: path, message: 'findFirst + update outside a transaction — TOCTOU race condition.', suggestion: 'Wrap both operations in prisma.$transaction() to prevent concurrent state corruption.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_026',
    category: 'db_concurrent_upsert_no_unique',
    description: 'Concurrent `upsert` calls can create duplicate records if no unique constraint exists on the target field.',
    severity: 'HIGH',
    tags: ['database', 'race-condition', 'concurrency', 'prisma'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Prisma upsert uses a where + create + update pattern. Without a database-level unique constraint, two concurrent requests can both evaluate "not found" and both execute the create, resulting in duplicate rows. The unique constraint is the actual safety mechanism.',
      commonViolations: [
        'await prisma.profile.upsert({ where: { userId }, create: { ... }, update: { ... } })  // without @unique on userId',
      ],
      goodExample: '// Ensure unique constraint in schema:\n// userId String @unique\n// Then upsert is safe under concurrency',
      badExample: '// schema.prisma: userId String  (no @unique)\n// code: await prisma.profile.upsert({ where: { userId } ... })  // ❌ duplicate risk',
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_concurrent_upsert_no_unique', config.severityRules);
      const findings: Finding[] = [];
      const UPSERT_RE = /await\s+\w+\.upsert\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (UPSERT_RE.test(lines[i]!)) {
            findings.push({ severity, category: 'db_concurrent_upsert_no_unique', file: path, line: i + 1, message: 'Upsert without verified unique constraint — concurrent calls may create duplicate records.', suggestion: 'Ensure the where field has a @unique constraint in the Prisma schema to make upsert safe under concurrency.' });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_027',
    category: 'db_missing_idempotency_key',
    description: 'Mutating API route has no idempotency key — double-submit creates duplicate records.',
    severity: 'HIGH',
    tags: ['database', 'race-condition', 'idempotency', 'api'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Network retries, double-clicks, and load balancer timeouts can cause duplicate POST requests. Without an idempotency key, payment routes and order creation endpoints create duplicate records. Stripe, Braintree, and AWS all require idempotency keys for this reason.',
      commonViolations: [
        'await prisma.order.create({ data: orderData })  // on POST /checkout — no idempotency',
      ],
      goodExample: "const idempotencyKey = req.headers['idempotency-key'];\nif (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key header required' });\nconst existing = await prisma.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });\nif (existing) return res.json(existing.response);",
      badExample: "export async function POST(req) {\n  const order = await prisma.order.create({ data: await req.json() });\n  return NextResponse.json(order);  // ❌ no idempotency\n}",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_missing_idempotency_key', config.severityRules);
      const findings: Finding[] = [];
      const CREATE_RE = /await\s+\w+\.(?:order|payment|invoice|transaction|subscription)\.create\s*\(/i;
      const IDEMPOTENCY_RE = /idempotency.?key|idempotencyKey|Idempotency-Key/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!CREATE_RE.test(content)) continue;
        if (!IDEMPOTENCY_RE.test(content)) {
          findings.push({ severity, category: 'db_missing_idempotency_key', file: path, message: 'Order/payment creation without idempotency key — double-submit creates duplicate records.', suggestion: 'Require Idempotency-Key header and cache responses to prevent duplicate operations.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_028',
    category: 'db_abort_controller_missing',
    description: 'Sequential async fetch chain without AbortController — stale responses from cancelled requests corrupt state.',
    severity: 'MEDIUM',
    tags: ['database', 'race-condition', 'concurrency', 'frontend'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'When a user triggers multiple sequential requests (e.g., typing in a search box), earlier requests can resolve after later ones. Without AbortController, the stale earlier response overwrites the correct later one — a classic React race condition documented extensively.',
      commonViolations: [
        'useEffect(() => { fetch(url).then(setData); }, [query])',
      ],
      goodExample: "useEffect(() => {\n  const controller = new AbortController();\n  fetch(url, { signal: controller.signal }).then(r => r.json()).then(setData).catch(() => {});\n  return () => controller.abort();\n}, [query]);",
      badExample: "useEffect(() => {\n  fetch(`/api/search?q=${query}`).then(r => r.json()).then(setResults);\n}, [query]);  // ❌ stale closure race",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_abort_controller_missing', config.severityRules);
      const findings: Finding[] = [];
      const USE_EFFECT_FETCH_RE = /useEffect\s*\(\s*(?:\(\s*\)|async\s*\(\s*\)|async\s+\(\s*\))\s*=>\s*\{[\s\S]{0,200}?\bfetch\s*\(/;
      const ABORT_RE = /AbortController|\.abort\s*\(\)|signal\s*:/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (USE_EFFECT_FETCH_RE.test(content) && !ABORT_RE.test(content)) {
          findings.push({ severity, category: 'db_abort_controller_missing', file: path, message: 'useEffect with fetch has no AbortController — stale response race condition.', suggestion: 'Add AbortController and return cleanup: const c = new AbortController(); ... return () => c.abort();' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_029',
    category: 'db_sequential_await_in_loop',
    description: 'Sequential `await` in a loop instead of `Promise.all` — unnecessary serialization and potential race-free alternative.',
    severity: 'MEDIUM',
    tags: ['database', 'performance', 'concurrency'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'AI-generated code commonly uses `for...of` with `await` inside, making independent database operations run serially. This is 5-10× slower than Promise.all for independent queries and signals the developer may have missed concurrency implications entirely.',
      commonViolations: [
        'for (const id of ids) { await prisma.user.findUnique({ where: { id } }); }',
      ],
      goodExample: 'const results = await Promise.all(ids.map(id => prisma.user.findUnique({ where: { id } })));',
      badExample: 'for (const id of userIds) {\n  const user = await prisma.user.findUnique({ where: { id } });\n  users.push(user);  // ❌ serial — use Promise.all\n}',
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_sequential_await_in_loop', config.severityRules);
      const findings: Finding[] = [];
      const FOR_OF_RE = /for\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+\w+/;
      const AWAIT_IN_LOOP_RE = /for\s*\((?:const|let|var)\s+\w+\s+of[\s\S]{0,300}?\bawait\s+\w+\.\w+\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (FOR_OF_RE.test(content) && AWAIT_IN_LOOP_RE.test(content)) {
          findings.push({ severity, category: 'db_sequential_await_in_loop', file: path, message: 'Sequential await in for-of loop — use Promise.all for independent async operations.', suggestion: 'Replace with: const results = await Promise.all(items.map(item => asyncOp(item)));' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_030',
    category: 'db_ticket_reservation_no_lock',
    description: 'Ticket, seat, or appointment reservation without pessimistic lock — overselling under concurrent requests.',
    severity: 'HIGH',
    tags: ['database', 'race-condition', 'concurrency', 'inventory'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Reservation systems (tickets, seats, appointments, limited inventory) require either a SELECT FOR UPDATE pessimistic lock or an optimistic lock with version field. Without this, two concurrent users can both "claim" the last available slot. This is the classic overselling bug.',
      commonViolations: [
        'const seat = await prisma.seat.findFirst({ where: { available: true } });\nawait prisma.seat.update({ where: { id: seat.id }, data: { available: false } });',
      ],
      goodExample: "await prisma.$transaction(async (tx) => {\n  const seat = await tx.$queryRaw`SELECT * FROM seats WHERE available = true LIMIT 1 FOR UPDATE`;\n  if (!seat[0]) throw new Error('No seats available');\n  await tx.seat.update({ where: { id: seat[0].id }, data: { available: false, userId } });\n});",
      badExample: "const seat = await prisma.seat.findFirst({ where: { available: true } });\nif (seat) {\n  await prisma.seat.update({ data: { available: false } });  // ❌ oversell race\n}",
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_ticket_reservation_no_lock', config.severityRules);
      const findings: Finding[] = [];
      const RESERVATION_RE = /(?:seat|ticket|slot|appointment|booking|reservation).*available/i;
      const LOCK_RE = /FOR\s+UPDATE|SELECT_FOR_UPDATE|pessimistic|optimistic|version.*increment|\$queryRaw/i;
      const TRANSACTION_RE = /\$transaction/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!RESERVATION_RE.test(content)) continue;
        if (!LOCK_RE.test(content) && !TRANSACTION_RE.test(content)) {
          findings.push({ severity, category: 'db_ticket_reservation_no_lock', file: path, message: 'Ticket/seat reservation without SELECT FOR UPDATE lock — overselling under concurrency.', suggestion: 'Use $transaction with SELECT FOR UPDATE or optimistic locking (version field) to prevent overselling.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'DB_031',
    category: 'db_shared_state_no_atomicity',
    description: 'Event handler or callback updates shared mutable state without atomicity — lost update under concurrent execution.',
    severity: 'MEDIUM',
    tags: ['database', 'race-condition', 'concurrency', 'state'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'In Node.js, shared in-memory state (counters, caches, queues) mutated in async event handlers is subject to interleaving. Although Node.js is single-threaded, `await` yields execution and allows another handler to run concurrently, corrupting shared state.',
      commonViolations: [
        'let count = 0;\napp.post("/vote", async (req, res) => { count += 1; await db.save(count); });',
      ],
      goodExample: 'await db.collection.updateOne({ _id }, { $inc: { count: 1 } });  // atomic at DB level',
      badExample: 'let counter = 0;\nwebhook.on("event", async () => {\n  counter += 1;  // ❌ not atomic across concurrent async handlers\n  await save(counter);\n});',
      relatedPlaybooks: ['database-migrations.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('db_shared_state_no_atomicity', config.severityRules);
      const findings: Finding[] = [];
      const SHARED_COUNTER_RE = /(?:let|var)\s+(?:count|counter|total|sum|hits)\s*=\s*0/i;
      const ASYNC_MUTATION_RE = /async\s+(?:function|\(|(?:req|ctx|event)\s*[,)])[^{]*\{[\s\S]{0,200}?\bcount(?:er|s|)\s*\+=/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (SHARED_COUNTER_RE.test(content) && ASYNC_MUTATION_RE.test(content)) {
          findings.push({ severity, category: 'db_shared_state_no_atomicity', file: path, message: 'Shared mutable counter incremented inside async handler — lost update under concurrency.', suggestion: 'Use atomic database operations ($inc, SERIAL, or transactions) instead of in-memory shared state.' });
        }
      }
      return findings;
    },
  },
];
