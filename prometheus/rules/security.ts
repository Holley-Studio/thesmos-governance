import type { PrometheusRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, SQL_EXT, isTestPath, isCommentLine, matchLines } from './helpers';

export const SECURITY_RULES: PrometheusRule[] = [
  {
    id: 'SEC_004',
    category: 'eval_usage',
    description: 'Never use eval() or new Function(string). Both execute arbitrary code and open remote code execution vulnerabilities.',
    severity: 'BLOCKER',
    tags: ['security', 'rce'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'eval() and new Function(string) execute arbitrary JavaScript at runtime. If user-controlled data reaches either call, an attacker can run any code in your process — reading env vars, filesystem contents, or establishing a reverse shell.',
      commonViolations: ['eval(userInput)', 'new Function("return " + code)()', 'eval(`${template}`)'],
      goodExample: '// Parse with JSON.parse, use a sandboxed eval library, or redesign to avoid dynamic execution.',
      badExample: 'const result = eval(req.body.expression); // RCE if body is user-controlled',
      relatedPlaybooks: ['security-rce.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['safe-eval-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('eval_usage', config.severityRules);
      const EVAL_RE = /\beval\s*\(|new\s+Function\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (EVAL_RE.test(line)) {
            findings.push({ severity, category: 'eval_usage', file: path, line: i + 1, message: 'eval() or new Function() detected — remote code execution risk.', suggestion: 'Use JSON.parse for data, or redesign to avoid dynamic code execution entirely.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_005',
    category: 'dangerous_inner_html',
    description: 'dangerouslySetInnerHTML with a variable value is an XSS vector. Sanitize with DOMPurify before use.',
    severity: 'HIGH',
    tags: ['security', 'xss', 'react'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'dangerouslySetInnerHTML injects HTML directly into the DOM, bypassing React\'s escaping. If the value contains attacker-controlled content — including LLM output — it executes arbitrary scripts in the user\'s browser.',
      commonViolations: ['dangerouslySetInnerHTML={{ __html: content }}', 'dangerouslySetInnerHTML={{ __html: post.body }}'],
      goodExample: "import DOMPurify from 'dompurify';\n<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }} />",
      badExample: '<div dangerouslySetInnerHTML={{ __html: userContent }} />  // XSS if userContent is attacker-controlled',
      relatedPlaybooks: ['xss-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['sanitize-html-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('dangerous_inner_html', config.severityRules);
      const DHTML_RE = /dangerouslySetInnerHTML\s*=\s*\{/;
      const SAFE_RE = /DOMPurify\.sanitize|sanitizeHtml|xss\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx?|jsx?)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (DHTML_RE.test(line) && !SAFE_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 2), i + 2).join('');
            if (!SAFE_RE.test(ctx)) {
              findings.push({ severity, category: 'dangerous_inner_html', file: path, line: i + 1, message: 'dangerouslySetInnerHTML used without visible sanitization.', suggestion: 'Wrap the value in DOMPurify.sanitize() before rendering.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_006',
    category: 'sql_injection',
    description: 'SQL queries built with template literals or string concatenation are vulnerable to injection. Use parameterized queries.',
    severity: 'BLOCKER',
    tags: ['security', 'sql', 'injection'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'String interpolation in SQL queries allows attackers to break out of the query context and execute arbitrary SQL — dumping tables, bypassing auth, or deleting data. Parameterized queries separate code from data at the protocol level.',
      commonViolations: ['db.query(`SELECT * FROM users WHERE id = ${userId}`)', 'connection.execute("SELECT * FROM orders WHERE user = " + req.body.userId)'],
      goodExample: "db.query('SELECT * FROM users WHERE id = $1', [userId]);",
      badExample: 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);  // injection',
      relatedPlaybooks: ['sql-injection.md'],
      relatedAgents: ['security-reviewer', 'database-reviewer'],
      relatedSkills: ['parameterized-query-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('sql_injection', config.severityRules);
      const SQL_TMPL_RE = /\b(?:query|execute|raw|sql|run|prepare)\s*\(\s*`[^`]*\$\{/i;
      const SQL_CONCAT_RE = /\b(?:query|execute|raw|sql|run)\s*\(\s*['"][^'"]*['"\s]*\+/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SQL_TMPL_RE.test(line) || SQL_CONCAT_RE.test(line)) {
            findings.push({ severity, category: 'sql_injection', file: path, line: i + 1, message: 'SQL query constructed with string interpolation — injection risk.', suggestion: 'Use parameterized queries: db.query("SELECT ... WHERE id = $1", [id])' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_007',
    category: 'innerHTML_assignment',
    description: 'Direct assignment to .innerHTML with a variable is an XSS vulnerability. Use textContent or sanitize first.',
    severity: 'HIGH',
    tags: ['security', 'xss', 'dom'],
    sinceVersion: '2.0.0',
    explain: {
      why: '.innerHTML = value executes any script tags or event handlers in value. Even content from your own API can carry XSS payloads if that API received untrusted data upstream.',
      commonViolations: ['el.innerHTML = response.html', 'document.getElementById("root").innerHTML = template'],
      goodExample: 'el.textContent = safeText;  // no script execution\n// Or: el.innerHTML = DOMPurify.sanitize(html);',
      badExample: 'container.innerHTML = apiResponse.body;  // XSS if body contains <script>',
      relatedPlaybooks: ['xss-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['sanitize-html-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('innerHTML_assignment', config.severityRules);
      const INNER_RE = /\.innerHTML\s*=\s*(?!['"`]\s*['"`]|''\s*;|""\s*;)/;
      const SAFE_RE = /DOMPurify|sanitize/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (INNER_RE.test(line) && !SAFE_RE.test(line)) {
            findings.push({ severity, category: 'innerHTML_assignment', file: path, line: i + 1, message: '.innerHTML assigned from a variable — XSS risk.', suggestion: 'Use .textContent for plain text, or sanitize HTML with DOMPurify before assignment.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_008',
    category: 'hardcoded_http_url',
    description: 'Hardcoded http:// (non-HTTPS) URLs in production code expose data to network interception.',
    severity: 'MEDIUM',
    tags: ['security', 'transport', 'tls'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'HTTP transmits data in plaintext, making it susceptible to man-in-the-middle attacks, credential theft, and content injection. Hardcoded HTTP URLs persist after HTTPS migration and are easy to miss in reviews.',
      commonViolations: ["const API = 'http://api.example.com'", "fetch('http://example.com/data')"],
      goodExample: "const API = 'https://api.example.com';",
      badExample: "const API_URL = 'http://api.production.com/v1'; // MITM risk",
      relatedPlaybooks: ['tls-requirements.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('hardcoded_http_url', config.severityRules);
      const HTTP_RE = /['"]http:\/\/(?!localhost|127\.|0\.0\.0\.0|::1)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (HTTP_RE.test(line)) {
            findings.push({ severity, category: 'hardcoded_http_url', file: path, line: i + 1, message: 'Hardcoded HTTP (non-HTTPS) URL detected.', suggestion: 'Use HTTPS for all production URLs, or read the URL from environment configuration.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_009',
    category: 'path_traversal',
    description: 'path.join / path.resolve with user-controlled input enables directory traversal attacks.',
    severity: 'BLOCKER',
    tags: ['security', 'path-traversal', 'filesystem'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'An attacker supplying "../../../etc/passwd" as a path segment can read arbitrary files from the filesystem. path.join does not sanitize traversal sequences.',
      commonViolations: ['path.join(__dirname, req.params.file)', 'fs.readFile(path.join(base, query.name))'],
      goodExample: "const safe = path.join(BASE_DIR, path.basename(req.params.file));  // basename strips directories\n// Also validate against an allowlist of expected filenames.",
      badExample: 'const filePath = path.join(__dirname, req.query.path);  // traversal risk',
      relatedPlaybooks: ['path-traversal.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['safe-path-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('path_traversal', config.severityRules);
      const PT_RE = /path\.(?:join|resolve)\s*\([^)]*(?:req\.\w+|params\.|query\.|body\.)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PT_RE.test(line)) {
            findings.push({ severity, category: 'path_traversal', file: path, line: i + 1, message: 'path.join/resolve with request input — directory traversal risk.', suggestion: 'Use path.basename() to strip directory components, then validate against an allowlist.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_010',
    category: 'cors_wildcard',
    description: 'CORS wildcard origin (*) allows any website to make credentialed cross-origin requests to your API.',
    severity: 'HIGH',
    tags: ['security', 'cors', 'api'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Access-Control-Allow-Origin: * combined with credentials: true violates the CORS spec and some browsers will allow it anyway. Even without credentials, wildcard CORS exposes your API to CSRF-style attacks from any origin.',
      commonViolations: ["cors({ origin: '*' })", "res.setHeader('Access-Control-Allow-Origin', '*')"],
      goodExample: "cors({ origin: ['https://app.example.com', 'https://admin.example.com'] })",
      badExample: "app.use(cors({ origin: '*' }));  // any site can call your API",
      relatedPlaybooks: ['cors-configuration.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_wildcard', config.severityRules);
      const CORS_RE = /(?:origin\s*:\s*['"]?\*['"]?|Access-Control-Allow-Origin['"],?\s*['"]?\*['"]?)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (CORS_RE.test(line)) {
            findings.push({ severity, category: 'cors_wildcard', file: path, line: i + 1, message: 'CORS wildcard origin (*) detected.', suggestion: 'Specify an explicit allowlist of trusted origins instead of *.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_011',
    category: 'math_random_crypto',
    description: 'Math.random() is not cryptographically secure. Never use it for tokens, passwords, session IDs, or security-sensitive values.',
    severity: 'HIGH',
    tags: ['security', 'crypto', 'randomness'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Math.random() produces predictable sequences that an attacker can reverse-engineer to predict past or future values. Node\'s crypto.randomBytes() uses the OS CSPRNG and is the correct choice for security-sensitive randomness.',
      commonViolations: ['const token = Math.random().toString(36)', 'const sessionId = String(Math.random())'],
      goodExample: "import { randomBytes } from 'node:crypto';\nconst token = randomBytes(32).toString('hex');",
      badExample: "const token = Math.random().toString(36).slice(2); // predictable!",
      relatedPlaybooks: ['cryptography.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['crypto-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('math_random_crypto', config.severityRules);
      const RAND_RE = /Math\.random\s*\(\s*\)/;
      const CRYPTO_CTX = /(?:token|secret|key|password|session|nonce|salt|id|uuid|guid)/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (RAND_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
            if (CRYPTO_CTX.test(ctx) || CRYPTO_CTX.test(line)) {
              findings.push({ severity, category: 'math_random_crypto', file: path, line: i + 1, message: 'Math.random() used in a security-sensitive context.', suggestion: "Use crypto.randomBytes(32).toString('hex') for tokens and session IDs." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_012',
    category: 'cookie_no_flags',
    description: 'Cookies set without httpOnly, secure, and sameSite flags are vulnerable to XSS theft and CSRF.',
    severity: 'HIGH',
    tags: ['security', 'cookies', 'session'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without httpOnly, cookies are readable by JavaScript (XSS can steal them). Without secure, cookies transmit over HTTP. Without sameSite=strict/lax, cookies are sent on cross-origin navigations (CSRF).',
      commonViolations: ["res.cookie('session', token)", "document.cookie = 'auth=' + token"],
      goodExample: "res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 3600000 });",
      badExample: "res.cookie('auth', token);  // no flags — XSS can steal, CSRF possible",
      relatedPlaybooks: ['session-security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['cookie-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cookie_no_flags', config.severityRules);
      const SET_COOKIE_RE = /\bres\.cookie\s*\(|setCookie\s*\(|document\.cookie\s*=/;
      const HAS_FLAGS_RE = /httpOnly|sameSite|secure/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SET_COOKIE_RE.test(line) && !HAS_FLAGS_RE.test(line)) {
            const ctx = lines.slice(i, Math.min(i + 4, lines.length)).join(' ');
            if (!HAS_FLAGS_RE.test(ctx)) {
              findings.push({ severity, category: 'cookie_no_flags', file: path, line: i + 1, message: 'Cookie set without security flags (httpOnly, secure, sameSite).', suggestion: "Add { httpOnly: true, secure: true, sameSite: 'lax' } to cookie options." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_013',
    category: 'json_parse_user_input',
    description: 'JSON.parse on user-supplied input without try-catch causes unhandled exceptions on malformed JSON.',
    severity: 'MEDIUM',
    tags: ['security', 'input-validation', 'reliability'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'JSON.parse throws a SyntaxError on invalid input. Unguarded calls with user data allow denial-of-service attacks by sending malformed JSON, crashing request handlers or workers.',
      commonViolations: ['const data = JSON.parse(req.body)', "const payload = JSON.parse(message)"],
      goodExample: "let data;\ntry { data = JSON.parse(rawInput); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }",
      badExample: 'const body = JSON.parse(req.body.data);  // throws on "not json"',
      relatedPlaybooks: ['input-validation.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['safe-parse-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('json_parse_user_input', config.severityRules);
      const PARSE_RE = /JSON\.parse\s*\(\s*(?:req\.|body|message|input|data|payload|text)\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PARSE_RE.test(line)) {
            const ctx = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
            if (!/try\s*\{|\.catch\(|safeParse/.test(ctx)) {
              findings.push({ severity, category: 'json_parse_user_input', file: path, line: i + 1, message: 'JSON.parse on user-supplied input without error handling.', suggestion: 'Wrap in try-catch and return a 400 response on SyntaxError.' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_014',
    category: 'ssrf_fetch',
    description: 'Server-side fetch with a user-controlled URL enables SSRF — attackers can reach internal services.',
    severity: 'BLOCKER',
    tags: ['security', 'ssrf', 'api'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'SSRF (Server-Side Request Forgery) lets attackers use your server as a proxy to reach internal services, cloud metadata endpoints (169.254.169.254), or other hosts not accessible from the internet.',
      commonViolations: ['fetch(req.query.url)', "axios(req.body.webhookUrl)", "fetch(`${userInput}/api`)"],
      goodExample: "// Validate URL against an allowlist of domains before fetching\nconst ALLOWED = new Set(['api.stripe.com', 'hooks.slack.com']);\nconst url = new URL(req.body.url);\nif (!ALLOWED.has(url.hostname)) return res.status(400).end();",
      badExample: "const data = await fetch(req.query.url).then(r => r.json());  // SSRF",
      relatedPlaybooks: ['ssrf-prevention.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['url-allowlist-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ssrf_fetch', config.severityRules);
      const SSRF_RE = /\b(?:fetch|axios|got|request)\s*\(\s*(?:req\.|.*(?:query|params|body)\.\w+|`[^`]*\$\{(?:req|query|params|body))/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (SSRF_RE.test(line)) {
            findings.push({ severity, category: 'ssrf_fetch', file: path, line: i + 1, message: 'Server-side fetch with user-controlled URL — SSRF risk.', suggestion: 'Validate the URL against an explicit allowlist of trusted domains before fetching.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_015',
    category: 'open_redirect',
    description: 'redirect() or res.redirect() with user-controlled input enables open redirect attacks.',
    severity: 'HIGH',
    tags: ['security', 'redirect', 'phishing'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Open redirects allow attackers to craft legitimate-looking URLs on your domain that redirect users to phishing sites. They are commonly used in phishing campaigns and OAuth token theft.',
      commonViolations: ['redirect(req.query.returnTo)', "res.redirect(searchParams.get('next'))"],
      goodExample: "const ALLOWED_PATHS = ['/dashboard', '/profile'];\nconst dest = req.query.next;\nif (!ALLOWED_PATHS.includes(dest)) return res.redirect('/dashboard');\nres.redirect(dest);",
      badExample: "res.redirect(req.query.returnUrl);  // attacker sets returnUrl=https://evil.com",
      relatedPlaybooks: ['redirect-safety.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('open_redirect', config.severityRules);
      const REDIR_RE = /\b(?:redirect|res\.redirect)\s*\(\s*(?:req\.\w+|.*(?:query|params|searchParams|body)\.\w+)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (REDIR_RE.test(line)) {
            findings.push({ severity, category: 'open_redirect', file: path, line: i + 1, message: 'redirect() with user-controlled value — open redirect risk.', suggestion: 'Validate the redirect destination against an allowlist of paths.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_016',
    category: 'shell_injection',
    description: 'child_process.exec / execSync with template literals or concatenation enables command injection.',
    severity: 'BLOCKER',
    tags: ['security', 'rce', 'shell-injection'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'exec() passes the command string to /bin/sh, which interprets shell metacharacters. User-controlled input in the command string allows attackers to run arbitrary OS commands.',
      commonViolations: ['exec(`git clone ${req.body.repoUrl}`)', 'execSync("ls " + userInput)'],
      goodExample: "import { execFile } from 'node:child_process';\nexecFile('git', ['clone', '--', repoUrl], { timeout: 10000 });",
      badExample: 'exec(`convert ${req.file.path} -resize 800 output.jpg`);  // command injection',
      relatedPlaybooks: ['shell-injection.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('shell_injection', config.severityRules);
      const EXEC_TMPL_RE = /\bexec(?:Sync|File)?\s*\(\s*`[^`]*\$\{/;
      const EXEC_CONCAT_RE = /\bexec(?:Sync)?\s*\([^)]*\+\s*(?:req\.|user|input|query|params)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (EXEC_TMPL_RE.test(line) || EXEC_CONCAT_RE.test(line)) {
            findings.push({ severity, category: 'shell_injection', file: path, line: i + 1, message: 'exec() with dynamic string — shell injection risk.', suggestion: 'Use execFile() with an explicit args array — arguments are not shell-interpolated.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_017',
    category: 'prototype_pollution',
    description: 'Object.assign or spread with untrusted input into a shared object enables prototype pollution.',
    severity: 'HIGH',
    tags: ['security', 'prototype-pollution', 'node'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'An attacker sending { "__proto__": { "admin": true } } can modify Object.prototype, affecting all objects in the process. This bypasses authorization checks that rely on property lookups.',
      commonViolations: ['Object.assign(target, req.body)', 'const opts = { ...defaults, ...req.query }'],
      goodExample: "import { merge } from 'lodash/fp';  // safe deep merge\nconst safe = merge(defaults, JSON.parse(JSON.stringify(userInput)));",
      badExample: 'const config = Object.assign({}, defaults, req.body);  // pollution if body has __proto__',
      relatedPlaybooks: ['prototype-pollution.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prototype_pollution', config.severityRules);
      const ASSIGN_RE = /Object\.assign\s*\([^)]*(?:req\.body|req\.query|req\.params|userInput|body)\b/;
      const SPREAD_RE = /\.\.\.\s*(?:req\.body|req\.query|req\.params|userInput)\b/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (ASSIGN_RE.test(line) || SPREAD_RE.test(line)) {
            findings.push({ severity, category: 'prototype_pollution', file: path, line: i + 1, message: 'Object.assign or spread with user-controlled input — prototype pollution risk.', suggestion: 'Deep-clone and validate user input before merging into shared objects.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_018',
    category: 'password_in_url',
    description: 'Passwords or secrets in URLs appear in server logs, browser history, and Referer headers.',
    severity: 'BLOCKER',
    tags: ['security', 'credentials', 'logging'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'URLs are logged by every proxy, CDN, and web server. Including a password or API key in a URL means it appears in access logs, browser history, and can leak via the Referer header to third-party scripts.',
      commonViolations: ['https://api.com/endpoint?api_key=sk-abc123', 'https://user:pass@db.example.com'],
      goodExample: "// Pass credentials in headers: Authorization: Bearer <token>\n// Or in the request body for POST requests.",
      badExample: "fetch(`https://api.example.com/v1?key=${API_KEY}`)  // key appears in logs",
      relatedPlaybooks: ['credential-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('password_in_url', config.severityRules);
      const PWD_URL_RE = /https?:\/\/[^:@\s]+:[^@\s]+@|\?(?:api_key|password|secret|token|key)=/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (PWD_URL_RE.test(line)) {
            findings.push({ severity, category: 'password_in_url', file: path, line: i + 1, message: 'Credential or secret detected in URL — leaks via logs and Referer.', suggestion: 'Pass credentials in Authorization headers or POST body, never in the URL.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_019',
    category: 'timing_attack',
    description: 'Password or token comparison with == / === is vulnerable to timing attacks. Use a constant-time comparison function.',
    severity: 'HIGH',
    tags: ['security', 'crypto', 'timing'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'String equality operators short-circuit on the first non-matching byte. An attacker measuring response times can determine how many bytes of their guess match the correct value, eventually recovering the full secret.',
      commonViolations: ["if (token === storedToken)", "password == user.password"],
      goodExample: "import { timingSafeEqual } from 'node:crypto';\nconst safe = timingSafeEqual(Buffer.from(a), Buffer.from(b));",
      badExample: "if (req.headers['x-api-key'] === process.env.API_KEY) {  // timing leak",
      relatedPlaybooks: ['cryptography.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['crypto-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('timing_attack', config.severityRules);
      const TIMING_RE = /\b(?:password|token|secret|key|hash|digest|signature)\b.*(?:===|!==|==|!=)/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (TIMING_RE.test(line) && !/timingSafeEqual|bcrypt\.compare|argon2\.verify/.test(line)) {
            findings.push({ severity, category: 'timing_attack', file: path, line: i + 1, message: 'String equality comparison on secret/token — timing attack risk.', suggestion: 'Use crypto.timingSafeEqual() for constant-time comparison.' });
          }
        }
      }
      return findings;
    },
  },

  // ── Auth rules ─────────────────────────────────────────────────────────────

  {
    id: 'AUTH_002',
    category: 'jwt_decode_no_verify',
    description: 'jwt.decode() decodes without verifying the signature. Use jwt.verify() to authenticate the token.',
    severity: 'BLOCKER',
    tags: ['security', 'auth', 'jwt'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'jwt.decode() does not validate the signature, expiry, or issuer. Any attacker can craft a JWT with arbitrary claims (including admin: true) and jwt.decode() will accept it as legitimate.',
      commonViolations: ['const user = jwt.decode(req.headers.authorization)', 'const payload = jwt.decode(token)'],
      goodExample: "const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });",
      badExample: "const user = jwt.decode(token);  // does not check signature — anyone can forge",
      relatedPlaybooks: ['jwt-security.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: ['auth-check-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('jwt_decode_no_verify', config.severityRules);
      const JWT_DECODE_RE = /\bjwt\.decode\s*\(/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (JWT_DECODE_RE.test(line)) {
            findings.push({ severity, category: 'jwt_decode_no_verify', file: path, line: i + 1, message: 'jwt.decode() used — does not verify signature. Use jwt.verify() instead.', suggestion: "Replace with jwt.verify(token, secret, { algorithms: ['HS256'] })." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_003',
    category: 'localstorage_token',
    description: 'Storing auth tokens in localStorage exposes them to XSS. Use httpOnly cookies managed by the server.',
    severity: 'HIGH',
    tags: ['security', 'auth', 'xss', 'storage'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'localStorage is accessible to all JavaScript on the page, including injected XSS scripts. A single XSS vulnerability drains all stored tokens. httpOnly cookies are inaccessible to JavaScript entirely.',
      commonViolations: ["localStorage.setItem('token', jwt)", "localStorage.setItem('session', sessionId)"],
      goodExample: "// The server sets the token as an httpOnly, secure cookie — JavaScript never touches it.\n// On logout, call your logout API which clears the cookie server-side.",
      badExample: "localStorage.setItem('auth_token', response.token);  // XSS can steal this",
      relatedPlaybooks: ['auth-storage.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('localstorage_token', config.severityRules);
      const LS_TOKEN_RE = /localStorage\.setItem\s*\(\s*['"][^'"]*(?:token|auth|jwt|session|key)[^'"]*['"]/i;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (LS_TOKEN_RE.test(line)) {
            findings.push({ severity, category: 'localstorage_token', file: path, line: i + 1, message: 'Auth token stored in localStorage — vulnerable to XSS theft.', suggestion: 'Use an httpOnly secure cookie set by the server instead.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_004',
    category: 'user_id_from_body',
    description: 'Trusting userId from req.body instead of the session allows users to act as any other user.',
    severity: 'BLOCKER',
    tags: ['security', 'auth', 'idor'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'If your endpoint reads userId from the request body or query params and uses it for DB operations, any user can send someone else\'s ID and read or modify their data — a classic IDOR (Insecure Direct Object Reference) vulnerability.',
      commonViolations: ['const userId = req.body.userId', 'const { userId } = req.query'],
      goodExample: "const session = await getSession(req);\nif (!session) return res.status(401).end();\nconst userId = session.user.id;  // always from server-side session",
      badExample: "const userId = req.body.userId;  // attacker sets this to another user's ID\nawait db.delete(users, { where: { id: userId } });",
      relatedPlaybooks: ['idor-prevention.md', 'auth-patterns.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: ['session-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('user_id_from_body', config.severityRules);
      const BODY_ID_RE = /(?:const|let|var)\s+\{?[^}]*\buserId\b[^}]*\}?\s*=\s*req\.(?:body|query|params)/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        if (!/api|route|handler|controller/i.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (BODY_ID_RE.test(line)) {
            findings.push({ severity, category: 'user_id_from_body', file: path, line: i + 1, message: 'userId taken from request body/query — IDOR risk. Read from server-side session.', suggestion: "const userId = (await getSession(req)).user.id;" });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_005',
    category: 'missing_rate_limit',
    description: 'Auth endpoints (login, register, password reset) without rate limiting are brute-force targets.',
    severity: 'HIGH',
    tags: ['security', 'auth', 'rate-limiting'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Without rate limiting, attackers can attempt thousands of password combinations per second against login endpoints, or enumerate valid email addresses via register/reset endpoints.',
      commonViolations: ['Login route handler with no rateLimit middleware', 'Password reset route with no throttle'],
      goodExample: "import rateLimit from 'express-rate-limit';\nconst loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });\nrouter.post('/login', loginLimiter, loginHandler);",
      badExample: "router.post('/login', loginHandler);  // no rate limit — brute-force target",
      relatedPlaybooks: ['auth-security.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, scan }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_rate_limit', config.severityRules);
      const AUTH_PATH_RE = /\/(login|signin|sign-in|register|signup|sign-up|forgot-password|reset-password|auth)/i;
      return scan.apiRoutes
        .filter(r => AUTH_PATH_RE.test(r.path) && !r.auth)
        .map(r => ({
          severity,
          category: 'missing_rate_limit',
          file: r.file ?? r.path,
          message: `Auth endpoint ${r.path} may lack rate limiting.`,
          suggestion: 'Apply rate limiting middleware (e.g., express-rate-limit or Upstash) to this auth route.',
        }));
    },
  },

  {
    id: 'AUTH_006',
    category: 'hardcoded_credentials',
    description: 'Hardcoded test credentials or default passwords in non-test files are a persistent security risk.',
    severity: 'BLOCKER',
    tags: ['security', 'auth', 'credentials'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Hardcoded credentials are committed to git history permanently. Even if "only for dev", they often appear unchanged in staging or production. Automated scanners find them in minutes.',
      commonViolations: ["const ADMIN_PASS = 'admin123'", "password: 'password'", "apiKey = 'test-key-do-not-use'"],
      goodExample: "const adminPass = process['env' as 'env']['ADMIN_PASSWORD'];",
      badExample: "const DEFAULT_ADMIN = { email: 'admin@example.com', password: 'admin123' };  // hardcoded",
      relatedPlaybooks: ['secret-management.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: ['env-var-helper'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('hardcoded_credentials', config.severityRules);
      const CRED_RE = /(?:password|passwd|secret|apiKey|api_key)\s*(?:[:=])\s*['"][^'"]{4,}['"]/i;
      const SAFE_RE = /process\.env|getenv|process\[/;
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line) || SAFE_RE.test(line)) continue;
          if (CRED_RE.test(line)) {
            findings.push({ severity, category: 'hardcoded_credentials', file: path, line: i + 1, message: 'Hardcoded credential or API key detected.', suggestion: 'Move to environment variable and load via process.env.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'AUTH_007',
    category: 'missing_auth_middleware',
    description: 'Admin or internal routes exposed without authentication middleware are world-accessible.',
    severity: 'BLOCKER',
    tags: ['security', 'auth', 'admin'],
    sinceVersion: '2.0.0',
    explain: {
      why: 'Routes under /admin, /internal, or /api/admin are prime targets. Without explicit auth middleware, the naming convention provides no real protection — anyone can access them.',
      commonViolations: ['GET /admin/users with no auth check', 'POST /internal/reset-all with no session guard'],
      goodExample: "router.use('/admin', requireAdminRole, adminRouter);",
      badExample: "router.get('/admin/users', listAllUsers);  // no auth check — world readable",
      relatedPlaybooks: ['auth-patterns.md'],
      relatedAgents: ['auth-reviewer', 'security-reviewer'],
      relatedSkills: ['auth-check-helper'],
    },
    detect({ config, scan }: DetectInput): Finding[] {
      const severity = classifySeverity('missing_auth_middleware', config.severityRules);
      const ADMIN_RE = /\/(?:admin|internal|sys|management|backoffice)/i;
      return scan.apiRoutes
        .filter(r => ADMIN_RE.test(r.path) && !r.auth)
        .map(r => ({
          severity,
          category: 'missing_auth_middleware',
          file: r.file ?? r.path,
          message: `Admin/internal route ${r.path} has no visible auth check.`,
          suggestion: 'Add requireAdmin or similar middleware before this route handler.',
        }));
    },
  },
];
