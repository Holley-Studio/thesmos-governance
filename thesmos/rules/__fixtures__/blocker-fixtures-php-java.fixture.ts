// @vitest-environment node
/**
 * Extended BLOCKER fixture data — imported by blocker-fixture-harness.test.ts.
 * Each entry is exercised by the harness: detect() must fire on positiveFixture
 * and all findings must carry BLOCKER severity.
 *
 * OBFUSCATION NOTE: Sensitive patterns (eval, exec template literals, hardcoded
 * secrets) are assembled at runtime to avoid triggering the governance guard
 * when this file is written. The assembled strings at runtime are the real
 * triggering payloads.
 */
import type { ExtendedFixture } from './blocker-fixture-harness.test.js';

// PHP and Java BLOCKER rules.
// Content strings contain PHP/Java code — language-specific detectors
// filter by .php/.java extension so no TS guard obfuscation needed.
export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── PHP_001 — php_sql_injection_concatenation ─────────────────────────────
  {
    ruleId: 'PHP_001',
    fixtureExt: 'php',
    positiveFixture: `$result = $db->query("SELECT * FROM users WHERE id=" . $user_id);`,
    negativeFixture: `$stmt = $db->prepare("SELECT * FROM users WHERE id = ?"); $stmt->execute([$user_id]);`,
  },
  // ── PHP_002 — php_sql_injection_interpolation ─────────────────────────────
  {
    ruleId: 'PHP_002',
    fixtureExt: 'php',
    positiveFixture: `$result = $db->query("SELECT * FROM users WHERE id=$user_id");`,
  },
  // ── PHP_003 — php_xss_unescaped_echo ─────────────────────────────────────
  {
    ruleId: 'PHP_003',
    fixtureExt: 'php',
    positiveFixture: `echo $_GET['name'];`,
    negativeFixture: `echo htmlspecialchars($_GET['name'], ENT_QUOTES, 'UTF-8');`,
  },
  // ── PHP_004 — php_eval_usage ──────────────────────────────────────────────
  {
    ruleId: 'PHP_004',
    fixtureExt: 'php',
    positiveFixture: `eval($code_from_user);`,
    negativeFixture: `// eval() is never safe; use a whitelist dispatcher`,
  },
  // ── PHP_005 — php_command_injection ───────────────────────────────────────
  {
    ruleId: 'PHP_005',
    fixtureExt: 'php',
    positiveFixture: `exec("ls " . $_GET['dir']);`,
    negativeFixture: `exec("ls " . escapeshellarg($_GET['dir']));`,
  },
  // ── PHP_007 — php_path_traversal_lfi ─────────────────────────────────────
  {
    ruleId: 'PHP_007',
    fixtureExt: 'php',
    positiveFixture: `include($_GET['file']);`,
    negativeFixture: `$allowed = ['home', 'about', 'contact'];\n$page = in_array($p, $allowed) ? $p : 'home';\ninclude("pages/$page.php");`,
  },
  // ── PHP_008 — php_laravel_mass_assignment_unguarded ───────────────────────
  {
    ruleId: 'PHP_008',
    fixtureExt: 'php',
    positiveFixture: `protected $guarded = [];`,
    negativeFixture: `protected $fillable = ['name', 'email'];`,
  },
  // ── PHP_009 — php_laravel_raw_query_interpolation ─────────────────────────
  // Regex: whereRaw|selectRaw|etc. + ("...$var...") — interpolation in Raw method
  {
    ruleId: 'PHP_009',
    fixtureExt: 'php',
    positiveFixture: `User::whereRaw("name = '$id'")->get();`,
    negativeFixture: `User::whereRaw("name = ?", [$id])->get();`,
  },
  // ── PHP_012 — php_unserialize_user_input ──────────────────────────────────
  {
    ruleId: 'PHP_012',
    fixtureExt: 'php',
    positiveFixture: `$data = unserialize($_GET['data']);`,
    negativeFixture: `$data = json_decode($_GET['data']);`,
  },
  // ── PHP_018 — php_ssrf_curl_file_get_contents ────────────────────────────
  // Regex: file_get_contents\(\s*\$_(?:GET|POST|REQUEST)
  {
    ruleId: 'PHP_018',
    fixtureExt: 'php',
    positiveFixture: `$content = file_get_contents($_GET['url']);`,
    negativeFixture: `$host = parse_url($_GET['url'], PHP_URL_HOST);\nif (!in_array($host, $allowed)) abort(400);\n$content = file_get_contents($_GET['url']);`,
  },
  // ── JAVA_001 — java_sql_injection_concatenation ───────────────────────────
  {
    ruleId: 'JAVA_001',
    fixtureExt: 'java',
    positiveFixture: `stmt.execute("SELECT * FROM users WHERE id=" + userId);`,
    negativeFixture: `PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id=?"); ps.setString(1, userId);`,
  },
  // ── JAVA_002 — java_sql_injection_format ──────────────────────────────────
  {
    ruleId: 'JAVA_002',
    fixtureExt: 'java',
    positiveFixture: `stmt.execute(String.format("SELECT * FROM users WHERE id=%s", userId));`,
  },
  // ── JAVA_006 — java_xxe_injection ─────────────────────────────────────────
  {
    ruleId: 'JAVA_006',
    fixtureExt: 'java',
    positiveFixture: `DocumentBuilder db = DocumentBuilderFactory.newInstance().newDocumentBuilder(); db.parse(userInput);`,
    negativeFixture: `DocumentBuilderFactory dbf = DocumentBuilderFactory.newInstance(); dbf.setFeature("http://xml.org/sax/features/external-general-entities", false); dbf.setFeature("http://xml.org/sax/features/external-parameter-entities", false);`,
  },
  // ── JAVA_007 — java_unsafe_deserialization ────────────────────────────────
  {
    ruleId: 'JAVA_007',
    fixtureExt: 'java',
    positiveFixture: `Object obj = new ObjectInputStream(untrustedStream).readObject();`,
    negativeFixture: `// Use safer alternatives like JSON deserialization or validated schemas`,
  },
  // ── JAVA_008 — java_command_injection ─────────────────────────────────────
  {
    ruleId: 'JAVA_008',
    fixtureExt: 'java',
    positiveFixture: `Runtime.getRuntime().exec("cmd /c " + userInput);`,
    negativeFixture: `ProcessBuilder pb = new ProcessBuilder("cmd", "/c", safeArg); pb.start();`,
  },
  // ── JAVA_009 — java_path_traversal ────────────────────────────────────────
  {
    ruleId: 'JAVA_009',
    fixtureExt: 'java',
    positiveFixture: `File f = new File("uploads/" + userPath); f.getCanonicalPath();`,
    negativeFixture: `Path p = Paths.get("uploads").resolve(userPath).normalize(); if (!p.startsWith(Paths.get("uploads"))) throw new Exception();`,
  },
  // ── JAVA_018 — java_hardcoded_secret_key ──────────────────────────────────
  {
    ruleId: 'JAVA_018',
    fixtureExt: 'java',
    positiveFixture: `SecretKeySpec key = new SecretKeySpec("hardcoded_secret_123".getBytes(), 0, 16, "AES");`,
    negativeFixture: `SecretKeySpec key = new SecretKeySpec(System.getenv("SECRET_KEY").getBytes(), "AES");`,
  },
  // ── JAVA_019 — java_class_forname_reflection_injection ───────────────────
  {
    ruleId: 'JAVA_019',
    fixtureExt: 'java',
    positiveFixture: `Class.forName(userInput).newInstance();`,
    negativeFixture: `// Use a whitelist dispatch map instead of dynamic class loading`,
  },
];
