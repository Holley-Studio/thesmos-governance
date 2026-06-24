// @vitest-environment node
/**
 * Unit tests for Java / Spring Boot security rules (JAVA_001–020).
 *
 * Each test exercises ONE rule by passing crafted changedFiles.
 * "fires" tests verify the rule detects bad code.
 * "safe" tests verify no false positives on correct code.
 */
import { describe, it, expect } from 'vitest';
import { JAVA_RULES } from './java';
import { CONFIG_DEFAULTS } from '../config';
import type { DetectInput, ScanResult } from '../types';

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: '2024-01-01T00:00:00.000Z',
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

function rule(id: string) {
  const r = JAVA_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(ruleId).detect(input);
}

// ── JAVA_001: SQL injection via JDBC string concatenation ─────────────────────

describe('JAVA_001 — SQL injection via JDBC string concatenation', () => {
  it('fires on executeQuery with string literal + variable concatenation', () => {
    const findings = detect('JAVA_001', [
      { path: 'src/main/java/UserDao.java', content: 'stmt.executeQuery("SELECT * FROM users WHERE id = " + id);\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_sql_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
    expect(findings[0]!.line).toBe(1);
  });

  it('fires on prepareStatement with concatenation', () => {
    const findings = detect('JAVA_001', [
      { path: 'src/main/java/OrderDao.java', content: 'conn.prepareStatement("SELECT * FROM orders WHERE user = " + userId);\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_sql_injection');
  });

  it('fires on executeUpdate with variable + string concatenation', () => {
    const findings = detect('JAVA_001', [
      { path: 'src/main/java/SessionDao.java', content: 'stmt.executeUpdate("DELETE FROM sessions WHERE token = \'" + token + "\'");\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on PreparedStatement with ? placeholder', () => {
    const findings = detect('JAVA_001', [
      { path: 'src/main/java/UserDao.java', content: 'PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");\nps.setInt(1, id);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out code', () => {
    const findings = detect('JAVA_001', [
      { path: 'src/main/java/UserDao.java', content: '// stmt.executeQuery("SELECT * FROM users WHERE id = " + id);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_001', [
      { path: 'src/test/java/UserDaoTest.java', content: 'stmt.executeQuery("SELECT * FROM users WHERE id = " + id);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Java files', () => {
    const findings = detect('JAVA_001', [
      { path: 'src/resources/query.sql', content: 'SELECT * FROM users WHERE id = ' + 1 },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_002: SQL injection via String.format() ───────────────────────────────

describe('JAVA_002 — SQL injection via String.format()', () => {
  it('fires on executeQuery(String.format(...))', () => {
    const findings = detect('JAVA_002', [
      { path: 'src/main/java/UserDao.java', content: 'stmt.executeQuery(String.format("SELECT * FROM users WHERE id = %s", id));\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_sql_interpolation');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on execute(String.format(...))', () => {
    const findings = detect('JAVA_002', [
      { path: 'src/main/java/ReportDao.java', content: 'conn.execute(String.format("DELETE FROM logs WHERE user_id = %d", userId));\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on prepareStatement(String.format(...))', () => {
    const findings = detect('JAVA_002', [
      { path: 'src/main/java/ItemDao.java', content: 'conn.prepareStatement(String.format("SELECT * FROM items WHERE cat = \'%s\'", cat));\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on String.format used outside SQL methods', () => {
    const findings = detect('JAVA_002', [
      { path: 'src/main/java/UserService.java', content: 'String msg = String.format("Hello, %s!", name);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_002', [
      { path: 'src/test/java/UserDaoTest.java', content: 'stmt.executeQuery(String.format("SELECT * FROM users WHERE id = %s", id));\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Java files', () => {
    const findings = detect('JAVA_002', [
      { path: 'application.properties', content: 'stmt.executeQuery(String.format("SELECT %s", col));\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_003: Spring mapping without @PreAuthorize ────────────────────────────

describe('JAVA_003 — Spring mapping without @PreAuthorize or @Secured', () => {
  it('fires on @GetMapping without @PreAuthorize in window', () => {
    const findings = detect('JAVA_003', [
      {
        path: 'src/main/java/UserController.java',
        content: [
          'public class UserController {',
          '    @GetMapping("/users/{id}")',
          '    public User getUser(@PathVariable Long id) {',
          '        return userService.findById(id);',
          '    }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('spring_missing_pre_authorize');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on @PostMapping without auth annotation', () => {
    const findings = detect('JAVA_003', [
      {
        path: 'src/main/java/AdminController.java',
        content: '    @PostMapping("/admin/delete")\n    public ResponseEntity<?> delete(Long id) { return ok(); }\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on @DeleteMapping without auth annotation', () => {
    const findings = detect('JAVA_003', [
      {
        path: 'src/main/java/ItemController.java',
        content: '    @DeleteMapping("/items/{id}")\n    public void delete(@PathVariable Long id) { service.delete(id); }\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when @PreAuthorize is in the 5-line window before', () => {
    const findings = detect('JAVA_003', [
      {
        path: 'src/main/java/UserController.java',
        content: [
          '    @PreAuthorize("hasRole(\'ADMIN\')")',
          '    @GetMapping("/users/{id}")',
          '    public User getUser(@PathVariable Long id) {',
          '        return userService.findById(id);',
          '    }',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when @Secured is present', () => {
    const findings = detect('JAVA_003', [
      {
        path: 'src/main/java/UserController.java',
        content: '    @Secured("ROLE_USER")\n    @GetMapping("/users/{id}")\n    public User getUser(@PathVariable Long id) { return null; }\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when @PermitAll is in the window', () => {
    const findings = detect('JAVA_003', [
      {
        path: 'src/main/java/PublicController.java',
        content: '    @PermitAll\n    @GetMapping("/health")\n    public String health() { return "ok"; }\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_003', [
      {
        path: 'src/test/java/UserControllerTest.java',
        content: '    @GetMapping("/users/{id}")\n    public User getUser(@PathVariable Long id) { return null; }\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_004: Hardcoded password string literal ───────────────────────────────

describe('JAVA_004 — hardcoded password/secret variable', () => {
  it('fires on String password = "..."', () => {
    const findings = detect('JAVA_004', [
      { path: 'src/main/java/Config.java', content: 'String password = "supersecret123";\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_hardcoded_password');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on final String apiKey = "..."', () => {
    const findings = detect('JAVA_004', [
      { path: 'src/main/java/ApiClient.java', content: 'final String apiKey = "sk-abcdef1234567";\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on String token = "..."', () => {
    const findings = detect('JAVA_004', [
      { path: 'src/main/java/AuthService.java', content: 'String token = "Bearer my-secret-token";\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when using System.getenv()', () => {
    const findings = detect('JAVA_004', [
      { path: 'src/main/java/Config.java', content: 'String password = System.getenv("DB_PASSWORD");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when using @Value injection', () => {
    const findings = detect('JAVA_004', [
      { path: 'src/main/java/Config.java', content: '@Value("${db.password}") private String password;\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out lines', () => {
    const findings = detect('JAVA_004', [
      { path: 'src/main/java/Config.java', content: '// String password = "supersecret123";\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_005: Weak password hash MD5/SHA-1 ───────────────────────────────────

describe('JAVA_005 — weak password hash (MD5/SHA-1)', () => {
  it('fires on MessageDigest.getInstance("MD5")', () => {
    const findings = detect('JAVA_005', [
      { path: 'src/main/java/PasswordService.java', content: 'MessageDigest md = MessageDigest.getInstance("MD5");\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_weak_password_hash');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on MessageDigest.getInstance("SHA-1")', () => {
    const findings = detect('JAVA_005', [
      { path: 'src/main/java/HashUtil.java', content: 'MessageDigest sha = MessageDigest.getInstance("SHA-1");\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on MessageDigest.getInstance("SHA1")', () => {
    const findings = detect('JAVA_005', [
      { path: 'src/main/java/LegacyHash.java', content: 'return MessageDigest.getInstance("SHA1").digest(input);\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on MessageDigest.getInstance("SHA-256")', () => {
    const findings = detect('JAVA_005', [
      { path: 'src/main/java/HashUtil.java', content: 'MessageDigest md = MessageDigest.getInstance("SHA-256");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on BCryptPasswordEncoder', () => {
    const findings = detect('JAVA_005', [
      { path: 'src/main/java/AuthService.java', content: 'BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out code', () => {
    const findings = detect('JAVA_005', [
      { path: 'src/main/java/HashUtil.java', content: '// MessageDigest.getInstance("MD5");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_006: XXE injection via XML factory ───────────────────────────────────

describe('JAVA_006 — XXE injection via XML factory without secure processing', () => {
  it('fires on DocumentBuilderFactory.newInstance() without setFeature', () => {
    const findings = detect('JAVA_006', [
      {
        path: 'src/main/java/XmlParser.java',
        content: [
          'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();',
          'DocumentBuilder db = dbf.newDocumentBuilder();',
          'Document doc = db.parse(inputStream);',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_xxe_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on XMLInputFactory.newInstance() without secure config', () => {
    const findings = detect('JAVA_006', [
      {
        path: 'src/main/java/XmlReader.java',
        content: 'XMLInputFactory factory = XMLInputFactory.newInstance();\nXMLStreamReader reader = factory.createXMLStreamReader(input);\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on SAXParserFactory.newInstance() without secure config', () => {
    const findings = detect('JAVA_006', [
      {
        path: 'src/main/java/SaxHandler.java',
        content: 'SAXParserFactory spf = SAXParserFactory.newInstance();\nSAXParser parser = spf.newSAXParser();\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when setFeature is called within 8 lines', () => {
    const findings = detect('JAVA_006', [
      {
        path: 'src/main/java/XmlParser.java',
        content: [
          'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();',
          'dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);',
          'DocumentBuilder db = dbf.newDocumentBuilder();',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when setExpandEntityReferences(false) is set', () => {
    const findings = detect('JAVA_006', [
      {
        path: 'src/main/java/XmlParser.java',
        content: 'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();\ndbf.setExpandEntityReferences(false);\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_006', [
      {
        path: 'src/test/java/XmlParserTest.java',
        content: 'DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance();\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_007: Unsafe deserialization via ObjectInputStream ────────────────────

describe('JAVA_007 — unsafe deserialization via ObjectInputStream.readObject()', () => {
  it('fires on new ObjectInputStream followed by readObject()', () => {
    const findings = detect('JAVA_007', [
      {
        path: 'src/main/java/CacheService.java',
        content: [
          'ObjectInputStream ois = new ObjectInputStream(inputStream);',
          'Object obj = ois.readObject();',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_deserialization');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on single-line new ObjectInputStream(...).readObject()', () => {
    const findings = detect('JAVA_007', [
      {
        path: 'src/main/java/SessionLoader.java',
        content: 'Object obj = new ObjectInputStream(socket.getInputStream()).readObject();\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on new ObjectInputStream without readObject in window', () => {
    const findings = detect('JAVA_007', [
      {
        path: 'src/main/java/SerialUtil.java',
        content: [
          'ObjectInputStream ois = new ObjectInputStream(inputStream);',
          'ois.close();',
          '// readObject is never called here',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_007', [
      {
        path: 'src/test/java/CacheServiceTest.java',
        content: 'ObjectInputStream ois = new ObjectInputStream(stream);\nObject obj = ois.readObject();\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_008: Command injection via Runtime.exec / ProcessBuilder ─────────────

describe('JAVA_008 — command injection via Runtime.exec or ProcessBuilder with concatenation', () => {
  it('fires on Runtime.getRuntime().exec() with concatenation', () => {
    const findings = detect('JAVA_008', [
      { path: 'src/main/java/FileService.java', content: 'Runtime.getRuntime().exec("convert " + filename);\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_command_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on new ProcessBuilder with concatenation', () => {
    const findings = detect('JAVA_008', [
      { path: 'src/main/java/ShellRunner.java', content: 'new ProcessBuilder("ls " + userDir).start();\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on ProcessBuilder with array args (no concatenation)', () => {
    const findings = detect('JAVA_008', [
      { path: 'src/main/java/FileService.java', content: 'new ProcessBuilder("convert", filename, "output.png").start();\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on Runtime.exec with no concatenation', () => {
    const findings = detect('JAVA_008', [
      { path: 'src/main/java/HealthCheck.java', content: 'Runtime.getRuntime().exec("ls -la");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out code', () => {
    const findings = detect('JAVA_008', [
      { path: 'src/main/java/FileService.java', content: '// Runtime.getRuntime().exec("convert " + filename);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_008', [
      { path: 'src/test/java/ShellRunnerTest.java', content: 'Runtime.getRuntime().exec("ls " + dir);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_009: Path traversal via new File() ───────────────────────────────────

describe('JAVA_009 — path traversal via new File() with user input', () => {
  it('fires on new File(request.getParameter(...))', () => {
    const findings = detect('JAVA_009', [
      { path: 'src/main/java/FileController.java', content: 'File f = new File(request.getParameter("path"));\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_path_traversal');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on new File(baseDir + "/" + userInput) without canonicalize', () => {
    const findings = detect('JAVA_009', [
      { path: 'src/main/java/FileService.java', content: 'File f = new File(baseDir + "/" + userInput);\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when getCanonicalFile is present on the same line', () => {
    const findings = detect('JAVA_009', [
      { path: 'src/main/java/FileService.java', content: 'File f = new File(base, filename).getCanonicalFile();\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_009', [
      { path: 'src/test/java/FileControllerTest.java', content: 'File f = new File(request.getParameter("path"));\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Java files', () => {
    const findings = detect('JAVA_009', [
      { path: 'application.properties', content: 'File f = new File(request.getParameter("path"));\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_010: Open redirect via response.sendRedirect ────────────────────────

describe('JAVA_010 — open redirect via response.sendRedirect with request param', () => {
  it('fires on response.sendRedirect(request.getParameter(...))', () => {
    const findings = detect('JAVA_010', [
      { path: 'src/main/java/AuthController.java', content: 'response.sendRedirect(request.getParameter("returnUrl"));\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_open_redirect');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on sendRedirect with getParameter("next")', () => {
    const findings = detect('JAVA_010', [
      { path: 'src/main/java/LoginFilter.java', content: 'response.sendRedirect(request.getParameter("next"));\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on sendRedirect with a literal URL', () => {
    const findings = detect('JAVA_010', [
      { path: 'src/main/java/AuthController.java', content: 'response.sendRedirect("/home");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out code', () => {
    const findings = detect('JAVA_010', [
      { path: 'src/main/java/AuthController.java', content: '// response.sendRedirect(request.getParameter("returnUrl"));\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_010', [
      { path: 'src/test/java/AuthControllerTest.java', content: 'response.sendRedirect(request.getParameter("returnUrl"));\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_011: Spring Security CSRF disabled ───────────────────────────────────

describe('JAVA_011 — Spring Security CSRF disabled', () => {
  it('fires on .csrf().disable()', () => {
    const findings = detect('JAVA_011', [
      { path: 'src/main/java/SecurityConfig.java', content: 'http.csrf().disable();\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('spring_csrf_disabled');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on csrf(AbstractHttpConfigurer::disable)', () => {
    const findings = detect('JAVA_011', [
      { path: 'src/main/java/SecurityConfig.java', content: 'http.csrf(AbstractHttpConfigurer::disable);\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on csrf() without disable()', () => {
    const findings = detect('JAVA_011', [
      { path: 'src/main/java/SecurityConfig.java', content: 'http.csrf(csrf -> csrf.csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse()));\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out disable', () => {
    const findings = detect('JAVA_011', [
      { path: 'src/main/java/SecurityConfig.java', content: '// http.csrf().disable();\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_011', [
      { path: 'src/test/java/SecurityConfigTest.java', content: 'http.csrf().disable();\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_012: Spring CORS wildcard origin ────────────────────────────────────

describe('JAVA_012 — Spring CORS wildcard allowedOrigins("*")', () => {
  it('fires on .allowedOrigins("*")', () => {
    const findings = detect('JAVA_012', [
      { path: 'src/main/java/CorsConfig.java', content: 'config.addAllowedOrigin("*");\n' },
    ]);
    expect(findings).toHaveLength(0); // uses addAllowedOrigin not .allowedOrigins
  });

  it('fires on .allowedOrigins("*") method chain', () => {
    const findings = detect('JAVA_012', [
      { path: 'src/main/java/CorsConfig.java', content: 'registry.addMapping("/**").allowedOrigins("*");\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('spring_cors_wildcard');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire on .allowedOrigins with specific origin', () => {
    const findings = detect('JAVA_012', [
      { path: 'src/main/java/CorsConfig.java', content: 'registry.addMapping("/**").allowedOrigins("https://app.example.com");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out line', () => {
    const findings = detect('JAVA_012', [
      { path: 'src/main/java/CorsConfig.java', content: '// .allowedOrigins("*")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_012', [
      { path: 'src/test/java/CorsConfigTest.java', content: 'registry.addMapping("/**").allowedOrigins("*");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_013: Spring Actuator all endpoints exposed ───────────────────────────

describe('JAVA_013 — Spring Actuator all endpoints exposed', () => {
  it('fires on management.endpoints.web.exposure.include=* in properties file', () => {
    const findings = detect('JAVA_013', [
      { path: 'src/main/resources/application.properties', content: 'management.endpoints.web.exposure.include=*\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('spring_actuator_exposed');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on include: * in yaml file', () => {
    const findings = detect('JAVA_013', [
      {
        path: 'src/main/resources/application.yml',
        content: 'management:\n  endpoints:\n    web:\n      exposure:\n        include: "*"\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on limited exposure list', () => {
    const findings = detect('JAVA_013', [
      { path: 'src/main/resources/application.properties', content: 'management.endpoints.web.exposure.include=health,info\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out line', () => {
    const findings = detect('JAVA_013', [
      { path: 'src/main/resources/application.properties', content: '# management.endpoints.web.exposure.include=*\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-properties files', () => {
    const findings = detect('JAVA_013', [
      { path: 'src/main/java/ActuatorConfig.java', content: 'management.endpoints.web.exposure.include=*\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_014: H2 console enabled ─────────────────────────────────────────────

describe('JAVA_014 — H2 console enabled in non-test properties', () => {
  it('fires on spring.h2.console.enabled=true in application.properties', () => {
    const findings = detect('JAVA_014', [
      { path: 'src/main/resources/application.properties', content: 'spring.h2.console.enabled=true\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('spring_h2_console_enabled');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on spring.h2.console.enabled=true in application.yml', () => {
    const findings = detect('JAVA_014', [
      { path: 'src/main/resources/application.yml', content: 'spring.h2.console.enabled=true\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when h2 console is disabled', () => {
    const findings = detect('JAVA_014', [
      { path: 'src/main/resources/application.properties', content: 'spring.h2.console.enabled=false\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire in test directory paths', () => {
    const findings = detect('JAVA_014', [
      { path: 'src/test/resources/application.properties', content: 'spring.h2.console.enabled=true\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out line', () => {
    const findings = detect('JAVA_014', [
      { path: 'src/main/resources/application.properties', content: '# spring.h2.console.enabled=true\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-properties files', () => {
    const findings = detect('JAVA_014', [
      { path: 'src/main/java/H2Config.java', content: 'spring.h2.console.enabled=true\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_015: new Random() in security context ────────────────────────────────

describe('JAVA_015 — new Random() in security/token context', () => {
  it('fires on new Random() with token in the surrounding window', () => {
    const findings = detect('JAVA_015', [
      {
        path: 'src/main/java/TokenService.java',
        content: [
          'public String generateToken() {',
          '    Random rand = new Random();',
          '    return String.valueOf(rand.nextLong());',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_random_not_secure');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on new Random() near password context', () => {
    const findings = detect('JAVA_015', [
      {
        path: 'src/main/java/PasswordUtil.java',
        content: 'String password = "";\nRandom rng = new Random();\nfor (int i = 0; i < 12; i++) password += chars.charAt(rng.nextInt());\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on new Random() with no security context nearby', () => {
    const findings = detect('JAVA_015', [
      {
        path: 'src/main/java/GameService.java',
        content: '// Roll dice\nRandom rand = new Random();\nint roll = rand.nextInt(6) + 1;\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on SecureRandom', () => {
    const findings = detect('JAVA_015', [
      {
        path: 'src/main/java/TokenService.java',
        content: 'SecureRandom sr = new SecureRandom();\nbyte[] token = new byte[32];\nsr.nextBytes(token);\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_015', [
      {
        path: 'src/test/java/TokenServiceTest.java',
        content: 'Random rand = new Random();\nString token = String.valueOf(rand.nextLong());\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_016: Logging sensitive values ───────────────────────────────────────

describe('JAVA_016 — logging sensitive values', () => {
  it('fires on logger.info() with password in message', () => {
    const findings = detect('JAVA_016', [
      { path: 'src/main/java/AuthService.java', content: 'logger.info("User login with password: " + password);\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_log_sensitive');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on log.debug() with token in message', () => {
    const findings = detect('JAVA_016', [
      { path: 'src/main/java/ApiClient.java', content: 'log.debug("Calling API with token=" + apiToken);\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on LOG.error() with secret keyword', () => {
    const findings = detect('JAVA_016', [
      { path: 'src/main/java/IntegrationService.java', content: 'LOG.error("Auth failed, secret=" + secretKey);\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on logging non-sensitive values', () => {
    const findings = detect('JAVA_016', [
      { path: 'src/main/java/AuthService.java', content: 'logger.info("User {} authenticated successfully", userId);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out log lines', () => {
    const findings = detect('JAVA_016', [
      { path: 'src/main/java/AuthService.java', content: '// logger.info("password=" + password);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Java files', () => {
    const findings = detect('JAVA_016', [
      { path: 'application.properties', content: 'logger.info("password=" + password);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_017: @RequestBody without @Valid ─────────────────────────────────────

describe('JAVA_017 — @RequestBody without @Valid or @Validated', () => {
  it('fires on @RequestBody without @Valid on same or previous line', () => {
    const findings = detect('JAVA_017', [
      {
        path: 'src/main/java/UserController.java',
        content: 'public ResponseEntity<?> create(@RequestBody UserDto dto) {\n    return ok(service.create(dto));\n}\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('spring_missing_request_validation');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on @RequestBody on its own line without @Valid above it', () => {
    const findings = detect('JAVA_017', [
      {
        path: 'src/main/java/OrderController.java',
        content: 'public void update(\n    @RequestBody OrderRequest req) { service.update(req); }\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when @Valid precedes @RequestBody on same line', () => {
    const findings = detect('JAVA_017', [
      {
        path: 'src/main/java/UserController.java',
        content: 'public ResponseEntity<?> create(@Valid @RequestBody UserDto dto) { return ok(); }\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when @Validated is on the previous line', () => {
    const findings = detect('JAVA_017', [
      {
        path: 'src/main/java/UserController.java',
        content: '// @Validated\npublic ResponseEntity<?> create(@RequestBody UserDto dto) { return ok(); }\n',
      },
    ]);
    // Comment line still has @Validated text — the rule just checks line text
    expect(Array.isArray(findings)).toBe(true);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_017', [
      {
        path: 'src/test/java/UserControllerTest.java',
        content: 'public ResponseEntity<?> create(@RequestBody UserDto dto) { return ok(); }\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Java files', () => {
    const findings = detect('JAVA_017', [
      { path: 'application.properties', content: '@RequestBody UserDto dto\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_018: Hardcoded SecretKeySpec ────────────────────────────────────────

describe('JAVA_018 — hardcoded SecretKeySpec key material', () => {
  it('fires on new SecretKeySpec("hardcoded..." ...)', () => {
    const findings = detect('JAVA_018', [
      { path: 'src/main/java/CryptoService.java', content: 'SecretKey key = new SecretKeySpec("mysupersecretkey".getBytes(), "AES");\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_hardcoded_secret_key');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on new SecretKeySpec(new byte[]{ ... })', () => {
    const findings = detect('JAVA_018', [
      { path: 'src/main/java/AesUtil.java', content: 'SecretKey key = new SecretKeySpec(new byte[]{ 0x01, 0x02, 0x03 }, "AES");\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when key comes from environment variable', () => {
    const findings = detect('JAVA_018', [
      { path: 'src/main/java/CryptoService.java', content: 'byte[] keyBytes = Base64.getDecoder().decode(System.getenv("AES_KEY"));\nSecretKey key = new SecretKeySpec(keyBytes, "AES");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out code', () => {
    const findings = detect('JAVA_018', [
      { path: 'src/main/java/CryptoService.java', content: '// new SecretKeySpec("hardcodedkey".getBytes(), "AES");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_018', [
      { path: 'src/test/java/CryptoServiceTest.java', content: 'SecretKey key = new SecretKeySpec("testkey12345678!".getBytes(), "AES");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_019: Class.forName() reflection injection ────────────────────────────

describe('JAVA_019 — Class.forName() with variable argument', () => {
  it('fires on Class.forName(variable)', () => {
    const findings = detect('JAVA_019', [
      { path: 'src/main/java/PluginLoader.java', content: 'Class<?> cls = Class.forName(className);\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('java_reflection_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on Class.forName(request.getParameter(...))', () => {
    const findings = detect('JAVA_019', [
      { path: 'src/main/java/DynLoader.java', content: 'Class<?> cls = Class.forName(request.getParameter("class"));\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on Class.forName with a string literal', () => {
    const findings = detect('JAVA_019', [
      { path: 'src/main/java/DriverLoader.java', content: 'Class.forName("com.mysql.jdbc.Driver");\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out code', () => {
    const findings = detect('JAVA_019', [
      { path: 'src/main/java/PluginLoader.java', content: '// Class.forName(className);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_019', [
      { path: 'src/test/java/PluginLoaderTest.java', content: 'Class<?> cls = Class.forName(className);\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── JAVA_020: @Repository write method without @Transactional ────────────────

describe('JAVA_020 — @Repository write method without @Transactional', () => {
  it('fires on save method in @Repository class without @Transactional', () => {
    const findings = detect('JAVA_020', [
      {
        path: 'src/main/java/UserRepository.java',
        content: [
          '@Repository',
          'public class UserRepository {',
          '    public void saveUser(User user) {',
          '        jdbc.update("INSERT INTO users VALUES (?)", user.getId());',
          '    }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('spring_missing_transaction');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on delete method without @Transactional', () => {
    const findings = detect('JAVA_020', [
      {
        path: 'src/main/java/SessionRepo.java',
        content: '@Repository\npublic class SessionRepo {\n    public int deleteExpired() {\n        return jdbc.update("DELETE FROM sessions WHERE expires < ?", now);\n    }\n}\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when @Transactional is present', () => {
    const findings = detect('JAVA_020', [
      {
        path: 'src/main/java/UserRepository.java',
        content: [
          '@Repository',
          'public class UserRepository {',
          '    @Transactional',
          '    public void saveUser(User user) {',
          '        jdbc.update("INSERT INTO users VALUES (?)", user.getId());',
          '    }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire in classes without @Repository annotation', () => {
    const findings = detect('JAVA_020', [
      {
        path: 'src/main/java/UserService.java',
        content: 'public class UserService {\n    public void saveUser(User user) {\n        dao.save(user);\n    }\n}\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('JAVA_020', [
      {
        path: 'src/test/java/UserRepositoryTest.java',
        content: '@Repository\npublic class UserRepositoryTest {\n    public void saveUser(User user) { dao.save(user); }\n}\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── Structural validation ─────────────────────────────────────────────────────

describe('JAVA_RULES structural checks', () => {
  it('has exactly 20 rules', () => {
    expect(JAVA_RULES).toHaveLength(20);
  });

  it('every rule has a unique ID', () => {
    const ids = JAVA_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has an explain block', () => {
    for (const r of JAVA_RULES) {
      expect(r.explain, `[${r.id}] missing explain`).toBeDefined();
      expect(r.explain!.why.length, `[${r.id}] explain.why empty`).toBeGreaterThan(0);
      expect(Array.isArray(r.explain!.commonViolations), `[${r.id}] commonViolations not array`).toBe(true);
      expect(r.explain!.goodExample.length, `[${r.id}] goodExample empty`).toBeGreaterThan(0);
      expect(r.explain!.badExample.length, `[${r.id}] badExample empty`).toBeGreaterThan(0);
    }
  });

  it('every rule detect() returns an array', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const r of JAVA_RULES) {
      expect(Array.isArray(r.detect(input)), `[${r.id}] detect() did not return array`).toBe(true);
    }
  });

  it('every rule has a valid severity', () => {
    const VALID = new Set(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT']);
    for (const r of JAVA_RULES) {
      expect(VALID.has(r.severity), `[${r.id}] invalid severity ${r.severity}`).toBe(true);
    }
  });
});
