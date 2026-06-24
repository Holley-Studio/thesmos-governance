/**
 * Java / Spring Boot Security Rules — JAVA_001–020
 *
 * Targets the predictable security failure modes of AI-generated Java code.
 * Covers SQL injection, XXE, deserialization, command injection, path traversal,
 * Spring auth gaps, CSRF bypass, hardcoded secrets, weak crypto, open redirect,
 * CORS wildcard, actuator exposure, log-sensitive, reflection injection, and
 * missing transaction guards.
 *
 * AI assistants writing Spring Boot code consistently concatenate SQL strings,
 * skip @PreAuthorize, leave CSRF disabled, and use new Random() for tokens.
 */

import type { ThesmosRule, DetectInput, Finding } from '../types.js';
import { classifySeverity } from '../severity.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const isJavaFile = (p: string) => /\.java$/.test(p);
const isJavaTest = (p: string) => /Test\.java$|\/test\//.test(p);
const isPropertiesFile = (p: string) => /\.properties$|\.yml$|\.yaml$/.test(p);

// ── Rules ──────────────────────────────────────────────────────────────────────

export const JAVA_RULES: ThesmosRule[] = [

  // ── JAVA_001: SQL injection via JDBC string concatenation ─────────────────
  {
    id: 'JAVA_001',
    category: 'java_sql_injection',
    description: 'JDBC executeQuery/execute with string concatenation — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Concatenating user-controlled variables directly into a JDBC query string allows attackers to inject arbitrary SQL. The safe alternative is PreparedStatement with ? placeholders which keep data separate from SQL structure at the protocol level.',
      commonViolations: [
        'stmt.executeQuery("SELECT * FROM users WHERE id = " + id)',
        'conn.execute("DELETE FROM sessions WHERE token = \'" + token + "\'")',
        'stmt.prepareStatement("SELECT * FROM orders WHERE user = " + userId)',
      ],
      goodExample: 'PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");\nps.setInt(1, id);\nResultSet rs = ps.executeQuery();',
      badExample: 'ResultSet rs = stmt.executeQuery("SELECT * FROM users WHERE id = " + id); // ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      const SQL_CONCAT_RE = /(?:executeQuery|executeUpdate|execute|prepareStatement)\s*\(\s*["'][^"']*["']\s*\+|\+\s*\w+\s*\+\s*["']/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (SQL_CONCAT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_sql_injection', file: path, line: i + 1,
              message: 'JDBC query built with string concatenation — SQL injection vulnerability.',
              suggestion: 'Use PreparedStatement with ? placeholders: conn.prepareStatement("SELECT * FROM users WHERE id = ?")',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_002: SQL injection via String.format() ───────────────────────────
  {
    id: 'JAVA_002',
    category: 'java_sql_interpolation',
    description: 'String.format() used to build a SQL query — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'String.format() interpolates values into a format string without any SQL escaping. Using it to build queries is functionally identical to string concatenation and exposes the same SQL injection vulnerability.',
      commonViolations: [
        'stmt.executeQuery(String.format("SELECT * FROM users WHERE id = %s", id))',
        'conn.execute(String.format("DELETE FROM tokens WHERE val = \'%s\'", token))',
      ],
      goodExample: 'PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");\nps.setString(1, id);',
      badExample: 'stmt.executeQuery(String.format("SELECT * FROM users WHERE id = %s", id)); // ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_sql_interpolation', config.severityRules);
      const findings: Finding[] = [];
      const SQL_FORMAT_RE = /(?:executeQuery|executeUpdate|execute|prepareStatement)\s*\(\s*String\.format\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (SQL_FORMAT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_sql_interpolation', file: path, line: i + 1,
              message: 'String.format() used to build SQL query — SQL injection vulnerability.',
              suggestion: 'Use PreparedStatement with ? placeholders instead of String.format() for SQL.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_003: Spring mapping method without @PreAuthorize / @Secured ──────
  {
    id: 'JAVA_003',
    category: 'spring_missing_pre_authorize',
    description: 'Spring @RequestMapping/@GetMapping/@PostMapping etc. without @PreAuthorize or @Secured — unauthenticated access possible.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'auth', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'AI-generated Spring Boot controllers frequently add endpoint mappings without any method-level security annotation. Without @PreAuthorize or @Secured, any caller — authenticated or not — can invoke the endpoint.',
      commonViolations: [
        '@PostMapping("/admin/delete")\npublic ResponseEntity<?> deleteUser(Long id) { ... }',
        '@GetMapping("/users/{id}")\npublic User getUser(@PathVariable Long id) { ... }',
      ],
      goodExample: '@PreAuthorize("hasRole(\'ADMIN\')")\n@DeleteMapping("/admin/delete")\npublic ResponseEntity<?> deleteUser(Long id) { ... }',
      badExample: '@PostMapping("/admin/delete")\npublic ResponseEntity<?> deleteUser(Long id) { ... } // ❌ no auth check',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('spring_missing_pre_authorize', config.severityRules);
      const findings: Finding[] = [];
      const MAPPING_RE = /@(?:GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\b/;
      const AUTH_RE = /@PreAuthorize|@Secured|@RolesAllowed|@PermitAll/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        if (/AuthController/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!MAPPING_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - WINDOW);
          const windowLines = lines.slice(start, i + 1).join('\n');
          if (!AUTH_RE.test(windowLines)) {
            findings.push({
              severity: sev, category: 'spring_missing_pre_authorize', file: path, line: i + 1,
              message: 'Spring endpoint mapping without @PreAuthorize or @Secured — unauthenticated access possible.',
              suggestion: 'Add @PreAuthorize("hasRole(\'ROLE_USER\')") or @Secured above the mapping annotation.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── JAVA_004: Hardcoded password/secret string literal ────────────────────
  {
    id: 'JAVA_004',
    category: 'java_hardcoded_password',
    description: 'String variable named password/secret/apiKey assigned a hardcoded string literal.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'secrets', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Hardcoded credentials in source code are exposed to everyone with repository access, CI logs, and binary decompilation. AI assistants frequently fill in placeholder values that get committed and shipped to production.',
      commonViolations: [
        'String password = "supersecret123";',
        'final String apiKey = "sk-abcdef1234";',
        'String authKey = "Bearer abc123token";',
      ],
      goodExample: 'String password = System.getenv("DB_PASSWORD");\n// or inject via @Value("${db.password}")',
      badExample: 'String password = "supersecret123"; // ❌ hardcoded credential',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_hardcoded_password', config.severityRules);
      const findings: Finding[] = [];
      const HARDCODED_RE = /(?:String|final\s+String)\s+(?:password|passwd|secret|apiKey|api_key|token|authKey)\s*=\s*["'][^"']{4,}["']/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (HARDCODED_RE.test(line) && !/getenv|getProperty|@Value|\$\{/.test(line)) {
            findings.push({
              severity: sev, category: 'java_hardcoded_password', file: path, line: i + 1,
              message: 'Hardcoded credential in variable — secrets must not be committed to source code.',
              suggestion: 'Load from environment: System.getenv("DB_PASSWORD") or @Value("${db.password}")',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_005: Weak password hashing (MD5/SHA-1) ───────────────────────────
  {
    id: 'JAVA_005',
    category: 'java_weak_password_hash',
    description: 'MessageDigest.getInstance("MD5") or ("SHA-1") — insecure for password hashing.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'crypto', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'MD5 and SHA-1 are general-purpose hash functions, not password hash functions. They are extremely fast, which means an attacker with a GPU can test billions of guesses per second. Password hashing requires intentionally slow algorithms like BCrypt or Argon2.',
      commonViolations: [
        'MessageDigest md = MessageDigest.getInstance("MD5");',
        'MessageDigest sha = MessageDigest.getInstance("SHA-1");',
        'MessageDigest.getInstance("SHA1")',
      ],
      goodExample: 'BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();\nString hash = encoder.encode(rawPassword);',
      badExample: 'MessageDigest md = MessageDigest.getInstance("MD5"); // ❌ trivially crackable',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_weak_password_hash', config.severityRules);
      const findings: Finding[] = [];
      const WEAK_HASH_RE = /MessageDigest\.getInstance\s*\(\s*["'](?:MD5|SHA-1|SHA1)["']\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (WEAK_HASH_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_weak_password_hash', file: path, line: i + 1,
              message: 'MD5/SHA-1 used — insecure for password hashing, trivially brute-forced.',
              suggestion: 'Use BCryptPasswordEncoder, Argon2PasswordEncoder, or SCryptPasswordEncoder from Spring Security.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_006: XXE injection via XML factory without secure processing ──────
  {
    id: 'JAVA_006',
    category: 'java_xxe_injection',
    description: 'XMLInputFactory/DocumentBuilderFactory/SAXParserFactory without external entity protection — XXE injection.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'xxe', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'XML External Entity (XXE) attacks exploit XML parsers that process external entity references. An attacker can use XXE to read arbitrary files from the server, perform SSRF, or cause denial of service. The fix is to explicitly disable external entity processing on every parser factory instance.',
      commonViolations: [
        'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();\nDocumentBuilder db = dbf.newDocumentBuilder();',
        'XMLInputFactory factory = XMLInputFactory.newInstance();\nfactory.createXMLStreamReader(input);',
      ],
      goodExample: 'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();\ndbf.setFeature("http://xml.org/sax/features/external-general-entities", false);\ndbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);',
      badExample: 'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance(); // ❌ XXE — no secure processing set',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_xxe_injection', config.severityRules);
      const findings: Finding[] = [];
      const FACTORY_RE = /(?:XMLInputFactory|DocumentBuilderFactory|SAXParserFactory)\.newInstance\s*\(/;
      const SECURE_RE = /setFeature|setExpandEntityReferences\s*\(\s*false|FEATURE_SECURE_PROCESSING|external.*entit/i;
      const WINDOW = 8;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FACTORY_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          const windowLines = lines.slice(i, end).join('\n');
          if (!SECURE_RE.test(windowLines)) {
            findings.push({
              severity: sev, category: 'java_xxe_injection', file: path, line: i + 1,
              message: 'XML factory created without disabling external entity processing — XXE injection risk.',
              suggestion: 'Call setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true) and disable external entities on the factory.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── JAVA_007: Unsafe ObjectInputStream deserialization ────────────────────
  {
    id: 'JAVA_007',
    category: 'java_deserialization',
    description: 'new ObjectInputStream followed by readObject() — arbitrary code execution via unsafe deserialization.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'deserialization', 'rce', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Java deserialization via ObjectInputStream.readObject() can execute arbitrary code when the serialized data contains crafted gadget chains. Numerous libraries (Commons Collections, Spring, etc.) contain known gadget chains that make this exploitable. This pattern is always suspicious when applied to data from external sources.',
      commonViolations: [
        'ObjectInputStream ois = new ObjectInputStream(inputStream);\nObject obj = ois.readObject();',
        'new ObjectInputStream(request.getInputStream()).readObject()',
      ],
      goodExample: '// Use JSON or Protocol Buffers for data exchange.\n// If you must use serialization, use a whitelist-based ObjectInputStream.',
      badExample: 'Object obj = new ObjectInputStream(socket.getInputStream()).readObject(); // ❌ RCE via gadget chain',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_deserialization', config.severityRules);
      const findings: Finding[] = [];
      const NEW_OIS_RE = /new ObjectInputStream\b/;
      const READ_OBJ_RE = /\.readObject\s*\(/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!NEW_OIS_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          const windowLines = lines.slice(i, end).join('\n');
          if (READ_OBJ_RE.test(windowLines)) {
            findings.push({
              severity: sev, category: 'java_deserialization', file: path, line: i + 1,
              message: 'ObjectInputStream.readObject() — unsafe deserialization, potential RCE via gadget chains.',
              suggestion: 'Use JSON or Protocol Buffers. If serialization is required, implement a whitelist-based ObjectInputStream override.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── JAVA_008: Command injection via Runtime.exec or ProcessBuilder ─────────
  {
    id: 'JAVA_008',
    category: 'java_command_injection',
    description: 'Runtime.exec() or new ProcessBuilder() with string concatenation — command injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'command-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Passing user-controlled data into Runtime.exec() or ProcessBuilder via string concatenation allows command injection. Shell metacharacters like ;, &&, |, and $() can inject additional commands.',
      commonViolations: [
        'Runtime.getRuntime().exec("convert " + filename)',
        'new ProcessBuilder("ls " + userDir)',
      ],
      goodExample: 'new ProcessBuilder("convert", filename, "output.png").start();',
      badExample: 'Runtime.getRuntime().exec("convert " + filename); // ❌ command injection if filename contains ;',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_command_injection', config.severityRules);
      const findings: Finding[] = [];
      const CMD_RE = /Runtime\.getRuntime\s*\(\s*\)\s*\.exec\s*\([^)]*\+|new ProcessBuilder\s*\([^)]*\+/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (CMD_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_command_injection', file: path, line: i + 1,
              message: 'Runtime.exec() or ProcessBuilder with string concatenation — command injection risk.',
              suggestion: 'Use ProcessBuilder with a String array of arguments: new ProcessBuilder("cmd", arg1, arg2)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_009: Path traversal via new File() with user input ───────────────
  {
    id: 'JAVA_009',
    category: 'java_path_traversal',
    description: 'new File() with request.getParameter() or concatenation — path traversal risk.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'path-traversal', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Constructing a File path from user-supplied input allows path traversal attacks (../../etc/passwd). Attackers can navigate outside the intended directory to read or write arbitrary server files.',
      commonViolations: [
        'new File(request.getParameter("path"))',
        'new File(baseDir + "/" + userInput)',
        'new File(getParam("filename"))',
      ],
      goodExample: 'File base = new File("/safe/uploads");\nFile f = new File(base, filename).getCanonicalFile();\nif (!f.toPath().startsWith(base.toPath())) throw new SecurityException("Path traversal");',
      badExample: 'new File(request.getParameter("path")) // ❌ path traversal',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const PATH_RE = /new File\s*\(\s*(?:request\.getParameter|.*getParam)|new File\s*\([^)]*\+[^)]*\)/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (PATH_RE.test(line) && !/canonicalize|toRealPath|getCanonicalFile/.test(line)) {
            findings.push({
              severity: sev, category: 'java_path_traversal', file: path, line: i + 1,
              message: 'new File() with user-controlled input — path traversal vulnerability.',
              suggestion: 'Use getCanonicalFile() and verify the resolved path starts within the intended base directory.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_010: Open redirect via response.sendRedirect with request param ───
  {
    id: 'JAVA_010',
    category: 'java_open_redirect',
    description: 'response.sendRedirect() with request.getParameter() — open redirect vulnerability.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'open-redirect', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Using a user-supplied parameter directly in a redirect allows attackers to craft links on your domain that send users to malicious sites. This is widely used in phishing campaigns because the initial URL appears legitimate.',
      commonViolations: [
        'response.sendRedirect(request.getParameter("returnUrl"))',
        'response.sendRedirect(request.getParameter("next"))',
      ],
      goodExample: 'String returnUrl = request.getParameter("returnUrl");\nif (isAllowedUrl(returnUrl)) { response.sendRedirect(returnUrl); }\nelse { response.sendRedirect("/home"); }',
      badExample: 'response.sendRedirect(request.getParameter("returnUrl")); // ❌ open redirect',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_open_redirect', config.severityRules);
      const findings: Finding[] = [];
      const REDIRECT_RE = /response\.sendRedirect\s*\([^)]*request\.getParameter/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (REDIRECT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_open_redirect', file: path, line: i + 1,
              message: 'response.sendRedirect with user-supplied parameter — open redirect enables phishing via your domain.',
              suggestion: 'Validate the redirect URL against an allowlist of safe destinations before redirecting.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_011: Spring Security CSRF disabled ───────────────────────────────
  {
    id: 'JAVA_011',
    category: 'spring_csrf_disabled',
    description: 'Spring Security .csrf().disable() or csrf(AbstractHttpConfigurer::disable) — CSRF protection removed.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'csrf', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'CSRF attacks trick authenticated users into making unintended state-changing requests. Spring Security\'s built-in CSRF protection prevents this. Disabling it is a common AI shortcut to "fix" integration test failures without understanding the security implication.',
      commonViolations: [
        'http.csrf().disable()',
        'http.csrf(AbstractHttpConfigurer::disable)',
      ],
      goodExample: '// Keep CSRF enabled (default). For stateless REST APIs, use JWT/token auth:\nhttp.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS));',
      badExample: 'http.csrf().disable(); // ❌ CSRF protection removed — state-changing requests are vulnerable',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('spring_csrf_disabled', config.severityRules);
      const findings: Finding[] = [];
      const CSRF_RE = /\.csrf\s*\(\s*\)\s*\.disable\s*\(|csrf\s*\(\s*AbstractHttpConfigurer::disable\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (CSRF_RE.test(line)) {
            findings.push({
              severity: sev, category: 'spring_csrf_disabled', file: path, line: i + 1,
              message: 'Spring Security CSRF protection disabled — cross-site request forgery attacks are possible.',
              suggestion: 'Keep CSRF enabled. For stateless REST APIs use SessionCreationPolicy.STATELESS instead.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_012: Spring CORS wildcard allowedOrigins ────────────────────────
  {
    id: 'JAVA_012',
    category: 'spring_cors_wildcard',
    description: '.allowedOrigins("*") in CORS configuration — accepts requests from any origin.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'cors', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'A wildcard CORS origin allows any website to make credentialed cross-origin requests to your API. This can enable CSRF-like attacks from malicious sites when combined with cookie-based authentication.',
      commonViolations: [
        'config.addAllowedOrigin("*");',
        '.allowedOrigins("*")',
      ],
      goodExample: 'config.addAllowedOrigin("https://app.example.com");\nconfig.addAllowedOrigin("https://staging.example.com");',
      badExample: 'config.addAllowedOrigin("*"); // ❌ accepts requests from any origin',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('spring_cors_wildcard', config.severityRules);
      const findings: Finding[] = [];
      const CORS_RE = /\.allowedOrigins\s*\(\s*["']\*["']\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (CORS_RE.test(line)) {
            findings.push({
              severity: sev, category: 'spring_cors_wildcard', file: path, line: i + 1,
              message: 'CORS wildcard origin "*" allows requests from any domain — specify explicit allowed origins.',
              suggestion: 'Replace "*" with the actual allowed origins: config.addAllowedOrigin("https://app.example.com")',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_013: Spring Actuator all endpoints exposed ───────────────────────
  {
    id: 'JAVA_013',
    category: 'spring_actuator_exposed',
    description: 'management.endpoints.web.exposure.include=* exposes all Spring Actuator endpoints.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'config', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Exposing all Spring Actuator endpoints publishes heap dumps, thread dumps, environment variables (including secrets), and shutdown capabilities over HTTP. This is a common misconfiguration in AI-generated Spring Boot configuration.',
      commonViolations: [
        'management.endpoints.web.exposure.include=*  # in application.properties',
        'include: "*"  # in management.endpoints.web.exposure section',
      ],
      goodExample: 'management.endpoints.web.exposure.include=health,info\nmanagement.endpoint.health.show-details=when_authorized',
      badExample: 'management.endpoints.web.exposure.include=* // ❌ exposes heap dumps, env vars, and shutdown',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('spring_actuator_exposed', config.severityRules);
      const findings: Finding[] = [];
      const ACTUATOR_RE = /management\.endpoints\.web\.exposure\.include\s*=\s*\*|include:\s*['"]?\*['"]?/;
      for (const { path, content } of changedFiles) {
        if (!isPropertiesFile(path)) continue;
        if (isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (ACTUATOR_RE.test(line)) {
            findings.push({
              severity: sev, category: 'spring_actuator_exposed', file: path, line: i + 1,
              message: 'All Spring Actuator endpoints exposed — heap dumps, env vars, and shutdown endpoint are accessible.',
              suggestion: 'Limit to: management.endpoints.web.exposure.include=health,info',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_014: H2 console enabled in properties ────────────────────────────
  {
    id: 'JAVA_014',
    category: 'spring_h2_console_enabled',
    description: 'spring.h2.console.enabled=true in application properties — H2 web console exposed.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'config', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'The H2 in-memory database web console provides full database access via a browser UI. Leaving it enabled in non-development environments means anyone who can reach the server can query or modify the database without authentication.',
      commonViolations: [
        'spring.h2.console.enabled=true  # in application.properties',
        'spring:\n  h2:\n    console:\n      enabled: true',
      ],
      goodExample: '# Only in dev profile (application-dev.properties):\nspring.h2.console.enabled=true\n# Ensure it is NOT in application.properties or production config.',
      badExample: 'spring.h2.console.enabled=true // ❌ H2 console exposes full database access',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('spring_h2_console_enabled', config.severityRules);
      const findings: Finding[] = [];
      const H2_RE = /spring\.h2\.console\.enabled\s*=\s*true/;
      for (const { path, content } of changedFiles) {
        if (!isPropertiesFile(path)) continue;
        if (isJavaTest(path) || /test/.test(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*#/.test(line)) return;
          if (H2_RE.test(line)) {
            findings.push({
              severity: sev, category: 'spring_h2_console_enabled', file: path, line: i + 1,
              message: 'H2 web console enabled — exposes full database access over HTTP.',
              suggestion: 'Remove spring.h2.console.enabled=true from non-development configurations.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_015: new Random() in security/token context ────────────────────
  {
    id: 'JAVA_015',
    category: 'java_random_not_secure',
    description: 'new Random() used near token/password/key/session generation — use SecureRandom instead.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'crypto', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'java.util.Random is a pseudorandom number generator seeded from the system clock. Its output is predictable — an attacker who knows the approximate seed time can enumerate possible values. SecureRandom uses a cryptographically strong source of entropy.',
      commonViolations: [
        'Random rand = new Random(); String token = String.valueOf(rand.nextLong());',
        'new Random().nextBytes(salt)',
      ],
      goodExample: 'SecureRandom sr = new SecureRandom();\nbyte[] token = new byte[32];\nsr.nextBytes(token);',
      badExample: 'String token = String.valueOf(new Random().nextLong()); // ❌ predictable, not cryptographically secure',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_random_not_secure', config.severityRules);
      const findings: Finding[] = [];
      const RANDOM_RE = /new Random\s*\(/;
      const SECURITY_CONTEXT_RE = /token|password|secret|key|auth|session|nonce|salt/i;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!RANDOM_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - WINDOW);
          const end = Math.min(lines.length, i + WINDOW + 1);
          const windowLines = lines.slice(start, end).join('\n');
          if (SECURITY_CONTEXT_RE.test(windowLines)) {
            findings.push({
              severity: sev, category: 'java_random_not_secure', file: path, line: i + 1,
              message: 'new Random() in security-sensitive context — use SecureRandom for cryptographic randomness.',
              suggestion: 'Replace new Random() with new SecureRandom() for all token/key/session generation.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── JAVA_016: Logging sensitive values ────────────────────────────────────
  {
    id: 'JAVA_016',
    category: 'java_log_sensitive',
    description: 'Logger.info/debug/error/warn with password/token/secret in the message — credential leaked to logs.',
    severity: 'HIGH',
    tags: ['security', 'java', 'spring', 'logging', 'secrets'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Logging sensitive values exposes them permanently in log aggregators, monitoring dashboards, and CI output. AI assistants frequently add debug logging that includes credential variable values directly in the message string.',
      commonViolations: [
        'logger.info("User login with password: " + password)',
        'log.debug("API call with token=" + apiToken)',
        'LOG.error("Auth failed, secret=" + secret)',
      ],
      goodExample: 'logger.info("User {} authenticated successfully", userId); // log ID, not credential',
      badExample: 'logger.info("password=" + password); // ❌ credential in logs',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_log_sensitive', config.severityRules);
      const findings: Finding[] = [];
      const LOG_RE = /(?:log|logger|LOG|LOGGER)\s*\.(?:info|debug|warn|error|trace)\s*\([^)]*(?:password|passwd|secret|token|apiKey)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (LOG_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_log_sensitive', file: path, line: i + 1,
              message: 'Logging sensitive value (password/token/secret) — credential will appear in log output.',
              suggestion: 'Never log credential values. Log only non-sensitive identifiers such as user IDs.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_017: @RequestBody without @Valid annotation ────────────────────
  {
    id: 'JAVA_017',
    category: 'spring_missing_request_validation',
    description: '@RequestBody parameter without @Valid or @Validated — input is not validated.',
    severity: 'MEDIUM',
    tags: ['security', 'java', 'spring', 'validation', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Spring Boot will bind arbitrary request body fields to a @RequestBody object without validation unless @Valid or @Validated is present. Without validation, malformed or malicious input can propagate into the application without constraint checks.',
      commonViolations: [
        'public ResponseEntity<?> create(@RequestBody UserDto dto)',
        'public void update(@RequestBody OrderRequest req)',
      ],
      goodExample: 'public ResponseEntity<?> create(@Valid @RequestBody UserDto dto) { ... }',
      badExample: 'public ResponseEntity<?> create(@RequestBody UserDto dto) { ... } // ❌ no validation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('spring_missing_request_validation', config.severityRules);
      const findings: Finding[] = [];
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (!/@RequestBody\s/.test(line)) return;
          // Check same line and line before for @Valid/@Validated
          const prev = i > 0 ? lines[i - 1]! : '';
          if (!/@Valid\b|@Validated\b/.test(line) && !/@Valid\b|@Validated\b/.test(prev)) {
            findings.push({
              severity: sev, category: 'spring_missing_request_validation', file: path, line: i + 1,
              message: '@RequestBody without @Valid — request body fields are not validated against constraints.',
              suggestion: 'Add @Valid before @RequestBody: public ResponseEntity<?> create(@Valid @RequestBody UserDto dto)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_018: Hardcoded SecretKeySpec ────────────────────────────────────
  {
    id: 'JAVA_018',
    category: 'java_hardcoded_secret_key',
    description: 'new SecretKeySpec() with a hardcoded string or byte literal — cryptographic key in source code.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'crypto', 'secrets', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Hardcoding a cryptographic key in source code means anyone with repository access can decrypt ciphertexts. Key material must come from a secure store (environment variable, KMS, Java KeyStore) and must never be embedded in code.',
      commonViolations: [
        'new SecretKeySpec("mysupersecretkey".getBytes(), "AES")',
        'new SecretKeySpec(new byte[]{ 0x01, 0x02, ... }, "AES")',
      ],
      goodExample: 'byte[] keyBytes = Base64.getDecoder().decode(System.getenv("AES_KEY"));\nSecretKey key = new SecretKeySpec(keyBytes, "AES");',
      badExample: 'new SecretKeySpec("hardcodedkey12345".getBytes(), "AES"); // ❌ key in source code',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_hardcoded_secret_key', config.severityRules);
      const findings: Finding[] = [];
      const KEY_RE = /new SecretKeySpec\s*\(\s*["']|new SecretKeySpec\s*\(\s*new byte\[\s*\]\s*\{/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (KEY_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_hardcoded_secret_key', file: path, line: i + 1,
              message: 'SecretKeySpec created with hardcoded key material — cryptographic key in source code.',
              suggestion: 'Load key bytes from environment variable or Java KeyStore, never hardcode key material.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_019: Class.forName() reflection injection ────────────────────────
  {
    id: 'JAVA_019',
    category: 'java_reflection_injection',
    description: 'Class.forName() with a variable argument — dynamic class loading from user-controlled input enables RCE.',
    severity: 'BLOCKER',
    tags: ['security', 'java', 'spring', 'reflection', 'rce', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Class.forName() with a user-controlled class name allows an attacker to instantiate arbitrary classes on the classpath, potentially achieving code execution through static initializers or known gadget classes.',
      commonViolations: [
        'Class.forName(request.getParameter("class"))',
        'Class.forName(className)',
      ],
      goodExample: '// Use a whitelist of allowed class names:\nMap<String, Class<?>> allowed = Map.of("Foo", Foo.class, "Bar", Bar.class);\nClass<?> cls = allowed.get(request.getParameter("type"));',
      badExample: 'Class.forName(request.getParameter("class")); // ❌ RCE via reflection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('java_reflection_injection', config.severityRules);
      const findings: Finding[] = [];
      // Class.forName( not followed immediately by a string quote
      const REFLECT_RE = /Class\.forName\s*\(\s*(?!["'])/;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (REFLECT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'java_reflection_injection', file: path, line: i + 1,
              message: 'Class.forName() with a variable — dynamic class loading from user input enables RCE.',
              suggestion: 'Use a whitelist map of allowed class names rather than loading arbitrary classes by name.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── JAVA_020: @Repository method without @Transactional ──────────────────
  {
    id: 'JAVA_020',
    category: 'spring_missing_transaction',
    description: '@Repository class with save/update/delete/insert method missing @Transactional.',
    severity: 'MEDIUM',
    tags: ['java', 'spring', 'data', 'reliability', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Write operations in @Repository classes should be wrapped in a transaction to ensure atomicity. Without @Transactional, a multi-step write can be partially applied if an exception occurs mid-way, leaving data in an inconsistent state.',
      commonViolations: [
        'public void saveUser(User user) { repo.save(user); auditRepo.save(audit); }',
        'public int deleteExpired() { return jdbc.update("DELETE FROM sessions WHERE ..."); }',
      ],
      goodExample: '@Transactional\npublic void saveUser(User user) { repo.save(user); auditRepo.save(audit); }',
      badExample: 'public void saveUser(User user) { repo.save(user); } // ❌ no @Transactional — partial writes possible',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('spring_missing_transaction', config.severityRules);
      const findings: Finding[] = [];
      const WRITE_METHOD_RE = /public\s+(?:void|int|long|\w+)\s+(?:save|update|delete|insert|merge|remove|create)\w*\s*\(/;
      const TX_RE = /@Transactional\b/;
      const WINDOW = 3;
      for (const { path, content } of changedFiles) {
        if (!isJavaFile(path) || isJavaTest(path)) continue;
        if (!/@Repository\b/.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!WRITE_METHOD_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - WINDOW);
          const windowLines = lines.slice(start, i + 1).join('\n');
          if (!TX_RE.test(windowLines)) {
            findings.push({
              severity: sev, category: 'spring_missing_transaction', file: path, line: i + 1,
              message: 'Write method in @Repository without @Transactional — partial writes possible if an exception occurs.',
              suggestion: 'Add @Transactional to the method or the class to ensure atomic database operations.',
            });
          }
        }
      }
      return findings;
    },
  },

];
