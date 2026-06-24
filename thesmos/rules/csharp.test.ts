import { describe, it, expect } from 'vitest';
import { CSHARP_RULES } from './csharp';
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
  const r = CSHARP_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(id: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(id).detect(input);
}

// ── CS_001 — SQL injection via string interpolation/concatenation ─────────

describe('CS_001 — SQL injection via string interpolation', () => {
  it('fires on ExecuteReader with interpolated string', () => {
    const findings = detect('CS_001', [
      {
        path: 'Controllers/UserController.cs',
        content: 'cmd.ExecuteReader($"SELECT * FROM Users WHERE Id = {userId}");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_sql_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on ExecuteNonQuery with string concatenation', () => {
    const findings = detect('CS_001', [
      {
        path: 'Controllers/UserController.cs',
        content: 'cmd.ExecuteNonQuery("DELETE FROM Users WHERE Name = \'" + name + "\'");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_sql_injection');
  });

  it('does not fire on parameterized query', () => {
    const findings = detect('CS_001', [
      {
        path: 'Controllers/UserController.cs',
        content: 'cmd.CommandText = "SELECT * FROM Users WHERE Id = @id";\ncmd.Parameters.AddWithValue("@id", userId);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-.cs files', () => {
    const findings = detect('CS_001', [
      {
        path: 'scripts/migrate.sql',
        content: 'cmd.ExecuteReader($"SELECT * FROM Users WHERE Id = {id}");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_002 — EF Core FromSqlRaw with interpolated string ─────────────────

describe('CS_002 — EF Core FromSqlRaw with interpolated string', () => {
  it('fires on FromSqlRaw with $"..." interpolated string', () => {
    const findings = detect('CS_002', [
      {
        path: 'Data/UserRepository.cs',
        content: 'context.Users.FromSqlRaw($"SELECT * FROM Users WHERE Id = {userId}");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_ef_raw_sql_interpolation');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('does not fire on FromSqlInterpolated (safe)', () => {
    const findings = detect('CS_002', [
      {
        path: 'Data/UserRepository.cs',
        content: 'context.Users.FromSqlInterpolated($"SELECT * FROM Users WHERE Id = {userId}");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on FromSqlRaw with a plain string', () => {
    const findings = detect('CS_002', [
      {
        path: 'Data/UserRepository.cs',
        content: 'context.Users.FromSqlRaw("SELECT * FROM Users WHERE Id = {0}", userId);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_003 — Missing [Authorize] on controller action ────────────────────

describe('CS_003 — Missing [Authorize] on controller action', () => {
  it('fires on [HttpPost] without [Authorize] in context', () => {
    const findings = detect('CS_003', [
      {
        path: 'Controllers/UserController.cs',
        content: '[HttpPost]\npublic IActionResult Create(UserDto dto) { return Ok(); }',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_missing_authorize');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire when [Authorize] is present above [HttpPost]', () => {
    const findings = detect('CS_003', [
      {
        path: 'Controllers/UserController.cs',
        content: '[Authorize]\n[HttpPost]\npublic IActionResult Create(UserDto dto) { return Ok(); }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when [AllowAnonymous] is present', () => {
    const findings = detect('CS_003', [
      {
        path: 'Controllers/AuthController.cs',
        content: '[AllowAnonymous]\n[HttpPost]\npublic IActionResult Login(LoginDto dto) { return Ok(); }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-controller .cs files', () => {
    const findings = detect('CS_003', [
      {
        path: 'Services/UserService.cs',
        content: '[HttpPost]\npublic IActionResult Create(UserDto dto) { return Ok(); }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_004 — Missing anti-forgery token in Razor form ────────────────────

describe('CS_004 — Missing anti-forgery in Razor POST form', () => {
  it('fires on POST form without AntiForgeryToken in .cshtml', () => {
    const findings = detect('CS_004', [
      {
        path: 'Views/User/Create.cshtml',
        content: '<form method="post">\n  <input name="email">\n  <button>Submit</button>\n</form>',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_missing_antiforgery');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire when asp-antiforgery is present', () => {
    const findings = detect('CS_004', [
      {
        path: 'Views/User/Create.cshtml',
        content: '<form method="post" asp-antiforgery="true">\n  <input name="email">\n</form>',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when @Html.AntiForgeryToken() is present', () => {
    const findings = detect('CS_004', [
      {
        path: 'Views/User/Create.cshtml',
        content: '<form method="post">\n  @Html.AntiForgeryToken()\n  <input name="email">\n</form>',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Razor files', () => {
    const findings = detect('CS_004', [
      {
        path: 'wwwroot/index.html',
        content: '<form method="post">\n  <input name="email">\n</form>',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_005 — Hardcoded connection string with credentials ─────────────────

describe('CS_005 — Hardcoded connection string with credentials', () => {
  it('fires on connection string with Password= in C# source', () => {
    const findings = detect('CS_005', [
      {
        path: 'Data/AppDbContext.cs',
        content: 'string connectionString = "Server=db;Database=app;User ID=sa;Password=secret123";',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_hardcoded_connection_string');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on connection string with Pwd= credential', () => {
    const findings = detect('CS_005', [
      {
        path: 'Startup.cs',
        content: 'var connStr = "Server=localhost;Database=mydb;Uid=admin;Pwd=hunter2";',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on IConfiguration usage', () => {
    const findings = detect('CS_005', [
      {
        path: 'Startup.cs',
        content: 'string connectionString = _configuration.GetConnectionString("DefaultConnection");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_006 — Hardcoded secret in appsettings.json ────────────────────────

describe('CS_006 — Hardcoded secret in appsettings.json', () => {
  it('fires on ApiKey with a real value in appsettings.json', () => {
    const findings = detect('CS_006', [
      {
        path: 'appsettings.json',
        content: '{\n  "ApiKey": "sk_live_abc123xyz"\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_hardcoded_secret_in_config');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on Password key with literal value', () => {
    const findings = detect('CS_006', [
      {
        path: 'appsettings.Production.json',
        content: '{\n  "Password": "supersecret"\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on placeholder value', () => {
    const findings = detect('CS_006', [
      {
        path: 'appsettings.json',
        content: '{\n  "ApiKey": "your-key-here"\n}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-config files', () => {
    const findings = detect('CS_006', [
      {
        path: 'Models/User.cs',
        content: '"ApiKey": "sk_live_abc123xyz"',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_007 — TypeNameHandling.All/Objects/Auto ───────────────────────────

describe('CS_007 — TypeNameHandling All/Objects/Auto', () => {
  it('fires on TypeNameHandling.All', () => {
    const findings = detect('CS_007', [
      {
        path: 'Services/JsonService.cs',
        content: 'var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.All };',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_type_name_handling');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on TypeNameHandling.Auto', () => {
    const findings = detect('CS_007', [
      {
        path: 'Services/JsonService.cs',
        content: 'settings.TypeNameHandling = TypeNameHandling.Auto;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on TypeNameHandling.None', () => {
    const findings = detect('CS_007', [
      {
        path: 'Services/JsonService.cs',
        content: 'var settings = new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.None };',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_008 — XML external entity (XXE) ───────────────────────────────────

describe('CS_008 — XML external entity (XXE)', () => {
  it('fires on new XmlDocument() without secure settings in window', () => {
    const findings = detect('CS_008', [
      {
        path: 'Services/XmlParser.cs',
        content: 'var doc = new XmlDocument();\ndoc.LoadXml(input);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_xml_external_entity');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('does not fire when DtdProcessing.Prohibit is nearby', () => {
    const findings = detect('CS_008', [
      {
        path: 'Services/XmlParser.cs',
        content: 'var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit };\nvar reader = XmlReader.Create(stream, settings);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when XmlResolver = null is nearby', () => {
    const findings = detect('CS_008', [
      {
        path: 'Services/XmlParser.cs',
        content: 'var doc = new XmlDocument();\ndoc.XmlResolver = null;\ndoc.LoadXml(input);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_009 — Debug page without IsDevelopment guard ──────────────────────

describe('CS_009 — UseDeveloperExceptionPage without IsDevelopment guard', () => {
  it('fires on UseDeveloperExceptionPage without environment check', () => {
    const findings = detect('CS_009', [
      {
        path: 'Startup.cs',
        content: 'app.UseRouting();\napp.UseDeveloperExceptionPage();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_debug_in_production');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire when IsDevelopment is in context', () => {
    const findings = detect('CS_009', [
      {
        path: 'Startup.cs',
        content: 'if (env.IsDevelopment()) {\n  app.UseDeveloperExceptionPage();\n}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-.cs files', () => {
    const findings = detect('CS_009', [
      {
        path: 'appsettings.json',
        content: 'app.UseDeveloperExceptionPage();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_010 — Open redirect ────────────────────────────────────────────────

describe('CS_010 — Open redirect', () => {
  it('fires on Response.Redirect with Request.Query', () => {
    const findings = detect('CS_010', [
      {
        path: 'Controllers/AuthController.cs',
        content: 'Response.Redirect(Request.Query["returnUrl"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_open_redirect');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on return Redirect(returnUrl) with url-named parameter', () => {
    const findings = detect('CS_010', [
      {
        path: 'Controllers/AuthController.cs',
        content: 'return Redirect(returnUrl);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on hardcoded redirect path', () => {
    const findings = detect('CS_010', [
      {
        path: 'Controllers/AuthController.cs',
        content: 'return Redirect("/dashboard");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_011 — Path traversal ───────────────────────────────────────────────

describe('CS_011 — Path traversal', () => {
  it('fires on File.ReadAllText with Request.Query', () => {
    const findings = detect('CS_011', [
      {
        path: 'Controllers/FileController.cs',
        content: 'var data = File.ReadAllText(Request.Query["file"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_path_traversal');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on Path.Combine with Request.Form', () => {
    const findings = detect('CS_011', [
      {
        path: 'Controllers/FileController.cs',
        content: 'var path = Path.Combine(baseDir, Request.Form["filename"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on hardcoded file path', () => {
    const findings = detect('CS_011', [
      {
        path: 'Controllers/FileController.cs',
        content: 'var data = File.ReadAllText("config/settings.json");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_012 — Command injection ────────────────────────────────────────────

describe('CS_012 — Command injection', () => {
  it('fires on Process.Start with Request.Query', () => {
    const findings = detect('CS_012', [
      {
        path: 'Controllers/AdminController.cs',
        content: 'Process.Start("cmd.exe", Request.Query["args"]);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_command_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on new ProcessStartInfo with string concatenation', () => {
    const findings = detect('CS_012', [
      {
        path: 'Services/ShellService.cs',
        content: 'var psi = new ProcessStartInfo("tool", "/c " + userInput);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on Process.Start with hardcoded arguments', () => {
    const findings = detect('CS_012', [
      {
        path: 'Services/ShellService.cs',
        content: 'Process.Start("notepad.exe", "readme.txt");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_013 — Insecure cookie ──────────────────────────────────────────────

describe('CS_013 — Insecure cookie (HttpOnly/Secure = false)', () => {
  it('fires on HttpOnly = false', () => {
    const findings = detect('CS_013', [
      {
        path: 'Controllers/AuthController.cs',
        content: 'var opts = new CookieOptions { HttpOnly = false, Secure = true };',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_insecure_cookie');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on Secure = false', () => {
    const findings = detect('CS_013', [
      {
        path: 'Controllers/AuthController.cs',
        content: 'var opts = new CookieOptions { HttpOnly = true, Secure = false };',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when both are true', () => {
    const findings = detect('CS_013', [
      {
        path: 'Controllers/AuthController.cs',
        content: 'var opts = new CookieOptions { HttpOnly = true, Secure = true };',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_014 — Weak hash algorithm ─────────────────────────────────────────

describe('CS_014 — Weak hash algorithm (MD5/SHA1)', () => {
  it('fires on MD5.Create()', () => {
    const findings = detect('CS_014', [
      {
        path: 'Services/HashService.cs',
        content: 'var hash = MD5.Create();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_weak_hash_algorithm');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on SHA1.Create()', () => {
    const findings = detect('CS_014', [
      {
        path: 'Services/HashService.cs',
        content: 'using var sha = SHA1.Create();',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on SHA256.Create()', () => {
    const findings = detect('CS_014', [
      {
        path: 'Services/HashService.cs',
        content: 'using var sha = SHA256.Create();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_015 — CORS allow all origins ──────────────────────────────────────

describe('CS_015 — CORS allowing all origins', () => {
  it('fires on AllowAnyOrigin()', () => {
    const findings = detect('CS_015', [
      {
        path: 'Startup.cs',
        content: 'policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_cors_allow_all');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on WithOrigins("*")', () => {
    const findings = detect('CS_015', [
      {
        path: 'Startup.cs',
        content: 'policy.WithOrigins("*");',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on WithOrigins with specific domain', () => {
    const findings = detect('CS_015', [
      {
        path: 'Startup.cs',
        content: 'policy.WithOrigins("https://myapp.com").AllowAnyMethod();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_016 — Logging sensitive data ──────────────────────────────────────

describe('CS_016 — Logging sensitive data', () => {
  it('fires on logger.LogDebug with password in message', () => {
    const findings = detect('CS_016', [
      {
        path: 'Services/AuthService.cs',
        content: '_logger.LogDebug($"Login attempt with password: {password}");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_string_format_logging_sensitive');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on logger.LogInformation with token', () => {
    const findings = detect('CS_016', [
      {
        path: 'Services/ApiService.cs',
        content: 'logger.LogInformation("Using token: " + token);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on logger without sensitive field names', () => {
    const findings = detect('CS_016', [
      {
        path: 'Services/UserService.cs',
        content: '_logger.LogInformation("User {UserId} logged in", userId);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_017 — async void method ────────────────────────────────────────────

describe('CS_017 — async void method', () => {
  it('fires on async void non-event method', () => {
    const findings = detect('CS_017', [
      {
        path: 'Services/DataService.cs',
        content: 'public async void LoadData() { await _repo.FetchAsync(); }',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_async_void');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('does not fire on async Task method', () => {
    const findings = detect('CS_017', [
      {
        path: 'Services/DataService.cs',
        content: 'public async Task LoadData() { await _repo.FetchAsync(); }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on event handler async void', () => {
    const findings = detect('CS_017', [
      {
        path: 'Forms/MainForm.cs',
        content: 'private async void button_Click(object sender, EventArgs e) { await DoWork(); }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_018 — Empty catch block ────────────────────────────────────────────

describe('CS_018 — Empty catch block (exception swallowed)', () => {
  it('fires on empty catch(Exception) { }', () => {
    const findings = detect('CS_018', [
      {
        path: 'Services/DataService.cs',
        content: 'try { DoWork(); } catch (Exception) { }',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_exception_swallowed');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on bare empty catch { }', () => {
    const findings = detect('CS_018', [
      {
        path: 'Services/DataService.cs',
        content: 'try { DoWork(); } catch { }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on catch with logging', () => {
    const findings = detect('CS_018', [
      {
        path: 'Services/DataService.cs',
        content: 'try { DoWork(); } catch (Exception ex) { _logger.LogError(ex, "Failed"); throw; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_019 — Hardcoded JWT secret ─────────────────────────────────────────

describe('CS_019 — Hardcoded JWT secret', () => {
  it('fires on SymmetricSecurityKey with hardcoded string literal', () => {
    const findings = detect('CS_019', [
      {
        path: 'Services/TokenService.cs',
        content: 'var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes("my_super_secret_key_123"));',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_hardcoded_jwt_secret');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('does not fire when key is loaded from configuration', () => {
    const findings = detect('CS_019', [
      {
        path: 'Services/TokenService.cs',
        content: 'var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_configuration["Jwt:Secret"]!));',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on SymmetricSecurityKey with variable reference', () => {
    const findings = detect('CS_019', [
      {
        path: 'Services/TokenService.cs',
        content: 'var key = new SymmetricSecurityKey(secretBytes);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── CS_020 — Razor @Html.Raw with ViewBag/ViewData ───────────────────────

describe('CS_020 — @Html.Raw with ViewBag/ViewData (XSS)', () => {
  it('fires on @Html.Raw(ViewBag.UserName) in .cshtml', () => {
    const findings = detect('CS_020', [
      {
        path: 'Views/User/Profile.cshtml',
        content: '<div>@Html.Raw(ViewBag.UserName)</div>',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('csharp_viewbag_xss');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on @Html.Raw(ViewData["Description"]) in .cshtml', () => {
    const findings = detect('CS_020', [
      {
        path: 'Views/Home/Index.cshtml',
        content: '<p>@Html.Raw(ViewData["Description"])</p>',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on auto-escaped @ViewBag.UserName', () => {
    const findings = detect('CS_020', [
      {
        path: 'Views/User/Profile.cshtml',
        content: '<div>@ViewBag.UserName</div>',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Razor files', () => {
    const findings = detect('CS_020', [
      {
        path: 'Views/User/Profile.html',
        content: '@Html.Raw(ViewBag.UserName)',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});
