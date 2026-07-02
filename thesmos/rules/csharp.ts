// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import type { ThesmosRule, Finding, DetectInput } from '../types.js';
import { classifySeverity } from '../severity.js';

const isCsFile = (p: string) => /\.cs$/.test(p);
const isCsTest = (p: string) => /Test\.cs$|\.Tests?\/|_test\.cs$/i.test(p);
const isConfigFile = (p: string) => /appsettings(?:\.\w+)?\.json$|web\.config$/.test(p);
const isRazorFile = (p: string) => /\.cshtml$|\.razor$/.test(p);

export const CSHARP_RULES: ThesmosRule[] = [
  // ── CS_001: SQL injection via string interpolation/concatenation ──────────
  {
    id: 'CS_001',
    category: 'csharp_sql_injection',
    description: 'SQL built by string interpolation or concatenation passed to a database method — SQL injection.',
    severity: 'BLOCKER',
    tags: ['security', 'csharp', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Building SQL strings with interpolation or concatenation allows attackers to inject arbitrary SQL. AI-generated C# frequently uses $"SELECT ... WHERE id = {userId}" for brevity without understanding the injection risk.',
      commonViolations: [
        'cmd.CommandText = $"SELECT * FROM Users WHERE Id = {userId}";',
        'cmd.ExecuteReader("SELECT * FROM Users WHERE Name = \'" + name + "\'");',
      ],
      goodExample: 'cmd.CommandText = "SELECT * FROM Users WHERE Id = @id";\ncmd.Parameters.AddWithValue("@id", userId);',
      badExample: 'cmd.CommandText = $"SELECT * FROM Users WHERE Id = {userId}"; // SQL injection',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      const INTERP_RE = /(?:ExecuteNonQuery|ExecuteScalar|ExecuteReader|FromSqlRaw|FromSqlInterpolated)\s*\(\s*\$["']/;
      // Simpler concat check: any + followed by a variable inside the call args
      const CONCAT_RE = /(?:ExecuteNonQuery|ExecuteScalar|ExecuteReader)\s*\([^)]*\+\s*[a-zA-Z_]/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (INTERP_RE.test(line) || CONCAT_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_sql_injection',
              file: path,
              line: i + 1,
              message: 'SQL built by string interpolation or concatenation — SQL injection vulnerability.',
              suggestion: 'Use SqlParameter or named placeholders: cmd.Parameters.AddWithValue("@id", userId);',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_002: EF Core FromSqlRaw with interpolated string ──────────────────
  {
    id: 'CS_002',
    category: 'csharp_ef_raw_sql_interpolation',
    description: 'EF Core FromSqlRaw() called with an interpolated string $"..." — defeats parameterization.',
    severity: 'BLOCKER',
    tags: ['security', 'csharp', 'ef-core', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'FromSqlRaw($"...") does NOT parameterize — it treats the interpolated string as raw SQL, creating SQL injection. Use FromSqlInterpolated($"...") which does parameterize C# interpolations.',
      commonViolations: [
        'context.Users.FromSqlRaw($"SELECT * FROM Users WHERE Id = {userId}");',
      ],
      goodExample: 'context.Users.FromSqlInterpolated($"SELECT * FROM Users WHERE Id = {userId}");',
      badExample: 'context.Users.FromSqlRaw($"SELECT * FROM Users WHERE Id = {userId}"); // SQL injection',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_ef_raw_sql_interpolation', config.severityRules);
      const findings: Finding[] = [];
      const RAW_INTERP_RE = /FromSqlRaw\s*\(\s*\$["']/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (RAW_INTERP_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_ef_raw_sql_interpolation',
              file: path,
              line: i + 1,
              message: 'FromSqlRaw() with interpolated string is not parameterized — SQL injection risk.',
              suggestion: 'Use FromSqlInterpolated($"...") instead of FromSqlRaw($"...") to get parameterization.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_003: Missing [Authorize] on controller action ─────────────────────
  {
    id: 'CS_003',
    category: 'csharp_missing_authorize',
    description: 'ASP.NET Core controller action with [Http*] attribute but no [Authorize] or [AllowAnonymous] nearby.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'aspnet', 'auth', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Controller actions without [Authorize] are publicly accessible. AI-generated APIs frequently omit authorization attributes, leaving CRUD endpoints open to unauthenticated callers.',
      commonViolations: [
        '[HttpPost]\npublic IActionResult Create(UserDto dto) { ... }',
      ],
      goodExample: '[Authorize]\n[HttpPost]\npublic IActionResult Create(UserDto dto) { ... }',
      badExample: '[HttpPost]\npublic IActionResult Create(UserDto dto) { ... } // no auth',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_missing_authorize', config.severityRules);
      const findings: Finding[] = [];
      const HTTP_ATTR_RE = /\[Http(?:Get|Post|Put|Delete|Patch)\]|\[Route\b/;
      const AUTH_RE = /\[Authorize\]|\[AllowAnonymous\]/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        if (!/[Cc]ontrollers?\//.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!HTTP_ATTR_RE.test(line)) continue;
          const start = Math.max(0, i - WINDOW);
          const windowLines = lines.slice(start, i + 1).join('\n');
          if (!AUTH_RE.test(windowLines)) {
            findings.push({
              severity: sev,
              category: 'csharp_missing_authorize',
              file: path,
              line: i + 1,
              message: 'Controller action has [Http*] but no [Authorize] or [AllowAnonymous] — unauthenticated access possible.',
              suggestion: 'Add [Authorize] above the action or on the controller class. Use [AllowAnonymous] to explicitly opt out.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_004: Missing anti-forgery token in Razor form ─────────────────────
  {
    id: 'CS_004',
    category: 'csharp_missing_antiforgery',
    description: 'Razor form with POST method missing @Html.AntiForgeryToken() or asp-antiforgery.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'csrf', 'razor', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Forms without CSRF tokens are vulnerable to cross-site request forgery. AI-generated Razor views frequently omit anti-forgery directives.',
      commonViolations: [
        '<form method="post">\n  <input name="email">\n</form>',
      ],
      goodExample: '<form method="post" asp-antiforgery="true">\n  <input name="email">\n</form>',
      badExample: '<form method="post">\n  <input name="email">\n</form> // missing CSRF token',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_missing_antiforgery', config.severityRules);
      const findings: Finding[] = [];
      const FORM_RE = /<form\b[^>]*method\s*=\s*["']post["']/i;
      const ANTIFORGERY_RE = /AntiForgeryToken|asp-antiforgery|__RequestVerificationToken/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isRazorFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FORM_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          const windowLines = lines.slice(i, end).join('\n');
          if (!ANTIFORGERY_RE.test(windowLines)) {
            findings.push({
              severity: sev,
              category: 'csharp_missing_antiforgery',
              file: path,
              line: i + 1,
              message: 'Razor POST form missing anti-forgery token — CSRF vulnerability.',
              suggestion: 'Add asp-antiforgery="true" to the form tag or @Html.AntiForgeryToken() inside the form.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_005: Hardcoded connection string with credentials ──────────────────
  {
    id: 'CS_005',
    category: 'csharp_hardcoded_connection_string',
    description: 'Connection string with credentials hardcoded in C# source.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'secrets', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Hardcoded connection strings with passwords end up in version control and build artifacts. Use IConfiguration and environment variables instead.',
      commonViolations: [
        'string conn = "Server=db;Database=app;User ID=sa;Password=secret123";',
      ],
      goodExample: 'string conn = _configuration.GetConnectionString("DefaultConnection");',
      badExample: 'string conn = "Server=db;Database=app;User ID=sa;Password=secret123"; // hardcoded',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_hardcoded_connection_string', config.severityRules);
      const findings: Finding[] = [];
      const CONN_RE = /(?:connectionString|ConnectionString|connStr)\s*=\s*["'][^"']*(?:Password|Pwd|User ID|uid)\s*=[^"']{4,}["']/i;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (CONN_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_hardcoded_connection_string',
              file: path,
              line: i + 1,
              message: 'Connection string with credentials hardcoded in source — use IConfiguration instead.',
              suggestion: 'Use _configuration.GetConnectionString() and store credentials in appsettings.json or environment variables.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_006: Hardcoded secrets in appsettings.json ─────────────────────────
  {
    id: 'CS_006',
    category: 'csharp_hardcoded_secret_in_config',
    description: 'appsettings.json contains a hardcoded API key, password, or secret.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'secrets', 'config', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Secrets committed to appsettings.json end up in version control. Use environment variables or Azure Key Vault for sensitive values.',
      commonViolations: [
        '{ "ApiKey": "sk_live_abc123" }',
        '{ "Password": "supersecret" }',
      ],
      goodExample: '{ "ApiKey": "" }  // load from environment variable at runtime',
      badExample: '{ "ApiKey": "sk_live_abc123" } // hardcoded secret',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_hardcoded_secret_in_config', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_RE = /"(?:ApiKey|SecretKey|Password|ConnectionString|Token)"\s*:\s*"([^"]{6,})"/i;
      const PLACEHOLDER_RE = /your[-_]?key|change[-_]?me|placeholder|\*{3,}|<[^>]+>/i;
      for (const { path, content } of changedFiles) {
        if (!isConfigFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const m = SECRET_RE.exec(line);
          if (m && !PLACEHOLDER_RE.test(m[1]!)) {
            findings.push({
              severity: sev,
              category: 'csharp_hardcoded_secret_in_config',
              file: path,
              line: i + 1,
              message: 'Hardcoded secret in appsettings.json — use environment variables or Azure Key Vault.',
              suggestion: 'Replace the value with an empty string and load from environment at runtime via IConfiguration.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_007: TypeNameHandling All/Objects/Auto ─────────────────────────────
  {
    id: 'CS_007',
    category: 'csharp_type_name_handling',
    description: 'JsonSerializerSettings with TypeNameHandling set to All, Objects, or Auto — RCE via deserialization.',
    severity: 'BLOCKER',
    tags: ['security', 'csharp', 'deserialization', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'TypeNameHandling.All/Objects/Auto allows attackers to specify .NET types in JSON, leading to arbitrary object construction and remote code execution via gadget chains.',
      commonViolations: [
        'new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All }',
      ],
      goodExample: 'new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.None }',
      badExample: 'new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All } // RCE risk',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_type_name_handling', config.severityRules);
      const findings: Finding[] = [];
      const TNH_RE = /TypeNameHandling\s*=\s*TypeNameHandling\.(?:All|Objects|Auto)/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (TNH_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_type_name_handling',
              file: path,
              line: i + 1,
              message: 'TypeNameHandling.All/Objects/Auto enables RCE via JSON deserialization gadget chains.',
              suggestion: 'Use TypeNameHandling.None (the default) or a custom type discriminator.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_008: XmlDocument/XmlReader without XXE protection ─────────────────
  {
    id: 'CS_008',
    category: 'csharp_xml_external_entity',
    description: 'XmlDocument or XmlReader created without disabling external entity processing — XXE vulnerability.',
    severity: 'BLOCKER',
    tags: ['security', 'csharp', 'xxe', 'xml', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Without explicitly disabling DTD processing, XmlDocument and XmlReader will fetch external entities, enabling XXE attacks that can read local files or perform SSRF.',
      commonViolations: [
        'var doc = new XmlDocument();\ndoc.LoadXml(input);',
      ],
      goodExample: 'var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };\nvar reader = XmlReader.Create(stream, settings);',
      badExample: 'var doc = new XmlDocument();\ndoc.LoadXml(userInput); // XXE risk',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_xml_external_entity', config.severityRules);
      const findings: Finding[] = [];
      const XML_CREATE_RE = /new XmlDocument\s*\(\s*\)|XmlReader\.Create\s*\(/;
      const SAFE_RE = /DtdProcessing\s*=\s*DtdProcessing\.Prohibit|XmlResolver\s*=\s*null|ProhibitDtd\s*=\s*true/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (!XML_CREATE_RE.test(line)) continue;
          // Look backwards too — settings are often defined before the Create call
          const start = Math.max(0, i - WINDOW);
          const end = Math.min(lines.length, i + WINDOW + 1);
          const windowLines = lines.slice(start, end).join('\n');
          if (!SAFE_RE.test(windowLines)) {
            findings.push({
              severity: sev,
              category: 'csharp_xml_external_entity',
              file: path,
              line: i + 1,
              message: 'XmlDocument/XmlReader without XXE protection — external entity injection risk.',
              suggestion: 'Set DtdProcessing = DtdProcessing.Prohibit and XmlResolver = null in XmlReaderSettings.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_009: UseDeveloperExceptionPage without IsDevelopment guard ─────────
  {
    id: 'CS_009',
    category: 'csharp_debug_in_production',
    description: 'app.UseDeveloperExceptionPage() called without an IsDevelopment() guard — leaks stack traces.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'aspnet', 'config', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'UseDeveloperExceptionPage() outputs full stack traces, source code snippets, and environment variables in HTTP responses. Without an environment check it runs in production.',
      commonViolations: [
        'app.UseDeveloperExceptionPage();',
      ],
      goodExample: 'if (env.IsDevelopment()) {\n  app.UseDeveloperExceptionPage();\n}',
      badExample: 'app.UseDeveloperExceptionPage(); // runs in production, leaks internals',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_debug_in_production', config.severityRules);
      const findings: Finding[] = [];
      const DEV_PAGE_RE = /app\.UseDeveloperExceptionPage\s*\(\s*\)/;
      const IS_DEV_RE = /IsDevelopment|isDevelopment/;
      const WINDOW = 3;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!DEV_PAGE_RE.test(line)) continue;
          const start = Math.max(0, i - WINDOW);
          const windowLines = lines.slice(start, i + 1).join('\n');
          if (!IS_DEV_RE.test(windowLines)) {
            findings.push({
              severity: sev,
              category: 'csharp_debug_in_production',
              file: path,
              line: i + 1,
              message: 'UseDeveloperExceptionPage() without IsDevelopment() guard — leaks stack traces in production.',
              suggestion: 'Wrap with if (env.IsDevelopment()) { app.UseDeveloperExceptionPage(); }',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_010: Open redirect via user-supplied URL ───────────────────────────
  {
    id: 'CS_010',
    category: 'csharp_open_redirect',
    description: 'Response.Redirect or Redirect() called with a user-supplied URL.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'redirect', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Open redirects allow phishing: attackers craft links to your trusted domain that redirect to malicious sites. ASP.NET auth flows often redirect to a returnUrl parameter without validating it.',
      commonViolations: [
        'Response.Redirect(Request.Query["returnUrl"]);',
        'return Redirect(returnUrl);',
      ],
      goodExample: 'if (Url.IsLocalUrl(returnUrl)) { return Redirect(returnUrl); }\nreturn RedirectToAction("Index", "Home");',
      badExample: 'Response.Redirect(Request.Query["returnUrl"]); // open redirect',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_open_redirect', config.severityRules);
      const findings: Finding[] = [];
      const REDIRECT_QUERY_RE = /(?:Response\.Redirect|Redirect)\s*\(\s*(?:Request\.Query|Request\.Form|Request\.Params)\b/;
      const REDIRECT_URL_RE = /(?:Response\.Redirect|return\s+Redirect)\s*\([^)]*\b(?:url|returnUrl|redirect|next)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (REDIRECT_QUERY_RE.test(line) || REDIRECT_URL_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_open_redirect',
              file: path,
              line: i + 1,
              message: 'Redirect destination from user input — open redirect vulnerability.',
              suggestion: 'Use Url.IsLocalUrl() to validate redirect URLs, or use a whitelist of allowed destinations.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_011: Path traversal via File.* with user input ────────────────────
  {
    id: 'CS_011',
    category: 'csharp_path_traversal',
    description: 'File.ReadAllText/Open/ReadAllBytes or Path.Combine used with user-supplied request input.',
    severity: 'BLOCKER',
    tags: ['security', 'csharp', 'path-traversal', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Passing user-controlled paths to file system APIs allows ../../../etc/passwd traversal attacks. Always validate and canonicalize paths against an allowed base directory.',
      commonViolations: [
        'var data = File.ReadAllText(Request.Query["file"]);',
        'var path = Path.Combine(basePath, Request.Form["name"]);',
      ],
      goodExample: 'var fullPath = Path.GetFullPath(Path.Combine(baseDir, fileName));\nif (!fullPath.StartsWith(baseDir)) throw new UnauthorizedAccessException();',
      badExample: 'var data = File.ReadAllText(Request.Query["file"]); // path traversal',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const FILE_RE = /(?:File\.ReadAllText|File\.Open|File\.ReadAllBytes|File\.WriteAllText)\s*\([^)]*(?:Request\.Query|Request\.Form|Request\.Params|HttpContext\.Request)\b/;
      const PATH_RE = /Path\.Combine\s*\([^)]*(?:Request\.Query|Request\.Form)\b/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (FILE_RE.test(line) || PATH_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_path_traversal',
              file: path,
              line: i + 1,
              message: 'File system API called with user-supplied path — path traversal vulnerability.',
              suggestion: 'Use Path.GetFullPath() and verify the result starts with the allowed base directory.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_012: Command injection via Process.Start ───────────────────────────
  {
    id: 'CS_012',
    category: 'csharp_command_injection',
    description: 'Process.Start or ProcessStartInfo used with user-controlled arguments.',
    severity: 'BLOCKER',
    tags: ['security', 'csharp', 'command-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Passing user input directly to Process.Start enables command injection via shell metacharacters (;, &&, |). AI assistants building shell-out features routinely omit input sanitization.',
      commonViolations: [
        'Process.Start("cmd.exe", Request.Query["args"]);',
        'new ProcessStartInfo("tool", "/c " + userInput)',
      ],
      goodExample: '// Use an allow-list for commands. Never pass user input directly as arguments.',
      badExample: 'Process.Start("cmd.exe", Request.Query["args"]); // command injection',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_command_injection', config.severityRules);
      const findings: Finding[] = [];
      const PROC_RE = /Process\.Start\s*\([^)]*(?:Request\.Query|Request\.Form|Request\.Params)\b/;
      const PSI_CONCAT_RE = /new ProcessStartInfo\s*\([^)]*\+/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (PROC_RE.test(line) || PSI_CONCAT_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_command_injection',
              file: path,
              line: i + 1,
              message: 'Process.Start with user-controlled input — command injection risk.',
              suggestion: 'Use an allow-list of valid commands. Never pass user input directly as process arguments.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_013: Insecure cookie (HttpOnly/Secure = false) ────────────────────
  {
    id: 'CS_013',
    category: 'csharp_insecure_cookie',
    description: 'Cookie created with HttpOnly or Secure explicitly set to false.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'cookie', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Cookies without HttpOnly can be stolen via XSS. Cookies without Secure are transmitted over plain HTTP. Both are required for session cookies in production.',
      commonViolations: [
        'new CookieOptions { HttpOnly = false, Secure = false }',
      ],
      goodExample: 'new CookieOptions { HttpOnly = true, Secure = true, SameSite = SameSiteMode.Strict }',
      badExample: 'new CookieOptions { HttpOnly = false } // cookie accessible to JavaScript',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_insecure_cookie', config.severityRules);
      const findings: Finding[] = [];
      const INSECURE_RE = /(?:HttpOnly|Secure)\s*=\s*false/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (INSECURE_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_insecure_cookie',
              file: path,
              line: i + 1,
              message: 'Cookie with HttpOnly or Secure explicitly set to false — cookie security flag disabled.',
              suggestion: 'Set HttpOnly = true and Secure = true for all session cookies.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_014: Weak hash algorithm (MD5/SHA1) ────────────────────────────────
  {
    id: 'CS_014',
    category: 'csharp_weak_hash_algorithm',
    description: 'MD5.Create() or SHA1.Create() used for hashing — not safe for passwords or integrity checks.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'crypto', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'MD5 and SHA-1 are cryptographically broken. They are trivially collision-prone and GPU-crackable. Use SHA-256 or better for checksums, and bcrypt/Argon2 for passwords.',
      commonViolations: [
        'var hash = MD5.Create();',
        'using var sha = SHA1.Create();',
      ],
      goodExample: 'using var sha = SHA256.Create();\n// For passwords: use BCrypt.Net.BCrypt.HashPassword()',
      badExample: 'var hash = MD5.Create(); // MD5 is cryptographically broken',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_weak_hash_algorithm', config.severityRules);
      const findings: Finding[] = [];
      const WEAK_HASH_RE = /(?:MD5|SHA1)\.Create\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (WEAK_HASH_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_weak_hash_algorithm',
              file: path,
              line: i + 1,
              message: 'MD5 or SHA1 used for hashing — these algorithms are cryptographically broken.',
              suggestion: 'Use SHA256.Create() for checksums or BCrypt/Rfc2898DeriveBytes for password hashing.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_015: CORS allowing all origins ────────────────────────────────────
  {
    id: 'CS_015',
    category: 'csharp_cors_allow_all',
    description: 'CORS policy allows all origins — exposes API to any website.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'cors', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'AllowAnyOrigin() lets any website make credentialed cross-origin requests to your API. AI assistants frequently generate open CORS policies to fix CORS errors during development.',
      commonViolations: [
        'policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();',
        'WithOrigins("*")',
      ],
      goodExample: 'policy.WithOrigins("https://myapp.com").AllowAnyMethod().AllowAnyHeader();',
      badExample: 'policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader(); // open CORS',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_cors_allow_all', config.severityRules);
      const findings: Finding[] = [];
      const CORS_RE = /\.AllowAnyOrigin\s*\(\s*\)|WithOrigins\s*\(\s*["']\*["']\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (CORS_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_cors_allow_all',
              file: path,
              line: i + 1,
              message: 'CORS policy allows all origins — restrict to specific trusted domains.',
              suggestion: 'Replace AllowAnyOrigin() with WithOrigins("https://yourdomain.com").',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_016: Logging sensitive data ───────────────────────────────────────
  {
    id: 'CS_016',
    category: 'csharp_string_format_logging_sensitive',
    description: 'Logger call includes password, secret, token, or API key — sensitive data in logs.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'logging', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Logging sensitive values like passwords, tokens, or API keys can expose credentials in log files, log aggregation services, or monitoring dashboards accessible to many people.',
      commonViolations: [
        '_logger.LogInformation($"User logged in with password: {password}");',
        'logger.LogDebug("Token: " + apiKey);',
      ],
      goodExample: '_logger.LogInformation("User {UserId} logged in", userId); // never log the password',
      badExample: '_logger.LogDebug($"Token: {token}"); // token exposed in logs',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_string_format_logging_sensitive', config.severityRules);
      const findings: Finding[] = [];
      const LOG_SENSITIVE_RE = /(?:_logger|logger|Logger|log)\s*\.(?:Log|LogInformation|LogDebug|LogWarning|LogError)\s*\([^)]*(?:password|secret|token|apiKey|api_key)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (LOG_SENSITIVE_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_string_format_logging_sensitive',
              file: path,
              line: i + 1,
              message: 'Logger call includes sensitive field name (password/secret/token/apiKey) — credential exposure risk.',
              suggestion: 'Never log sensitive values. Use structured logging with sanitized data and exclude credential fields.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_017: async void method ─────────────────────────────────────────────
  {
    id: 'CS_017',
    category: 'csharp_async_void',
    description: 'async void method — exceptions are swallowed and cannot be awaited.',
    severity: 'MEDIUM',
    tags: ['quality', 'csharp', 'async', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'async void methods throw exceptions on the synchronization context rather than the caller. They cannot be awaited, making error handling impossible and causing silent failures.',
      commonViolations: [
        'public async void LoadData() { await _repo.FetchAsync(); }',
      ],
      goodExample: 'public async Task LoadData() { await _repo.FetchAsync(); }',
      badExample: 'public async void LoadData() { ... } // exceptions are swallowed',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_async_void', config.severityRules);
      const findings: Finding[] = [];
      const ASYNC_VOID_RE = /\basync\s+void\s+\w+\s*\(/;
      const EVENT_RE = /_Click|_Changed|_Load|EventHandler/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (ASYNC_VOID_RE.test(line) && !EVENT_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_async_void',
              file: path,
              line: i + 1,
              message: 'async void method — exceptions will be swallowed. Use async Task instead.',
              suggestion: 'Change return type from void to Task so exceptions propagate and the method can be awaited.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_018: Empty catch block ─────────────────────────────────────────────
  {
    id: 'CS_018',
    category: 'csharp_exception_swallowed',
    description: 'Empty catch block silently swallows exceptions.',
    severity: 'HIGH',
    tags: ['quality', 'csharp', 'error-handling', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'An empty catch block discards exceptions without logging or rethrowing. This masks failures, making debugging impossible and hiding security-relevant errors.',
      commonViolations: [
        'catch (Exception) { }',
        'catch { }',
      ],
      goodExample: 'catch (Exception ex) { _logger.LogError(ex, "Operation failed"); throw; }',
      badExample: 'catch (Exception) { } // exception silently swallowed',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_exception_swallowed', config.severityRules);
      const findings: Finding[] = [];
      // Match catch blocks that close immediately: catch(...) { } or catch { }
      const EMPTY_CATCH_RE = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (EMPTY_CATCH_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_exception_swallowed',
              file: path,
              line: i + 1,
              message: 'Empty catch block silently swallows exceptions.',
              suggestion: 'Log the exception and/or rethrow it. At minimum: catch (Exception ex) { _logger.LogError(ex, "..."); throw; }',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_019: Hardcoded JWT secret key ─────────────────────────────────────
  {
    id: 'CS_019',
    category: 'csharp_hardcoded_jwt_secret',
    description: 'JWT signing key hardcoded as a string literal in SymmetricSecurityKey.',
    severity: 'BLOCKER',
    tags: ['security', 'csharp', 'jwt', 'secrets', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'A hardcoded JWT secret ends up in source control. Anyone with repo access can forge tokens. Load the secret from IConfiguration or environment variables.',
      commonViolations: [
        'new SymmetricSecurityKey(Encoding.UTF8.GetBytes("my_super_secret_key_123"))',
      ],
      goodExample: 'new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_configuration["Jwt:Secret"]!))',
      badExample: 'new SymmetricSecurityKey(Encoding.UTF8.GetBytes("hardcoded_secret")); // anyone can forge tokens',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_hardcoded_jwt_secret', config.severityRules);
      const findings: Finding[] = [];
      const JWT_HARDCODED_RE = /new SymmetricSecurityKey\s*\(\s*Encoding\.\w+\.GetBytes\s*\(\s*["'][^"']{8,}["']\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isCsFile(path) || isCsTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (JWT_HARDCODED_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_hardcoded_jwt_secret',
              file: path,
              line: i + 1,
              message: 'JWT signing key hardcoded in source — anyone with repo access can forge tokens.',
              suggestion: 'Load the secret from IConfiguration["Jwt:Secret"] or an environment variable.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── CS_020: Razor @Html.Raw with ViewBag/ViewData ─────────────────────────
  {
    id: 'CS_020',
    category: 'csharp_viewbag_xss',
    description: 'Razor view outputs ViewBag or ViewData via @Html.Raw() — unescaped XSS risk.',
    severity: 'HIGH',
    tags: ['security', 'csharp', 'xss', 'razor', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: '@Html.Raw() bypasses Razor auto-escaping. If ViewBag values contain user-controlled data, this is a stored/reflected XSS vulnerability.',
      commonViolations: [
        '@Html.Raw(ViewBag.UserName)',
        '@Html.Raw(ViewData["Description"])',
      ],
      goodExample: '@ViewBag.UserName  // Razor auto-escapes this',
      badExample: '@Html.Raw(ViewBag.UserName)  // XSS if user-controlled',
      relatedPlaybooks: [],
      relatedAgents: [],
      relatedSkills: [],
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('csharp_viewbag_xss', config.severityRules);
      const findings: Finding[] = [];
      const VIEWBAG_RAW_RE = /@Html\.Raw\s*\(\s*(?:ViewBag|ViewData)\b/;
      for (const { path, content } of changedFiles) {
        if (!isRazorFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (VIEWBAG_RAW_RE.test(line)) {
            findings.push({
              severity: sev,
              category: 'csharp_viewbag_xss',
              file: path,
              line: i + 1,
              message: '@Html.Raw(ViewBag/ViewData) bypasses Razor escaping — XSS if data is user-controlled.',
              suggestion: 'Use @ViewBag.Value instead of @Html.Raw(ViewBag.Value) — Razor auto-escapes the output.',
            });
          }
        }
      }
      return findings;
    },
  },
];
