import { describe, it, expect } from 'vitest';
import { PHP_RULES } from './php';
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
  const r = PHP_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(id: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(id).detect(input);
}

// ── PHP_001 — SQL injection via concatenation ─────────────────────────────

describe('PHP_001 — SQL injection via string concatenation', () => {
  it('fires on ->query("string" . $var)', () => {
    const findings = detect('PHP_001', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: '$result = $pdo->query("SELECT * FROM users WHERE id = " . $_GET["id"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_sql_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('does not fire on prepared statement', () => {
    const findings = detect('PHP_001', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: '$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");\n$stmt->execute([$id]);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-PHP files', () => {
    const findings = detect('PHP_001', [
      {
        path: 'app/js/main.js',
        content: '$result = $pdo->query("SELECT * FROM users WHERE id = " . $id);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_002 — SQL injection via interpolation ─────────────────────────────

describe('PHP_002 — SQL injection via variable interpolation', () => {
  it('fires on ->query("...  $var  ...")', () => {
    const findings = detect('PHP_002', [
      {
        path: 'app/Http/Controllers/PostController.php',
        content: '$rows = $pdo->query("SELECT * FROM posts WHERE author = \'$name\'");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_sql_interpolation');
  });

  it('does not fire on single-quoted SQL (no interpolation)', () => {
    const findings = detect('PHP_002', [
      {
        path: 'app/Http/Controllers/PostController.php',
        content: "$rows = $pdo->query('SELECT * FROM posts WHERE id = 1');",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on PHP test files', () => {
    const findings = detect('PHP_002', [
      {
        path: 'tests/Unit/UserTest.php',
        content: '$rows = $pdo->query("SELECT * FROM users WHERE id = $id");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_003 — XSS via unescaped echo ─────────────────────────────────────

describe('PHP_003 — XSS via unescaped echo', () => {
  it('fires on echo $_GET["name"]', () => {
    const findings = detect('PHP_003', [
      {
        path: 'public/index.php',
        content: 'echo $_GET["name"];',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_xss_echo');
  });

  it('fires on echo concatenation with $_POST', () => {
    const findings = detect('PHP_003', [
      {
        path: 'public/index.php',
        content: 'echo "Hello " . $_POST["username"];',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when htmlspecialchars is present', () => {
    const findings = detect('PHP_003', [
      {
        path: 'public/index.php',
        content: 'echo htmlspecialchars($_GET["name"], ENT_QUOTES, "UTF-8");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-PHP files', () => {
    const findings = detect('PHP_003', [
      {
        path: 'resources/views/index.html',
        content: 'echo $_GET["name"];',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_004 — eval() usage ────────────────────────────────────────────────

describe('PHP_004 — eval() usage', () => {
  it('fires on eval($_POST["code"])', () => {
    const findings = detect('PHP_004', [
      {
        path: 'app/Http/Controllers/AdminController.php',
        content: 'eval($_POST["code"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_eval_usage');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on eval() with a variable', () => {
    const findings = detect('PHP_004', [
      {
        path: 'app/Http/Controllers/AdminController.php',
        content: 'eval("$output = " . $formula . ";");',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when eval is in a comment', () => {
    const findings = detect('PHP_004', [
      {
        path: 'app/Http/Controllers/AdminController.php',
        content: '// never use eval() in production',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_005 — command injection ───────────────────────────────────────────

describe('PHP_005 — command injection', () => {
  it('fires on system() with superglobal', () => {
    const findings = detect('PHP_005', [
      {
        path: 'app/Http/Controllers/ImageController.php',
        content: 'system("convert " . $_GET["file"] . " output.png");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_command_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on exec() with concatenated variable', () => {
    const findings = detect('PHP_005', [
      {
        path: 'app/Http/Controllers/ImageController.php',
        content: 'exec("ping " . $host);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when escapeshellarg is present', () => {
    const findings = detect('PHP_005', [
      {
        path: 'app/Http/Controllers/ImageController.php',
        content: '$file = escapeshellarg($_GET["file"]);\nsystem("convert $file output.png");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_006 — open redirect ───────────────────────────────────────────────

describe('PHP_006 — open redirect', () => {
  it('fires on header("Location: " . $_GET["redirect"])', () => {
    const findings = detect('PHP_006', [
      {
        path: 'app/Http/Controllers/AuthController.php',
        content: 'header("Location: " . $_GET["redirect"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_open_redirect');
  });

  it('fires on single-quoted Location header', () => {
    const findings = detect('PHP_006', [
      {
        path: 'app/Http/Controllers/AuthController.php',
        content: "header('Location: ' . $_POST['next']);",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on hardcoded redirect', () => {
    const findings = detect('PHP_006', [
      {
        path: 'app/Http/Controllers/AuthController.php',
        content: 'header("Location: /dashboard");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_007 — path traversal / LFI ───────────────────────────────────────

describe('PHP_007 — path traversal / local file inclusion', () => {
  it('fires on include($_GET["page"])', () => {
    const findings = detect('PHP_007', [
      {
        path: 'public/index.php',
        content: 'include($_GET["page"] . ".php");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_path_traversal');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on file_get_contents with superglobal', () => {
    const findings = detect('PHP_007', [
      {
        path: 'app/Http/Controllers/FileController.php',
        content: '$data = file_get_contents("uploads/" . $_GET["file"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on hardcoded file path', () => {
    const findings = detect('PHP_007', [
      {
        path: 'app/Http/Controllers/FileController.php',
        content: '$data = file_get_contents("config/settings.json");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_008 — Laravel mass assignment ────────────────────────────────────

describe('PHP_008 — Laravel mass assignment ($guarded = [])', () => {
  it('fires on protected $guarded = []', () => {
    const findings = detect('PHP_008', [
      {
        path: 'app/Models/User.php',
        content: 'class User extends Model {\n  protected $guarded = [];\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('laravel_mass_assignment');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('does not fire when $fillable is used instead', () => {
    const findings = detect('PHP_008', [
      {
        path: 'app/Models/User.php',
        content: "class User extends Model {\n  protected \$fillable = ['name', 'email'];\n}",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on $guarded with actual values', () => {
    const findings = detect('PHP_008', [
      {
        path: 'app/Models/User.php',
        content: "class User extends Model {\n  protected \$guarded = ['is_admin'];\n}",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_009 — Laravel raw query with interpolation ────────────────────────

describe('PHP_009 — Laravel *Raw() with interpolation', () => {
  it('fires on whereRaw with interpolated variable', () => {
    const findings = detect('PHP_009', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: "$users = User::whereRaw(\"name = '$name'\")->get();",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('laravel_raw_query');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on selectRaw with interpolated variable', () => {
    const findings = detect('PHP_009', [
      {
        path: 'app/Http/Controllers/ReportController.php',
        content: '$rows = DB::table("orders")->selectRaw("SUM(total) as sum WHERE user_id = $userId")->get();',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on whereRaw with bindings', () => {
    const findings = detect('PHP_009', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: "$users = User::whereRaw('name = ?', [\$name])->get();",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_010 — Laravel missing auth middleware ─────────────────────────────

describe('PHP_010 — Laravel apiResource missing auth middleware', () => {
  it('fires on apiResource route without auth in context', () => {
    const findings = detect('PHP_010', [
      {
        path: 'routes/api.php',
        content: "<?php\nRoute::apiResource('users', UserController::class);",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('laravel_missing_auth_middleware');
  });

  it('does not fire when auth middleware is in surrounding context', () => {
    const findings = detect('PHP_010', [
      {
        path: 'routes/api.php',
        content: [
          "Route::middleware('auth:sanctum')->group(function () {",
          "  Route::apiResource('users', UserController::class);",
          '});',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-route files', () => {
    const findings = detect('PHP_010', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: "Route::apiResource('users', UserController::class);",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_011 — file upload without MIME validation ─────────────────────────

describe('PHP_011 — file upload without MIME validation', () => {
  it('fires on move_uploaded_file without MIME check in context', () => {
    const findings = detect('PHP_011', [
      {
        path: 'app/Http/Controllers/UploadController.php',
        content: 'move_uploaded_file($_FILES["file"]["tmp_name"], "uploads/file.jpg");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_file_upload_no_validation');
  });

  it('does not fire when finfo is used nearby', () => {
    const findings = detect('PHP_011', [
      {
        path: 'app/Http/Controllers/UploadController.php',
        content: [
          '$finfo = new finfo(FILEINFO_MIME_TYPE);',
          '$mime = $finfo->file($_FILES["file"]["tmp_name"]);',
          'move_uploaded_file($_FILES["file"]["tmp_name"], "uploads/file");',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_012 — unserialize() on user input ────────────────────────────────

describe('PHP_012 — unserialize() on user input', () => {
  it('fires on unserialize($_COOKIE["user"])', () => {
    const findings = detect('PHP_012', [
      {
        path: 'app/Http/Controllers/SessionController.php',
        content: '$user = unserialize($_COOKIE["user"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_deserialization');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on unserialize(base64_decode($_GET["data"]))', () => {
    const findings = detect('PHP_012', [
      {
        path: 'app/Http/Controllers/SessionController.php',
        content: '$data = unserialize(base64_decode($_GET["data"]));',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on unserialize of a hardcoded string', () => {
    const findings = detect('PHP_012', [
      {
        path: 'app/Http/Controllers/SessionController.php',
        content: '$data = unserialize(file_get_contents("data/cache.bin"));',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_013 — Laravel APP_DEBUG=true ─────────────────────────────────────

describe('PHP_013 — Laravel APP_DEBUG=true', () => {
  it('fires on APP_DEBUG=true in .env', () => {
    const findings = detect('PHP_013', [
      {
        path: '.env',
        content: 'APP_NAME=Laravel\nAPP_DEBUG=true\nAPP_URL=http://localhost',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('laravel_debug_true');
  });

  it("fires on hardcoded 'debug' => true in config/app.php", () => {
    const findings = detect('PHP_013', [
      {
        path: 'config/app.php',
        content: "return [\n  'debug' => true,\n  'name' => 'Laravel',\n];",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on APP_DEBUG=false', () => {
    const findings = detect('PHP_013', [
      {
        path: '.env',
        content: 'APP_DEBUG=false',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("does not fire when env() wrapper is used in config", () => {
    const findings = detect('PHP_013', [
      {
        path: 'config/app.php',
        content: "return [\n  'debug' => env('APP_DEBUG', false),\n];",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-env/non-config PHP files', () => {
    const findings = detect('PHP_013', [
      {
        path: 'app/Http/Controllers/HomeController.php',
        content: 'APP_DEBUG=true',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_014 — weak password hashing ──────────────────────────────────────

describe('PHP_014 — weak password hashing (md5/sha1)', () => {
  it('fires on md5($password)', () => {
    const findings = detect('PHP_014', [
      {
        path: 'app/Http/Controllers/AuthController.php',
        content: '$hash = md5($password);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_weak_password_hash');
  });

  it('fires on sha1($pass)', () => {
    const findings = detect('PHP_014', [
      {
        path: 'app/Http/Controllers/AuthController.php',
        content: 'if ($user->password === sha1($pass)) { login($user); }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on password_hash()', () => {
    const findings = detect('PHP_014', [
      {
        path: 'app/Http/Controllers/AuthController.php',
        content: '$hash = password_hash($password, PASSWORD_ARGON2ID);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on md5() used for non-password data', () => {
    const findings = detect('PHP_014', [
      {
        path: 'app/Services/CacheService.php',
        content: '$key = md5($cacheKey);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_015 — Blade form missing @csrf ───────────────────────────────────

describe('PHP_015 — Blade form missing @csrf', () => {
  it('fires on POST form without @csrf', () => {
    const findings = detect('PHP_015', [
      {
        path: 'resources/views/profile.blade.php',
        content: '<form method="POST" action="/profile">\n  <input name="email">\n  <button>Save</button>\n</form>',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('laravel_missing_csrf');
  });

  it('does not fire when @csrf is present', () => {
    const findings = detect('PHP_015', [
      {
        path: 'resources/views/profile.blade.php',
        content: '<form method="POST" action="/profile">\n  @csrf\n  <input name="email">\n</form>',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on GET forms', () => {
    const findings = detect('PHP_015', [
      {
        path: 'resources/views/search.blade.php',
        content: '<form method="GET" action="/search">\n  <input name="q">\n</form>',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Blade files', () => {
    const findings = detect('PHP_015', [
      {
        path: 'resources/views/profile.html',
        content: '<form method="POST" action="/profile">\n  <input name="email">\n</form>',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_016 — extract() on superglobals ──────────────────────────────────

describe('PHP_016 — extract() on superglobals', () => {
  it('fires on extract($_POST)', () => {
    const findings = detect('PHP_016', [
      {
        path: 'app/Http/Controllers/FormController.php',
        content: 'extract($_POST);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_extract_superglobal');
  });

  it('fires on extract($_GET, EXTR_SKIP)', () => {
    const findings = detect('PHP_016', [
      {
        path: 'app/Http/Controllers/FormController.php',
        content: 'extract($_GET, EXTR_SKIP);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on extract() with a local array', () => {
    const findings = detect('PHP_016', [
      {
        path: 'app/Http/Controllers/FormController.php',
        content: 'extract($config);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_017 — session fixation ────────────────────────────────────────────

describe('PHP_017 — session fixation', () => {
  it('fires on session_id($_GET["sid"])', () => {
    const findings = detect('PHP_017', [
      {
        path: 'app/Http/Controllers/SessionController.php',
        content: 'session_id($_GET["sid"]);\nsession_start();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_session_fixation');
  });

  it('fires on session_id($_COOKIE["PHPSESSID"])', () => {
    const findings = detect('PHP_017', [
      {
        path: 'app/Http/Controllers/SessionController.php',
        content: 'session_id($_COOKIE["PHPSESSID"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on session_regenerate_id()', () => {
    const findings = detect('PHP_017', [
      {
        path: 'app/Http/Controllers/SessionController.php',
        content: 'session_start();\nsession_regenerate_id(true);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_018 — SSRF ────────────────────────────────────────────────────────

describe('PHP_018 — SSRF', () => {
  it('fires on file_get_contents($_GET["url"])', () => {
    const findings = detect('PHP_018', [
      {
        path: 'app/Http/Controllers/ProxyController.php',
        content: '$content = file_get_contents($_GET["url"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_ssrf');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on curl_setopt with CURLOPT_URL from $_POST', () => {
    const findings = detect('PHP_018', [
      {
        path: 'app/Http/Controllers/ProxyController.php',
        content: 'curl_setopt($ch, CURLOPT_URL, $_POST["endpoint"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when parse_url is present', () => {
    const findings = detect('PHP_018', [
      {
        path: 'app/Http/Controllers/ProxyController.php',
        content: '$host = parse_url($_GET["url"], PHP_URL_HOST);\nif (!in_array($host, $allowed)) { abort(400); }\nfile_get_contents($_GET["url"]);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_019 — hardcoded credentials ──────────────────────────────────────

describe('PHP_019 — hardcoded credentials', () => {
  it("fires on 'password' => 'literal_value'", () => {
    const findings = detect('PHP_019', [
      {
        path: 'config/database.php',
        content: "return [\n  'password' => 'supersecret123',\n];",
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('php_hardcoded_credentials');
  });

  it('fires on define("DB_PASSWORD", "hunter2")', () => {
    const findings = detect('PHP_019', [
      {
        path: 'bootstrap/app.php',
        content: "define('DB_PASSWORD', 'hunter2');",
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when env() wrapper is used', () => {
    const findings = detect('PHP_019', [
      {
        path: 'config/database.php',
        content: "return [\n  'password' => env('DB_PASSWORD'),\n];",
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on comment lines', () => {
    const findings = detect('PHP_019', [
      {
        path: 'config/database.php',
        content: "// 'password' => 'example_value',",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── PHP_020 — $request->all() mass assignment ─────────────────────────────

describe('PHP_020 — $request->all() passed to create()/update()', () => {
  it('fires on User::create($request->all())', () => {
    const findings = detect('PHP_020', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: '$user = User::create($request->all());',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('laravel_request_all_mass_assign');
  });

  it('fires on ->update($request->all())', () => {
    const findings = detect('PHP_020', [
      {
        path: 'app/Http/Controllers/PostController.php',
        content: '$post->update($request->all());',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on $request->validated()', () => {
    const findings = detect('PHP_020', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: '$user = User::create($request->validated());',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it("does not fire on $request->only([...])", () => {
    const findings = detect('PHP_020', [
      {
        path: 'app/Http/Controllers/UserController.php',
        content: "$user = User::create(\$request->only(['name', 'email']));",
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});
