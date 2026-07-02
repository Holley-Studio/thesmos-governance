// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * DAST-lite rules (DAST_001–010).
 *
 * Server-side web vulnerabilities detectable statically. These complement
 * vibe-coding.ts (which targets AI-generated patterns) — these rules are
 * framework-agnostic and fire on any Express/Hono/Fastify/Next.js server code.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isServerFile(path: string): boolean {
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path)) return false;
  if (/\/__tests__\//.test(path)) return false;
  return (
    /\/(api|server|backend|routes?|controllers?|handlers?|middleware)\//i.test(path) ||
    /\.(server|api)\.(ts|js|tsx|jsx)$/.test(path) ||
    /\/route\.(ts|js|tsx|jsx)$/.test(path)
  );
}

function isTestPath(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path) || /\/__tests__\//.test(path);
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const DAST_RULES: ThesmosRule[] = [
  {
    id: 'DAST_001',
    category: 'dast_xml_entity_expansion',
    description: 'XML parser called without entity expansion protection — vulnerable to XXE and billion-laughs attacks.',
    severity: 'BLOCKER',
    tags: ['security', 'dast', 'xxe', 'xml'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'XML External Entity (XXE) attacks exploit XML parsers that expand entity references. An attacker can read arbitrary server-side files (/etc/passwd), trigger SSRF, or cause DoS via entity expansion (billion-laughs). Most XML parsers are vulnerable by default.',
      commonViolations: [
        'xml2js.parseString(userXml, callback)',
        'new XMLParser().parse(content)  // fast-xml-parser defaults',
      ],
      goodExample: 'const parser = new XMLParser({ allowBooleanAttributes: false });\n// For xml2js: use {explicitArray: false} and validate input schema',
      badExample: 'xml2js.parseString(req.body, (err, result) => { ... })  // XXE possible',
      relatedPlaybooks: ['xxe-prevention.md'],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_xml_entity_expansion', config.severityRules);
      const findings: Finding[] = [];
      // xml2js.parseString with user-controlled data (no explicit guard check pattern)
      const XML2JS_RE = /xml2js\s*\.\s*(?:parseString|parseStringPromise|Parser)\s*\(/;
      // fast-xml-parser without entity disable option visible on same/nearby line
      const FXP_RE = /new\s+XMLParser\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (XML2JS_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'dast_xml_entity_expansion',
              file: path,
              line: i + 1,
              message: 'xml2js parser called — verify that user-controlled XML input is sanitized (XXE risk).',
              suggestion: 'Reject external entity declarations before parsing. Use a JSON API if possible.',
            });
          } else if (FXP_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'dast_xml_entity_expansion',
              file: path,
              line: i + 1,
              message: 'XMLParser instantiated without explicit entity options — may expand external entities.',
              suggestion: 'Pass options: new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: false })',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_002',
    category: 'dast_cors_wildcard_with_auth',
    description: 'Access-Control-Allow-Origin: * set on a route that also performs authentication — CORS wildcard bypasses same-origin protection.',
    severity: 'HIGH',
    tags: ['security', 'dast', 'cors'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'CORS with `*` allows any origin to make credentialed cross-origin requests to your API. When combined with cookie-based or token-based authentication, it can enable cross-site attacks. Restrict the allowed origin to your specific frontend domain(s).',
      commonViolations: [
        'res.setHeader("Access-Control-Allow-Origin", "*") in an authenticated route',
        'app.use(cors()) // defaults to * with no authentication guard',
      ],
      goodExample: 'res.setHeader("Access-Control-Allow-Origin", "https://app.example.com");',
      badExample: 'res.setHeader("Access-Control-Allow-Origin", "*"); // in POST /api/user route',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_cors_wildcard_with_auth', config.severityRules);
      const findings: Finding[] = [];
      const CORS_WILDCARD_RE = /Access-Control-Allow-Origin['"]\s*,\s*['"][*]['"]|cors\(\s*\)/;
      const AUTH_RE = /bearer|authorization|cookie|session|getUser|currentUser|jwt|verifyToken|requireAuth/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path)) continue;
        if (!CORS_WILDCARD_RE.test(content)) continue;
        if (!AUTH_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (CORS_WILDCARD_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'dast_cors_wildcard_with_auth',
              file: path,
              line: i + 1,
              message: 'CORS wildcard (*) in a file with authentication code — may expose credentials cross-origin.',
              suggestion: 'Restrict to your specific origin: res.setHeader("Access-Control-Allow-Origin", "https://your-app.com")',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_003',
    category: 'dast_missing_helmet',
    description: 'Express/Fastify app without helmet() middleware — missing default security headers (CSP, HSTS, X-Frame-Options, etc.).',
    severity: 'MEDIUM',
    tags: ['security', 'dast', 'headers', 'express'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'helmet() sets ~14 HTTP security headers in one call: Content-Security-Policy, Strict-Transport-Security, X-Frame-Options, X-Content-Type-Options, and more. Omitting it leaves the application vulnerable to clickjacking, MIME sniffing, and reflected XSS.',
      commonViolations: [
        'const app = express(); // no helmet()',
        'app.use(bodyParser.json()); // other middleware but no helmet',
      ],
      goodExample: 'import helmet from "helmet";\napp.use(helmet());',
      badExample: 'const app = express();\napp.use(express.json());\n// no helmet',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_missing_helmet', config.severityRules);
      const findings: Finding[] = [];
      const EXPRESS_INIT_RE = /(?:express|fastify|Fastify)\s*\(\s*\)/;
      const HELMET_RE = /helmet\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        if (!EXPRESS_INIT_RE.test(content)) continue;
        if (HELMET_RE.test(content)) continue;
        // Only flag the app initialization line
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (EXPRESS_INIT_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'dast_missing_helmet',
              file: path,
              line: i + 1,
              message: 'Express/Fastify app initialized without helmet() — missing default security headers.',
              suggestion: 'Add: import helmet from "helmet"; app.use(helmet()); after app initialization.',
            });
            break; // one finding per file
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_004',
    category: 'dast_sensitive_param_in_get',
    description: 'Sensitive parameter name (password, token, secret, key, api_key) appears in a GET route path or query handler.',
    severity: 'HIGH',
    tags: ['security', 'dast', 'credentials', 'get-request'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'GET parameters are logged in access logs, browser history, and proxy servers. Sending passwords, tokens, or API keys as GET parameters means they are exposed in logs and history indefinitely.',
      commonViolations: [
        'router.get("/verify?token=", handler)',
        'req.query.password',
        'router.get("/reset/:token", handler)',
      ],
      goodExample: 'POST /api/verify with token in request body or Authorization header.',
      badExample: 'router.get("/verify", (req) => { const { token } = req.query; })',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_sensitive_param_in_get', config.severityRules);
      const findings: Finding[] = [];
      // GET routes with sensitive query param access
      const SENSITIVE_QUERY_RE = /req\.query\.(?:password|token|secret|api[_-]?key|apikey|auth|access[_-]?token)\b/i;
      // GET route handler definitions with sensitive path params
      const GET_SENSITIVE_PATH_RE = /(?:router|app)\.get\s*\(\s*['"][^'"]*\/:(?:token|secret|api[_-]?key|password)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (SENSITIVE_QUERY_RE.test(line) || GET_SENSITIVE_PATH_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'dast_sensitive_param_in_get',
              file: path,
              line: i + 1,
              message: 'Sensitive parameter (token/password/key) passed via GET — exposed in logs and browser history.',
              suggestion: 'Move sensitive parameters to the request body (POST) or Authorization header.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_005',
    category: 'dast_eval_user_input',
    description: 'User-controlled input passed to eval(), new Function(), or vm.runInContext() — remote code execution risk.',
    severity: 'BLOCKER',
    tags: ['security', 'dast', 'rce', 'eval'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Passing user-controlled data to `eval()`, `new Function()`, or Node.js `vm` APIs executes arbitrary JavaScript on the server. This is a critical remote code execution (RCE) vulnerability.',
      commonViolations: [
        'eval(req.body.expression)',
        'new Function("return " + userCode)()',
        'vm.runInNewContext(req.query.script)',
      ],
      goodExample: 'Use a sandboxed expression evaluator like mathjs for math expressions, or a JSON schema validator for structured data.',
      badExample: 'const result = eval(req.body.formula); // RCE',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_eval_user_input', config.severityRules);
      const findings: Finding[] = [];
      // eval/new Function/vm with req./body./query./params. in surrounding context
      const EVAL_RE = /\beval\s*\(|new\s+Function\s*\(|vm\s*\.\s*(?:runIn(?:New|This|)Context|Script)\s*\(/;
      const USER_INPUT_RE = /req\.|body\.|query\.|params\.|input\.|userInput/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        if (!USER_INPUT_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (EVAL_RE.test(line)) {
            // Check for user input in the same or adjacent lines (window of 5)
            const window = lines.slice(Math.max(0, i - 3), i + 3).join('\n');
            if (USER_INPUT_RE.test(window)) {
              findings.push({
                severity: sev,
                category: 'dast_eval_user_input',
                file: path,
                line: i + 1,
                message: 'eval()/new Function()/vm near user input — potential remote code execution.',
                suggestion: 'Never pass user-controlled data to eval or dynamic function creation. Use a safe expression parser.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_006',
    category: 'dast_no_xframe_options',
    description: 'Server file sets response headers but does not set X-Frame-Options — clickjacking protection missing.',
    severity: 'MEDIUM',
    tags: ['security', 'dast', 'headers', 'clickjacking'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Without X-Frame-Options or Content-Security-Policy frame-ancestors, your pages can be embedded in an attacker-controlled iframe. This enables clickjacking attacks where users are tricked into clicking UI elements they cannot see.',
      commonViolations: ['res.setHeader("Content-Type", ...) without X-Frame-Options'],
      goodExample: 'res.setHeader("X-Frame-Options", "DENY"); // or use helmet()',
      badExample: '// response handler with no X-Frame-Options header',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_no_xframe_options', config.severityRules);
      const findings: Finding[] = [];
      const SET_HEADER_RE = /res\s*\.\s*setHeader\s*\(|res\s*\.\s*header\s*\(|headers\s*\[/;
      const XFRAME_RE = /X-Frame-Options|frame-ancestors|helmet/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path)) continue;
        if (!SET_HEADER_RE.test(content)) continue;
        if (XFRAME_RE.test(content)) continue;
        findings.push({
          severity: sev,
          category: 'dast_no_xframe_options',
          file: path,
          message: 'Response headers set but no X-Frame-Options — clickjacking protection absent.',
          suggestion: 'Add res.setHeader("X-Frame-Options", "DENY") or use helmet() which sets it automatically.',
        });
      }
      return findings;
    },
  },

  {
    id: 'DAST_007',
    category: 'dast_method_override',
    description: 'X-HTTP-Method-Override or _method parameter processed without an authentication check nearby.',
    severity: 'MEDIUM',
    tags: ['security', 'dast', 'method-override'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Method override allows clients to spoof DELETE/PUT/PATCH requests via POST. Without authentication, attackers can use method override to call privileged endpoints that are otherwise not reachable from a browser.',
      commonViolations: [
        'app.use(methodOverride("X-HTTP-Method-Override"))',
        'const method = req.headers["x-http-method-override"]',
      ],
      goodExample: '// Only enable method override after authentication middleware:\napp.use(authenticate);\napp.use(methodOverride("X-HTTP-Method-Override"));',
      badExample: 'app.use(methodOverride("_method")); // before any auth check',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_method_override', config.severityRules);
      const findings: Finding[] = [];
      const METHOD_OVERRIDE_RE = /methodOverride\s*\(|x-http-method-override/i;
      const AUTH_RE = /authenticate|requireAuth|isAuthenticated|verifyToken|protect|getServerSession/i;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path)) continue;
        if (!METHOD_OVERRIDE_RE.test(content)) continue;
        if (AUTH_RE.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (METHOD_OVERRIDE_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'dast_method_override',
              file: path,
              line: i + 1,
              message: 'Method override processed without visible authentication — may allow spoofed HTTP verbs.',
              suggestion: 'Ensure authentication middleware runs before methodOverride().',
            });
            break;
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_008',
    category: 'dast_template_injection',
    description: 'Template engine render called with user-controlled template string — Server-Side Template Injection (SSTI) risk.',
    severity: 'BLOCKER',
    tags: ['security', 'dast', 'ssti', 'template-injection'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'Server-Side Template Injection (SSTI) occurs when user-controlled data is used as a template string (not just as template data). Attackers can craft payloads that execute arbitrary code on the server.',
      commonViolations: [
        'ejs.render(req.body.template, data)',
        'Handlebars.compile(userTemplate)(data)',
        'pug.render(req.query.template)',
      ],
      goodExample: 'ejs.render(FIXED_TEMPLATE_STRING, { username: req.body.username })',
      badExample: 'const html = ejs.render(req.body.template, userData); // SSTI',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_template_injection', config.severityRules);
      const findings: Finding[] = [];
      // Template engine calls where the first argument looks user-controlled
      const TEMPLATE_ENGINE_RE = /(?:ejs|pug|handlebars|Handlebars|nunjucks|mustache|Mustache|dot|swig)\s*\.\s*(?:render|compile|renderString)\s*\(\s*(?:req\.|body\.|query\.|params\.|userInput|template)/i;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (TEMPLATE_ENGINE_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'dast_template_injection',
              file: path,
              line: i + 1,
              message: 'Template engine render() called with potentially user-controlled template — SSTI risk.',
              suggestion: 'Pass user data as template variables, not as the template itself. Use fixed template strings.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_009',
    category: 'dast_prototype_pollution_express',
    description: 'Express body-parser configured with extended: true — enables prototype pollution via qs library.',
    severity: 'HIGH',
    tags: ['security', 'dast', 'prototype-pollution', 'express'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'express.urlencoded({ extended: true }) uses the `qs` library for parsing, which allows deeply nested objects like `?__proto__[admin]=true`. This can pollute Object.prototype and bypass authorization checks that depend on property existence.',
      commonViolations: ['app.use(express.urlencoded({ extended: true }))'],
      goodExample: 'app.use(express.urlencoded({ extended: false })) // uses querystring, no prototype risk',
      badExample: 'app.use(express.urlencoded({ extended: true })) // qs parser — prototype pollution possible',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_prototype_pollution_express', config.severityRules);
      const findings: Finding[] = [];
      const EXTENDED_TRUE_RE = /express\s*\.\s*urlencoded\s*\(\s*\{[^}]*extended\s*:\s*true/;
      for (const { path, content } of changedFiles) {
        if (isTestPath(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (EXTENDED_TRUE_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'dast_prototype_pollution_express',
              file: path,
              line: i + 1,
              message: 'express.urlencoded({ extended: true }) enables qs-based prototype pollution.',
              suggestion: 'Use { extended: false } to use the querystring module, which does not allow nested objects.',
            });
          }
        }
      }
      return findings;
    },
  },

  {
    id: 'DAST_010',
    category: 'dast_http_response_splitting',
    description: 'User input used directly in a response header value — HTTP response splitting / header injection risk.',
    severity: 'HIGH',
    tags: ['security', 'dast', 'response-splitting', 'header-injection'],
    sinceVersion: '2.3.0',
    explain: {
      why: 'If user input containing newline characters (\\r\\n) is placed in a response header, an attacker can inject additional HTTP headers or even split the response into two. This can enable cache poisoning, XSS, or CSRF.',
      commonViolations: [
        'res.setHeader("Location", req.query.redirect)',
        'res.setHeader("Set-Cookie", "session=" + req.body.value)',
      ],
      goodExample: 'Validate and sanitize any user-provided header value, or use a library that handles this automatically.',
      badExample: 'res.setHeader("Location", req.query.next); // may contain \\r\\n',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('dast_http_response_splitting', config.severityRules);
      const findings: Finding[] = [];
      // setHeader with a user-controlled value as second argument
      const HEADER_USER_RE = /res\s*\.\s*setHeader\s*\(\s*['"][^'"]+['"]\s*,\s*(?:req\.|body\.|query\.|params\.)/;
      for (const { path, content } of changedFiles) {
        if (!isServerFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (HEADER_USER_RE.test(lines[i]!)) {
            findings.push({
              severity: sev,
              category: 'dast_http_response_splitting',
              file: path,
              line: i + 1,
              message: 'Response header value sourced from user input — HTTP response splitting risk.',
              suggestion: 'Sanitize header values to remove \\r and \\n characters, or use encodeURIComponent() for Location headers.',
            });
          }
        }
      }
      return findings;
    },
  },
];
