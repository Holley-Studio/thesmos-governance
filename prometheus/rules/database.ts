import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, SQL_EXT, isTestPath, isCommentLine } from './helpers';

export const DATABASE_RULES: PrometheusRule[] = [
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
];
