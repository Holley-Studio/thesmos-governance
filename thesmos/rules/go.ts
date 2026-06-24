/**
 * Go Security Rules — GO_001–020
 *
 * Targets the predictable security failure modes of AI-generated Go code.
 * Covers SQL injection, command injection, SSRF, weak randomness, hardcoded
 * secrets, insecure TLS, goroutine leaks, HTTP client/server misconfiguration,
 * path traversal, auth gaps, and deprecated stdlib patterns.
 *
 * AI assistants writing Go code consistently skip timeouts on HTTP clients,
 * use fmt.Sprintf to build SQL queries, forget to check errors, and use
 * context.Background() inside handlers instead of r.Context().
 */

import type { ThesmosRule, DetectInput, Finding } from '../types';
import { classifySeverity } from '../severity';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isGoFile(p: string) { return p.endsWith('.go'); }
function isGoTest(p: string) { return p.endsWith('_test.go'); }

function lineOf(content: string, re: RegExp): number | undefined {
  const idx = content.split('\n').findIndex((l) => re.test(l));
  return idx >= 0 ? idx + 1 : undefined;
}

// ── Rules ─────────────────────────────────────────────────────────────────────

export const GO_RULES: ThesmosRule[] = [

  // ── GO_001: SQL injection via fmt.Sprintf or string concat ───────────────
  {
    id: 'GO_001',
    category: 'go_sql_injection',
    description: 'SQL query built with fmt.Sprintf or string concat — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'go', 'sql-injection', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Building SQL queries by concatenating strings with fmt.Sprintf or + allows attackers to escape the query context and run arbitrary SQL. AI assistants frequently produce this pattern because it looks natural, but it is the most common Go injection vulnerability. Parameterized queries pass user data separately from the SQL structure, making injection impossible.',
      commonViolations: [
        'db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", userID))',
        'db.Exec("DELETE FROM items WHERE name = \'" + name + "\'")',
        'db.QueryRow(fmt.Sprintf("SELECT * FROM orders WHERE status = \'%s\'", status))',
      ],
      goodExample: 'db.Query("SELECT * FROM users WHERE id = $1", userID)',
      badExample: 'db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", userID)) // ❌ SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      // Detects fmt.Sprintf or string + used as first argument to Query/QueryRow/Exec/QueryContext
      const SQL_SPRINTF_RE = /(?:\.Query|\.QueryRow|\.Exec|\.QueryContext)\s*\(\s*fmt\.Sprintf\s*\(/;
      // Match .Exec( or .Query( etc. followed by anything then a `+` — catches string concat regardless of quote content
      const SQL_CONCAT_RE = /(?:\.Query|\.QueryRow|\.Exec|\.QueryContext)\s*\(.*"\s*\+\s*\w/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (SQL_SPRINTF_RE.test(line) || SQL_CONCAT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_sql_injection', file: path, line: i + 1,
              message: 'SQL query built with fmt.Sprintf or string concatenation — SQL injection vulnerability.',
              suggestion: 'Use parameterized queries: db.Query("SELECT ... WHERE id = $1", userID)',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_002: Command injection via exec.Command with fmt.Sprintf ──────────
  {
    id: 'GO_002',
    category: 'go_command_injection',
    description: 'exec.Command() first arg built with fmt.Sprintf or string concat — command injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'go', 'command-injection', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'When exec.Command receives a dynamically built command name (via fmt.Sprintf or concatenation), an attacker who controls input can substitute a malicious binary name or inject shell-interpreted characters. Safe usage always passes a string literal as the command name and variables only as separate arguments.',
      commonViolations: [
        'exec.Command(fmt.Sprintf("git-%s", subcommand))',
        'exec.Command("sh", "-c", fmt.Sprintf("convert %s output.png", filename))',
        'cmd := exec.Command("bash", "-c", "echo "+userInput)',
      ],
      goodExample: 'exec.Command("git", "clone", repoURL) // literal command name, args separate',
      badExample: 'exec.Command(fmt.Sprintf("run-%s", userCmd)) // ❌ command injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_command_injection', config.severityRules);
      const findings: Finding[] = [];
      const CMD_SPRINTF_RE = /exec\.Command\s*\(\s*fmt\.Sprintf\s*\(/;
      const CMD_CONCAT_RE = /exec\.Command\s*\(\s*(?:"[^"]*"\s*\+|\w+\s*\+)/;
      const SHELL_C_RE = /exec\.Command\s*\(\s*"(?:sh|bash|cmd|powershell)"\s*,\s*"(?:-c|\/C)"\s*,\s*(?:fmt\.Sprintf|[^"]\w)/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (CMD_SPRINTF_RE.test(line) || CMD_CONCAT_RE.test(line) || SHELL_C_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_command_injection', file: path, line: i + 1,
              message: 'exec.Command() with dynamically built command name — potential command injection.',
              suggestion: 'Use a literal command name: exec.Command("git", args...) — pass user input only as separate arguments, never in the command name.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_003: SSRF via http.Get/Post with variable URL ────────────────────
  {
    id: 'GO_003',
    category: 'go_ssrf',
    description: 'http.Get() or http.Post() with a variable URL — SSRF if user-controlled.',
    severity: 'HIGH',
    tags: ['security', 'go', 'ssrf', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Server-Side Request Forgery allows attackers to redirect your server to internal services, cloud metadata endpoints (169.254.169.254), or private networks. AI assistants generate http.Get(url) patterns where url comes from user input without validating the destination. Always validate URLs against an allowlist before making outbound requests.',
      commonViolations: [
        'resp, err := http.Get(r.URL.Query().Get("url"))',
        'resp, err := http.Post(webhookURL, "application/json", body)',
        'http.Get(fmt.Sprintf("http://%s/api", host))',
      ],
      goodExample: 'if !isAllowedHost(parsedURL.Host) { return errors.New("disallowed host") }\nresp, err := http.Get(validatedURL)',
      badExample: 'resp, err := http.Get(userProvidedURL) // ❌ SSRF',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_ssrf', config.severityRules);
      const findings: Finding[] = [];
      // http.Get or http.Post where arg is not a plain string literal
      const SSRF_GET_RE = /\bhttp\.Get\s*\(\s*(?!["']https?:\/\/)/;
      const SSRF_POST_RE = /\bhttp\.Post\s*\(\s*(?!["']https?:\/\/)/;
      const URL_VALIDATE_RE = /url\.Parse|allowedHost|allowlist|isAllowed|validateURL|net\/url/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path)) continue;
        if (!SSRF_GET_RE.test(content) && !SSRF_POST_RE.test(content)) continue;
        if (URL_VALIDATE_RE.test(content)) continue;
        const line = lineOf(content, SSRF_GET_RE) ?? lineOf(content, SSRF_POST_RE);
        findings.push({
          severity: sev, category: 'go_ssrf', file: path, line,
          message: 'http.Get/Post with variable URL — validate against an allowlist before making requests to prevent SSRF.',
          suggestion: 'Parse the URL with url.Parse(), check the hostname against an allowlist, then make the request.',
        });
      }
      return findings;
    },
  },

  // ── GO_004: Weak randomness for security-sensitive values ────────────────
  {
    id: 'GO_004',
    category: 'go_weak_random',
    description: 'math/rand used near token/secret/key/password — not cryptographically secure.',
    severity: 'HIGH',
    tags: ['security', 'go', 'cryptography', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Go's math/rand package uses a deterministic PRNG that is not cryptographically secure. Its output is predictable if an attacker knows the seed. Tokens, session IDs, passwords, and cryptographic keys generated with math/rand can be forged. Use crypto/rand for all security-sensitive random values.",
      commonViolations: [
        'import "math/rand"\ntoken := rand.Intn(1000000)',
        'secret := fmt.Sprintf("%d", rand.Int63())',
        'apiKey := rand.Read(buf) // wrong package',
      ],
      goodExample: 'import "crypto/rand"\nbuf := make([]byte, 32)\ncrypto/rand.Read(buf)',
      badExample: 'token := fmt.Sprintf("%d", rand.Int63()) // ❌ predictable, not secure',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_weak_random', config.severityRules);
      const findings: Finding[] = [];
      const MATH_RAND_IMPORT = /import\s+(?:"math\/rand"|[\s\S]*?"math\/rand")/;
      const RAND_USE = /\brand\./;
      const SEC_CONTEXT = /token|secret|key|password|nonce|salt|csrf|session/i;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        if (!MATH_RAND_IMPORT.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!RAND_USE.test(line)) continue;
          const ctx = lines.slice(Math.max(0, i - 5), i + 6).join('\n');
          if (SEC_CONTEXT.test(ctx)) {
            findings.push({
              severity: sev, category: 'go_weak_random', file: path, line: i + 1,
              message: 'math/rand used in security-sensitive context — use crypto/rand instead.',
              suggestion: 'Replace math/rand with crypto/rand: buf := make([]byte, 32); io.ReadFull(rand.Reader, buf)',
            });
            break; // one finding per file
          }
        }
      }
      return findings;
    },
  },

  // ── GO_005: Hardcoded secrets ─────────────────────────────────────────────
  {
    id: 'GO_005',
    category: 'go_hardcoded_secret',
    description: 'Variable named password/secret/apiKey/token assigned a string literal.',
    severity: 'BLOCKER',
    tags: ['security', 'go', 'secrets', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Hardcoded credentials in Go source are permanently in git history even after deletion. They are found by automated scanners, leaked in CI logs, and shared in forks. AI assistants generate placeholder values like apiKey = "sk-..." that developers ship unchanged.',
      commonViolations: [
        'password := "hunter2"',
        'apiKey := "sk-prod-abc123"',
        'const privateKey = "-----BEGIN RSA PRIVATE KEY-----"',
      ],
      goodExample: 'apiKey := os.Getenv("API_KEY")',
      badExample: 'apiKey := "sk-prod-abc123" // ❌ hardcoded credential',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_hardcoded_secret', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_RE = /\b(?:password|secret|apiKey|api_key|token|apiSecret|api_secret|privateKey|private_key)\s*(?::=|=)\s*"[^"]{4,}"/i;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (SECRET_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_hardcoded_secret', file: path, line: i + 1,
              message: 'Hardcoded secret or API key detected.',
              suggestion: 'Load from environment: os.Getenv("API_KEY") or use a secrets manager.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_006: InsecureSkipVerify: true in TLS config ───────────────────────
  {
    id: 'GO_006',
    category: 'go_tls_insecure',
    description: 'InsecureSkipVerify: true in TLS config disables certificate verification.',
    severity: 'BLOCKER',
    tags: ['security', 'go', 'tls', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "InsecureSkipVerify: true tells Go's TLS stack to accept any certificate, even invalid, expired, or self-signed ones from a different host. This makes HTTPS connections trivially MITMable — an attacker on the same network can intercept all traffic including auth tokens and API keys.",
      commonViolations: [
        'tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}',
        'tlsConfig := &tls.Config{InsecureSkipVerify: true}',
      ],
      goodExample: 'tr := &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}}',
      badExample: '&tls.Config{InsecureSkipVerify: true} // ❌ MitM trivially possible',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_tls_insecure', config.severityRules);
      const findings: Finding[] = [];
      const INSECURE_RE = /InsecureSkipVerify\s*:\s*true/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (INSECURE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_tls_insecure', file: path, line: i + 1,
              message: 'InsecureSkipVerify: true disables TLS certificate verification — connections are trivially MITM-able.',
              suggestion: 'Remove InsecureSkipVerify. If using a custom CA, load it with x509.CertPool instead.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_007: Logging sensitive values ────────────────────────────────────
  {
    id: 'GO_007',
    category: 'go_log_sensitive',
    description: 'log.Printf/fmt.Printf logging a value named password/secret/token/apiKey.',
    severity: 'HIGH',
    tags: ['security', 'go', 'secrets', 'logging'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Logging sensitive values like passwords, tokens, and API keys exposes them in log aggregators, monitoring dashboards, and CI output — often permanently. AI assistants frequently add debug logging that includes full struct values or format strings containing secret variables.',
      commonViolations: [
        'log.Printf("password: %s", password)',
        'fmt.Printf("token=%s", apiToken)',
        'log.Println("secret:", secret)',
      ],
      goodExample: 'log.Printf("login attempt for user: %s", username) // never log the password',
      badExample: 'log.Printf("auth: password=%s token=%s", password, token) // ❌ leaks credentials',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_log_sensitive', config.severityRules);
      const findings: Finding[] = [];
      const LOG_RE = /(?:log\.Printf|log\.Println|log\.Fatal|log\.Fatalf|log\.Print|fmt\.Printf|fmt\.Println|fmt\.Fprintf)\s*\(/;
      const SENSITIVE_RE = /\b(?:password|secret|token|apiKey|api_key|apiSecret|api_secret|privateKey|private_key)\b/i;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (LOG_RE.test(line) && SENSITIVE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_log_sensitive', file: path, line: i + 1,
              message: 'Logging a sensitive value (password/secret/token) — credentials will appear in log output.',
              suggestion: 'Never log passwords, tokens, or secrets. Log only non-sensitive identifiers.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_008: os.Setenv with sensitive key ─────────────────────────────────
  {
    id: 'GO_008',
    category: 'go_os_setenv_secret',
    description: 'os.Setenv() with a key containing PASSWORD/SECRET/TOKEN/KEY — leaks into child processes.',
    severity: 'MEDIUM',
    tags: ['security', 'go', 'secrets', 'environment'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Environment variables set with os.Setenv are visible to all child processes spawned after the call, including exec.Command calls that an attacker might influence. Placing secrets in environment variables also makes them appear in /proc/<pid>/environ on Linux, readable by any user with sufficient privileges.',
      commonViolations: [
        'os.Setenv("DB_PASSWORD", password)',
        'os.Setenv("API_SECRET", secretKey)',
        'os.Setenv("AUTH_TOKEN", token)',
      ],
      goodExample: '// Pass secrets directly to the process that needs them, not via environment\ncmd.Env = append(os.Environ(), "MY_SECRET="+secret)',
      badExample: 'os.Setenv("DB_PASSWORD", password) // ❌ leaks to all child processes',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_os_setenv_secret', config.severityRules);
      const findings: Finding[] = [];
      const SETENV_RE = /\bos\.Setenv\s*\(\s*"[^"]*(?:PASSWORD|SECRET|TOKEN|KEY|PASS)[^"]*"/i;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (SETENV_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_os_setenv_secret', file: path, line: i + 1,
              message: 'os.Setenv() with a secret key name — leaks into child process environments.',
              suggestion: 'Pass secrets directly to individual commands via cmd.Env instead of the global environment.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_009: Ignored error (blank identifier on function return) ──────────
  {
    id: 'GO_009',
    category: 'go_ignored_error',
    description: 'Function return value discarded with _ = — silently ignores errors.',
    severity: 'HIGH',
    tags: ['quality', 'go', 'error-handling', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Assigning a function result to _ in Go silently discards it. For functions that return errors (database operations, file I/O, JSON unmarshaling), this means failures are invisible — the program continues in a broken state, often causing data corruption or security bypasses that are extremely hard to debug.',
      commonViolations: [
        '_ = db.Exec("INSERT INTO users...")',
        '_ = json.Unmarshal(data, &result)',
        '_ = os.Remove(tempFile)',
      ],
      goodExample: 'if err := db.Exec("INSERT INTO users..."); err != nil {\n  return fmt.Errorf("insert failed: %w", err)\n}',
      badExample: '_ = db.Exec("INSERT INTO users...") // ❌ error silently ignored',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_ignored_error', config.severityRules);
      const findings: Finding[] = [];
      // Detects: _ = someFunc(...) pattern — error return discarded
      const BLANK_ASSIGN_RE = /^\s*_\s*=\s*\w[\w.]*\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (BLANK_ASSIGN_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_ignored_error', file: path, line: i + 1,
              message: 'Function return value discarded with _ = — errors are silently ignored.',
              suggestion: 'Handle the error: if err := fn(); err != nil { return err }',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_010: panic() in HTTP handler ─────────────────────────────────────
  {
    id: 'GO_010',
    category: 'go_panic_in_handler',
    description: 'panic() called inside an HTTP handler — crashes the server or goroutine.',
    severity: 'HIGH',
    tags: ['reliability', 'go', 'http', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "panic() in an HTTP handler crashes the goroutine handling the request. Without a recover() middleware, this terminates the server process. Even with recovery middleware, panic() is not idiomatic Go error handling — it signals programmer error, not recoverable runtime conditions. Return an HTTP error instead.",
      commonViolations: [
        'func handler(w http.ResponseWriter, r *http.Request) {\n  if err != nil { panic(err) }',
        'panic("unexpected state") inside a handler body',
      ],
      goodExample: 'func handler(w http.ResponseWriter, r *http.Request) {\n  if err != nil {\n    http.Error(w, "internal error", http.StatusInternalServerError)\n    return\n  }\n}',
      badExample: 'func handler(w http.ResponseWriter, r *http.Request) {\n  if err != nil { panic(err) } // ❌ crashes server',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_panic_in_handler', config.severityRules);
      const findings: Finding[] = [];
      const HANDLER_RE = /func\s+\w+\s*\(\s*\w+\s+http\.ResponseWriter\s*,\s*\w+\s+\*http\.Request\s*\)/;
      const PANIC_RE = /\bpanic\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!HANDLER_RE.test(lines[i]!)) continue;
          const window = lines.slice(i, Math.min(lines.length, i + 25)).join('\n');
          if (PANIC_RE.test(window)) {
            findings.push({
              severity: sev, category: 'go_panic_in_handler', file: path, line: i + 1,
              message: 'panic() called inside HTTP handler — use http.Error() to return error responses instead.',
              suggestion: 'Replace panic(err) with http.Error(w, "internal error", http.StatusInternalServerError); return',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GO_011: Goroutine leak — go func without WaitGroup/context ──────────
  {
    id: 'GO_011',
    category: 'go_goroutine_leak',
    description: 'Goroutine launched without WaitGroup, errgroup, or context cancellation — potential goroutine leak.',
    severity: 'MEDIUM',
    tags: ['reliability', 'go', 'goroutines', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Goroutines that are never joined or cancelled accumulate over time, consuming memory and file descriptors. AI-generated Go code frequently launches goroutines to 'do work in the background' without any mechanism to wait for them to finish or cancel them on shutdown. This is one of the most common sources of goroutine leaks.",
      commonViolations: [
        'go func() { doWork() }() // no WaitGroup',
        'go processItem(item) // no way to track completion',
        'for _, item := range items { go process(item) } // leak if parent returns early',
      ],
      goodExample: 'var wg sync.WaitGroup\nfor _, item := range items {\n  wg.Add(1)\n  go func(it Item) {\n    defer wg.Done()\n    process(it)\n  }(item)\n}\nwg.Wait()',
      badExample: 'go func() { doWork() }() // ❌ goroutine leak — no join point',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_goroutine_leak', config.severityRules);
      const findings: Finding[] = [];
      const GO_FUNC_RE = /\bgo\s+(?:func\s*\(|[\w.]+\s*\()/;
      const SAFE_RE = /sync\.WaitGroup|errgroup|context\.WithCancel|context\.WithTimeout|wg\.Add|wg\.Wait|done\s*<-|<-done/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        if (!GO_FUNC_RE.test(content)) continue;
        if (SAFE_RE.test(content)) continue;
        const line = lineOf(content, GO_FUNC_RE);
        findings.push({
          severity: sev, category: 'go_goroutine_leak', file: path, line,
          message: 'Goroutine launched without WaitGroup, errgroup, or context — potential goroutine leak.',
          suggestion: 'Use sync.WaitGroup or golang.org/x/sync/errgroup to track goroutine completion.',
        });
      }
      return findings;
    },
  },

  // ── GO_012: Global mutable map/slice without mutex ───────────────────────
  {
    id: 'GO_012',
    category: 'go_global_mutable_state',
    description: 'Package-level var map or slice without sync.Mutex — data race under concurrent access.',
    severity: 'MEDIUM',
    tags: ['reliability', 'go', 'concurrency', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Global maps and slices in Go are not safe for concurrent use. When multiple goroutines read and write the same map without synchronization, Go's race detector triggers and in production you get silent data corruption or panics. AI assistants frequently create global caches or registries as plain maps without any mutex protection.",
      commonViolations: [
        'var cache = map[string]string{} // no mutex',
        'var items []Item // global, no sync',
        'var registry = make(map[string]Handler)',
      ],
      goodExample: 'var (\n  mu    sync.RWMutex\n  cache = map[string]string{}\n)\nfunc get(k string) string {\n  mu.RLock()\n  defer mu.RUnlock()\n  return cache[k]\n}',
      badExample: 'var cache = map[string]string{} // ❌ data race under concurrent access',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_global_mutable_state', config.severityRules);
      const findings: Finding[] = [];
      const GLOBAL_MAP_RE = /^var\s+\w+\s*(?:=\s*(?:map\[|make\s*\(\s*map\[|\[\])|\[\])/m;
      const MUTEX_RE = /sync\.(?:Mutex|RWMutex)|sync\.Map/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        if (!GLOBAL_MAP_RE.test(content)) continue;
        if (MUTEX_RE.test(content)) continue;
        const line = lineOf(content, GLOBAL_MAP_RE);
        findings.push({
          severity: sev, category: 'go_global_mutable_state', file: path, line,
          message: 'Package-level mutable map or slice without sync.Mutex — concurrent access causes data races.',
          suggestion: 'Add sync.RWMutex alongside the map, or use sync.Map for concurrent access.',
        });
      }
      return findings;
    },
  },

  // ── GO_013: HTTP client without timeout ──────────────────────────────────
  {
    id: 'GO_013',
    category: 'go_http_no_timeout',
    description: 'http.DefaultClient or &http.Client{} without Timeout — hangs indefinitely on slow upstreams.',
    severity: 'HIGH',
    tags: ['reliability', 'go', 'http', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "Go's http.DefaultClient has no timeout by default. Any outbound HTTP request can block indefinitely if the remote server is slow or unresponsive. Under load this exhausts goroutines and file descriptors, cascading into a full service outage. AI assistants consistently use http.DefaultClient or forget to set Timeout on custom clients.",
      commonViolations: [
        'resp, err := http.DefaultClient.Do(req)',
        'client := &http.Client{}',
        'http.Get(url) // uses DefaultClient',
      ],
      goodExample: 'client := &http.Client{Timeout: 10 * time.Second}',
      badExample: 'client := &http.Client{} // ❌ no timeout — hangs indefinitely',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_http_no_timeout', config.severityRules);
      const findings: Finding[] = [];
      const DEFAULT_CLIENT_RE = /\bhttp\.DefaultClient\b/;
      const EMPTY_CLIENT_RE = /&http\.Client\s*\{\s*\}/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (DEFAULT_CLIENT_RE.test(line) || EMPTY_CLIENT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_http_no_timeout', file: path, line: i + 1,
              message: 'HTTP client without timeout — will hang indefinitely on slow or unresponsive upstream servers.',
              suggestion: 'Set a timeout: &http.Client{Timeout: 10 * time.Second}',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_014: http.ListenAndServe without timeout server ───────────────────
  {
    id: 'GO_014',
    category: 'go_server_no_timeout',
    description: 'http.ListenAndServe() called directly — infinite timeouts enable slowloris attacks.',
    severity: 'MEDIUM',
    tags: ['security', 'reliability', 'go', 'http', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Calling http.ListenAndServe() directly uses an http.Server with zero (infinite) read, write, and idle timeouts. This makes the server vulnerable to slowloris attacks where an attacker opens many connections and sends data very slowly, eventually exhausting all available goroutines.',
      commonViolations: [
        'http.ListenAndServe(":8080", mux)',
        'http.ListenAndServeTLS(":443", cert, key, mux)',
        'log.Fatal(http.ListenAndServe(":8080", nil))',
      ],
      goodExample: 'srv := &http.Server{\n  Addr:         ":8080",\n  Handler:      mux,\n  ReadTimeout:  5 * time.Second,\n  WriteTimeout: 10 * time.Second,\n  IdleTimeout:  120 * time.Second,\n}\nlog.Fatal(srv.ListenAndServe())',
      badExample: 'http.ListenAndServe(":8080", mux) // ❌ infinite timeouts — slowloris vulnerability',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_server_no_timeout', config.severityRules);
      const findings: Finding[] = [];
      const LISTEN_RE = /\bhttp\.ListenAndServe(?:TLS)?\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (LISTEN_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_server_no_timeout', file: path, line: i + 1,
              message: 'http.ListenAndServe() with infinite timeouts — use http.Server struct with ReadTimeout, WriteTimeout, and IdleTimeout.',
              suggestion: 'Replace with: srv := &http.Server{Addr: ":8080", ReadTimeout: 5*time.Second, WriteTimeout: 10*time.Second}; srv.ListenAndServe()',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_015: Missing input validation in handler before DB ────────────────
  {
    id: 'GO_015',
    category: 'go_missing_input_validation',
    description: 'HTTP handler reads request input and passes it directly to a DB call without validation.',
    severity: 'MEDIUM',
    tags: ['security', 'go', 'validation', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "AI-generated handlers frequently read from r.URL.Query(), r.FormValue(), or r.Body and pass the result directly to database operations without type checking, length limits, or format validation. This enables injection attacks and allows malformed input to corrupt data or crash the handler.",
      commonViolations: [
        'id := r.URL.Query().Get("id")\ndb.Query("SELECT * FROM items WHERE id = $1", id)',
        'name := r.FormValue("name")\ndb.Exec("INSERT INTO users(name) VALUES($1)", name)',
      ],
      goodExample: 'id := r.URL.Query().Get("id")\nif _, err := strconv.Atoi(id); err != nil {\n  http.Error(w, "invalid id", http.StatusBadRequest)\n  return\n}\ndb.Query("SELECT * FROM items WHERE id = $1", id)',
      badExample: 'id := r.URL.Query().Get("id")\ndb.Query("SELECT ... WHERE id = $1", id) // ❌ no validation before DB',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_missing_input_validation', config.severityRules);
      const findings: Finding[] = [];
      const HANDLER_RE = /func\s+\w+\s*\(\s*\w+\s+http\.ResponseWriter\s*,\s*\w+\s+\*http\.Request\s*\)/;
      const INPUT_RE = /\br\.(?:URL\.Query\(\)|FormValue\(|PathValue\(|Body)/;
      // Require a known DB receiver name so `r.URL.Query()` doesn't false-positive
      const DB_RE = /\b(?:db|DB|sqlDB|conn|tx|store|repo)\s*\.(?:Query|QueryRow|Exec|QueryContext|ExecContext)\s*\(/;
      const VALIDATE_RE = /strconv\.|regexp\.|Validate|validate|len\s*\(|strings\.TrimSpace|json\.Unmarshal/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!HANDLER_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + 15);
          const window = lines.slice(i, end).join('\n');
          if (INPUT_RE.test(window) && DB_RE.test(window) && !VALIDATE_RE.test(window)) {
            findings.push({
              severity: sev, category: 'go_missing_input_validation', file: path, line: i + 1,
              message: 'HTTP handler passes request input directly to database without validation.',
              suggestion: 'Validate and sanitize all inputs before passing to database operations (check type, length, format).',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GO_016: HTTP handler with no auth check ──────────────────────────────
  {
    id: 'GO_016',
    category: 'go_handler_no_auth',
    description: 'HTTP handler registration with no visible auth check or middleware in the handler body.',
    severity: 'HIGH',
    tags: ['security', 'go', 'auth', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'AI assistants generate complete handler functions that implement the business logic but forget the auth layer. Without an auth check, any anonymous caller can invoke the endpoint. Mutating endpoints (POST/PUT/DELETE) without auth enable account takeover, data corruption, and resource exhaustion.',
      commonViolations: [
        'http.HandleFunc("/admin/users", handleUsers) // no auth middleware',
        'r.POST("/api/delete", deleteHandler) // handler has no auth check',
        'mux.Handle("/dashboard", dashboardHandler) // no session check',
      ],
      goodExample: 'http.HandleFunc("/api/users", authMiddleware(handleUsers))\n// or inside handler:\ntoken := r.Header.Get("Authorization")\nif token == "" { http.Error(w, "unauthorized", 401); return }',
      badExample: 'http.HandleFunc("/api/admin", handleAdmin) // ❌ no auth',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_handler_no_auth', config.severityRules);
      const findings: Finding[] = [];
      const HANDLER_REG_RE = /(?:http\.HandleFunc|r\.(?:GET|POST|PUT|DELETE|PATCH)|mux\.(?:Handle|HandleFunc))\s*\(\s*"([^"]+)"/;
      const PUBLIC_ROUTE_RE = /\/(?:health|ping|metrics|static|favicon)\b/;
      const AUTH_RE = /(?:Auth|Token|JWT|Session|Cookie|middleware|Authorization|session|Bearer|getUser|getCurrentUser|isAuthenticated)/i;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const m = HANDLER_REG_RE.exec(lines[i]!);
          if (!m) continue;
          if (PUBLIC_ROUTE_RE.test(m[1]!)) continue;
          const window = lines.slice(i, Math.min(lines.length, i + 20)).join('\n');
          if (!AUTH_RE.test(window)) {
            findings.push({
              severity: sev, category: 'go_handler_no_auth', file: path, line: i + 1,
              message: `HTTP handler at "${m[1]}" has no visible authentication check.`,
              suggestion: 'Add an auth middleware or check Authorization header / session token at the start of the handler.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── GO_017: Path traversal via request input into file operations ────────
  {
    id: 'GO_017',
    category: 'go_path_traversal',
    description: 'filepath.Join or os.Open/ReadFile called with a request-derived argument — path traversal risk.',
    severity: 'BLOCKER',
    tags: ['security', 'go', 'path-traversal', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: 'Path traversal (../../etc/passwd) lets attackers read or write arbitrary files on the server. AI-generated file-serving handlers pass user-supplied path values directly to filepath.Join or os.Open without verifying the resolved path stays within the intended directory.',
      commonViolations: [
        'os.ReadFile(filepath.Join(baseDir, r.URL.Query().Get("file")))',
        'os.Open(r.FormValue("path"))',
        'filepath.Join(dir, chi.URLParam(r, "filename"))',
      ],
      goodExample: 'safePath := filepath.Join(baseDir, userInput)\nif !strings.HasPrefix(filepath.Clean(safePath), baseDir) {\n  http.Error(w, "forbidden", 403)\n  return\n}\nos.ReadFile(safePath)',
      badExample: 'os.ReadFile(filepath.Join(dir, r.URL.Query().Get("file"))) // ❌ path traversal',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_path_traversal', config.severityRules);
      const findings: Finding[] = [];
      const FILE_OP_RE = /(?:filepath\.Join|os\.Open|os\.ReadFile|os\.WriteFile)\s*\(/;
      const REQUEST_VAR_RE = /r\.(?:URL|FormValue|PathValue|Body)|chi\.URLParam|c\.Param/;
      const TRAVERSAL_GUARD_RE = /filepath\.Clean|strings\.HasPrefix|path\.Clean|filepath\.Abs/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!/^\s*\/\//.test(lines[i]!) && FILE_OP_RE.test(lines[i]!)) {
            const ctx = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
            if (REQUEST_VAR_RE.test(ctx) && !TRAVERSAL_GUARD_RE.test(ctx)) {
              findings.push({
                severity: sev, category: 'go_path_traversal', file: path, line: i + 1,
                message: 'File operation with request-derived path — path traversal vulnerability.',
                suggestion: 'Use filepath.Clean() and verify path is within the intended base directory with strings.HasPrefix.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── GO_018: ioutil deprecated functions ──────────────────────────────────
  {
    id: 'GO_018',
    category: 'go_ioutil_deprecated',
    description: 'ioutil.ReadFile/WriteFile/ReadAll deprecated since Go 1.16 — use os/io packages instead.',
    severity: 'LOW',
    tags: ['quality', 'go', 'deprecated', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "The ioutil package was deprecated in Go 1.16 (released February 2021). Its functions are simple aliases for os and io package functions. AI assistants trained on pre-1.16 code still generate ioutil.ReadFile and ioutil.ReadAll. Using deprecated APIs signals that the code was generated from outdated training data and may have other anachronistic patterns.",
      commonViolations: [
        'data, err := ioutil.ReadFile("config.json")',
        'body, err := ioutil.ReadAll(resp.Body)',
        'ioutil.WriteFile("output.txt", data, 0644)',
      ],
      goodExample: 'data, err := os.ReadFile("config.json")\nbody, err := io.ReadAll(resp.Body)',
      badExample: 'data, err := ioutil.ReadFile("config.json") // ❌ deprecated since Go 1.16',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_ioutil_deprecated', config.severityRules);
      const findings: Finding[] = [];
      const IOUTIL_RE = /\bioutil\.(?:ReadFile|WriteFile|ReadAll|NopCloser|Discard|TempFile|TempDir)\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path)) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (/^\s*\/\//.test(line)) return;
          if (IOUTIL_RE.test(line)) {
            findings.push({
              severity: sev, category: 'go_ioutil_deprecated', file: path, line: i + 1,
              message: 'ioutil function used — deprecated since Go 1.16. Use os or io package equivalents.',
              suggestion: 'Replace ioutil.ReadFile with os.ReadFile, ioutil.ReadAll with io.ReadAll, ioutil.WriteFile with os.WriteFile.',
            });
          }
        });
      }
      return findings;
    },
  },

  // ── GO_019: context.Background() inside HTTP handler ────────────────────
  {
    id: 'GO_019',
    category: 'go_context_background_in_handler',
    description: 'context.Background() inside HTTP handler — use r.Context() to respect request cancellation.',
    severity: 'MEDIUM',
    tags: ['reliability', 'go', 'context', 'vibe-coding'],
    sinceVersion: '1.3.0',
    explain: {
      why: "context.Background() inside an HTTP handler creates a new root context that is never cancelled when the client disconnects. This means downstream operations (database queries, outbound HTTP calls) continue even after the client has left, wasting resources and causing goroutine accumulation. r.Context() is already cancelled when the request is done.",
      commonViolations: [
        'func handler(w http.ResponseWriter, r *http.Request) {\n  ctx := context.Background()\n  db.QueryContext(ctx, ...)',
        'rows, err := db.QueryContext(context.Background(), query)',
      ],
      goodExample: 'func handler(w http.ResponseWriter, r *http.Request) {\n  ctx := r.Context() // cancelled when client disconnects\n  db.QueryContext(ctx, query)\n}',
      badExample: 'db.QueryContext(context.Background(), query) // ❌ inside handler, ignores client cancellation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_context_background_in_handler', config.severityRules);
      const findings: Finding[] = [];
      const HANDLER_RE = /func\s+\w+\s*\(\s*\w+\s+http\.ResponseWriter\s*,\s*\w+\s+\*http\.Request\s*\)/;
      const CTX_BG_RE = /context\.Background\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!HANDLER_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + 30);
          for (let j = i + 1; j < end; j++) {
            if (/^\s*\/\//.test(lines[j]!)) continue;
            if (CTX_BG_RE.test(lines[j]!)) {
              findings.push({
                severity: sev, category: 'go_context_background_in_handler', file: path, line: j + 1,
                message: 'context.Background() inside HTTP handler — use r.Context() to propagate cancellation.',
                suggestion: 'Replace context.Background() with r.Context() so downstream operations respect client disconnection.',
              });
              break;
            }
            // Stop looking if we hit the next function
            if (/^func\s/.test(lines[j]!)) break;
          }
        }
      }
      return findings;
    },
  },

  // ── GO_020: time.Sleep in HTTP handler ──────────────────────────────────
  {
    id: 'GO_020',
    category: 'go_time_sleep_in_handler',
    description: 'time.Sleep() called inside HTTP handler — blocks goroutine and degrades server throughput.',
    severity: 'MEDIUM',
    tags: ['reliability', 'go', 'http', 'performance'],
    sinceVersion: '1.3.0',
    explain: {
      why: "time.Sleep() in an HTTP handler blocks the goroutine serving the request for the full sleep duration. Under any meaningful load, all goroutines become blocked in Sleep() and new connections queue up or are rejected. AI assistants add Sleep() for retry delays, rate limiting, or 'simulating work' — all of which should use time.After() or context-aware timers instead.",
      commonViolations: [
        'time.Sleep(1 * time.Second) // retry delay inside handler',
        'time.Sleep(100 * time.Millisecond) // rate limit attempt',
        'time.Sleep(retryDelay) // backoff in handler',
      ],
      goodExample: 'select {\ncase <-time.After(retryDelay):\n  // retry\ncase <-r.Context().Done():\n  return\n}',
      badExample: 'time.Sleep(1 * time.Second) // ❌ inside handler — blocks goroutine',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('go_time_sleep_in_handler', config.severityRules);
      const findings: Finding[] = [];
      const HANDLER_RE = /func\s+\w+\s*\(\s*\w+\s+http\.ResponseWriter\s*,\s*\w+\s+\*http\.Request\s*\)/;
      const SLEEP_RE = /\btime\.Sleep\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isGoFile(path) || isGoTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!HANDLER_RE.test(lines[i]!)) continue;
          const end = Math.min(lines.length, i + 30);
          for (let j = i + 1; j < end; j++) {
            if (/^\s*\/\//.test(lines[j]!)) continue;
            if (SLEEP_RE.test(lines[j]!)) {
              findings.push({
                severity: sev, category: 'go_time_sleep_in_handler', file: path, line: j + 1,
                message: 'time.Sleep() inside HTTP handler — blocks goroutine and degrades server throughput under load.',
                suggestion: 'Use select with time.After() and r.Context().Done() for cancellable delays.',
              });
              break;
            }
            if (/^func\s/.test(lines[j]!)) break;
          }
        }
      }
      return findings;
    },
  },

];
