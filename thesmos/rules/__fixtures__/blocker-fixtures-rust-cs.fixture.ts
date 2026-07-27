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

// Rust and C# BLOCKER rules.
// Content strings contain Rust/C# code filtered by .rs/.cs extension.
export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── RUST_008 — rust_mutex_guard_across_await ──────────────────────────────
  // WINDOW=8: .lock() within 8 lines of .await fires. Negative must keep >8 lines apart.
  {
    ruleId: 'RUST_008',
    fixtureExt: 'rs',
    positiveFixture: `let guard = mutex.lock().unwrap();\ndo_something().await;`,
    negativeFixture: `let result = compute_sync();\ndo_something().await;`,
  },
  // ── RUST_010 — rust_sql_injection_format ──────────────────────────────────
  {
    ruleId: 'RUST_010',
    fixtureExt: 'rs',
    positiveFixture: `let rows = client.query(&format!("SELECT * FROM users WHERE id={}", user_id), &[]).await?;`,
    negativeFixture: `let rows = client.query("SELECT * FROM users WHERE id=$1", &[&user_id]).await?;`,
  },
  // ── RUST_014 — rust_transmute_usage ───────────────────────────────────────
  {
    ruleId: 'RUST_014',
    fixtureExt: 'rs',
    positiveFixture: `let f: f32 = unsafe { std::mem::transmute::<i32, f32>(bits) };`,
    negativeFixture: `let f = f32::from_bits(bits);`,
  },
  // ── CS_001 — cs_sql_injection_interpolation ───────────────────────────────
  // Regex: ExecuteNonQuery|ExecuteScalar|ExecuteReader|FromSqlRaw($"...) or concat with +var
  {
    ruleId: 'CS_001',
    fixtureExt: 'cs',
    positiveFixture: `cmd.ExecuteReader($"SELECT * FROM users WHERE id={userId}");`,
    negativeFixture: `cmd.CommandText = "SELECT * FROM users WHERE id=@id"; cmd.Parameters.AddWithValue("@id", userId); cmd.ExecuteReader();`,
  },
  // ── CS_002 — cs_ef_core_raw_sql_interpolation ────────────────────────────
  {
    ruleId: 'CS_002',
    fixtureExt: 'cs',
    positiveFixture: `var users = db.Users.FromSqlRaw($"SELECT * FROM users WHERE id={id}");`,
    negativeFixture: `var users = db.Users.FromSqlRaw("SELECT * FROM users WHERE id={0}", id);`,
  },
  // ── CS_007 — cs_json_type_name_handling_all ──────────────────────────────
  {
    ruleId: 'CS_007',
    fixtureExt: 'cs',
    positiveFixture: `settings.TypeNameHandling = TypeNameHandling.All;`,
    negativeFixture: `settings.TypeNameHandling = TypeNameHandling.None;`,
  },
  // ── CS_008 — cs_xxe_xml_injection ─────────────────────────────────────────
  {
    ruleId: 'CS_008',
    fixtureExt: 'cs',
    positiveFixture: `XmlDocument doc = new XmlDocument(); doc.Load(userProvidedUrl);`,
    negativeFixture: `XmlReaderSettings settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit }; XmlReader.Create(stream, settings);`,
  },
  // ── CS_011 — cs_path_traversal_file ──────────────────────────────────────
  // Regex: File.ReadAllText(Request.Query["file"]) or Path.Combine(...Request.Query...)
  {
    ruleId: 'CS_011',
    fixtureExt: 'cs',
    positiveFixture: `string content = File.ReadAllText(Request.Query["file"]);`,
    negativeFixture: `var full = Path.GetFullPath(Path.Combine(baseDir, fileName));\nif (!full.StartsWith(baseDir)) throw new UnauthorizedAccessException();\nstring content = File.ReadAllText(full);`,
  },
  // ── CS_012 — cs_command_injection_process_start ───────────────────────────
  // Regex: Process.Start(...Request.Query...) or new ProcessStartInfo(...+...)
  {
    ruleId: 'CS_012',
    fixtureExt: 'cs',
    positiveFixture: `Process.Start("cmd.exe", Request.Query["args"]);`,
    negativeFixture: `var allowedArgs = new[] { "/silent", "/log" };\nif (!allowedArgs.Contains(arg)) return;\nProcess.Start("tool.exe", arg);`,
  },
  // ── CS_019 — cs_hardcoded_jwt_secret ─────────────────────────────────────
  {
    ruleId: 'CS_019',
    fixtureExt: 'cs',
    positiveFixture: `var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes("hardcoded_secret_key_123"));`,
    negativeFixture: `var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(config["Jwt:Secret"]));`,
  },
];
