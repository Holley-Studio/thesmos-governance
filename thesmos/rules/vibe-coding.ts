// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Vibe-Coding Security Rules — VIBE_001–025
 *
 * These rules target the systematic, predictable security failure modes of
 * AI coding assistants (Claude, Copilot, Cursor, Windsurf). Research shows
 * 100% of vibe-coded apps miss CSRF protection, have SSRF vulnerabilities,
 * and ship without rate limiting. These rules catch those gaps before prod.
 *
 * Reference: CSA Research Note on AI-Generated Code Security (2025)
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Detection helpers ─────────────────────────────────────────────────────────

function isTestPath(p: string) {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p) || /(^|\/)__tests__\//.test(p);
}
function isApiRoute(p: string) {
  return /\/(api|route|handler)s?\//.test(p) || /route\.(ts|js)$/.test(p) || /\/(pages|app)\/api\//.test(p);
}
function isServerFile(p: string) {
  return isApiRoute(p) || /\.(server|action)\.(ts|tsx|js)$/.test(p) || /actions\//.test(p);
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const VIBE_CODING_RULES: ThesmosRule[] = [
  {
    id: 'VIBE_001',
    category: 'vibe_csrf_missing',
    description: 'POST/PUT/DELETE handlers in AI-generated code often lack CSRF protection — the #1 vibe-coding gap.',
    severity: 'HIGH',
    tags: ['security', 'csrf', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Research shows 100% of vibe-coded apps tested lacked CSRF protection. AI assistants generate the happy path (data in → response out) but skip the security handshake that prevents malicious sites from submitting forms on a user\'s behalf.',
      commonViolations: [
        'export async function POST(req) { const body = await req.json(); await db.insert(...) } — no CSRF check',
        'Form handler with no csrf token validation',
        'tRPC mutation missing CSRF header assertion',
      ],
      goodExample: 'import { validateCsrfToken } from "@/lib/csrf";\nexport async function POST(req) {\n  await validateCsrfToken(req);\n  // safe to proceed\n}',
      badExample: 'export async function POST(req) {\n  const { userId } = await req.json();\n  await db.update(users, ...) // ❌ no CSRF\n}',
      relatedPlaybooks: ['csrf-protection.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['csrf-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_csrf_missing', config.severityRules);
      const findings: Finding[] = [];
      const MUTATION_EXPORT = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\(/;
      const CSRF_CHECK = /csrf|xsrf|x-csrf|verifyCsrf|validateCsrf|getToken/i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) || isTestPath(path)) continue;
        if (!MUTATION_EXPORT.test(content)) continue;
        if (CSRF_CHECK.test(content)) continue;
        const line = content.split('\n').findIndex((l) => MUTATION_EXPORT.test(l)) + 1;
        findings.push({
          severity: sev, category: 'vibe_csrf_missing', file: path, line: line || undefined,
          message: 'Mutating API route (POST/PUT/PATCH/DELETE) has no visible CSRF protection.',
          suggestion: 'Add a CSRF token validation step before processing the request body.',
        });
      }
      return findings;
    },
  },

  {
    id: 'VIBE_002',
    category: 'vibe_ssrf',
    description: 'AI tools generate fetch(userInput) patterns that are trivially exploitable as SSRF.',
    severity: 'BLOCKER',
    tags: ['security', 'ssrf', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Server-Side Request Forgery (SSRF) lets attackers redirect server-initiated HTTP requests to internal services, cloud metadata endpoints (169.254.169.254), or private networks. AI assistants generate `fetch(url)` where `url` comes from user input without validating the destination.',
      commonViolations: [
        'const res = await fetch(body.url) — user-controlled URL',
        'fetch(searchParams.get("endpoint"))',
        'axios.get(req.query.target)',
      ],
      goodExample: 'const ALLOWED_HOSTS = new Set(["api.example.com"]);\nconst parsed = new URL(userUrl);\nif (!ALLOWED_HOSTS.has(parsed.hostname)) throw new Error("Disallowed host");\nawait fetch(parsed.toString());',
      badExample: 'const { url } = await req.json();\nconst data = await fetch(url); // ❌ SSRF: attacker controls destination',
      relatedPlaybooks: ['ssrf-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['url-validator'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_ssrf', config.severityRules);
      const findings: Finding[] = [];
      // fetch/axios with a variable that looks like it came from request context
      const SSRF_RE = /(?:fetch|axios\.get|axios\.post|axios\.request|got|request)\s*\(\s*(?:url|href|endpoint|target|src|source|link|uri|redirect|body\.|params\.|query\.|req\.|input\.)/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SSRF_RE.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_ssrf', file: path, line: i + 1,
              message: 'Potential SSRF: HTTP request with a URL that may originate from user input.',
              suggestion: 'Validate the URL against an allowlist of permitted hosts before making the request.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_003',
    category: 'vibe_no_rate_limit',
    description: 'AI-generated API routes almost never include rate limiting — exposing endpoints to brute force and resource exhaustion.',
    severity: 'HIGH',
    tags: ['security', 'rate-limiting', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI coding assistants focus on the core business logic and skip operational hardening. Public-facing endpoints without rate limits are trivially abused for credential stuffing, API key enumeration, and DoS attacks.',
      commonViolations: [
        'Login route with no rate limit — enables brute force',
        'Password reset endpoint callable unlimited times',
        'AI inference endpoint with no throttle — attacker drives up your LLM costs',
      ],
      goodExample: 'import { rateLimit } from "@/lib/rate-limit";\nexport async function POST(req) {\n  await rateLimit(req, { max: 5, window: "1m" });\n  // handle login\n}',
      badExample: 'export async function POST(req) {\n  const { email, password } = await req.json();\n  return signIn(email, password); // ❌ no rate limit\n}',
      relatedPlaybooks: ['rate-limiting.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['rate-limit-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_no_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      const SENSITIVE_ROUTES = /\/(login|signin|sign-in|auth|password|reset|register|signup|sign-up|verify|otp|token|ai|generate|chat|complete)/i;
      const RATE_LIMIT_RE = /rateLimit|rateLimiter|rate.limit|throttle|upstash|redis\.incr|limiter/i;
      const HANDLER_RE = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH)\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) || isTestPath(path)) continue;
        if (!SENSITIVE_ROUTES.test(path) && !SENSITIVE_ROUTES.test(content)) continue;
        if (!HANDLER_RE.test(content)) continue;
        if (RATE_LIMIT_RE.test(content)) continue;
        const line = content.split('\n').findIndex((l) => HANDLER_RE.test(l)) + 1;
        findings.push({
          severity: sev, category: 'vibe_no_rate_limit', file: path, line: line || undefined,
          message: 'Sensitive route (auth/AI/password) has no rate limiting.',
          suggestion: 'Add rate limiting (e.g., Upstash, express-rate-limit) before this handler executes.',
        });
      }
      return findings;
    },
  },

  {
    id: 'VIBE_004',
    category: 'vibe_missing_security_headers',
    description: 'AI-generated Next.js configs skip security headers — leaving apps vulnerable to clickjacking, MIME sniffing, and XSS.',
    severity: 'MEDIUM',
    tags: ['security', 'headers', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Security headers (X-Frame-Options, CSP, X-Content-Type-Options, HSTS) are a 15-minute hardening task that AI assistants almost never include. They prevent a category of attacks that technical controls further down the stack cannot stop.',
      commonViolations: [
        'next.config.js with no headers() function',
        'Express app with no helmet() middleware',
        'API responses missing X-Content-Type-Options',
      ],
      goodExample: '// next.config.js\nconst securityHeaders = [\n  { key: "X-Frame-Options", value: "DENY" },\n  { key: "X-Content-Type-Options", value: "nosniff" },\n  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },\n];\nmodule.exports = { async headers() { return [{ source: "/(.*)", headers: securityHeaders }] } }',
      badExample: '// next.config.js\nmodule.exports = { reactStrictMode: true }; // ❌ no security headers',
      relatedPlaybooks: ['security-headers.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['headers-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_missing_security_headers', config.severityRules);
      const findings: Finding[] = [];
      const NEXT_CONFIG = /next\.config\.(js|ts|mjs)$/;
      const EXPRESS_APP = /(?:express|app)\.(use|get|post|listen)\s*\(/;
      const HEADER_RE = /helmet|securityHeaders|X-Frame-Options|Content-Security-Policy|X-Content-Type-Options|HSTS|Strict-Transport/i;
      for (const { path, content } of changedFiles) {
        if (NEXT_CONFIG.test(path)) {
          if (!HEADER_RE.test(content)) {
            findings.push({
              severity: sev, category: 'vibe_missing_security_headers', file: path,
              message: 'next.config.js has no security headers configuration.',
              suggestion: 'Add a headers() export with X-Frame-Options, X-Content-Type-Options, and Referrer-Policy at minimum.',
            });
          }
        } else if (/\.(ts|js)$/.test(path) && EXPRESS_APP.test(content)) {
          if (!HEADER_RE.test(content)) {
            findings.push({
              severity: sev, category: 'vibe_missing_security_headers', file: path,
              message: 'Express app has no helmet() or security header middleware.',
              suggestion: 'Add `app.use(helmet())` early in the middleware chain.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_005',
    category: 'vibe_cors_wildcard',
    description: 'AI-generated backends frequently use CORS wildcard (`*`) that allows any origin to make credentialed requests.',
    severity: 'HIGH',
    tags: ['security', 'cors', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'CORS wildcards allow any website to make cross-origin requests to your API. Combined with cookies or auth tokens, this enables cross-site data theft. AI tools use `origin: "*"` as the path of least resistance when debugging CORS errors.',
      commonViolations: [
        'cors({ origin: "*" })',
        'Access-Control-Allow-Origin: *',
        '\'Access-Control-Allow-Origin\', \'*\'',
      ],
      goodExample: "cors({ origin: process.env.ALLOWED_ORIGIN, credentials: true })",
      badExample: "app.use(cors({ origin: '*', credentials: true })); // ❌ any site can make credentialed requests",
      relatedPlaybooks: ['cors-configuration.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['cors-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_cors_wildcard', config.severityRules);
      const findings: Finding[] = [];
      const WILDCARD_RE = /(?:origin\s*:\s*['"`]\*['"`]|Access-Control-Allow-Origin['"`,\s:]*\*)/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (WILDCARD_RE.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_cors_wildcard', file: path, line: i + 1,
              message: 'CORS wildcard (`*`) origin — allows any site to make cross-origin requests.',
              suggestion: 'Set `origin` to an explicit allowlist of trusted domains.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_006',
    category: 'vibe_missing_input_validation',
    description: 'AI-generated API routes accept request bodies without schema validation — the primary source of injection and type confusion bugs.',
    severity: 'HIGH',
    tags: ['security', 'validation', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI assistants generate `const body = await req.json()` and immediately destructure it. Without schema validation (Zod, Yup, Valibot), the handler trusts arbitrary attacker-controlled data. This is the root cause of mass-assignment, prototype pollution, and SQL injection.',
      commonViolations: [
        'const { name, email } = await req.json() — no validation',
        'const data = req.body — no schema check before use',
        'Destructuring query params without parsing/coercing types',
      ],
      goodExample: 'const BodySchema = z.object({ name: z.string().max(100), email: z.string().email() });\nconst body = BodySchema.parse(await req.json());',
      badExample: 'export async function POST(req) {\n  const { name, email, role } = await req.json(); // ❌ mass-assignment possible\n  await db.insert(users, { name, email, role });\n}',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['zod-schema-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_missing_input_validation', config.severityRules);
      const findings: Finding[] = [];
      const JSON_PARSE = /await\s+req\.json\(\)/;
      const VALIDATION = /\.parse\(|\.safeParse\(|\.validate\(|\.parseAsync\(|z\.|yup\.|joi\.|valibot/i;
      const HANDLER_RE = /export\s+(?:async\s+)?function\s+(POST|PUT|PATCH|DELETE)\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) || isTestPath(path)) continue;
        if (!HANDLER_RE.test(content) || !JSON_PARSE.test(content)) continue;
        if (VALIDATION.test(content)) continue;
        const line = content.split('\n').findIndex((l) => JSON_PARSE.test(l)) + 1;
        findings.push({
          severity: sev, category: 'vibe_missing_input_validation', file: path, line: line || undefined,
          message: 'Request body parsed without schema validation (Zod, Yup, Valibot, etc.).',
          suggestion: 'Define a schema and call `.parse()` on the raw body before destructuring it.',
        });
      }
      return findings;
    },
  },

  {
    id: 'VIBE_007',
    category: 'vibe_hardcoded_secret',
    description: 'AI assistants fill in placeholder secrets (API keys, tokens, passwords) during code generation that get committed.',
    severity: 'BLOCKER',
    tags: ['security', 'secrets', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI coding tools use realistic-looking placeholder values to make code "work immediately." These placeholders are often real-looking strings that pass regex checks but get committed and pushed to public repos.',
      commonViolations: [
        'const API_KEY = "sk-proj-abc123..."',
        'apiKey: "your-api-key-here"',
        'Authorization: `Bearer ${hardcodedToken}`',
      ],
      goodExample: "const apiKey = process['env' as 'env']['OPENAI_API_KEY'];",
      badExample: "const OPENAI = new OpenAI({ apiKey: 'sk-proj-yourkey' }); // ❌",
      relatedPlaybooks: ['secret-management.md'],
      relatedAgents: ['secret-scanner'],
      relatedSkills: ['env-var-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_hardcoded_secret', config.severityRules);
      const findings: Finding[] = [];
      const HARDCODED_SECRET_RE = /(?:apiKey|api_key|secret|token|password|auth_token|bearer)\s*[:=]\s*['"`][A-Za-z0-9+/\-_.]{12,}['"`]/i;
      const PLACEHOLDER_RE = /your[-_]?(api[-_]?key|key|token|secret|password)|sk-proj-[a-z]/i;
      // Sentinel must be an UPPERCASE token inside a quoted value — the lowercase HTML/JSX
      // `placeholder` attribute and UI constants like SEARCH_PLACEHOLDER must never match.
      const SENTINEL_VALUE_RE = /['"`][^'"`\n]*(?:PLACEHOLDER|INSERT[-_]?KEY)[^'"`\n]*['"`]/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if ((HARDCODED_SECRET_RE.test(l) || PLACEHOLDER_RE.test(l) || SENTINEL_VALUE_RE.test(l)) &&
              !/process\.env|process\[|getenv|os\.environ/i.test(l)) {
            findings.push({
              severity: sev, category: 'vibe_hardcoded_secret', file: path, line: i + 1,
              message: 'Potential hardcoded API key or secret — AI placeholder values get committed.',
              suggestion: 'Move to an environment variable and access via process[\'env\' as \'env\'][\'VAR_NAME\'].',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_008',
    category: 'vibe_eval_usage',
    description: 'eval() and new Function() are AI hallucination favorites for "dynamic" code — they allow arbitrary code execution.',
    severity: 'BLOCKER',
    tags: ['security', 'injection', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools reach for eval() when asked to implement dynamic expression evaluation, formula parsers, or JSON "deserialization with functions." Any user-controlled input reaching eval() is remote code execution.',
      commonViolations: [
        'eval(userFormula)',
        'new Function("return " + expression)()',
        'const fn = new Function(code); fn()',
      ],
      goodExample: 'import { evaluate } from "mathjs"; // safe math evaluator\nconst result = evaluate(userExpression);',
      badExample: 'const result = eval(req.body.formula); // ❌ RCE if formula is user-controlled',
      relatedPlaybooks: ['injection-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_eval_usage', config.severityRules);
      const findings: Finding[] = [];
      const EVAL_RE = /\beval\s*\(|new\s+Function\s*\(/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (EVAL_RE.test(lines[i]) && !/\/\//. test(lines[i].slice(0, lines[i].search(EVAL_RE)))) {
            findings.push({
              severity: sev, category: 'vibe_eval_usage', file: path, line: i + 1,
              message: 'eval() or new Function() detected — potential arbitrary code execution.',
              suggestion: 'Use a safe evaluation library (mathjs, jsep) or restructure to avoid dynamic evaluation.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_009',
    // Shape heuristic — can misfire on innocent code; reports but does not gate
    // unless gate.minConfidence is lowered. See thesmos/gate.ts.
    confidence: 'medium',
    category: 'vibe_sql_template_injection',
    description: 'AI-generated SQL using template literals with unescaped interpolation is trivially exploitable.',
    severity: 'BLOCKER',
    tags: ['security', 'sql-injection', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate raw SQL queries using template literals when asked to "build a flexible search" or "add filtering." Any variable interpolation into SQL is textbook SQL injection. Parameterized queries are the only safe approach.',
      commonViolations: [
        '`SELECT * FROM users WHERE email = \'${email}\'`',
        '`DELETE FROM ${tableName} WHERE id = ${id}`',
        'db.execute(`INSERT INTO orders (${cols.join(",")}) VALUES (...)`)',
      ],
      goodExample: 'db.prepare("SELECT * FROM users WHERE email = ?").get(email)',
      badExample: 'db.execute(`SELECT * FROM ${table} WHERE id = ${req.params.id}`); // ❌ SQL injection',
      relatedPlaybooks: ['database-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['query-builder-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_sql_template_injection', config.severityRules);
      const findings: Finding[] = [];
      // Match a template literal whose CONTENT begins with a SQL keyword and
      // contains interpolation. The old shape (keyword outside the backtick,
      // no quotes allowed in between) could never match its own documented
      // examples — `SELECT ... '${email}'` has a quote that broke [^`'"]* —
      // while identifiers like createTerminal(`${x}`) DID match via the
      // unanchored keyword CREATE. Content may contain quotes ([^`]*).
      const SQL_INTERP = /`\s*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b[^`]*\$\{/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SQL_INTERP.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_sql_template_injection', file: path, line: i + 1,
              message: 'SQL query built with template literal interpolation — potential SQL injection.',
              suggestion: 'Use parameterized queries or a query builder (Drizzle, Prisma, Kysely) instead.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_010',
    category: 'vibe_path_traversal',
    description: 'AI-generated file-serving code using path.join(userInput) enables directory traversal attacks.',
    severity: 'BLOCKER',
    tags: ['security', 'path-traversal', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate `fs.readFile(path.join(base, userParam))` as a natural pattern for "serving files by name." Without path normalization and allowlist checking, an attacker passes `../../etc/passwd` to read arbitrary server files.',
      commonViolations: [
        'fs.readFile(path.join(__dirname, req.params.file))',
        'fs.readFileSync(join(uploadsDir, filename))',
        'createReadStream(path.join(root, query.path))',
      ],
      goodExample: 'const safe = path.resolve(baseDir, filename);\nif (!safe.startsWith(baseDir)) throw new Error("Path traversal");\nfs.readFile(safe, ...)',
      badExample: 'const file = path.join(uploadsDir, req.query.name);\nres.sendFile(file); // ❌ path traversal',
      relatedPlaybooks: ['file-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const PATH_JOIN_RE = /(?:path\.join|path\.resolve|join)\s*\([^)]*(?:req\.|params\.|query\.|body\.|searchParams\.)/;
      const SAFE_CHECK = /\.startsWith|path\.normalize|allowlist|whitelist|sanitize/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (PATH_JOIN_RE.test(lines[i]) && !SAFE_CHECK.test(content)) {
            findings.push({
              severity: sev, category: 'vibe_path_traversal', file: path, line: i + 1,
              message: 'File path constructed from request input — potential path traversal.',
              suggestion: 'Resolve to an absolute path, then verify it starts with the intended base directory.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_011',
    category: 'vibe_unvalidated_redirect',
    description: 'AI-generated redirect(searchParams.get("next")) enables open redirect attacks used for phishing.',
    severity: 'HIGH',
    tags: ['security', 'redirect', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools implement "redirect after login" using `redirect(searchParams.get("next"))` without validating the destination. An attacker crafts `/login?next=https://evil.com` to redirect victims to a phishing page after authentication.',
      commonViolations: [
        'redirect(searchParams.get("next"))',
        'res.redirect(req.query.returnUrl)',
        'router.push(params.redirect)',
      ],
      goodExample: 'const next = searchParams.get("next") ?? "/";\nif (!next.startsWith("/") || next.startsWith("//")) redirect("/");\nredirect(next);',
      badExample: 'const next = searchParams.get("next");\nreturn redirect(next ?? "/"); // ❌ open redirect if next is http://evil.com',
      relatedPlaybooks: ['redirect-safety.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_unvalidated_redirect', config.severityRules);
      const findings: Finding[] = [];
      const REDIRECT_USER = /(?:redirect|res\.redirect|router\.push|router\.replace)\s*\(\s*(?:searchParams\.get|req\.query|params\.|query\.)/;
      const SAFE_CHECK = /startsWith\(['"`]\/|\.startsWith\(['"`]\//;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (REDIRECT_USER.test(lines[i]) && !SAFE_CHECK.test(content)) {
            findings.push({
              severity: sev, category: 'vibe_unvalidated_redirect', file: path, line: i + 1,
              message: 'Redirect destination sourced from user input — open redirect risk.',
              suggestion: 'Validate the destination starts with "/" and does not start with "//" before redirecting.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_012',
    category: 'vibe_insecure_cookie',
    description: 'AI-generated cookie-setting code omits httpOnly/secure/sameSite attributes — enabling session theft.',
    severity: 'HIGH',
    tags: ['security', 'cookies', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools set cookies with `cookies().set(name, value)` and stop there. Without httpOnly (blocks JS access), Secure (HTTPS-only), and SameSite=Strict/Lax, session cookies are stolen by XSS and CSRF attacks.',
      commonViolations: [
        'cookies().set("session", token)',
        'res.cookie("auth", token) — missing options',
        'document.cookie = `session=${token}` — JS-accessible session',
      ],
      goodExample: 'cookies().set("session", token, { httpOnly: true, secure: true, sameSite: "strict", path: "/" })',
      badExample: 'cookies().set("session", token); // ❌ missing httpOnly, secure, sameSite',
      relatedPlaybooks: ['cookie-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_insecure_cookie', config.severityRules);
      const findings: Finding[] = [];
      // cookies().set(name, value) with no options object
      const BARE_COOKIE = /(?:cookies\(\)|res)\.set\s*\(\s*['"`][^'"`,]+['"`]\s*,\s*[^,)]+\s*\)/;
      const HAS_OPTIONS = /httpOnly|sameSite|secure\s*:/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (BARE_COOKIE.test(lines[i]) && !HAS_OPTIONS.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_insecure_cookie', file: path, line: i + 1,
              message: 'Cookie set without httpOnly, Secure, or SameSite attributes.',
              suggestion: 'Add `{ httpOnly: true, secure: true, sameSite: "strict" }` to all session cookie writes.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_013',
    category: 'vibe_weak_random',
    description: 'AI tools use Math.random() for tokens, passwords, and session IDs — it is not cryptographically secure.',
    severity: 'HIGH',
    tags: ['security', 'randomness', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Math.random() uses a deterministic PRNG with a short period that is predictable with enough samples. Any security-sensitive value (tokens, OTPs, session IDs, nonces) generated with Math.random() can be predicted by an attacker who observes prior outputs.',
      commonViolations: [
        'const token = Math.random().toString(36).slice(2)',
        'const otp = Math.floor(Math.random() * 1000000)',
        'const id = `sess_${Date.now()}_${Math.random()}`',
      ],
      goodExample: 'import { randomBytes, randomInt } from "node:crypto";\nconst token = randomBytes(32).toString("hex");\nconst otp = randomInt(100000, 999999);',
      badExample: 'const resetToken = Math.random().toString(36).slice(2); // ❌ predictable',
      relatedPlaybooks: ['cryptography.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_weak_random', config.severityRules);
      const findings: Finding[] = [];
      const WEAK_RAND = /Math\.random\(\)/;
      const SECURITY_CONTEXT = /token|secret|session|otp|nonce|key|password|id|hash/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (WEAK_RAND.test(lines[i]) && SECURITY_CONTEXT.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_weak_random', file: path, line: i + 1,
              message: 'Math.random() used in a security context — not cryptographically secure.',
              suggestion: 'Use `crypto.randomBytes()` or `crypto.randomInt()` from Node.js built-ins.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_014',
    category: 'vibe_error_stack_leak',
    description: 'AI-generated error handlers return raw Error objects or stack traces to the client — leaking internal structure.',
    severity: 'MEDIUM',
    tags: ['security', 'information-disclosure', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate `return NextResponse.json({ error: err.message, stack: err.stack })` to "help with debugging." In production, stack traces expose file paths, function names, and internal API shapes that attackers use to fingerprint the stack and craft targeted exploits.',
      commonViolations: [
        'res.json({ error: err.message, stack: err.stack })',
        'return NextResponse.json(err)',
        'catch (e) { res.status(500).json(e) }',
      ],
      goodExample: 'catch (err) {\n  logger.error("Request failed", { err, requestId });\n  return NextResponse.json({ error: "Internal server error" }, { status: 500 });\n}',
      badExample: 'catch (err) {\n  return res.json({ error: err.message, stack: err.stack }); // ❌ leaks internals\n}',
      relatedPlaybooks: ['error-handling.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['error-handler-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_error_stack_leak', config.severityRules);
      const findings: Finding[] = [];
      const STACK_LEAK = /(?:err|error|e)\s*(?:\?\.)?(?:stack|message)\s*(?:,|:|}|to[Ss]tring)/;
      const IN_JSON = /(?:json|send|write)\s*\(\s*\{[^}]*(?:stack|message)/;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (IN_JSON.test(lines[i]) && STACK_LEAK.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_error_stack_leak', file: path, line: i + 1,
              message: 'Error stack or message sent directly to client — leaks internal structure.',
              suggestion: 'Log the full error server-side and return a generic "Internal server error" message to the client.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_015',
    category: 'vibe_no_request_timeout',
    description: 'AI-generated server-side fetch and DB calls have no timeout — enabling resource exhaustion via slow or hanging requests.',
    severity: 'MEDIUM',
    tags: ['reliability', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate `await fetch(url)` and `await db.query()` with no timeout. A slow or hanging upstream service will hold the event loop, exhaust connection pools, and take down the server. This is a trivial DoS vector.',
      commonViolations: [
        'await fetch(externalApi) — no timeout',
        'await prisma.user.findMany({ where: ... }) — no query timeout',
        'Long-running await in a hot API path with no abort controller',
      ],
      goodExample: 'const controller = new AbortController();\nconst timeout = setTimeout(() => controller.abort(), 5000);\ntry {\n  const res = await fetch(url, { signal: controller.signal });\n} finally { clearTimeout(timeout); }',
      badExample: 'const data = await fetch(slowExternalApi).then(r => r.json()); // ❌ no timeout',
      relatedPlaybooks: ['reliability.md'],
      relatedAgents: ['architecture-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_no_request_timeout', config.severityRules);
      const findings: Finding[] = [];
      const EXTERNAL_FETCH = /await\s+fetch\s*\(\s*(?:process\[|process\.env\b|[a-zA-Z_$][a-zA-Z0-9_$]*(?:Url|URL|Endpoint|endpoint|api|Api|API)[^)]*)\)/;
      const HAS_SIGNAL = /signal\s*:/;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (EXTERNAL_FETCH.test(lines[i]) && !HAS_SIGNAL.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_no_request_timeout', file: path, line: i + 1,
              message: 'External fetch with no timeout — slow upstream will hang this request.',
              suggestion: 'Use AbortController with a timeout, or pass `signal: AbortSignal.timeout(5000)`.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_016',
    category: 'vibe_prototype_pollution',
    description: 'AI tools generate Object.assign(target, userInput) and spread patterns that enable prototype pollution.',
    severity: 'HIGH',
    tags: ['security', 'prototype-pollution', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Prototype pollution occurs when attacker-controlled keys like `__proto__`, `constructor`, or `prototype` are merged into objects. AI tools frequently generate deep merge patterns with user input that are vulnerable to this attack.',
      commonViolations: [
        'Object.assign(config, userInput)',
        'merge(defaults, req.body)',
        '{ ...existingConfig, ...userProvidedOptions }',
      ],
      goodExample: 'const safeInput = Object.fromEntries(\n  Object.entries(userInput).filter(([k]) => !["__proto__","constructor","prototype"].includes(k))\n);\nconst config = { ...defaults, ...safeInput };',
      badExample: 'const config = Object.assign({}, defaults, req.body); // ❌ __proto__ injection possible',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_prototype_pollution', config.severityRules);
      const findings: Finding[] = [];
      const ASSIGN_USER = /Object\.assign\s*\([^)]*(?:req\.|body\.|input\.|params\.|query\.)/;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (ASSIGN_USER.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_prototype_pollution', file: path, line: i + 1,
              message: 'Object.assign() merging user-controlled input — prototype pollution risk.',
              suggestion: 'Filter out __proto__, constructor, and prototype keys before merging user input.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_017',
    category: 'vibe_xss_inner_html',
    description: 'dangerouslySetInnerHTML with user-controlled content — the React XSS vector AI tools consistently generate.',
    severity: 'BLOCKER',
    tags: ['security', 'xss', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate `dangerouslySetInnerHTML={{ __html: userContent }}` when asked to render rich text. Unless content is sanitized with DOMPurify before rendering, any user-controlled string can execute arbitrary JavaScript in the browser.',
      commonViolations: [
        '<div dangerouslySetInnerHTML={{ __html: content }} />',
        '<p dangerouslySetInnerHTML={{ __html: post.body }} />',
        'dangerouslySetInnerHTML={{ __html: t("html_key") }}',
      ],
      goodExample: 'import DOMPurify from "dompurify";\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />',
      badExample: '<div dangerouslySetInnerHTML={{ __html: userPost.content }} /> // ❌ XSS',
      relatedPlaybooks: ['xss-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_xss_inner_html', config.severityRules);
      const findings: Finding[] = [];
      const JSX_HTML = /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:/;
      const IS_SANITIZED = /DOMPurify|sanitize|purify/i;
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx?|jsx?)$/.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (JSX_HTML.test(lines[i]) && !IS_SANITIZED.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_xss_inner_html', file: path, line: i + 1,
              message: 'dangerouslySetInnerHTML without DOMPurify sanitization — potential XSS.',
              suggestion: 'Wrap the content with `DOMPurify.sanitize()` before passing to __html.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_018',
    category: 'vibe_missing_auth_middleware',
    description: 'AI-generated Next.js apps frequently have no middleware.ts — meaning protected routes are accessible without a session.',
    severity: 'HIGH',
    tags: ['security', 'auth', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI assistants generate individual page components and API routes but consistently omit the authentication middleware layer. Without middleware.ts, adding auth to each route is manual and error-prone — routes are private by opt-in rather than public by exception.',
      commonViolations: [
        'Next.js app with /dashboard route but no middleware.ts',
        'Protected pages that check auth in useEffect (client-side only)',
        'Relying on layout.tsx auth check that can be bypassed',
      ],
      goodExample: '// middleware.ts at repo root\nexport { auth as middleware } from "@/lib/auth";\nexport const config = { matcher: ["/((?!_next|api/auth|login).*)"] }',
      badExample: '// No middleware.ts — every route is public unless individually protected',
      relatedPlaybooks: ['nextjs-auth.md'],
      relatedAgents: ['auth-reviewer'],
      relatedSkills: ['auth-check-helper'],
    },
    detect({ scan, config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_missing_auth_middleware', config.severityRules);
      if (scan.detector?.framework !== 'next') return [];
      const hasMiddleware = scan.riskyFiles.some((f) => /middleware\.(ts|js)$/.test(f)) ||
        scan.scriptFiles.some((f) => /middleware\.(ts|js)$/.test(f));
      const hasProtectedRoutes = scan.pages.some((p) =>
        /\/(dashboard|admin|account|profile|settings|app)/.test(p.path)
      );
      if (hasProtectedRoutes && !hasMiddleware) {
        return [{
          severity: sev, category: 'vibe_missing_auth_middleware',
          file: 'middleware.ts',
          message: 'Next.js app has protected-looking routes but no middleware.ts authentication layer.',
          suggestion: 'Create middleware.ts at the project root to protect routes by default, making public routes explicit exceptions.',
        }];
      }
      return [];
    },
  },

  {
    id: 'VIBE_019',
    category: 'vibe_timing_attack',
    description: 'String equality comparison for tokens/passwords is vulnerable to timing attacks — use crypto.timingSafeEqual().',
    severity: 'HIGH',
    tags: ['security', 'timing-attack', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'JavaScript string comparison (`===`) short-circuits on the first differing character, leaking timing information that attackers use to enumerate valid token characters. AI tools consistently generate token validation with `===`.',
      commonViolations: [
        'if (token === storedToken)',
        'if (req.headers["x-webhook-secret"] === SECRET)',
        'if (providedKey === apiKey)',
      ],
      goodExample: 'import { timingSafeEqual, createHash } from "node:crypto";\nconst a = Buffer.from(providedToken);\nconst b = Buffer.from(storedToken);\nif (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid");',
      badExample: 'if (token === WEBHOOK_SECRET) { // ❌ timing attack',
      relatedPlaybooks: ['token-validation.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_timing_attack', config.severityRules);
      const findings: Finding[] = [];
      const TIMING_RE = /(?:token|secret|key|hash|signature|hmac|webhook)\s*===?\s*|===?\s*(?:token|secret|key|hash|signature|hmac|webhook)/i;
      const SAFE_CHECK = /timingSafeEqual|constantTimeCompare|safeCompare/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path) || isTestPath(path)) continue;
        if (SAFE_CHECK.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (TIMING_RE.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_timing_attack', file: path, line: i + 1,
              message: 'Secret/token compared with === — vulnerable to timing attacks.',
              suggestion: 'Use `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` for constant-time comparison.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_020',
    category: 'vibe_missing_output_encoding',
    description: 'AI-generated code concatenating user data into HTML strings without encoding enables server-side XSS.',
    severity: 'BLOCKER',
    tags: ['security', 'xss', 'output-encoding', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'When AI generates email templates, PDF renderers, or HTML string builders, it concatenates user data directly. This is classic stored XSS when the output is rendered in a browser.',
      commonViolations: [
        '`<p>Hello ${user.name}</p>` in an HTML email template function',
        'html += `<td>${rowData}</td>`',
        'res.send(`<h1>Welcome ${req.query.name}</h1>`)',
      ],
      goodExample: 'function esc(str: string) { return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }\nhtml += `<td>${esc(rowData)}</td>`;',
      badExample: 'return `<html><body>Hello ${user.name}</body></html>`; // ❌ XSS if name contains <script>',
      relatedPlaybooks: ['xss-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_missing_output_encoding', config.severityRules);
      const findings: Finding[] = [];
      // Template literals containing HTML tags + variable interpolation
      const HTML_INTERP = /`[^`]*<(?:p|div|span|td|th|h[1-6]|li|a)[^>]*>[^`]*\$\{(?!esc\(|escape\(|encodeHTML\(|sanitize\()/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        if (!/\.(ts|tsx|js|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (HTML_INTERP.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_missing_output_encoding', file: path, line: i + 1,
              message: 'User data interpolated into HTML string without encoding — potential XSS.',
              suggestion: 'Escape all user-controlled values with an HTML encoding function before interpolating into HTML strings.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_021',
    category: 'vibe_ai_endpoint_no_auth',
    description: 'AI inference endpoints generated by AI tools almost never have authentication — your LLM costs are exposed to the internet.',
    severity: 'BLOCKER',
    tags: ['security', 'ai', 'auth', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI-powered features (chat, generation, summarization) are expensive per-call. AI tools generate these endpoints without auth because they optimize for "it works." An unauthenticated AI endpoint is a free LLM proxy for anyone who finds it — your OpenAI/Anthropic bill becomes the attack surface.',
      commonViolations: [
        '/api/chat route calling OpenAI with no session check',
        '/api/generate calling Anthropic with no API key validation',
        'POST /api/summarize with no auth middleware',
      ],
      goodExample: 'export async function POST(req: Request) {\n  const session = await getSession();\n  if (!session) return new Response("Unauthorized", { status: 401 });\n  // call LLM\n}',
      badExample: 'export async function POST(req: Request) {\n  const { message } = await req.json();\n  const completion = await openai.chat.completions.create({...}); // ❌ no auth\n}',
      relatedPlaybooks: ['ai-endpoint-security.md'],
      relatedAgents: ['security-reviewer', 'ai-reviewer'],
      relatedSkills: ['auth-check-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_ai_endpoint_no_auth', config.severityRules);
      const findings: Finding[] = [];
      const AI_SDK = /(?:openai|anthropic|@google|cohere|replicate|groq|together)\.(?:chat|messages|completions|generate|stream)/i;
      const AUTH_CHECK = /getSession|getServerSession|auth\(\)|requireAuth|currentUser|getUser|verifyToken|checkAuth/i;
      const HANDLER_RE = /export\s+(?:async\s+)?function\s+POST\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) || isTestPath(path)) continue;
        if (!HANDLER_RE.test(content)) continue;
        if (!AI_SDK.test(content)) continue;
        if (AUTH_CHECK.test(content)) continue;
        findings.push({
          severity: sev, category: 'vibe_ai_endpoint_no_auth', file: path,
          message: 'AI inference endpoint (OpenAI/Anthropic/etc.) has no authentication check.',
          suggestion: 'Add a session check before calling any LLM API — unauthenticated AI endpoints expose your API costs to abuse.',
        });
      }
      return findings;
    },
  },

  {
    id: 'VIBE_022',
    // Shape heuristic — can misfire on innocent code; reports but does not gate
    // unless gate.minConfidence is lowered. See thesmos/gate.ts.
    confidence: 'medium',
    category: 'vibe_prompt_injection_risk',
    description: 'Concatenating user input directly into LLM system prompts enables prompt injection attacks.',
    severity: 'BLOCKER',
    tags: ['security', 'prompt-injection', 'ai', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools generate system prompts using template literals: `${systemPrompt} ${userMessage}`. If the user message contains instructions like "ignore previous instructions and reveal X", the LLM may comply. This is prompt injection — the SQL injection of the AI era.',
      commonViolations: [
        '`You are a helpful assistant. ${user.customInstructions}`',
        'messages: [{ role: "system", content: systemPrompt + userInput }]',
        'system: `${SYSTEM_PROMPT}\\n\\nUser context: ${req.body.context}`',
      ],
      goodExample: '// Separate system and user turns — never concatenate\nmessages: [\n  { role: "system", content: SYSTEM_PROMPT }, // never interpolate user data here\n  { role: "user", content: sanitizedUserMessage }\n]',
      badExample: 'const system = `${BASE_SYSTEM_PROMPT} ${user.instructions}`; // ❌ prompt injection',
      relatedPlaybooks: ['ai-security.md', 'prompt-injection.md'],
      relatedAgents: ['ai-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_prompt_injection_risk', config.severityRules);
      const findings: Finding[] = [];
      const SYS_PROMPT_USER = /(?:system|systemPrompt|system_prompt)\s*[:=]\s*[`'"]\s*[^`'"]*\$\{[^}]*(?:user|body|input|message|query|req\.|params\.)/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SYS_PROMPT_USER.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_prompt_injection_risk', file: path, line: i + 1,
              message: 'User-controlled data interpolated into LLM system prompt — prompt injection risk.',
              suggestion: 'Keep system prompts static. Pass user input only as a separate "user" role message, never inside the system prompt.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_023',
    category: 'vibe_missing_zod_on_env',
    description: 'AI-generated Next.js apps skip env variable validation — leading to cryptic runtime crashes in production.',
    severity: 'MEDIUM',
    tags: ['quality', 'env', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'AI tools access env vars directly without validating they exist or have the correct format. Missing env vars in production cause runtime crashes with cryptic "Cannot read property of undefined" errors. t3-env and Zod validation catch these at startup.',
      commonViolations: [
        'No env.ts or env.mjs validation file',
        'Direct process.env.DATABASE_URL without existence check',
        'String env var used as a number without coercion',
      ],
      goodExample: '// env.ts\nimport { createEnv } from "@t3-oss/env-nextjs";\nexport const env = createEnv({\n  server: { DATABASE_URL: z.string().url() },\n  client: { NEXT_PUBLIC_APP_URL: z.string().url() },\n});',
      badExample: '// Direct access throughout the codebase — crashes if var is missing\nconst db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });',
      relatedPlaybooks: ['env-validation.md'],
      relatedAgents: [],
      relatedSkills: ['env-var-helper'],
    },
    detect({ scan, changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_missing_zod_on_env', config.severityRules);
      if (scan.detector?.framework !== 'next') return [];
      const hasEnvValidation = changedFiles.some((f) =>
        /env\.(ts|mjs|js)$/.test(f.path) && /createEnv|z\.object|z\.string/.test(f.content)
      );
      if (hasEnvValidation) return [];
      const DIRECT_ENV = /process\.env\.[A-Z_]{4,}/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (isTestPath(path) || /env\.(ts|mjs|js)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (DIRECT_ENV.test(lines[i])) {
            findings.push({
              severity: sev, category: 'vibe_missing_zod_on_env', file: path, line: i + 1,
              message: 'Direct process.env access with no env validation schema (t3-env, Zod).',
              suggestion: 'Create an env.ts file with Zod validation so missing env vars fail at startup with a clear error.',
            });
            break; // one finding per file is enough
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_024',
    category: 'vibe_insecure_direct_object',
    description: 'AI-generated CRUD routes use user-supplied IDs without verifying the caller owns the resource — classic IDOR.',
    severity: 'BLOCKER',
    tags: ['security', 'idor', 'authorization', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'Insecure Direct Object Reference (IDOR) is the #1 API vulnerability. AI tools generate `findById(params.id)` without checking that the authenticated user owns that resource. Any user can access or modify any other user\'s data by guessing an ID.',
      commonViolations: [
        'db.query("SELECT * FROM orders WHERE id = ?", [params.id]) — no ownership check',
        'await prisma.post.update({ where: { id: postId }, data: ... }) — no userId check',
        'DELETE /api/items/:id — deletes by ID without session.userId === item.userId',
      ],
      goodExample: 'const item = await db.items.findFirst({\n  where: { id: params.id, userId: session.user.id } // ← ownership enforced in query\n});\nif (!item) return notFound();',
      badExample: 'const item = await db.items.findById(params.id); // ❌ IDOR — anyone can access any item',
      relatedPlaybooks: ['authorization.md', 'idor-prevention.md'],
      relatedAgents: ['security-reviewer', 'auth-reviewer'],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_insecure_direct_object', config.severityRules);
      const findings: Finding[] = [];
      // findById / findUnique with an ID from params but no userId filter
      const FIND_BY_ID = /\.(findById|findByPk|findUnique|findFirst)\s*\(\s*(?:params\.|req\.params|id\s*:|where:\s*\{\s*id)/i;
      const OWNERSHIP_CHECK = /userId|user_id|ownerId|owner_id|createdBy|created_by|session\.user/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (FIND_BY_ID.test(lines[i]) && !OWNERSHIP_CHECK.test(content)) {
            findings.push({
              severity: sev, category: 'vibe_insecure_direct_object', file: path, line: i + 1,
              message: 'Resource fetched by ID without ownership verification — potential IDOR.',
              suggestion: 'Add `userId: session.user.id` to the query filter to enforce resource ownership at the database level.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_025',
    category: 'vibe_llm_response_unvalidated',
    description: 'AI-generated code trusts LLM JSON responses without schema validation — causing runtime crashes when the model hallucinates the shape.',
    severity: 'HIGH',
    tags: ['reliability', 'ai', 'validation', 'vibe-coding', 'ai-risk'],
    sinceVersion: '1.1.0',
    explain: {
      why: 'LLMs hallucinate. They return JSON that looks right but has missing fields, wrong types, or extra keys. AI tools generate `JSON.parse(llmResponse)` and immediately destructure it without validation. When the model changes behavior, production crashes.',
      commonViolations: [
        'const { title, summary } = JSON.parse(completion.choices[0].message.content)',
        'const data = JSON.parse(response.text) as ExpectedType',
        'Trusting LLM output type assertions without runtime validation',
      ],
      goodExample: 'const raw = JSON.parse(completion.choices[0].message.content ?? "{}");\nconst validated = ResponseSchema.parse(raw); // throws if shape is wrong',
      badExample: 'const { title, tags } = JSON.parse(llmOutput) as GeneratedContent; // ❌ crashes if LLM changes format',
      relatedPlaybooks: ['ai-reliability.md'],
      relatedAgents: ['ai-reviewer'],
      relatedSkills: ['zod-schema-helper'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_llm_response_unvalidated', config.severityRules);
      const findings: Finding[] = [];
      const LLM_PARSE = /JSON\.parse\s*\(\s*(?:completion|response|result|output|llm|message|content)\b/i;
      const VALIDATED = /\.parse\(|\.safeParse\(|Schema\.parse|parseWith/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (LLM_PARSE.test(lines[i]) && !VALIDATED.test(content)) {
            findings.push({
              severity: sev, category: 'vibe_llm_response_unvalidated', file: path, line: i + 1,
              message: 'LLM JSON response parsed without schema validation — will crash if model changes its output shape.',
              suggestion: 'Define a Zod schema for the expected LLM output and call `.parse()` before using the data.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_026',
    category: 'vibe_rate_limiter_not_applied',
    description: 'Rate limiter imported or created but not applied to any route handler — AI generates middleware it never wires up.',
    severity: 'BLOCKER',
    tags: ['security', 'rate-limiting', 'vibe-coding', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'This is the most common production security gap in AI-generated code. The AI creates a rate limiter (Upstash, express-rate-limit, etc.) in the file but never calls it inside a handler. The limiter exists but protects nothing.',
      commonViolations: [
        'const limiter = rateLimit({ windowMs: 15*60*1000, max: 100 });  // defined but never used in handler',
        'import { ratelimit } from "@/lib/redis"; — imported but app.use(limiter) never called',
      ],
      goodExample: 'const limiter = rateLimit({ windowMs: 15*60*1000, max: 100 });\nexport const POST = [limiter, async (req, res) => { ... }];',
      badExample: 'const limiter = rateLimit({ max: 100 });\n\nexport async function POST(req) { ... }  // ❌ limiter never applied',
      relatedPlaybooks: ['rate-limiting.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_rate_limiter_not_applied', config.severityRules);
      const findings: Finding[] = [];
      const LIMITER_INIT_RE = /(?:const|let|var)\s+(?:limiter|rateLimit|rateLimiter|throttler)\s*=\s*(?:rateLimit|Ratelimit|createRateLimiter|new\s+RateLimiter)/i;
      const LIMITER_USED_RE = /app\.use\s*\(\s*(?:limiter|rateLimiter)|limiter\s*\(|rateLimiter\s*\(|await\s+(?:limiter|rateLimiter|rateLimit)\.|\.check\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) && !isServerFile(path)) continue;
        if (isTestPath(path)) continue;
        if (!LIMITER_INIT_RE.test(content)) continue;
        if (!LIMITER_USED_RE.test(content)) {
          findings.push({
            severity: sev, category: 'vibe_rate_limiter_not_applied', file: path,
            message: 'Rate limiter created but never applied to a route handler — endpoints are unprotected.',
            suggestion: 'Apply the limiter: await rateLimiter.check(identifier); or add as middleware before the handler.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_027',
    category: 'vibe_payment_route_no_rate_limit',
    description: 'Payment or subscription API route has no rate limiting — financial abuse via rapid repeated requests.',
    severity: 'BLOCKER',
    tags: ['security', 'rate-limiting', 'payments', 'vibe-coding', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Payment endpoints without rate limiting allow card testing attacks (automated card validation) that cost merchants 20-30 basis points per authorization attempt. Attackers probe thousands of cards per minute against unprotected Stripe/Braintree endpoints.',
      commonViolations: [
        'POST /api/checkout with no rate limiter',
        'POST /api/subscription without per-user or per-IP throttling',
      ],
      goodExample: 'await rateLimiter.check(session.userId, { max: 5, window: "1h" });\nawait stripe.paymentIntents.create({ amount, currency });',
      badExample: 'export async function POST(req) { await stripe.paymentIntents.create(...); }  // ❌ no rate limit',
      relatedPlaybooks: ['rate-limiting.md', 'payment-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_payment_route_no_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      const PAYMENT_RE = /stripe|braintree|paypal|checkout|subscription|paymentIntent|createPayment/i;
      const RATE_RE = /rateLimit|rateLimiter|throttle|limiter\.|\.check\s*\(|upstash/i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path)) continue;
        if (isTestPath(path)) continue;
        if (!PAYMENT_RE.test(content)) continue;
        if (!RATE_RE.test(content)) {
          findings.push({
            severity: sev, category: 'vibe_payment_route_no_rate_limit', file: path,
            message: 'Payment route without rate limiting — vulnerable to card testing attacks.',
            suggestion: 'Add strict per-user rate limiting: max 5 attempts per hour per user ID.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_028',
    category: 'vibe_global_rate_limit_only',
    description: 'Rate limit applied globally (all users share one counter) — one user can DoS others by exhausting the shared limit.',
    severity: 'HIGH',
    tags: ['security', 'rate-limiting', 'vibe-coding', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'A global rate limit (e.g., 1000 requests/minute across all users) means a single high-traffic user or attacker can exhaust the limit and block all other users. Rate limits must be per-user or per-IP.',
      commonViolations: [
        'rateLimit({ windowMs: 60000, max: 1000 })  // no keyGenerator — global counter',
        'Upstash ratelimit with a static key instead of session.userId',
      ],
      goodExample: 'await ratelimit.limit(session.userId ?? req.ip);  // per-user key',
      badExample: 'await ratelimit.limit("global");  // ❌ shared counter',
      relatedPlaybooks: ['rate-limiting.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_global_rate_limit_only', config.severityRules);
      const findings: Finding[] = [];
      const GLOBAL_KEY_RE = /(?:ratelimit|limiter)\s*\.\s*limit\s*\(\s*['"`](?:global|api|app|default|shared)['"`]\s*\)/i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) && !isServerFile(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (GLOBAL_KEY_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'vibe_global_rate_limit_only', file: path, line: i + 1,
              message: 'Rate limit using a global/static key — one user can exhaust the limit for everyone.',
              suggestion: 'Use per-user or per-IP key: ratelimit.limit(session.userId ?? req.ip)',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_029',
    category: 'vibe_file_upload_no_limit',
    description: 'File upload endpoint has no size or frequency rate limit — storage exhaustion and DoS.',
    severity: 'HIGH',
    tags: ['security', 'rate-limiting', 'file-upload', 'vibe-coding', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'File upload routes without size limits and frequency throttling can be abused to exhaust storage (S3, disk, database) and cause service degradation. AI tools generate the happy-path upload without any of these guards.',
      commonViolations: [
        'await supabase.storage.from("uploads").upload(file) — no file size check',
        'formData multipart handler with no maxFileSize config',
      ],
      goodExample: 'if (file.size > MAX_FILE_SIZE_BYTES) return badRequest("File too large");\nawait rateLimiter.check(userId, { max: 10, window: "1h" });\nawait storage.upload(file);',
      badExample: 'const { file } = await parseMultipart(req);\nawait s3.putObject({ Key: file.name, Body: file.buffer });  // ❌ no size or rate check',
      relatedPlaybooks: ['rate-limiting.md', 'file-upload-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_file_upload_no_limit', config.severityRules);
      const findings: Finding[] = [];
      const UPLOAD_RE = /\.upload\s*\(|putObject|writeFile|saveFile|multipart|formData\.(?:get|getAll)/i;
      const LIMIT_RE = /maxFileSize|MAX_FILE_SIZE|file\.size|rateLimit|rateLimiter|limiter\./i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) && !isServerFile(path)) continue;
        if (isTestPath(path)) continue;
        if (!UPLOAD_RE.test(content)) continue;
        if (!LIMIT_RE.test(content)) {
          findings.push({
            severity: sev, category: 'vibe_file_upload_no_limit', file: path,
            message: 'File upload handler without size limit or rate limiting — storage exhaustion risk.',
            suggestion: 'Add file size check and per-user upload frequency limit before storing.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_030',
    category: 'vibe_llm_route_no_rate_limit',
    description: 'LLM/AI API call route has no rate limiting — financial exposure from unbounded model usage.',
    severity: 'HIGH',
    tags: ['security', 'rate-limiting', 'ai', 'cost', 'vibe-coding', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Each LLM API call costs real money. A route that proxies to OpenAI, Anthropic, or Gemini without rate limiting can be abused to exhaust your monthly budget in hours. Vibe-coded AI chat apps almost never include rate limiting on the LLM endpoint.',
      commonViolations: [
        'POST /api/chat that calls openai.chat.completions.create() with no rate limit',
        'POST /api/generate with Anthropic SDK and no per-user throttle',
      ],
      goodExample: 'await rateLimiter.check(userId, { max: 20, window: "1h" });\nconst response = await openai.chat.completions.create({ model, messages });',
      badExample: 'export async function POST(req) { const res = await openai.chat.completions.create(...); }  // ❌ no rate limit',
      relatedPlaybooks: ['rate-limiting.md', 'ai-cost-controls.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_llm_route_no_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      const LLM_CALL_RE = /openai\.|anthropic\.|genai\.|gemini\.|claude\.|completions\.create|messages\.create|generateContent/i;
      const RATE_RE = /rateLimit|rateLimiter|limiter\.|throttle|upstash|\.check\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) && !isServerFile(path)) continue;
        if (isTestPath(path)) continue;
        if (!LLM_CALL_RE.test(content)) continue;
        if (!RATE_RE.test(content)) {
          findings.push({
            severity: sev, category: 'vibe_llm_route_no_rate_limit', file: path,
            message: 'LLM API call route without rate limiting — financial exposure from unbounded model usage.',
            suggestion: 'Add per-user rate limiting before LLM calls: max 20 requests per hour per user.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_031',
    category: 'vibe_rate_limit_wrong_status',
    description: 'Rate limiter returns 200 OK or 403 Forbidden instead of RFC 6585 429 Too Many Requests.',
    severity: 'MEDIUM',
    tags: ['security', 'rate-limiting', 'vibe-coding'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'RFC 6585 requires HTTP 429 for rate limit responses. Returning 200 (silently failing) or 403 (wrong semantic) makes rate limiting invisible to callers, breaks retry-after header conventions, and confuses monitoring systems.',
      commonViolations: [
        'return res.status(200).json({ error: "Rate limit exceeded" })  // wrong status',
        'return res.status(403).json({ error: "Too many requests" })  // wrong status',
      ],
      goodExample: 'return new Response("Too many requests", { status: 429, headers: { "Retry-After": "60" } });',
      badExample: 'return res.status(200).json({ error: "Rate limit exceeded" });  // ❌ 200 is not an error',
      relatedPlaybooks: ['rate-limiting.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_rate_limit_wrong_status', config.severityRules);
      const findings: Finding[] = [];
      const RATE_LIMIT_RESPONSE_RE = /(?:rate.?limit|too.?many.?request|limit.?exceed)/i;
      const WRONG_STATUS_RE = /status\s*\(\s*(?:200|403)\s*\)/i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) && !isServerFile(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (RATE_LIMIT_RESPONSE_RE.test(lines[i]!) && WRONG_STATUS_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'vibe_rate_limit_wrong_status', file: path, line: i + 1,
              message: 'Rate limit response using wrong HTTP status code — should be 429.',
              suggestion: 'Return HTTP 429 with Retry-After header: new Response("", { status: 429, headers: { "Retry-After": "60" } })',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_032',
    category: 'vibe_sms_no_rate_limit',
    description: 'OTP send or password reset endpoint has no rate limiting — SMS pumping and reset enumeration.',
    severity: 'HIGH',
    tags: ['security', 'rate-limiting', 'auth', 'vibe-coding', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'SMS OTP endpoints without rate limiting are targets for SMS pumping fraud (attackers trigger thousands of SMS sends, billing the service) and OTP brute-force (iterating 6-digit codes at high speed). Both attacks have caused significant financial and security damage.',
      commonViolations: [
        'POST /api/auth/send-otp with no rate limit — SMS pumping risk',
        'POST /api/auth/reset-password with no attempt counter',
      ],
      goodExample: 'await rateLimiter.check(req.ip, { max: 3, window: "15m" });\nawait sms.send({ to: phone, body: `Your code: ${otp}` });',
      badExample: 'await sms.send({ to: req.body.phone, body: `Your OTP: ${otp}` });  // ❌ no rate limit',
      relatedPlaybooks: ['rate-limiting.md', 'auth-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_sms_no_rate_limit', config.severityRules);
      const findings: Finding[] = [];
      const SMS_OTP_RE = /(?:sms\.send|twilio|vonage|nexmo|sendOTP|sendSMS|verifyCode|resetPassword)\s*\(/i;
      const RATE_RE = /rateLimit|rateLimiter|limiter\.|throttle|upstash|\.check\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!isApiRoute(path) && !isServerFile(path)) continue;
        if (isTestPath(path)) continue;
        if (!SMS_OTP_RE.test(content)) continue;
        if (!RATE_RE.test(content)) {
          findings.push({
            severity: sev, category: 'vibe_sms_no_rate_limit', file: path,
            message: 'SMS/OTP send endpoint without rate limiting — SMS pumping fraud and OTP brute-force risk.',
            suggestion: 'Limit by IP and phone number: max 3 OTP sends per 15 minutes.',
          });
        }
      }
      return findings;
    },
  },

  {
    id: 'VIBE_033',
    category: 'vibe_websocket_auth_missing',
    description: 'AI-generated code adds REST auth but skips WebSocket upgrade authentication — universal vibe-coding gap.',
    severity: 'BLOCKER',
    tags: ['security', 'websocket', 'auth', 'vibe-coding', 'ai-risk'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Every AI coding agent study confirms the same pattern: the assistant wires up JWT/session auth for REST routes but fails to add authentication on the WebSocket upgrade handler. This leaves a persistent, authenticated-looking connection that any unauthenticated client can open.',
      commonViolations: [
        'wss.on("connection", (ws) => { handleMessages(ws); })  // no auth on connection',
        'App has /api routes with auth + WebSocket server with no auth',
      ],
      goodExample: 'server.on("upgrade", async (req, socket, head) => {\n  const token = getTokenFromRequest(req);\n  const session = await verifyToken(token);\n  if (!session) { socket.destroy(); return; }\n  wss.handleUpgrade(req, socket, head, (ws) => { ws.session = session; wss.emit("connection", ws, req); });\n});',
      badExample: 'wss.on("connection", (ws) => { ws.on("message", handleMessage); });  // ❌ no auth',
      relatedPlaybooks: ['websocket-security.md', 'auth-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('vibe_websocket_auth_missing', config.severityRules);
      const findings: Finding[] = [];
      const WS_SERVER_RE = /new\s+(?:WebSocketServer|WebSocket\.Server)\s*\(/i;
      const AUTH_RE = /verifyToken|getSession|authenticate|bearer|session\s*\?|jwt\.verify|upgrade.*auth|auth.*upgrade/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path)) continue;
        if (isTestPath(path)) continue;
        if (!WS_SERVER_RE.test(content)) continue;
        if (!AUTH_RE.test(content)) {
          findings.push({
            severity: sev, category: 'vibe_websocket_auth_missing', file: path,
            message: 'WebSocket server without authentication on upgrade — unauthenticated connections accepted.',
            suggestion: 'Authenticate on the upgrade event: check token/session before calling wss.handleUpgrade().',
          });
        }
      }
      return findings;
    },
  },
];
