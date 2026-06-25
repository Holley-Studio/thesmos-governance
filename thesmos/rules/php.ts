// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, Finding, DetectInput } from '../types.js';
import { classifySeverity } from '../severity.js';

const isPhpFile = (p: string) => /\.php$/.test(p);
const isBladeTemplate = (p: string) => /\.blade\.php$/.test(p);
const isPhpTest = (p: string) => /Test\.php$|\/[Tt]ests?\/|_test\.php$/.test(p);

export const PHP_RULES: ThesmosRule[] = [
  // ── PHP_001: SQL injection via concatenation ─────────────────────────────
  {
    id: 'PHP_001',
    category: 'php_sql_injection',
    description: 'SQL query built by string concatenation with a variable — SQL injection.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Concatenating variables directly into SQL strings is the canonical SQL injection vector. AI-generated PHP frequently builds queries with . $var for convenience without understanding the risk.',
      commonViolations: [
        '$result = $db->query("SELECT * FROM users WHERE id = " . $_GET["id"]);',
        '$pdo->query("SELECT * FROM users WHERE name = \'" . $name . "\'");',
      ],
      goodExample: '$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");\n$stmt->execute([$_GET["id"]]);',
      badExample: '$result = $db->query("SELECT * FROM users WHERE id = " . $_GET["id"]); // ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      // Match query/exec/execute("string" . $var) or ($var . "string")
      const SQL_CONCAT_RE = /(?:->query|->exec|->execute|mysql_query|mysqli_query)\s*\(\s*["'][^"']*["']\s*\.\s*\$/i;
      const SQL_CONCAT_RE2 = /(?:->query|->exec|->execute|mysql_query|mysqli_query)\s*\(\s*\$\w+\s*\.\s*["']/i;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (SQL_CONCAT_RE.test(line) || SQL_CONCAT_RE2.test(line)) {
            findings.push({
              severity: sev, category: 'php_sql_injection', file: path, line: i + 1,
              message: 'SQL query built by string concatenation — SQL injection vulnerability.',
              suggestion: 'Use prepared statements: $stmt = $pdo->prepare("... WHERE id = ?"); $stmt->execute([$id]);',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_002: SQL injection via double-quoted interpolation ────────────────
  {
    id: 'PHP_002',
    category: 'php_sql_interpolation',
    description: 'PDO or mysqli query uses PHP variable interpolation inside the SQL string.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'PHP expands variables inside double-quoted strings: "WHERE id = $id" is functionally identical to concatenation. AI assistants rely on this for brevity, producing SQL injection vulnerabilities.',
      commonViolations: [
        '$pdo->query("SELECT * FROM users WHERE id = $id");',
        '$mysqli->query("DELETE FROM sessions WHERE token = \'$token\'");',
      ],
      goodExample: '$stmt = $pdo->prepare("SELECT * FROM users WHERE id = :id");\n$stmt->execute([":id" => $id]);',
      badExample: '$pdo->query("SELECT * FROM users WHERE id = $id"); // ❌ variable interpolated into SQL',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_sql_interpolation', config.severityRules);
      const findings: Finding[] = [];
      // ->query("...  $var  ...") — variable inside double-quoted SQL string
      const INTERP_RE = /(?:->query|->exec|->execute|mysql_query|mysqli_query)\s*\(\s*"[^"]*\$\w/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (INTERP_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'php_sql_interpolation', file: path, line: i + 1,
              message: 'Variable interpolated inside SQL query string — SQL injection risk.',
              suggestion: 'Use named or positional placeholders with prepare()/execute().',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_003: XSS via unescaped echo ──────────────────────────────────────
  {
    id: 'PHP_003',
    category: 'php_xss_echo',
    description: 'User superglobal ($_GET/$_POST/$_REQUEST) echoed without htmlspecialchars().',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'xss', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Directly echoing $_GET, $_POST, or $_REQUEST values renders whatever HTML/JS the attacker submits — reflected XSS. AI-generated PHP frequently echoes form fields for repopulation without escaping.',
      commonViolations: [
        'echo $_GET["name"];',
        'echo "Hello " . $_POST["username"];',
      ],
      goodExample: 'echo htmlspecialchars($_GET["name"], ENT_QUOTES, "UTF-8");',
      badExample: 'echo $_GET["name"]; // ❌ reflected XSS',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_xss_echo', config.severityRules);
      const findings: Finding[] = [];
      const ECHO_SUPERGLOBAL_RE = /(?:echo|print)\b[^;]*\$_(?:GET|POST|REQUEST|COOKIE)\b/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (ECHO_SUPERGLOBAL_RE.test(line) && !/htmlspecialchars|htmlentities|strip_tags|e\(/.test(line)) {
            findings.push({
              severity: sev, category: 'php_xss_echo', file: path, line: i + 1,
              message: 'User input echoed without escaping — reflected XSS vulnerability.',
              suggestion: 'Wrap with htmlspecialchars($val, ENT_QUOTES, "UTF-8") before outputting.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_004: eval() usage ─────────────────────────────────────────────────
  {
    id: 'PHP_004',
    category: 'php_eval_usage',
    description: 'eval() executes arbitrary PHP — code injection if input is attacker-controlled.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'code-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'eval() compiles and runs a string as PHP code. Any attacker-controlled input reaching eval() grants full code execution. Even "safe" uses are fragile and banned by most security policies.',
      commonViolations: [
        'eval($_POST["code"]);',
        'eval("$output = " . $userFormula . ";");',
      ],
      goodExample: '// Use a safe expression evaluator library instead of eval()',
      badExample: 'eval($_POST["code"]); // ❌ remote code execution',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_eval_usage', config.severityRules);
      const findings: Finding[] = [];
      const EVAL_RE = /\beval\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue; // skip comment lines
          if (EVAL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'php_eval_usage', file: path, line: i + 1,
              message: 'eval() found — arbitrary code execution risk.',
              suggestion: 'Remove eval(). Use a whitelist, dedicated expression parser, or template engine.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_005: command injection ────────────────────────────────────────────
  {
    id: 'PHP_005',
    category: 'php_command_injection',
    description: 'Shell command executed with user-controlled input — command injection.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'command-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'system(), exec(), shell_exec(), and passthru() run OS commands. Attacker-controlled input enables appending additional commands via ; && | characters.',
      commonViolations: [
        'system("convert " . $_GET["file"] . " output.png");',
        'exec("ping " . $ip);',
      ],
      goodExample: '$file = escapeshellarg($_GET["file"]);\nsystem("convert $file output.png");',
      badExample: 'system("convert " . $_GET["file"] . " output.png"); // ❌ command injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_command_injection', config.severityRules);
      const findings: Finding[] = [];
      // Shell functions with superglobal or concatenation of variable
      const CMD_SUPERGLOBAL_RE = /(?:system|exec|shell_exec|passthru|popen)\s*\([^)]*\$_(?:GET|POST|REQUEST|COOKIE)/;
      const CMD_CONCAT_RE = /(?:system|exec|shell_exec|passthru|popen)\s*\(\s*["'][^"']+["']\s*\.\s*\$/;
      const BACKTICK_RE = /`[^`]*\$_(?:GET|POST|REQUEST)/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if ((CMD_SUPERGLOBAL_RE.test(line) || CMD_CONCAT_RE.test(line) || BACKTICK_RE.test(line))
              && !/escapeshellarg|escapeshellcmd/.test(line)) {
            findings.push({
              severity: sev, category: 'php_command_injection', file: path, line: i + 1,
              message: 'Shell command built with user input — command injection risk.',
              suggestion: 'Use escapeshellarg() on every user-supplied argument, or use proc_open() with an array argv.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_006: open redirect ────────────────────────────────────────────────
  {
    id: 'PHP_006',
    category: 'php_open_redirect',
    description: 'HTTP redirect destination taken directly from user input without validation.',
    severity: 'HIGH',
    tags: ['security', 'php', 'redirect', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Open redirects enable phishing: attackers craft links to your trusted domain that immediately redirect to a malicious site. PHP auth flows often redirect to a "next" parameter without validating it.',
      commonViolations: [
        'header("Location: " . $_GET["redirect"]);',
        "header('Location: ' . $_POST['next']);",
      ],
      goodExample: '$allowed = ["/dashboard", "/profile"];\n$dest = in_array($_GET["redirect"], $allowed) ? $_GET["redirect"] : "/dashboard";\nheader("Location: $dest");',
      badExample: 'header("Location: " . $_GET["redirect"]); // ❌ open redirect',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_open_redirect', config.severityRules);
      const findings: Finding[] = [];
      const REDIRECT_RE = /header\s*\(\s*["']Location:\s*["']\s*\.\s*\$_(?:GET|POST|REQUEST|COOKIE)/i;
      const REDIRECT_INTERP_RE = /header\s*\(\s*"Location:\s*\$_(?:GET|POST|REQUEST|COOKIE)/i;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (REDIRECT_RE.test(line) || REDIRECT_INTERP_RE.test(line)) {
            findings.push({
              severity: sev, category: 'php_open_redirect', file: path, line: i + 1,
              message: 'HTTP redirect destination from user input — open redirect vulnerability.',
              suggestion: 'Validate redirect URL against an allowlist of known-safe paths before redirecting.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_007: path traversal / local file inclusion ────────────────────────
  {
    id: 'PHP_007',
    category: 'php_path_traversal',
    description: 'File path or include built from user input — path traversal / LFI.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'path-traversal', 'lfi', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Building file paths from user input allows ../../../etc/passwd traversal. include() with user input can load and execute arbitrary PHP files — local file inclusion leading to RCE.',
      commonViolations: [
        'include($_GET["page"] . ".php");',
        'file_get_contents("uploads/" . $_GET["file"]);',
      ],
      goodExample: '$allowed = ["home", "about", "contact"];\n$page = in_array($_GET["page"], $allowed) ? $_GET["page"] : "home";\ninclude("pages/$page.php");',
      badExample: 'include($_GET["page"] . ".php"); // ❌ local file inclusion',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const LFI_RE = /(?:include|require|include_once|require_once|file_get_contents|file_put_contents|readfile|fopen)\s*\([^)]*\$_(?:GET|POST|REQUEST|COOKIE)/;
      const LFI_CONCAT_RE = /(?:include|require|include_once|require_once)\s*\(\s*["'][^"']*["']\s*\.\s*\$_(?:GET|POST)/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (LFI_RE.test(line) || LFI_CONCAT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'php_path_traversal', file: path, line: i + 1,
              message: 'File path built from user input — path traversal / local file inclusion.',
              suggestion: 'Use an allowlist of permitted filenames. Never build file paths from raw user input.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_008: Laravel mass assignment ($guarded = []) ─────────────────────
  {
    id: 'PHP_008',
    category: 'laravel_mass_assignment',
    description: 'Eloquent model with $guarded = [] allows mass assignment of all attributes.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'laravel', 'mass-assignment', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Without a $fillable allowlist, Eloquent allows any column to be mass-assigned via create() or update(). AI assistants set $guarded = [] to silence MassAssignmentException without understanding that attackers can then set is_admin=1 or role=superuser.',
      commonViolations: [
        'protected $guarded = [];',
      ],
      goodExample: 'class User extends Model {\n  protected $fillable = ["name", "email", "password"];\n}',
      badExample: 'class User extends Model {\n  protected $guarded = []; // ❌ all fields mass-assignable\n}',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('laravel_mass_assignment', config.severityRules);
      const findings: Finding[] = [];
      const GUARDED_RE = /protected\s+\$guarded\s*=\s*\[\s*\]/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (GUARDED_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'laravel_mass_assignment', file: path, line: i + 1,
              message: '$guarded = [] — all model attributes are mass-assignable.',
              suggestion: 'Replace with an explicit $fillable list: protected $fillable = ["name", "email"];',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_009: Laravel *Raw() with interpolation ────────────────────────────
  {
    id: 'PHP_009',
    category: 'laravel_raw_query',
    description: 'Laravel whereRaw(), selectRaw(), or DB::raw() with PHP variable interpolation.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'laravel', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Raw SQL methods bypass Eloquent\'s parameter binding. Variable interpolation inside them is SQL injection.',
      commonViolations: [
        'User::whereRaw("name = \'$name\'")->get();',
        'DB::select(DB::raw("SELECT * FROM users WHERE id = $id"));',
      ],
      goodExample: '$users = User::whereRaw("name = ?", [$name])->get();\n// or use the query builder: User::where("name", $name)->get();',
      badExample: 'User::whereRaw("name = \'$name\'")->get(); // ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('laravel_raw_query', config.severityRules);
      const findings: Finding[] = [];
      // *Raw("... $var ...") — interpolated variable inside the SQL string argument
      const RAW_INTERP_RE = /(?:whereRaw|orWhereRaw|selectRaw|havingRaw|orderByRaw|groupByRaw|DB::raw)\s*\(\s*"[^"]*\$\w/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (RAW_INTERP_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'laravel_raw_query', file: path, line: i + 1,
              message: 'Raw SQL method with variable interpolation — SQL injection risk.',
              suggestion: 'Pass values as bindings: whereRaw("col = ?", [$val]) instead of interpolating.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_010: Laravel apiResource route missing auth middleware ────────────
  {
    id: 'PHP_010',
    category: 'laravel_missing_auth_middleware',
    description: 'Laravel apiResource/resource route defined without auth middleware in context.',
    severity: 'HIGH',
    tags: ['security', 'php', 'laravel', 'auth', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'AI assistants building Laravel APIs frequently define routes without auth:sanctum or auth middleware, leaving all CRUD endpoints publicly accessible. Route groups with ->middleware("auth") require authentication for every route inside.',
      commonViolations: [
        'Route::apiResource("users", UserController::class);',
      ],
      goodExample: 'Route::middleware("auth:sanctum")->group(function () {\n  Route::apiResource("users", UserController::class);\n});',
      badExample: 'Route::apiResource("users", UserController::class); // ❌ no auth middleware',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('laravel_missing_auth_middleware', config.severityRules);
      const findings: Finding[] = [];
      const ROUTE_RE = /Route\s*::\s*(?:apiResource|resource)\s*\(/;
      // Match both ->middleware('auth...') (chained) and Route::middleware('auth...') (static)
      const AUTH_RE = /(?:->|::)middleware\s*\(\s*(?:["']auth|\[)/;
      const WINDOW = 4;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        // Only check route definition files
        if (!/routes\/|web\.php$|api\.php$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!ROUTE_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - WINDOW);
          const end = Math.min(lines.length, i + WINDOW + 1);
          const window = lines.slice(start, end).join('\n');
          if (!AUTH_RE.test(window)) {
            findings.push({
              severity: sev, category: 'laravel_missing_auth_middleware', file: path, line: i + 1,
              message: 'apiResource/resource route without auth middleware — unauthenticated access possible.',
              suggestion: 'Wrap in Route::middleware("auth:sanctum")->group(...) or chain ->middleware("auth").',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_011: file upload without MIME validation ──────────────────────────
  {
    id: 'PHP_011',
    category: 'php_file_upload_no_validation',
    description: 'move_uploaded_file() called without MIME type validation in surrounding context.',
    severity: 'HIGH',
    tags: ['security', 'php', 'file-upload', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Accepting file uploads without validating MIME type allows webshell uploads. AI-generated upload handlers often only check file size, ignoring the content type.',
      commonViolations: [
        'move_uploaded_file($_FILES["file"]["tmp_name"], "uploads/" . $_FILES["file"]["name"]);',
      ],
      goodExample: '$finfo = new finfo(FILEINFO_MIME_TYPE);\n$mime = $finfo->file($_FILES["file"]["tmp_name"]);\nif (!in_array($mime, ["image/jpeg", "image/png"])) { throw new RuntimeException("Invalid"); }',
      badExample: 'move_uploaded_file($_FILES["file"]["tmp_name"], "uploads/file"); // ❌ no type check',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_file_upload_no_validation', config.severityRules);
      const findings: Finding[] = [];
      const UPLOAD_RE = /move_uploaded_file\s*\(\s*\$_FILES/;
      const MIME_RE = /finfo|mime_content_type|getimagesize|FILEINFO_MIME/;
      const WINDOW = 10;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!UPLOAD_RE.test(lines[i]!)) continue;
          const start = Math.max(0, i - WINDOW);
          const end = Math.min(lines.length, i + WINDOW + 1);
          const window = lines.slice(start, end).join('\n');
          if (!MIME_RE.test(window)) {
            findings.push({
              severity: sev, category: 'php_file_upload_no_validation', file: path, line: i + 1,
              message: 'File uploaded without MIME type validation — webshell upload risk.',
              suggestion: 'Validate MIME type with finfo before moving the file. Never trust $_FILES["type"].',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_012: unserialize() on user input ─────────────────────────────────
  {
    id: 'PHP_012',
    category: 'php_deserialization',
    description: 'unserialize() on user-supplied data — PHP object injection / RCE.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'deserialization', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'unserialize() on attacker-controlled data triggers __wakeup()/__destruct() magic methods on arbitrary classes, enabling remote code execution via PHP object injection gadget chains.',
      commonViolations: [
        'unserialize($_COOKIE["user"]);',
        'unserialize(base64_decode($_GET["data"]));',
      ],
      goodExample: '// Use JSON for data interchange — it cannot contain PHP objects\n$data = json_decode($_COOKIE["user"], true);',
      badExample: '$user = unserialize($_COOKIE["user"]); // ❌ PHP object injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_deserialization', config.severityRules);
      const findings: Finding[] = [];
      const UNSER_RE = /unserialize\s*\([^)]*\$_(?:GET|POST|REQUEST|COOKIE|SESSION)/;
      const UNSER_WRAPPED_RE = /unserialize\s*\([^)]*(?:base64_decode|urldecode)\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (UNSER_RE.test(line) || UNSER_WRAPPED_RE.test(line)) {
            findings.push({
              severity: sev, category: 'php_deserialization', file: path, line: i + 1,
              message: 'unserialize() on user input — PHP object injection / RCE risk.',
              suggestion: 'Use json_decode() for user-supplied data. Never unserialize untrusted input.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_013: Laravel APP_DEBUG=true ──────────────────────────────────────
  {
    id: 'PHP_013',
    category: 'laravel_debug_true',
    description: "APP_DEBUG=true in .env or hardcoded 'debug' => true in config/app.php.",
    severity: 'HIGH',
    tags: ['security', 'php', 'laravel', 'config', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: "Debug mode exposes full stack traces, environment variables, and config values in HTTP error responses. Laravel's debug page leaks database credentials, API keys, and file paths to any visitor.",
      commonViolations: [
        'APP_DEBUG=true  // .env',
        "'debug' => true,  // config/app.php without env() wrapper",
      ],
      goodExample: "APP_DEBUG=false  # production .env\n// config/app.php:\n'debug' => env('APP_DEBUG', false),",
      badExample: "APP_DEBUG=true  # ❌ leaks stack traces and credentials",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('laravel_debug_true', config.severityRules);
      const findings: Finding[] = [];
      const DEBUG_PHP_RE = /['"]debug['"]\s*=>\s*true\b/;
      for (const { path, content } of changedFiles) {
        const isEnvFile = /\.env(?:\.example)?$/.test(path);
        const isConfigFile = /config\/app\.php$/.test(path);
        if (!isEnvFile && !isConfigFile) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (isEnvFile && /^APP_DEBUG\s*=\s*true\b/.test(line)) {
            findings.push({
              severity: sev, category: 'laravel_debug_true', file: path, line: i + 1,
              message: 'APP_DEBUG=true — debug mode exposes stack traces and credentials.',
              suggestion: 'Set APP_DEBUG=false. Use APP_DEBUG=${APP_DEBUG:-false} or env variable injection.',
            });
          }
          if (isConfigFile && DEBUG_PHP_RE.test(line) && !/env\s*\(/.test(line)) {
            findings.push({
              severity: sev, category: 'laravel_debug_true', file: path, line: i + 1,
              message: "Hardcoded 'debug' => true in config — use env('APP_DEBUG', false) instead.",
              suggestion: "Replace with 'debug' => env('APP_DEBUG', false).",
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_014: weak password hashing (md5/sha1) ────────────────────────────
  {
    id: 'PHP_014',
    category: 'php_weak_password_hash',
    description: 'md5() or sha1() used for password hashing instead of password_hash().',
    severity: 'HIGH',
    tags: ['security', 'php', 'crypto', 'password', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'MD5 and SHA-1 are fast — an attacker with a stolen hash table can brute-force all common passwords in seconds via GPU acceleration. password_hash() uses bcrypt/argon2 with a configurable work factor designed for password storage.',
      commonViolations: [
        '$hash = md5($password);',
        'if ($user->password === sha1($input)) { ... }',
      ],
      goodExample: '$hash = password_hash($password, PASSWORD_ARGON2ID);\nif (password_verify($input, $hash)) { ... }',
      badExample: '$hash = md5($password); // ❌ trivially crackable',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_weak_password_hash', config.severityRules);
      const findings: Finding[] = [];
      // md5/sha1 applied to a variable named password/passwd/pass/pwd/secret
      const WEAK_HASH_RE = /\b(?:md5|sha1)\s*\(\s*\$(?:password|passwd|pass|pwd|secret)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (WEAK_HASH_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'php_weak_password_hash', file: path, line: i + 1,
              message: 'md5()/sha1() used for password hashing — trivially crackable.',
              suggestion: 'Use password_hash($password, PASSWORD_ARGON2ID) and password_verify().',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_015: Blade form missing @csrf ────────────────────────────────────
  {
    id: 'PHP_015',
    category: 'laravel_missing_csrf',
    description: 'Blade form with POST/PUT/PATCH/DELETE method but no @csrf directive.',
    severity: 'HIGH',
    tags: ['security', 'php', 'laravel', 'csrf', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: "Laravel's VerifyCsrfToken middleware only protects forms that include @csrf. AI-generated Blade templates frequently omit this directive, leaving every mutating form open to cross-site request forgery.",
      commonViolations: [
        '<form method="POST" action="/profile">\n  <!-- no @csrf -->\n  <input name="email">',
      ],
      goodExample: '<form method="POST" action="/profile">\n  @csrf\n  <input name="email" type="email">\n</form>',
      badExample: '<form method="POST" action="/profile">\n  <!-- ❌ missing @csrf -->\n</form>',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('laravel_missing_csrf', config.severityRules);
      const findings: Finding[] = [];
      const FORM_RE = /<form\b[^>]*method\s*=\s*["'](?:POST|PUT|PATCH|DELETE|post|put|patch|delete)["'][^>]*>/i;
      const CSRF_RE = /@csrf\b/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isBladeTemplate(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!FORM_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          const window = lines.slice(i, end).join('\n');
          if (!CSRF_RE.test(window)) {
            findings.push({
              severity: sev, category: 'laravel_missing_csrf', file: path, line: i + 1,
              message: 'Blade form with mutation method missing @csrf — CSRF vulnerability.',
              suggestion: 'Add @csrf as the first element inside the <form> tag.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_016: extract() on superglobals ───────────────────────────────────
  {
    id: 'PHP_016',
    category: 'php_extract_superglobal',
    description: 'extract() on $_GET/$_POST/$_REQUEST creates arbitrary local variables from user input.',
    severity: 'HIGH',
    tags: ['security', 'php', 'variable-injection', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'extract() imports array keys as local variable names. Calling it on user input lets attackers overwrite any local variable by crafting request parameters — including $isAdmin or database handles.',
      commonViolations: [
        'extract($_POST);',
        'extract($_GET, EXTR_SKIP);',
      ],
      goodExample: '$name = $_POST["name"] ?? "";\n$email = $_POST["email"] ?? "";',
      badExample: 'extract($_POST); // ❌ attacker controls all local variables',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_extract_superglobal', config.severityRules);
      const findings: Finding[] = [];
      const EXTRACT_RE = /\bextract\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (EXTRACT_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'php_extract_superglobal', file: path, line: i + 1,
              message: 'extract() on user input — attacker can overwrite any local variable.',
              suggestion: 'Access request parameters individually: $name = $_POST["name"] ?? "";',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_017: session fixation ─────────────────────────────────────────────
  {
    id: 'PHP_017',
    category: 'php_session_fixation',
    description: 'session_id() set from user input — session fixation attack.',
    severity: 'HIGH',
    tags: ['security', 'php', 'session', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Session fixation: attacker plants a known session ID, victim logs in, attacker hijacks the now-authenticated session. Calling session_id() with GET/POST/COOKIE input is the canonical PHP session fixation vulnerability.',
      commonViolations: [
        'session_id($_GET["sid"]);',
        'session_id($_COOKIE["PHPSESSID"]);',
      ],
      goodExample: '// Always regenerate on login — never accept IDs from user input\nsession_regenerate_id(true);',
      badExample: 'session_id($_GET["sid"]); // ❌ session fixation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_session_fixation', config.severityRules);
      const findings: Finding[] = [];
      const SESSION_FIXATION_RE = /\bsession_id\s*\(\s*\$_(?:GET|POST|REQUEST|COOKIE)/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (SESSION_FIXATION_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'php_session_fixation', file: path, line: i + 1,
              message: 'session_id() set from user input — session fixation attack possible.',
              suggestion: 'Never set session_id() from request data. Call session_regenerate_id(true) after login.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_018: SSRF via curl / file_get_contents ───────────────────────────
  {
    id: 'PHP_018',
    category: 'php_ssrf',
    description: 'HTTP request or file fetch with URL from user input — Server-Side Request Forgery.',
    severity: 'BLOCKER',
    tags: ['security', 'php', 'ssrf', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'SSRF lets attackers proxy requests through the server to internal services — AWS metadata at 169.254.169.254, Redis, internal APIs — unreachable from outside. AI "fetch from URL" features routinely accept user-provided URLs without host validation.',
      commonViolations: [
        'file_get_contents($_GET["url"]);',
        'curl_setopt($ch, CURLOPT_URL, $request->input("url"));',
      ],
      goodExample: '$host = parse_url($_GET["url"], PHP_URL_HOST);\nif (!in_array($host, $allowedHosts)) { abort(400); }\nfile_get_contents($_GET["url"]);',
      badExample: 'file_get_contents($_GET["url"]); // ❌ SSRF — can reach internal services',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_ssrf', config.severityRules);
      const findings: Finding[] = [];
      const SSRF_FGC_RE = /file_get_contents\s*\(\s*\$_(?:GET|POST|REQUEST)/;
      const SSRF_CURL_RE = /curl_setopt\s*\([^,]+,\s*CURLOPT_URL\s*,[^)]*\$_(?:GET|POST|REQUEST)/;
      const SSRF_SAFE_RE = /parse_url|allowlist|whitelist/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (SSRF_FGC_RE.test(line) || SSRF_CURL_RE.test(line)) {
            const start = Math.max(0, i - WINDOW);
            const end = Math.min(lines.length, i + WINDOW + 1);
            const ctx = lines.slice(start, end).join('\n');
            if (!SSRF_SAFE_RE.test(ctx)) {
              findings.push({
                severity: sev, category: 'php_ssrf', file: path, line: i + 1,
                message: 'HTTP request or file fetch using user-supplied URL — SSRF vulnerability.',
                suggestion: 'Validate the URL host against an explicit allowlist using parse_url() before fetching.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_019: hardcoded credentials ───────────────────────────────────────
  {
    id: 'PHP_019',
    category: 'php_hardcoded_credentials',
    description: 'Password, API key, or secret hardcoded directly in PHP source code.',
    severity: 'HIGH',
    tags: ['security', 'php', 'secrets', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Hardcoded credentials end up in version control, build artifacts, and deployed code — any developer with repo access can read them. Credentials belong in environment variables or a secrets manager.',
      commonViolations: [
        "'password' => 'supersecret123',",
        "define('DB_PASSWORD', 'hunter2');",
      ],
      goodExample: "'password' => env('DB_PASSWORD'),\n$apiKey = $_ENV['STRIPE_SECRET_KEY'];",
      badExample: "define('DB_PASSWORD', 'hunter2'); // ❌ hardcoded credential",
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('php_hardcoded_credentials', config.severityRules);
      const findings: Finding[] = [];
      const CRED_KEY_RE = /(?:password|passwd|secret|api_?key|auth_?token)\s*['"]\s*=>\s*['"][^'"]{6,}['"]/i;
      const DEFINE_CRED_RE = /define\s*\(\s*['"](?:DB_PASSWORD|API_KEY|SECRET_KEY|AUTH_TOKEN|APP_SECRET)['"]\s*,\s*['"][^'"]{4,}['"]\s*\)/i;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*(?:\/\/|#|\*)/.test(line)) continue;
          if ((CRED_KEY_RE.test(line) || DEFINE_CRED_RE.test(line)) && !/env\s*\(|getenv\s*\(|\$_ENV|\$_SERVER/.test(line)) {
            findings.push({
              severity: sev, category: 'php_hardcoded_credentials', file: path, line: i + 1,
              message: 'Credential or secret hardcoded in PHP source — use environment variables.',
              suggestion: "Use env('MY_SECRET') (Laravel) or getenv('MY_SECRET') / \\$_ENV['MY_SECRET'].",
            });
          }
        }
      }
      return findings;
    },
  },

  // ── PHP_020: $request->all() passed to create()/update() ─────────────────
  {
    id: 'PHP_020',
    category: 'laravel_request_all_mass_assign',
    description: 'Model::create() or ->update() called with $request->all() — unfiltered mass assignment.',
    severity: 'HIGH',
    tags: ['security', 'php', 'laravel', 'mass-assignment', 'vibe-coding'],
    sinceVersion: '1.5.0',
    explain: {
      why: "Passing $request->all() to Eloquent's create() or update() is mass assignment even when $fillable is set — the controller should only pass the specific fields it intends to write. AI assistants routinely generate User::create($request->all()) as a one-liner shortcut.",
      commonViolations: [
        'User::create($request->all());',
        '$post->update($request->input());',
      ],
      goodExample: "User::create($request->validated());\n// or\nUser::create($request->only(['name', 'email', 'password']));",
      badExample: 'User::create($request->all()); // ❌ passes every request field to the model',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('laravel_request_all_mass_assign', config.severityRules);
      const findings: Finding[] = [];
      const REQ_ALL_RE = /(?:::create|->update)\s*\(\s*\$request->(?:all|input)\s*\(\s*\)\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isPhpFile(path) || isPhpTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (REQ_ALL_RE.test(lines[i]!)) {
            findings.push({
              severity: sev, category: 'laravel_request_all_mass_assign', file: path, line: i + 1,
              message: '$request->all() passed to create()/update() — unfiltered mass assignment.',
              suggestion: 'Use $request->validated() or $request->only([...]) to allowlist specific fields.',
            });
          }
        }
      }
      return findings;
    },
  },
];
