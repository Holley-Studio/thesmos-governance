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

// Go and Ruby BLOCKER rules.
// Content strings contain Go/Ruby code — language-specific detectors
// filter by .go/.rb extension so no TS guard obfuscation needed.
export const EXTENDED_FIXTURES: ExtendedFixture[] = [
  // ── GO_001 — go_sql_injection_fmt ─────────────────────────────────────────
  {
    ruleId: 'GO_001',
    fixtureExt: 'go',
    positiveFixture: `rows, _ := db.Query(fmt.Sprintf("SELECT * FROM users WHERE id=%s", userID))`,
    negativeFixture: `rows, _ := db.Query("SELECT * FROM users WHERE id=$1", userID)`,
  },
  // ── GO_002 — go_command_injection ─────────────────────────────────────────
  {
    ruleId: 'GO_002',
    fixtureExt: 'go',
    positiveFixture: `cmd := exec.Command("sh", "-c", userInput)\ncmd.Run()`,
    negativeFixture: `cmd := exec.Command("ls", "-la", safePath)\ncmd.Run()`,
  },
  // ── GO_005 — go_hardcoded_secret ──────────────────────────────────────────
  {
    ruleId: 'GO_005',
    fixtureExt: 'go',
    positiveFixture: `const apiKey = "sk-live-abc123def456"`,
    negativeFixture: `apiKey := os.Getenv("API_KEY")`,
  },
  // ── GO_006 — go_insecure_skip_verify ──────────────────────────────────────
  {
    ruleId: 'GO_006',
    fixtureExt: 'go',
    positiveFixture: `tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}`,
    negativeFixture: `tr := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}`,
  },
  // ── GO_017 — go_path_traversal ────────────────────────────────────────────
  // Regex: os.ReadFile|os.Open|filepath.Join + r.URL|r.FormValue|chi.URLParam in context
  {
    ruleId: 'GO_017',
    fixtureExt: 'go',
    positiveFixture: `data, _ := os.ReadFile(filepath.Join(baseDir, r.URL.Query().Get("file")))`,
    negativeFixture: `safePath := filepath.Join(baseDir, filepath.Clean(r.URL.Query().Get("file")))\nif !strings.HasPrefix(filepath.Clean(safePath), baseDir) { http.Error(w, "forbidden", 403); return }\ndata, _ := os.ReadFile(safePath)`,
  },
  // ── RB_001 — rb_sql_injection_string_interpolation ────────────────────────
  {
    ruleId: 'RB_001',
    fixtureExt: 'rb',
    positiveFixture: `User.where("email = '#{params[:email]}'")`,
    negativeFixture: `User.where(email: params[:email])`,
  },
  // ── RB_002 — rb_sql_injection_raw ─────────────────────────────────────────
  // Regex: (?:connection|conn)\.execute\s*\(.*#\{  — needs connection.execute with #{
  {
    ruleId: 'RB_002',
    fixtureExt: 'rb',
    positiveFixture: `connection.execute("SELECT * FROM users WHERE id = #{params[:id]}")`,
    negativeFixture: `connection.execute(sanitize_sql(["SELECT * FROM users WHERE id = ?", params[:id]]))`,
  },
  // ── RB_005 — rb_mass_assignment_wildcard ──────────────────────────────────
  {
    ruleId: 'RB_005',
    fixtureExt: 'rb',
    positiveFixture: `User.update(params.permit!)`,
    negativeFixture: `User.update(params.require(:user).permit(:name, :email))`,
  },
  // ── RB_009 — rb_command_injection ─────────────────────────────────────────
  {
    ruleId: 'RB_009',
    fixtureExt: 'rb',
    positiveFixture: `system("git clone #{params[:repo]}")`,
    negativeFixture: `system("git", "clone", "--", params[:repo])`,
  },
  // ── RB_010 — rb_path_traversal ────────────────────────────────────────────
  // Regex: File.read|File.open|send_file|render file: immediately followed by params[
  {
    ruleId: 'RB_010',
    fixtureExt: 'rb',
    positiveFixture: `File.read(params[:path])`,
    negativeFixture: `safe_path = Rails.root.join("public", "uploads", File.basename(params[:path]))\nFile.read(safe_path)`,
  },
  // ── RB_011 — rb_send_file_traversal ───────────────────────────────────────
  // Regex: send_file (space) [@\w] — no parens, not starting with quote/Rails.root
  {
    ruleId: 'RB_011',
    fixtureExt: 'rb',
    positiveFixture: `send_file @upload.file_path`,
    negativeFixture: `send_file Rails.root.join("storage", File.basename(@upload.filename))`,
  },
  // ── RB_012 — rb_hardcoded_secret_key_base ────────────────────────────────
  // Checks YAML files: path.endsWith('.yml') and secret_key_base: "..."
  {
    ruleId: 'RB_012',
    fixtureExt: 'yml',
    positiveFixture: `secret_key_base: "hardcoded_secret_key_base_value_xyz_long"`,
    negativeFixture: `secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>`,
  },
  // ── RB_016 — rb_yaml_load_unsafe ─────────────────────────────────────────
  {
    ruleId: 'RB_016',
    fixtureExt: 'rb',
    positiveFixture: `data = YAML.load(untrusted_yaml_string)`,
    negativeFixture: `data = YAML.safe_load(untrusted_yaml_string)`,
  },
  // ── RB_017 — rb_marshal_load_deserialization ──────────────────────────────
  {
    ruleId: 'RB_017',
    fixtureExt: 'rb',
    positiveFixture: `obj = Marshal.load(request.body.read)`,
    negativeFixture: `obj = JSON.parse(request.body.read)`,
  },
];
