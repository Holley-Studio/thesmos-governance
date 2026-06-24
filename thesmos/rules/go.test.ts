// @vitest-environment node
/**
 * Unit tests for Go security rules (GO_001–020).
 *
 * Each test exercises ONE rule by passing crafted changedFiles.
 * "fires" tests verify the rule detects bad code.
 * "safe" tests verify no false positives on correct code.
 */
import { describe, it, expect } from 'vitest';
import { GO_RULES } from './go';
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
  const r = GO_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(ruleId: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(ruleId).detect(input);
}

// ── GO_001: SQL injection ────────────────────────────────────────────────────

describe('GO_001 — SQL injection via fmt.Sprintf', () => {
  it('fires on db.Query with fmt.Sprintf', () => {
    const findings = detect('GO_001', [
      { path: 'store.go', content: 'rows, err := db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", userID))\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_sql_injection');
    expect(findings[0]!.line).toBe(1);
  });

  it('fires on db.Exec with string concat', () => {
    const findings = detect('GO_001', [
      { path: 'store.go', content: 'db.Exec("DELETE FROM items WHERE name = \'" + name + "\'")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on db.QueryRow with fmt.Sprintf', () => {
    const findings = detect('GO_001', [
      { path: 'repo.go', content: 'row := db.QueryRow(fmt.Sprintf("SELECT * FROM orders WHERE id = %d", id))\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on parameterized query', () => {
    const findings = detect('GO_001', [
      { path: 'store.go', content: 'rows, err := db.Query("SELECT * FROM users WHERE id = $1", userID)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_001', [
      { path: 'store_test.go', content: 'db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", id))\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-Go files', () => {
    const findings = detect('GO_001', [
      { path: 'store.ts', content: 'db.Query(fmt.Sprintf("SELECT * FROM users WHERE id = %s", id))\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_002: Command injection ────────────────────────────────────────────────

describe('GO_002 — command injection via exec.Command', () => {
  it('fires on exec.Command with fmt.Sprintf as first arg', () => {
    const findings = detect('GO_002', [
      { path: 'runner.go', content: 'cmd := exec.Command(fmt.Sprintf("git-%s", subcommand))\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_command_injection');
  });

  it('fires on sh -c with fmt.Sprintf', () => {
    const findings = detect('GO_002', [
      { path: 'runner.go', content: 'cmd := exec.Command("sh", "-c", fmt.Sprintf("convert %s output.png", filename))\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on exec.Command with literal command name and separate args', () => {
    const findings = detect('GO_002', [
      { path: 'runner.go', content: 'cmd := exec.Command("git", "clone", repoURL)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_002', [
      { path: 'runner_test.go', content: 'exec.Command(fmt.Sprintf("tool-%s", name))\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_003: SSRF ─────────────────────────────────────────────────────────────

describe('GO_003 — SSRF via http.Get with variable URL', () => {
  it('fires on http.Get with variable URL and no validation', () => {
    const findings = detect('GO_003', [
      { path: 'client.go', content: 'resp, err := http.Get(userURL)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_ssrf');
  });

  it('fires on http.Post with variable URL', () => {
    const findings = detect('GO_003', [
      { path: 'webhook.go', content: 'resp, err := http.Post(webhookURL, "application/json", body)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when url.Parse validation is present', () => {
    const findings = detect('GO_003', [
      { path: 'client.go', content: 'parsed, err := url.Parse(userURL)\nif !isAllowedHost(parsed.Host) { return }\nresp, err := http.Get(userURL)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on http.Get with literal URL', () => {
    const findings = detect('GO_003', [
      { path: 'client.go', content: 'resp, err := http.Get("https://api.example.com/data")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_004: Weak random ──────────────────────────────────────────────────────

describe('GO_004 — weak randomness with math/rand', () => {
  it('fires when math/rand is used near "token"', () => {
    const findings = detect('GO_004', [
      {
        path: 'auth.go',
        content: [
          'import "math/rand"',
          'func generateToken() string {',
          '  token := fmt.Sprintf("%d", rand.Int63())',
          '  return token',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_weak_random');
  });

  it('fires when math/rand is used near "password"', () => {
    const findings = detect('GO_004', [
      {
        path: 'util.go',
        content: 'import "math/rand"\nfunc genPassword() string {\n  password := rand.Intn(9999)\n  return fmt.Sprintf("%d", password)\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when math/rand is used without security context', () => {
    const findings = detect('GO_004', [
      { path: 'shuffle.go', content: 'import "math/rand"\nrand.Shuffle(len(items), func(i, j int) { items[i], items[j] = items[j], items[i] })\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when crypto/rand is used', () => {
    const findings = detect('GO_004', [
      { path: 'auth.go', content: 'import "crypto/rand"\nbuf := make([]byte, 32)\nrand.Read(buf)\ntoken := hex.EncodeToString(buf)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_004', [
      { path: 'auth_test.go', content: 'import "math/rand"\ntoken := rand.Intn(1000)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_005: Hardcoded secrets ────────────────────────────────────────────────

describe('GO_005 — hardcoded secrets', () => {
  it('fires on hardcoded password variable', () => {
    const findings = detect('GO_005', [
      { path: 'config.go', content: 'password := "hunter2secret"\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_hardcoded_secret');
    expect(findings[0]!.line).toBe(1);
  });

  it('fires on hardcoded apiKey', () => {
    const findings = detect('GO_005', [
      { path: 'client.go', content: 'apiKey := "sk-prod-abc123xyz456"\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on hardcoded token', () => {
    const findings = detect('GO_005', [
      { path: 'config.go', content: 'token := "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when loaded from env', () => {
    const findings = detect('GO_005', [
      { path: 'config.go', content: 'apiKey := os.Getenv("API_KEY")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_005', [
      { path: 'auth_test.go', content: 'password := "testpassword123"\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on empty string assignment', () => {
    const findings = detect('GO_005', [
      { path: 'config.go', content: 'password := ""\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_006: InsecureSkipVerify ───────────────────────────────────────────────

describe('GO_006 — InsecureSkipVerify: true in TLS config', () => {
  it('fires on InsecureSkipVerify: true', () => {
    const findings = detect('GO_006', [
      { path: 'client.go', content: 'tlsConfig := &tls.Config{InsecureSkipVerify: true}\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_tls_insecure');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires in http.Transport TLS config', () => {
    const findings = detect('GO_006', [
      { path: 'transport.go', content: 'tr := &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when InsecureSkipVerify is false', () => {
    const findings = detect('GO_006', [
      { path: 'client.go', content: 'tlsConfig := &tls.Config{InsecureSkipVerify: false}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on secure TLS config', () => {
    const findings = detect('GO_006', [
      { path: 'client.go', content: 'tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_007: Logging sensitive values ────────────────────────────────────────

describe('GO_007 — logging sensitive values', () => {
  it('fires on log.Printf with password', () => {
    const findings = detect('GO_007', [
      { path: 'auth.go', content: 'log.Printf("login: password=%s", password)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_log_sensitive');
  });

  it('fires on fmt.Printf with token', () => {
    const findings = detect('GO_007', [
      { path: 'debug.go', content: 'fmt.Printf("auth token: %s", token)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on log.Println with secret', () => {
    const findings = detect('GO_007', [
      { path: 'config.go', content: 'log.Println("loaded secret:", secret)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on log.Printf with non-sensitive values', () => {
    const findings = detect('GO_007', [
      { path: 'server.go', content: 'log.Printf("request from user: %s", username)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on commented-out log lines', () => {
    const findings = detect('GO_007', [
      { path: 'auth.go', content: '// log.Printf("password: %s", password)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_008: os.Setenv with secret key ───────────────────────────────────────

describe('GO_008 — os.Setenv with sensitive key', () => {
  it('fires on os.Setenv with PASSWORD key', () => {
    const findings = detect('GO_008', [
      { path: 'setup.go', content: 'os.Setenv("DB_PASSWORD", password)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_os_setenv_secret');
  });

  it('fires on os.Setenv with SECRET key', () => {
    const findings = detect('GO_008', [
      { path: 'setup.go', content: 'os.Setenv("API_SECRET", secretKey)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on os.Setenv with TOKEN key', () => {
    const findings = detect('GO_008', [
      { path: 'setup.go', content: 'os.Setenv("AUTH_TOKEN", token)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on os.Setenv with non-sensitive key', () => {
    const findings = detect('GO_008', [
      { path: 'setup.go', content: 'os.Setenv("LOG_LEVEL", "debug")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on os.Getenv', () => {
    const findings = detect('GO_008', [
      { path: 'config.go', content: 'password := os.Getenv("DB_PASSWORD")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_009: Ignored error ────────────────────────────────────────────────────

describe('GO_009 — ignored error with blank identifier', () => {
  it('fires on _ = db.Exec()', () => {
    const findings = detect('GO_009', [
      { path: 'store.go', content: '_ = db.Exec("INSERT INTO logs VALUES($1)", msg)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_ignored_error');
  });

  it('fires on _ = json.Unmarshal()', () => {
    const findings = detect('GO_009', [
      { path: 'parser.go', content: '_ = json.Unmarshal(data, &result)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on _ = os.Remove()', () => {
    const findings = detect('GO_009', [
      { path: 'cleanup.go', content: '_ = os.Remove(tempFile)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on proper error handling', () => {
    const findings = detect('GO_009', [
      { path: 'store.go', content: 'if err := db.Exec("INSERT INTO logs VALUES($1)", msg); err != nil {\n  return err\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_009', [
      { path: 'store_test.go', content: '_ = db.Exec("CREATE TABLE test ...")\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_010: panic in HTTP handler ────────────────────────────────────────────

describe('GO_010 — panic in HTTP handler', () => {
  it('fires on panic inside an HTTP handler', () => {
    const findings = detect('GO_010', [
      {
        path: 'handler.go',
        content: [
          'func handleUser(w http.ResponseWriter, r *http.Request) {',
          '  user, err := getUser(r)',
          '  if err != nil {',
          '    panic(err)',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_panic_in_handler');
  });

  it('does not fire when panic is outside a handler', () => {
    const findings = detect('GO_010', [
      { path: 'main.go', content: 'func main() {\n  if cfg == nil { panic("config required") }\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on handlers without panic', () => {
    const findings = detect('GO_010', [
      {
        path: 'handler.go',
        content: 'func handleUser(w http.ResponseWriter, r *http.Request) {\n  http.Error(w, "not found", http.StatusNotFound)\n}\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_010', [
      { path: 'handler_test.go', content: 'func TestHandler(w http.ResponseWriter, r *http.Request) {\n  panic("test")\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_011: Goroutine leak ───────────────────────────────────────────────────

describe('GO_011 — goroutine leak without WaitGroup', () => {
  it('fires when goroutine launched without WaitGroup or context', () => {
    const findings = detect('GO_011', [
      {
        path: 'worker.go',
        content: 'func startWorker() {\n  go func() {\n    doWork()\n  }()\n}\n',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_goroutine_leak');
  });

  it('does not fire when WaitGroup is used', () => {
    const findings = detect('GO_011', [
      {
        path: 'worker.go',
        content: 'var wg sync.WaitGroup\nwg.Add(1)\ngo func() {\n  defer wg.Done()\n  doWork()\n}()\nwg.Wait()\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when context.WithCancel is used', () => {
    const findings = detect('GO_011', [
      {
        path: 'worker.go',
        content: 'ctx, cancel := context.WithCancel(context.Background())\ngo func() {\n  <-ctx.Done()\n}()\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_011', [
      { path: 'worker_test.go', content: 'go func() { doWork() }()\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_012: Global mutable state without mutex ───────────────────────────────

describe('GO_012 — global mutable map without mutex', () => {
  it('fires on package-level var map without sync.Mutex', () => {
    const findings = detect('GO_012', [
      { path: 'cache.go', content: 'var cache = map[string]string{}\n\nfunc get(k string) string { return cache[k] }\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_global_mutable_state');
  });

  it('fires on package-level var slice without sync', () => {
    const findings = detect('GO_012', [
      { path: 'registry.go', content: 'var items []Item\n\nfunc add(item Item) { items = append(items, item) }\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when sync.RWMutex is present', () => {
    const findings = detect('GO_012', [
      {
        path: 'cache.go',
        content: 'var mu sync.RWMutex\nvar cache = map[string]string{}\nfunc get(k string) string { mu.RLock(); defer mu.RUnlock(); return cache[k] }\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when sync.Map is used', () => {
    const findings = detect('GO_012', [
      { path: 'cache.go', content: 'var cache sync.Map\nfunc get(k string) (string, bool) { v, ok := cache.Load(k); return v.(string), ok }\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_012', [
      { path: 'cache_test.go', content: 'var testCache = map[string]string{}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_013: HTTP client without timeout ─────────────────────────────────────

describe('GO_013 — HTTP client without timeout', () => {
  it('fires on http.DefaultClient usage', () => {
    const findings = detect('GO_013', [
      { path: 'client.go', content: 'resp, err := http.DefaultClient.Do(req)\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_http_no_timeout');
  });

  it('fires on &http.Client{} with no Timeout', () => {
    const findings = detect('GO_013', [
      { path: 'client.go', content: 'client := &http.Client{}\nresp, err := client.Do(req)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on http.Client with Timeout', () => {
    const findings = detect('GO_013', [
      { path: 'client.go', content: 'client := &http.Client{Timeout: 10 * time.Second}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_013', [
      { path: 'client_test.go', content: 'client := &http.Client{}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_014: http.ListenAndServe without timeout ──────────────────────────────

describe('GO_014 — http.ListenAndServe without server struct', () => {
  it('fires on http.ListenAndServe() call', () => {
    const findings = detect('GO_014', [
      { path: 'main.go', content: 'log.Fatal(http.ListenAndServe(":8080", mux))\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_server_no_timeout');
  });

  it('fires on http.ListenAndServeTLS() call', () => {
    const findings = detect('GO_014', [
      { path: 'main.go', content: 'http.ListenAndServeTLS(":443", certFile, keyFile, mux)\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on http.Server struct with timeouts', () => {
    const findings = detect('GO_014', [
      {
        path: 'main.go',
        content: 'srv := &http.Server{\n  Addr: ":8080",\n  ReadTimeout: 5 * time.Second,\n  WriteTimeout: 10 * time.Second,\n}\nsrv.ListenAndServe()\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_014', [
      { path: 'server_test.go', content: 'http.ListenAndServe(":8080", nil)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_015: Missing input validation ────────────────────────────────────────

describe('GO_015 — missing input validation in handler before DB', () => {
  it('fires when handler reads query param and passes to DB without validation', () => {
    const findings = detect('GO_015', [
      {
        path: 'handler.go',
        content: [
          'func getItem(w http.ResponseWriter, r *http.Request) {',
          '  id := r.URL.Query().Get("id")',
          '  rows, err := db.Query("SELECT * FROM items WHERE id = $1", id)',
          '  _ = rows',
          '  _ = err',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_missing_input_validation');
  });

  it('does not fire when strconv validation is present', () => {
    const findings = detect('GO_015', [
      {
        path: 'handler.go',
        content: [
          'func getItem(w http.ResponseWriter, r *http.Request) {',
          '  idStr := r.URL.Query().Get("id")',
          '  id, err := strconv.Atoi(idStr)',
          '  if err != nil { http.Error(w, "invalid id", 400); return }',
          '  rows, _ := db.Query("SELECT * FROM items WHERE id = $1", id)',
          '  _ = rows',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on handlers without DB calls', () => {
    const findings = detect('GO_015', [
      {
        path: 'handler.go',
        content: 'func ping(w http.ResponseWriter, r *http.Request) {\n  name := r.URL.Query().Get("name")\n  fmt.Fprintf(w, "hello %s", name)\n}\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_015', [
      {
        path: 'handler_test.go',
        content: 'func TestHandler(w http.ResponseWriter, r *http.Request) {\n  id := r.URL.Query().Get("id")\n  db.Query("SELECT * FROM items WHERE id = $1", id)\n}\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_016: Handler with no auth ─────────────────────────────────────────────

describe('GO_016 — HTTP handler registration with no auth', () => {
  it('fires on http.HandleFunc with no auth in the window', () => {
    const findings = detect('GO_016', [
      {
        path: 'server.go',
        content: [
          'func setupRoutes() {',
          '  http.HandleFunc("/api/admin", handleAdmin)',
          '}',
          'func handleAdmin(w http.ResponseWriter, r *http.Request) {',
          '  w.Write([]byte("admin"))',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_handler_no_auth');
  });

  it('does not fire on health/ping/metrics routes', () => {
    const findings = detect('GO_016', [
      { path: 'server.go', content: 'http.HandleFunc("/health", handleHealth)\nhttp.HandleFunc("/metrics", handleMetrics)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when auth middleware is referenced in the window', () => {
    const findings = detect('GO_016', [
      {
        path: 'server.go',
        content: 'http.HandleFunc("/api/users", authMiddleware(handleUsers))\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_016', [
      { path: 'server_test.go', content: 'http.HandleFunc("/api/data", handleData)\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_017: Path traversal ───────────────────────────────────────────────────

describe('GO_017 — path traversal via request input', () => {
  it('fires on os.ReadFile with r.URL.Query() arg', () => {
    const findings = detect('GO_017', [
      {
        path: 'files.go',
        content: [
          'func serveFile(w http.ResponseWriter, r *http.Request) {',
          '  filename := r.URL.Query().Get("file")',
          '  data, err := os.ReadFile(filepath.Join(baseDir, filename))',
          '  _ = data',
          '  _ = err',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_path_traversal');
  });

  it('fires on os.Open with r.FormValue arg', () => {
    const findings = detect('GO_017', [
      {
        path: 'upload.go',
        content: 'path := r.FormValue("path")\nf, _ := os.Open(path)\n_ = f\n',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when filepath.Clean is used as a guard', () => {
    const findings = detect('GO_017', [
      {
        path: 'files.go',
        content: [
          'filename := r.URL.Query().Get("file")',
          'safePath := filepath.Join(baseDir, filename)',
          'if !strings.HasPrefix(filepath.Clean(safePath), baseDir) {',
          '  http.Error(w, "forbidden", 403)',
          '  return',
          '}',
          'os.ReadFile(safePath)',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_017', [
      { path: 'files_test.go', content: 'filename := r.URL.Query().Get("file")\nos.ReadFile(filepath.Join(dir, filename))\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_018: ioutil deprecated ────────────────────────────────────────────────

describe('GO_018 — ioutil deprecated functions', () => {
  it('fires on ioutil.ReadFile', () => {
    const findings = detect('GO_018', [
      { path: 'config.go', content: 'data, err := ioutil.ReadFile("config.json")\n_ = data\n_ = err\n' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_ioutil_deprecated');
    expect(findings[0]!.severity).toBe('LOW');
  });

  it('fires on ioutil.ReadAll', () => {
    const findings = detect('GO_018', [
      { path: 'client.go', content: 'body, err := ioutil.ReadAll(resp.Body)\n_ = body\n_ = err\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on ioutil.WriteFile', () => {
    const findings = detect('GO_018', [
      { path: 'writer.go', content: 'err := ioutil.WriteFile("output.txt", data, 0644)\n_ = err\n' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on os.ReadFile', () => {
    const findings = detect('GO_018', [
      { path: 'config.go', content: 'data, err := os.ReadFile("config.json")\n_ = data\n_ = err\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on io.ReadAll', () => {
    const findings = detect('GO_018', [
      { path: 'client.go', content: 'body, err := io.ReadAll(resp.Body)\n_ = body\n_ = err\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('fires on test files too (ioutil is bad anywhere)', () => {
    const findings = detect('GO_018', [
      { path: 'config_test.go', content: 'data, _ := ioutil.ReadFile("testdata/fixture.json")\n' },
    ]);
    expect(findings).toHaveLength(1);
  });
});

// ── GO_019: context.Background() in handler ──────────────────────────────────

describe('GO_019 — context.Background() inside HTTP handler', () => {
  it('fires when context.Background() is used inside a handler', () => {
    const findings = detect('GO_019', [
      {
        path: 'handler.go',
        content: [
          'func getUser(w http.ResponseWriter, r *http.Request) {',
          '  ctx := context.Background()',
          '  rows, err := db.QueryContext(ctx, "SELECT * FROM users")',
          '  _ = rows',
          '  _ = err',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_context_background_in_handler');
  });

  it('does not fire when r.Context() is used', () => {
    const findings = detect('GO_019', [
      {
        path: 'handler.go',
        content: 'func getUser(w http.ResponseWriter, r *http.Request) {\n  ctx := r.Context()\n  rows, _ := db.QueryContext(ctx, "SELECT * FROM users")\n  _ = rows\n}\n',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when context.Background() is used outside a handler', () => {
    const findings = detect('GO_019', [
      { path: 'main.go', content: 'func main() {\n  ctx := context.Background()\n  _ = ctx\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_019', [
      { path: 'handler_test.go', content: 'func TestHandler(w http.ResponseWriter, r *http.Request) {\n  ctx := context.Background()\n  _ = ctx\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── GO_020: time.Sleep in HTTP handler ──────────────────────────────────────

describe('GO_020 — time.Sleep inside HTTP handler', () => {
  it('fires on time.Sleep inside a handler', () => {
    const findings = detect('GO_020', [
      {
        path: 'handler.go',
        content: [
          'func retryHandler(w http.ResponseWriter, r *http.Request) {',
          '  time.Sleep(1 * time.Second)',
          '  doWork()',
          '}',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('go_time_sleep_in_handler');
  });

  it('does not fire when time.Sleep is outside a handler', () => {
    const findings = detect('GO_020', [
      { path: 'worker.go', content: 'func worker() {\n  time.Sleep(100 * time.Millisecond)\n  doWork()\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on handlers without time.Sleep', () => {
    const findings = detect('GO_020', [
      { path: 'handler.go', content: 'func serve(w http.ResponseWriter, r *http.Request) {\n  w.Write([]byte("ok"))\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on test files', () => {
    const findings = detect('GO_020', [
      { path: 'handler_test.go', content: 'func TestHandler(w http.ResponseWriter, r *http.Request) {\n  time.Sleep(10 * time.Millisecond)\n}\n' },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── Structural validation ─────────────────────────────────────────────────────

describe('GO_RULES structural checks', () => {
  it('has exactly 20 rules', () => {
    expect(GO_RULES).toHaveLength(20);
  });

  it('every rule has a unique ID', () => {
    const ids = GO_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every rule has an explain block', () => {
    for (const r of GO_RULES) {
      expect(r.explain, `[${r.id}] missing explain`).toBeDefined();
      expect(r.explain!.why.length, `[${r.id}] explain.why empty`).toBeGreaterThan(0);
      expect(Array.isArray(r.explain!.commonViolations), `[${r.id}] commonViolations not array`).toBe(true);
      expect(r.explain!.goodExample.length, `[${r.id}] goodExample empty`).toBeGreaterThan(0);
      expect(r.explain!.badExample.length, `[${r.id}] badExample empty`).toBeGreaterThan(0);
    }
  });

  it('every rule detect() returns an array', () => {
    const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: [] };
    for (const r of GO_RULES) {
      expect(Array.isArray(r.detect(input)), `[${r.id}] detect() did not return array`).toBe(true);
    }
  });
});
