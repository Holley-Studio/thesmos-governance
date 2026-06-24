import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';
import { SOURCE_EXT, SQL_EXT, isTestPath, isCommentLine, matchLines } from './helpers';

export const SECURITY_RULES: ThesmosRule[] = [
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
      const CRED_RE = /(?:password|passwd|secret|apiKey|api_key|privateKey|private_key|clientSecret|client_secret|serviceAccountKey|database_password|db_password|connectionString|connection_string)\s*(?:[:=])\s*['"][^'"]{4,}['"]/i;
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

  // ── Security expansions ───────────────────────────────────────────────────

  {
    id: 'SEC_020',
    category: 'open_redirect',
    description: "Redirecting to a URL from user input without validation allows attackers to redirect users to phishing sites.",
    severity: 'HIGH',
    tags: ['security', 'redirect', 'owasp'],
    sinceVersion: '3.0.0',
    explain: {
      why: "An open redirect lets attackers craft links like /login?redirect=https://evil.com that appear to point to your domain but land the user on an attacker site. Always validate that redirect URLs are relative or on an allowlisted domain.",
      commonViolations: ["redirect(searchParams.get('redirect'))  // attacker-controlled URL"],
      goodExample: "const url = new URL(redirectParam, 'https://myapp.com')\nif (url.hostname !== 'myapp.com') throw new Error('Invalid redirect')\nredirect(url.pathname + url.search)",
      badExample: "const next = req.query.next\nres.redirect(next)  // open redirect — attacker sets next=https://evil.com",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('open_redirect', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:redirect|res\.redirect)\s*\(\s*(?:req\.|body\.|params\.|query\.|searchParams\.)/.test(line)) {
            findings.push({ severity, category: 'open_redirect', file: path, line: i + 1, message: 'Redirect target from request data without validation — open redirect vulnerability.', suggestion: 'Validate redirect URLs are relative paths or match an allowlisted hostname.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_021',
    category: 'mass_assignment',
    description: "Spreading user input directly into database operations allows attackers to set fields they shouldn't control.",
    severity: 'BLOCKER',
    tags: ['security', 'mass-assignment', 'database'],
    sinceVersion: '3.0.0',
    explain: {
      why: "await db.update(users, { where: eq(id, id), set: body }) lets an attacker include isAdmin: true in their request body and promote themselves. Always pick only allowed fields.",
      commonViolations: ["prisma.user.update({ where: { id }, data: body })", "db.update(users, { set: req.body })"],
      goodExample: "const { name, bio } = body  // destructure only allowed fields\nawait prisma.user.update({ where: { id }, data: { name, bio } })",
      badExample: "await prisma.user.update({ where: { id }, data: req.body })  // attacker can set isAdmin: true",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('mass_assignment', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:\.update|\.create|\.upsert)\s*\(\s*\{[^}]*(?:data|set)\s*:\s*(?:req\.body|body|input|data)\s*[,}]/.test(line)) {
            findings.push({ severity, category: 'mass_assignment', file: path, line: i + 1, message: 'User-controlled object spread into database write — mass assignment vulnerability.', suggestion: 'Destructure only the allowed fields: const { name, bio } = body and pass them individually.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_022',
    category: 'cors_wildcard_header',
    description: "CORS Access-Control-Allow-Origin: * allows any website to make credentialed requests to your API.",
    severity: 'BLOCKER',
    tags: ['security', 'cors', 'api'],
    sinceVersion: '3.0.0',
    explain: {
      why: "CORS * with Allow-Credentials: true is invalid (browser blocks it). CORS * alone allows any origin to read your API responses — acceptable only for truly public APIs. Use an explicit allowlist for APIs that serve user data.",
      commonViolations: ["res.setHeader('Access-Control-Allow-Origin', '*')", "cors({ origin: '*' })"],
      goodExample: "cors({ origin: ['https://myapp.com', 'https://staging.myapp.com'] })",
      badExample: "app.use(cors({ origin: '*' }))  // any website can read your API responses",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_wildcard_header', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:Allow-Origin|origin)\s*[:=,]+\s*['"]\s*\*\s*['"]/.test(line)) {
            findings.push({ severity, category: 'cors_wildcard_header', file: path, line: i + 1, message: "CORS wildcard '*' allows any origin to read API responses.", suggestion: "Use an explicit allowlist: cors({ origin: ['https://yourapp.com'] })." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_023',
    category: 'timing_attack_comparison',
    description: "Comparing secrets with === is vulnerable to timing attacks — use crypto.timingSafeEqual instead.",
    severity: 'HIGH',
    tags: ['security', 'cryptography', 'timing-attack'],
    sinceVersion: '3.0.0',
    explain: {
      why: "String comparison (a === b) short-circuits on the first differing character. An attacker can measure response time differences to brute-force secrets one character at a time. crypto.timingSafeEqual runs in constant time regardless of where strings differ.",
      commonViolations: ["if (token === storedToken) { ... }", "if (hmac === expected) { ... }"],
      goodExample: "import { timingSafeEqual, createHmac } from 'node:crypto'\nconst safe = timingSafeEqual(Buffer.from(a), Buffer.from(b))",
      badExample: "if (req.headers['x-webhook-signature'] === computedHmac) { ... }  // timing attack vulnerable",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('timing_attack_comparison', config.severityRules);
      const findings: Finding[] = [];
      const TOKEN_VARS = /(?:token|hmac|hash|signature|secret|key|password|digest)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/===|!==/.test(line) && TOKEN_VARS.test(line) && !/timingSafeEqual/.test(line)) {
            findings.push({ severity, category: 'timing_attack_comparison', file: path, line: i + 1, message: 'Secret/token compared with === — vulnerable to timing attacks.', suggestion: 'Use crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)) for constant-time comparison.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_024',
    category: 'insecure_deserialization',
    description: "Deserializing untrusted data with eval(), new Function(), or JSON.parse without schema validation is dangerous.",
    severity: 'BLOCKER',
    tags: ['security', 'deserialization', 'owasp'],
    sinceVersion: '3.0.0',
    explain: {
      why: "eval() and new Function() execute arbitrary code. JSON.parse on unvalidated data passes malicious types to consuming code. Always validate deserialized data with zod or JSON Schema before using it.",
      commonViolations: ["eval(userInput)", "const data = JSON.parse(req.body)  // no schema validation"],
      goodExample: "const raw = JSON.parse(req.body)\nconst data = mySchema.parse(raw)  // validates and types at runtime",
      badExample: "const config = eval(req.body.config)  // arbitrary code execution",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('insecure_deserialization', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/\beval\s*\(/.test(line) || /new\s+Function\s*\(/.test(line)) {
            findings.push({ severity, category: 'insecure_deserialization', file: path, line: i + 1, message: "eval() or new Function() executes arbitrary code — remote code execution risk.", suggestion: "Remove eval(). For dynamic dispatch, use a lookup table: const handlers = { add: fn1, remove: fn2 }." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_025',
    category: 'file_upload_path_traversal',
    description: "Using user-provided filenames for file uploads allows path traversal attacks (../../etc/passwd).",
    severity: 'BLOCKER',
    tags: ['security', 'path-traversal', 'file-upload'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If you save uploaded files using their original name (filename from the request), an attacker can upload a file named ../../.env to overwrite sensitive config files. Always use a generated UUID as the filename.",
      commonViolations: ["const dest = path.join(uploadDir, file.originalname)", "fs.writeFile(req.body.filename, data)"],
      goodExample: "import { randomUUID } from 'node:crypto'\nconst safeName = `${randomUUID()}${path.extname(file.originalname)}`\nfs.writeFile(path.join(uploadDir, safeName), data)",
      badExample: "const dest = path.join('./uploads', req.file.originalname)  // ../../etc/passwd attack",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('file_upload_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/path\.join\s*\([^)]*(?:originalname|filename|\.name)[^)]*\)/.test(line) || /writeFile\s*\([^,]*(?:req\.body|body\.)/.test(line)) {
            findings.push({ severity, category: 'file_upload_path_traversal', file: path, line: i + 1, message: 'File saved with user-provided filename — path traversal attack risk.', suggestion: 'Generate a UUID filename: randomUUID() + path.extname(originalname) to prevent traversal.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_026',
    category: 'rate_limit_missing_auth',
    description: "Authentication endpoints (login, password reset) without rate limiting are vulnerable to brute force attacks.",
    severity: 'HIGH',
    tags: ['security', 'rate-limiting', 'brute-force'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Without rate limiting, an attacker can try millions of password combinations per minute. Login and password-reset endpoints must have request throttling (e.g., 5 attempts per minute per IP).",
      commonViolations: ['// POST /api/auth/login with no rate limiting middleware'],
      goodExample: "import { rateLimit } from 'express-rate-limit'\nconst loginLimiter = rateLimit({ windowMs: 60 * 1000, max: 5 })\napp.post('/api/auth/login', loginLimiter, loginHandler)",
      badExample: "app.post('/api/auth/login', loginHandler)  // no rate limit — brute forceable",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('rate_limit_missing_auth', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const isAuthRoute = /(?:login|signin|sign-in|password.reset|forgot.password|register|signup)/i.test(path);
        if (!isAuthRoute) return findings;
        if (!content.includes('rateLimit') && !content.includes('rateLimiter') && !content.includes('rate_limit') && !content.includes('Bottleneck')) {
          findings.push({ severity, category: 'rate_limit_missing_auth', file: path, message: 'Authentication endpoint without rate limiting — vulnerable to brute force attacks.', suggestion: "Add rate limiting: import { rateLimit } from 'express-rate-limit' with max: 5 per windowMs: 60000." });
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_027',
    category: 'jwt_secret_weak',
    description: "Using a short or predictable JWT secret allows attackers to forge tokens via offline brute force.",
    severity: 'BLOCKER',
    tags: ['security', 'jwt', 'authentication'],
    sinceVersion: '3.0.0',
    explain: {
      why: "JWT HS256 tokens can be brute-forced offline if the secret is short or predictable (e.g., 'secret', 'password'). Use a cryptographically random secret of at least 256 bits (32 bytes).",
      commonViolations: ["jwt.sign(payload, 'secret')", "jwt.sign(payload, 'mysecretkey')"],
      goodExample: "// .env: JWT_SECRET=<output of: node -e \"require('crypto').randomBytes(32).toString('hex')\">\njwt.sign(payload, process.env.JWT_SECRET!, { algorithm: 'HS256' })",
      badExample: "jwt.sign(payload, 'secret')  // offline brute-forceable in seconds",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('jwt_secret_weak', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/jwt\.sign\s*\([^,]+,\s*['"][^'"]{1,20}['"]/.test(line)) {
            findings.push({ severity, category: 'jwt_secret_weak', file: path, line: i + 1, message: 'JWT signed with short hardcoded secret — offline brute-forceable.', suggestion: 'Use a 256-bit random secret from env: jwt.sign(payload, process.env.JWT_SECRET!).' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_028',
    category: 'session_fixation',
    description: "Not regenerating the session ID after login allows session fixation attacks.",
    severity: 'HIGH',
    tags: ['security', 'session', 'authentication'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If an attacker sets a known session ID before the user logs in, and the server doesn't regenerate it on login, the attacker can hijack the authenticated session. Always regenerate the session on privilege change.",
      commonViolations: ['req.session.userId = user.id  // without req.session.regenerate()'],
      goodExample: "req.session.regenerate((err) => {\n  req.session.userId = user.id\n  res.json({ success: true })\n})",
      badExample: "// On login:\nreq.session.user = user  // session ID unchanged — fixation attack",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('session_fixation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const isAuthFile = /(?:login|signin|auth)/i.test(path);
        if (!isAuthFile) return findings;
        if (/req\.session\.\w+\s*=/.test(content) && !content.includes('req.session.regenerate')) {
          findings.push({ severity, category: 'session_fixation', file: path, message: 'Session values set without session.regenerate() after login — session fixation attack risk.', suggestion: 'Call req.session.regenerate() before setting user data on the session after successful login.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_029',
    category: 'xxe_vulnerability',
    description: "Parsing XML with external entity expansion enabled allows XXE attacks that can read local files.",
    severity: 'BLOCKER',
    tags: ['security', 'xxe', 'xml'],
    sinceVersion: '3.0.0',
    explain: {
      why: "XXE (XML External Entity) attacks exploit XML parsers that resolve ENTITY declarations like <!ENTITY xxe SYSTEM 'file:///etc/passwd'> to read local files, do SSRF, or cause denial of service. Disable external entity resolution in your XML parser.",
      commonViolations: ["xml2js.parseString(userXml)  // external entities enabled by default"],
      goodExample: "// Prefer JSON over XML. If XML is required, disable external entities\n// fast-xml-parser: new XMLParser({ processEntities: false })",
      badExample: "const result = await parseXml(req.body)  // if parser resolves external entities — reads /etc/passwd",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('xxe_vulnerability', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (/from\s+['"](?:xml2js|fast-xml-parser|xmldom|sax)['"]|require\(['"](?:xml|xml2js)/.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (/parseString|parseXml|XMLParser\s*\(/.test(line) && !/processEntities.*false|noEntityExpansion/.test(line)) {
              findings.push({ severity, category: 'xxe_vulnerability', file: path, line: i + 1, message: 'XML parsed without disabling external entity resolution — XXE attack risk.', suggestion: "Disable external entities: new XMLParser({ processEntities: false }) or switch to JSON." });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_030',
    category: 'insecure_direct_object_ref',
    description: "Using user-provided IDs to fetch resources without verifying ownership enables IDOR attacks.",
    severity: 'HIGH',
    tags: ['security', 'idor', 'authorization'],
    sinceVersion: '3.0.0',
    explain: {
      why: "GET /api/orders/12345 with no ownership check lets user A access user B's order by changing the ID. Always verify the fetched resource belongs to the authenticated user before returning it.",
      commonViolations: ["const order = await prisma.order.findUnique({ where: { id: params.id } })"],
      goodExample: "const order = await prisma.order.findUnique({ where: { id: params.id, userId: session.userId } })\nif (!order) throw new NotFoundError()",
      badExample: "const invoice = await db.invoice.findById(req.params.id)  // no ownership check — IDOR",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('insecure_direct_object_ref', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/findUnique\s*\(\s*\{\s*where\s*:\s*\{\s*id\s*:\s*(?:params\.|req\.params\.|input\.)/.test(line)) {
            const surrounding = lines.slice(i, i + 3).join('\n');
            if (!/userId|user_id|ownerId|owner_id|session\.\w+/.test(surrounding)) {
              findings.push({ severity, category: 'insecure_direct_object_ref', file: path, line: i + 1, message: 'findUnique by user-supplied ID without ownership check — IDOR vulnerability.', suggestion: 'Add userId filter: findUnique({ where: { id: params.id, userId: session.userId } }).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_031',
    category: 'http_in_production',
    description: "Hardcoded http:// URLs in production code transmit data unencrypted and break HSTS.",
    severity: 'HIGH',
    tags: ['security', 'tls', 'https'],
    sinceVersion: '3.0.0',
    explain: {
      why: "HTTP URLs transmit data in plaintext, vulnerable to MITM attacks. Modern browsers also block mixed content (HTTPS page loading HTTP resources). Use https:// in all production URLs.",
      commonViolations: ["const API_URL = 'http://api.myapp.com'"],
      goodExample: "const API_URL = 'https://api.myapp.com'",
      badExample: "await fetch('http://internal-api.example.com/data')  // plaintext — MITM vulnerable",
      relatedPlaybooks: ['security.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('http_in_production', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) || isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/['"]http:\/\/(?!localhost|127\.|10\.|192\.168\.)[\w.-]+/.test(line)) {
            findings.push({ severity, category: 'http_in_production', file: path, line: i + 1, message: 'Non-localhost http:// URL in production code — transmits data unencrypted.', suggestion: "Change to https://. Use http:// only for localhost development." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_032',
    category: 'dependency_confusion',
    description: "Private package names without a scope (@org/) are vulnerable to dependency confusion attacks.",
    severity: 'MEDIUM',
    tags: ['security', 'supply-chain', 'npm'],
    sinceVersion: '3.0.0',
    explain: {
      why: "If your private package is named 'myutil' (no @org scope), an attacker can publish a malicious package named 'myutil' on npm.org. npm may prefer the public registry version. Always scope private packages: @yourorg/myutil.",
      commonViolations: ['// package.json: "dependencies": { "internal-auth": "1.0.0" }'],
      goodExample: '"@myorg/internal-auth": "1.0.0"  // scoped — protected from dependency confusion',
      badExample: '"internal-api": "1.0.0"  // unscoped — attackers can publish a malicious public package with same name',
      relatedPlaybooks: ['security.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('dependency_confusion', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('package.json')) continue;
        try {
          const pkg = JSON.parse(content);
          const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
          for (const [name] of Object.entries(allDeps)) {
            if (/(?:internal|private|local|corp|company)/i.test(name) && !name.startsWith('@')) {
              findings.push({ severity, category: 'dependency_confusion', file: path, message: `Package "${name}" looks private but is unscoped — vulnerable to dependency confusion.`, suggestion: `Rename to "@yourorg/${name}" and configure npm to use your private registry for @yourorg.` });
            }
          }
        } catch { /* not valid JSON */ }
      }
      return findings;
    },
  },

  {
    id: 'SEC_033',
    category: 'xss_via_href',
    description: "Using user-provided URLs in href attributes allows javascript: protocol XSS attacks.",
    severity: 'BLOCKER',
    tags: ['security', 'xss', 'react'],
    sinceVersion: '3.0.0',
    explain: {
      why: "<a href={userUrl}> where userUrl is 'javascript:alert(1)' executes JavaScript when clicked. Always validate that href URLs start with https:// or are relative paths.",
      commonViolations: ["<a href={user.website}>Visit</a>", "<a href={link}>Link</a>"],
      goodExample: "const safeUrl = user.website?.startsWith('https://') ? user.website : '#'\n<a href={safeUrl}>Visit</a>",
      badExample: "<a href={post.externalUrl}>Read more</a>  // javascript: XSS if externalUrl is attacker-controlled",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('xss_via_href', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!/\.(tsx|jsx)$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/href\s*=\s*\{(?!['"`]\/|['"`]https:\/\/|['"`]#)/.test(line) && !/href\s*=\s*\{\s*['"`]/.test(line)) {
            findings.push({ severity, category: 'xss_via_href', file: path, line: i + 1, message: 'Dynamic href from variable — may allow javascript: protocol XSS if unvalidated.', suggestion: "Validate href starts with 'https://' or is a relative path: const safe = url?.startsWith('https://') ? url : '#'." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_034',
    category: 'clickjacking_missing',
    description: "Pages without X-Frame-Options or CSP frame-ancestors are vulnerable to clickjacking.",
    severity: 'MEDIUM',
    tags: ['security', 'clickjacking', 'headers'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Clickjacking embeds your site in a hidden iframe on an attacker's page and tricks users into clicking your UI. X-Frame-Options: DENY or Content-Security-Policy: frame-ancestors 'none' prevents embedding.",
      commonViolations: ["// next.config.js without X-Frame-Options header"],
      goodExample: "// next.config.js headers:\n{ key: 'X-Frame-Options', value: 'DENY' }\n{ key: 'Content-Security-Policy', value: \"frame-ancestors 'none'\" }",
      badExample: "// No frame-ancestors or X-Frame-Options set — page embeddable in iframes",
      relatedPlaybooks: ['security.md'],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('clickjacking_missing', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!path.includes('next.config') && !path.includes('helmet') && !path.includes('middleware.')) continue;
        if (path.includes('next.config') && content.includes('headers') && !content.includes('X-Frame-Options') && !content.includes('frame-ancestors')) {
          findings.push({ severity, category: 'clickjacking_missing', file: path, message: 'Next.js config defines headers but is missing X-Frame-Options or frame-ancestors CSP — clickjacking risk.', suggestion: "Add: { key: 'X-Frame-Options', value: 'DENY' } to your headers configuration." });
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_035',
    category: 'password_not_hashed',
    description: "Storing passwords without hashing exposes all user credentials if the database is breached.",
    severity: 'BLOCKER',
    tags: ['security', 'passwords', 'cryptography'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Storing plaintext or MD5/SHA1 passwords means a database breach exposes all credentials immediately. Use bcrypt, Argon2, or scrypt with a high work factor — these are slow by design, making offline brute force impractical.",
      commonViolations: ["user.password = req.body.password  // stored as plaintext", "createHash('md5').update(password).digest('hex')"],
      goodExample: "import bcrypt from 'bcrypt'\nconst hashed = await bcrypt.hash(password, 12)  // cost factor 12",
      badExample: "user.password = password  // plaintext — full breach on DB dump",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('password_not_hashed', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:user|account|profile)\.\s*password\s*=\s*(?:password|req\.body|body\.|input\.)/.test(line)) {
            findings.push({ severity, category: 'password_not_hashed', file: path, line: i + 1, message: 'Password assigned directly without hashing — plaintext password storage.', suggestion: "Hash before storing: const hash = await bcrypt.hash(password, 12) and store hash." });
          }
          if (/createHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/.test(line)) {
            findings.push({ severity, category: 'password_not_hashed', file: path, line: i + 1, message: 'Password hashed with MD5/SHA1 — these are broken for password storage (too fast).', suggestion: "Use bcrypt.hash(password, 12), argon2.hash(password), or scrypt for password hashing." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_036',
    category: 'env_var_logged',
    description: "Logging process.env values risks exposing secret keys in log aggregators.",
    severity: 'HIGH',
    tags: ['security', 'secrets', 'logging'],
    sinceVersion: '3.0.0',
    explain: {
      why: "console.log(process.env) dumps all environment variables — including DATABASE_URL, API_KEYs, and other secrets — into logs. Log aggregators index these and they become permanently accessible.",
      commonViolations: ["console.log(process.env)", "logger.info({ env: process.env }, 'Config')"],
      goodExample: "logger.info({ NODE_ENV: process.env.NODE_ENV, version: pkg.version }, 'App starting')  // only safe non-secrets",
      badExample: "console.log(process.env)  // logs DATABASE_URL, SECRET_KEY, all other env vars",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('env_var_logged', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/(?:console|logger)\.\w+\s*\([^)]*process\.env(?!\.\w+['"])/.test(line)) {
            findings.push({ severity, category: 'env_var_logged', file: path, line: i + 1, message: 'process.env logged — exposes all secret environment variables in log aggregators.', suggestion: "Log only specific safe values: logger.info({ NODE_ENV: process.env.NODE_ENV }, 'Starting')." });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_037',
    category: 'prototype_pollution_merge',
    description: "Object.assign() or lodash.merge() with user-controlled keys can pollute Object.prototype.",
    severity: 'BLOCKER',
    tags: ['security', 'prototype-pollution', 'javascript'],
    sinceVersion: '3.0.0',
    explain: {
      why: "Object.assign(target, userInput) where userInput contains __proto__ or constructor.prototype keys pollutes the prototype chain. This can change behavior for all objects in the process and is exploitable for privilege escalation.",
      commonViolations: ["Object.assign(config, req.body)", "_.merge(defaults, userInput)"],
      goodExample: "const safe = Object.create(null)  // null prototype — not pollutable\nfor (const [k, v] of Object.entries(userInput)) { if (k !== '__proto__') safe[k] = v }",
      badExample: "Object.assign(options, req.body)  // req.body.__proto__ pollutes Object.prototype",
      relatedPlaybooks: ['security.md'],
      relatedAgents: ['security-reviewer'],
      relatedSkills: [],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('prototype_pollution_merge', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isCommentLine(line)) continue;
          if (/Object\.assign\s*\([^,]+,\s*(?:req\.|body\.|input\.|params\.)/.test(line) || /(?:_\.merge|lodash\.merge|merge)\s*\([^,]+,\s*(?:req\.|body\.|input\.)/.test(line)) {
            findings.push({ severity, category: 'prototype_pollution_merge', file: path, line: i + 1, message: 'Object.assign/merge with user-controlled input — prototype pollution vulnerability.', suggestion: "Sanitize user input: filter out '__proto__', 'constructor', 'prototype' keys before merging." });
          }
        }
      }
      return findings;
    },
  },

  // ── CORS Hardening Rules ───────────────────────────────────────────────────

  {
    id: 'SEC_038',
    category: 'cors_reflected_origin',
    severity: 'BLOCKER',
    description: 'CORS origin reflected from request header without allowlist — any origin can make credentialed cross-origin requests.',
    tags: ['security', 'cors', 'ai-risk', 'vibe-coding'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Setting Access-Control-Allow-Origin to the request\'s Origin header without validation means any website can make credentialed requests to your API, bypassing the same-origin policy entirely. AI tools generate this pattern when trying to make CORS "just work".',
      commonViolations: [
        'res.setHeader("Access-Control-Allow-Origin", req.headers.origin)',
        'response.headers.set("Access-Control-Allow-Origin", request.headers.get("origin"))',
      ],
      goodExample: 'const ALLOWED = new Set(["https://app.example.com"]);\nconst origin = req.headers.origin;\nif (ALLOWED.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);',
      badExample: 'res.setHeader("Access-Control-Allow-Origin", req.headers.origin);  // ❌ any origin allowed',
      relatedPlaybooks: ['cors-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_reflected_origin', config.severityRules);
      const findings: Finding[] = [];
      const REFLECT_RE = /Access-Control-Allow-Origin['"]\s*,\s*(?:req|request)\s*\.\s*headers\s*(?:\[['"]origin['"]\]|\.get\s*\(\s*['"]origin['"]\)|\.origin)/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (REFLECT_RE.test(lines[i]!)) {
            findings.push({ severity, category: 'cors_reflected_origin', file: path, line: i + 1, message: 'CORS origin reflected from request header — any origin can make credentialed requests.', suggestion: 'Validate origin against an allowlist: if (ALLOWED_ORIGINS.has(origin)) res.setHeader(...)' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_039',
    category: 'cors_wildcard_with_credentials',
    severity: 'BLOCKER',
    description: 'CORS allows wildcard origin (*) combined with credentials:true — credentials are never sent with wildcard but this signals a misconfiguration.',
    tags: ['security', 'cors'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Access-Control-Allow-Origin: * combined with Access-Control-Allow-Credentials: true is rejected by browsers, but the intent is dangerous. It signals the developer wants any origin to send credentialed requests — which means they will next change * to reflected origin, creating a BLOCKER vulnerability.',
      commonViolations: [
        'cors({ origin: "*", credentials: true })',
        'Access-Control-Allow-Origin: * + Access-Control-Allow-Credentials: true in headers',
      ],
      goodExample: 'cors({ origin: ["https://app.example.com"], credentials: true })',
      badExample: 'cors({ origin: "*", credentials: true });  // ❌ nonsensical + dangerous intent',
      relatedPlaybooks: ['cors-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_wildcard_with_credentials', config.severityRules);
      const findings: Finding[] = [];
      const WILDCARD_CRED_RE = /cors\s*\(\s*\{[^}]*origin\s*:\s*['"][*]['"][^}]*credentials\s*:\s*true/is;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (WILDCARD_CRED_RE.test(content)) {
          findings.push({ severity, category: 'cors_wildcard_with_credentials', file: path, message: 'Wildcard CORS origin with credentials:true — misconfiguration that signals intent to allow any origin.', suggestion: 'Specify an explicit origin allowlist instead of wildcard.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_040',
    category: 'cors_regex_allowlist',
    severity: 'HIGH',
    description: 'CORS allowlist uses regex pattern matching instead of exact string comparison — regex bypass risk.',
    tags: ['security', 'cors'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Regex-based CORS origin matching is fragile. For example, /example.com/.test(origin) passes for "evil-example.com". Even anchored patterns require care. Exact string matching with a Set is the only safe approach.',
      commonViolations: [
        'origin: /example\\.com$/.test(req.headers.origin)',
        'if (req.headers.origin.includes("example.com"))',
      ],
      goodExample: 'const ALLOWED = new Set(["https://app.example.com", "https://staging.example.com"]);\nif (ALLOWED.has(origin)) { ... }',
      badExample: 'if (/example\\.com/.test(origin)) { ... }  // ❌ "evilexample.com" passes',
      relatedPlaybooks: ['cors-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_regex_allowlist', config.severityRules);
      const findings: Finding[] = [];
      const CORS_REGEX_RE = /(?:origin|Access-Control)[^;{]*\/[^/]+\/\.test\s*\(|origin\.includes\s*\(/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (CORS_REGEX_RE.test(lines[i]!)) {
            findings.push({ severity, category: 'cors_regex_allowlist', file: path, line: i + 1, message: 'CORS origin checked with regex or includes() — use Set.has() for exact matching.', suggestion: 'const ALLOWED = new Set([...]); if (ALLOWED.has(origin)) { ... }' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_041',
    category: 'cors_null_origin',
    severity: 'HIGH',
    description: 'CORS allowlist includes "null" origin — allows requests from file:// and sandboxed iframes.',
    tags: ['security', 'cors'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Browsers send Origin: null for file:// requests, data: URIs, and sandboxed iframes. Including "null" in the allowlist allows attackers to make credentialed requests from a sandboxed iframe served from an attacker-controlled domain.',
      commonViolations: [
        'origin: ["https://app.example.com", "null"]',
        'if (origin === "null" || ALLOWED.has(origin))',
      ],
      goodExample: 'const ALLOWED = new Set(["https://app.example.com"]);  // no "null"',
      badExample: 'const ALLOWED = new Set(["https://app.example.com", "null"]);  // ❌ null origin bypass',
      relatedPlaybooks: ['cors-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_null_origin', config.severityRules);
      const findings: Finding[] = [];
      const NULL_ORIGIN_RE = /origin\s*(?:===|!==|==)\s*['"]null['"]|['"]null['"]\s*(?:===|!==|==)\s*origin|allowedOrigins.*['"]null['"]|origin:\s*\[[^\]]*['"]null['"]/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (NULL_ORIGIN_RE.test(lines[i]!)) {
            findings.push({ severity, category: 'cors_null_origin', file: path, line: i + 1, message: '"null" origin in CORS allowlist — allows requests from sandboxed iframes and file:// URIs.', suggestion: 'Remove "null" from your CORS allowlist.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_042',
    category: 'cors_in_route_handler',
    severity: 'HIGH',
    description: 'CORS headers set inside individual route handlers instead of global middleware — inconsistent coverage.',
    tags: ['security', 'cors'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'When CORS is set per route handler, newly added routes silently have no CORS protection. All routes should receive CORS headers consistently via global middleware. Scattering CORS logic across handlers creates security gaps.',
      commonViolations: [
        'export async function GET(req) { res.setHeader("Access-Control-Allow-Origin", "..."); ... }',
        'CORS headers added in only some handlers but not all',
      ],
      goodExample: '// middleware.ts or next.config.js headers() — global, covers all routes',
      badExample: 'export async function GET(req) { res.setHeader("Access-Control-Allow-Origin", "..."); }  // ❌ per-handler',
      relatedPlaybooks: ['cors-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_in_route_handler', config.severityRules);
      const findings: Finding[] = [];
      const HANDLER_RE = /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH|OPTIONS)\s*\(/;
      const CORS_IN_HANDLER_RE = /Access-Control-Allow-Origin/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!HANDLER_RE.test(content)) continue;
        if (CORS_IN_HANDLER_RE.test(content)) {
          findings.push({ severity, category: 'cors_in_route_handler', file: path, message: 'CORS headers set inside route handler — move to global middleware for consistent coverage.', suggestion: 'Use global middleware (middleware.ts or next.config headers()) to set CORS headers for all routes.' });
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_043',
    category: 'cors_long_preflight_cache',
    severity: 'MEDIUM',
    description: 'CORS preflight max-age exceeds 1 week — permission changes take days to propagate.',
    tags: ['security', 'cors'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'A long CORS preflight cache means browsers won\'t re-check permissions for up to max-age seconds. If you need to revoke a permission (e.g., remove an allowed origin), it takes the full cache duration to take effect for clients that already cached the preflight.',
      commonViolations: [
        'Access-Control-Max-Age: 86400000  // 1000 days',
        'cors({ maxAge: 31536000 })  // 1 year',
      ],
      goodExample: 'cors({ maxAge: 86400 })  // 1 day maximum',
      badExample: 'cors({ maxAge: 31536000 })  // ❌ 1 year — revocation takes a year to propagate',
      relatedPlaybooks: ['cors-security.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('cors_long_preflight_cache', config.severityRules);
      const findings: Finding[] = [];
      const MAX_AGE_RE = /(?:maxAge|Max-Age)\s*[=:]\s*(\d+)/i;
      const ONE_WEEK = 604800;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path) && !path.endsWith('.json')) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const m = MAX_AGE_RE.exec(lines[i]!);
          if (m && parseInt(m[1]!, 10) > ONE_WEEK) {
            findings.push({ severity, category: 'cors_long_preflight_cache', file: path, line: i + 1, message: `CORS preflight max-age ${m[1]} exceeds 1 week — permission revocation delayed.`, suggestion: 'Set maxAge to 86400 (1 day) or less.' });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_044',
    category: 'ssrf_private_ip_range',
    severity: 'BLOCKER',
    description: 'HTTP request to a URL that may resolve to a private IP range — SSRF to internal services.',
    tags: ['security', 'ssrf'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'SSRF to private IP ranges (10.x, 172.16.x, 192.168.x, 169.254.x) reaches internal services, cloud metadata endpoints (AWS IMDSv1 at 169.254.169.254), and Kubernetes cluster services. Most SSRF validators check the URL string but not the resolved IP.',
      commonViolations: [
        'fetch(userUrl) where userUrl could point to 169.254.169.254/latest/meta-data',
        'HTTP proxy that forwards to URL without blocking private ranges',
      ],
      goodExample: 'const parsed = new URL(userUrl);\nconst ip = await dns.resolve4(parsed.hostname);\nif (isPrivateIP(ip)) throw new Error("SSRF: private IP blocked");\nawait fetch(userUrl);',
      badExample: 'const res = await fetch(req.body.url);  // ❌ no IP range check',
      relatedPlaybooks: ['ssrf-prevention.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('ssrf_private_ip_range', config.severityRules);
      const findings: Finding[] = [];
      const SSRF_RE = /(?:fetch|axios\.get|axios\.post|got|request)\s*\(\s*(?:url|href|endpoint|target|src|redirect|body\.|params\.|req\.|input\.)/i;
      const IP_CHECK_RE = /isPrivateIP|isPrivate|privateRange|169\.254|10\.\d|192\.168|172\.1[6-9]\.|172\.2\d\.|172\.3[01]\./i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        if (!SSRF_RE.test(content)) continue;
        if (!IP_CHECK_RE.test(content)) {
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (SSRF_RE.test(lines[i]!)) {
              findings.push({ severity, category: 'ssrf_private_ip_range', file: path, line: i + 1, message: 'HTTP request with user-controlled URL and no private IP range check — SSRF to internal services.', suggestion: 'Resolve the hostname and block requests to private IP ranges (10.x, 192.168.x, 169.254.x).' });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'SEC_045',
    category: 'path_traversal_encoding_bypass',
    severity: 'BLOCKER',
    description: 'Path validation uses string comparison without URL-decoding first — encoding bypass (..%2F..%2F).',
    tags: ['security', 'path-traversal'],
    sinceVersion: '2.1.0',
    explain: {
      why: 'Path traversal validators that check for "../" can be bypassed with URL-encoded variants: ..%2F, ..%5C, ..%2f%2f, or double-encoded ..%252F. Always decode the path before validation and use path.resolve() + startsWith() as the definitive check.',
      commonViolations: [
        'if (filePath.includes("../")) throw error;  // bypassed with ..%2F',
        'path.join(basePath, userInput)  // without validating the result stays within basePath',
      ],
      goodExample: 'const decoded = decodeURIComponent(userInput);\nconst resolved = path.resolve(BASE_DIR, decoded);\nif (!resolved.startsWith(BASE_DIR + path.sep)) throw new Error("Path traversal denied");',
      badExample: 'if (filePath.includes("../")) throw error;  // ❌ bypassed with ..%2F',
      relatedPlaybooks: ['path-traversal.md'],
      relatedAgents: ['security-reviewer'],
    },
    detect({ config, changedFiles = [] }: DetectInput): Finding[] {
      const severity = classifySeverity('path_traversal_encoding_bypass', config.severityRules);
      const findings: Finding[] = [];
      const STRING_PATH_CHECK_RE = /(?:filePath|userPath|inputPath|reqPath|path)\s*\.\s*includes\s*\(\s*['"](?:\.\.|\.\.\/|\.\.\\)['"]\s*\)/i;
      const DECODE_RE = /decodeURIComponent|decodeURI|path\.resolve|path\.normalize/i;
      for (const { path, content } of changedFiles) {
        if (!SOURCE_EXT.test(path)) continue;
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!STRING_PATH_CHECK_RE.test(lines[i]!)) continue;
          const ctx = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
          if (!DECODE_RE.test(ctx)) {
            findings.push({ severity, category: 'path_traversal_encoding_bypass', file: path, line: i + 1, message: 'Path traversal check using string match without URL-decode — bypassed by %2F encoding.', suggestion: 'Decode first, then use path.resolve() + startsWith(): const resolved = path.resolve(BASE, decodeURIComponent(input));' });
          }
        }
      }
      return findings;
    },
  },
];
