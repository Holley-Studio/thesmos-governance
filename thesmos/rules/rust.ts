// Copyright (c) 2026 Holley Studios. All rights reserved.
import type { ThesmosRule, Finding, DetectInput } from '../types.js';
import { classifySeverity } from '../severity.js';

const isRustFile = (p: string) => /\.rs$/.test(p);
const isRustTest = (p: string) => /\/tests?\/|_test\.rs$|#\[cfg\(test\)\]/.test(p);
const isCargoToml = (p: string) => /Cargo\.toml$/.test(p);

export const RUST_RULES: ThesmosRule[] = [
  // ── RUST_001: .unwrap() in lib crate ────────────────────────────────────
  {
    id: 'RUST_001',
    category: 'rust_unwrap_in_lib',
    description: '.unwrap() in a lib crate (not in tests, not in fn main, not in examples).',
    severity: 'HIGH',
    tags: ['correctness', 'rust', 'error-handling'],
    sinceVersion: '1.5.0',
    explain: {
      why: '.unwrap() panics at runtime when the Result is Err or Option is None. In library code this propagates a panic to the caller rather than returning a recoverable error.',
      commonViolations: [
        'let val = result.unwrap();',
        'let s = std::fs::read_to_string("config.toml").unwrap();',
      ],
      goodExample: 'let val = result?;  // propagate with ? operator\nlet val = result.expect("descriptive message about invariant");',
      badExample: 'let val = result.unwrap(); // panics on Err',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_unwrap_in_lib', config.severityRules);
      const findings: Finding[] = [];
      const UNWRAP_RE = /\.unwrap\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        if (isRustTest(path)) continue;
        if (/\/main\.rs$/.test(path) || /\/examples\//.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (UNWRAP_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_unwrap_in_lib', file: path, line: i + 1,
              message: '.unwrap() in library code — panics on error instead of propagating.',
              suggestion: 'Use the ? operator or .expect("descriptive message") to handle errors explicitly.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_002: .expect("") or .expect("TODO") ─────────────────────────────
  {
    id: 'RUST_002',
    category: 'rust_expect_without_message',
    description: '.expect("") or .expect("TODO") — empty or placeholder expect message.',
    severity: 'MEDIUM',
    tags: ['correctness', 'rust', 'error-handling'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'An empty or placeholder expect message provides no context when the program panics. Good expect messages explain WHY the value must be present.',
      commonViolations: [
        'file.read_to_string(&mut s).expect("TODO");',
        'result.expect("");',
        'val.expect("fix")',
      ],
      goodExample: 'config_file.read_to_string(&mut s).expect("config file must exist at startup");',
      badExample: 'result.expect("TODO"); // no useful context when this panics',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_expect_without_message', config.severityRules);
      const findings: Finding[] = [];
      const EXPECT_PLACEHOLDER_RE = /\.expect\s*\(\s*["'](?:|TODO|todo|FIXME|fixme|unwrap|fix|placeholder)["']\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (EXPECT_PLACEHOLDER_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_expect_without_message', file: path, line: i + 1,
              message: '.expect() with empty or placeholder message — no context on panic.',
              suggestion: 'Provide a descriptive message: .expect("config file must exist at startup").',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_003: panic!() in lib crate ──────────────────────────────────────
  {
    id: 'RUST_003',
    category: 'rust_panic_in_lib',
    description: 'panic!() macro called in a lib crate (not in tests).',
    severity: 'HIGH',
    tags: ['correctness', 'rust', 'error-handling'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'panic!() in library code is unrecoverable and cannot be handled by the caller. Return a Result or Option instead to give the caller control.',
      commonViolations: [
        'panic!("something went wrong")',
        'panic!("index out of bounds: {}", idx)',
      ],
      goodExample: 'return Err(MyError::InvalidInput("something went wrong".to_string()));',
      badExample: 'panic!("something went wrong"); // caller cannot recover',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_panic_in_lib', config.severityRules);
      const findings: Finding[] = [];
      const PANIC_RE = /\bpanic!\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        if (isRustTest(path)) continue;
        if (/\/main\.rs$/.test(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (PANIC_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_panic_in_lib', file: path, line: i + 1,
              message: 'panic!() in library code — return Result/Option instead.',
              suggestion: 'Return Err(...) or None to let callers handle the error condition.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_004: unsafe block without SAFETY comment ─────────────────────────
  {
    id: 'RUST_004',
    category: 'rust_unsafe_block',
    description: 'unsafe { } block without a // SAFETY: comment explaining the invariant.',
    severity: 'HIGH',
    tags: ['correctness', 'rust', 'unsafe', 'security'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Every unsafe block requires a proof that the invariants required by the unsafe operation hold. A // SAFETY: comment forces the author to articulate this proof.',
      commonViolations: [
        'unsafe { *raw_ptr }',
        'unsafe { std::slice::from_raw_parts(ptr, len) }',
      ],
      goodExample: '// SAFETY: pointer is non-null because we checked above and has exclusive access\nunsafe { *ptr = value; }',
      badExample: 'unsafe { *raw_ptr } // no safety justification',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_unsafe_block', config.severityRules);
      const findings: Finding[] = [];
      const UNSAFE_RE = /\bunsafe\s*\{/;
      const SAFETY_RE = /\/\/\s*SAFETY:/i;
      const WINDOW = 3;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!UNSAFE_RE.test(line)) continue;
          // Check the current line and up to WINDOW lines before
          const start = Math.max(0, i - WINDOW);
          const ctx = lines.slice(start, i + 1).join('\n');
          if (!SAFETY_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'rust_unsafe_block', file: path, line: i + 1,
              message: 'unsafe block without // SAFETY: comment — document the invariant.',
              suggestion: 'Add a // SAFETY: comment before the unsafe block explaining why this is sound.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_005: unchecked as cast to narrow integer ─────────────────────────
  {
    id: 'RUST_005',
    category: 'rust_integer_overflow_cast',
    description: 'Unchecked `as u8` or `as i8` cast — silently truncates on overflow.',
    severity: 'MEDIUM',
    tags: ['correctness', 'rust', 'integer-overflow'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Casting to a narrower integer type with `as` silently truncates — 256u32 as u8 == 0. Use .try_into()? to get an error on overflow.',
      commonViolations: [
        'let byte = big_number as u8;',
        'let small = value as i8;',
      ],
      goodExample: 'let byte: u8 = big_number.try_into()?;',
      badExample: 'let byte = big_number as u8; // silently truncates',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_integer_overflow_cast', config.severityRules);
      const findings: Finding[] = [];
      const NARROW_CAST_RE = /\bas\s+(?:u8|i8)\b/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (NARROW_CAST_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_integer_overflow_cast', file: path, line: i + 1,
              message: '`as u8`/`as i8` cast silently truncates on overflow.',
              suggestion: 'Use .try_into()? to propagate overflow as an error instead of silently wrapping.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_006: .clone() on large struct / inside loop ─────────────────────
  {
    id: 'RUST_006',
    category: 'rust_clone_on_large_struct',
    description: '.clone() on a variable with a data/payload/buffer-like name, or inside a loop.',
    severity: 'MEDIUM',
    tags: ['performance', 'rust'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Cloning large structures (data buffers, record sets, payloads) causes heap allocations. Inside loops this multiplies the cost. Prefer passing references or wrapping in Arc<T>.',
      commonViolations: [
        'let copy = payload.clone();',
        'for item in list { process(data.clone()); }',
      ],
      goodExample: 'process(&payload); // pass a reference\nlet shared = Arc::new(data); // share ownership',
      badExample: 'let copy = payload.clone(); // potentially large heap allocation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_clone_on_large_struct', config.severityRules);
      const findings: Finding[] = [];
      const DATA_CLONE_RE = /\b(?:data|payload|body|content|records|items|buffer)\b[^;]*\.clone\s*\(\s*\)/;
      const CLONE_RE = /\.clone\s*\(\s*\)/;
      const FOR_RE = /\bfor\b|\bwhile\b/;
      const WINDOW = 5;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (DATA_CLONE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_clone_on_large_struct', file: path, line: i + 1,
              message: '.clone() on a data/payload/buffer variable — potential large heap allocation.',
              suggestion: 'Pass a reference instead, or wrap in Arc<T> for shared ownership.',
            });
          } else if (CLONE_RE.test(line)) {
            // Check if inside a loop
            const start = Math.max(0, i - WINDOW);
            const ctx = lines.slice(start, i).join('\n');
            if (FOR_RE.test(ctx)) {
              findings.push({
                severity: sev, category: 'rust_clone_on_large_struct', file: path, line: i + 1,
                message: '.clone() called inside a loop — allocates on every iteration.',
                suggestion: 'Move the clone outside the loop, pass a reference, or use Arc<T>.',
              });
            }
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_007: format!() inside a loop ────────────────────────────────────
  {
    id: 'RUST_007',
    category: 'rust_string_format_in_loop',
    description: 'format!() called inside a for/while/loop — allocates a new String every iteration.',
    severity: 'MEDIUM',
    tags: ['performance', 'rust'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'format!() allocates a new heap String each call. Inside a loop this causes O(n) allocations. Pre-allocate with String::with_capacity() and push_str/write! into it instead.',
      commonViolations: [
        'for item in items { let s = format!("{}: {}", key, item); }',
      ],
      goodExample: 'let mut buf = String::with_capacity(items.len() * 32);\nfor item in &items { write!(buf, "{}: {}\\n", key, item)?; }',
      badExample: 'for item in items { let s = format!("{}: {}", key, item); } // allocates every iteration',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_string_format_in_loop', config.severityRules);
      const findings: Finding[] = [];
      const FORMAT_RE = /\bformat!\s*\(/;
      const LOOP_RE = /\bfor\b|\bwhile\b|\bloop\b/;
      const WINDOW = 4;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (!FORMAT_RE.test(line)) continue;
          const start = Math.max(0, i - WINDOW);
          const ctx = lines.slice(start, i).join('\n');
          if (LOOP_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'rust_string_format_in_loop', file: path, line: i + 1,
              message: 'format!() inside a loop — heap-allocates on every iteration.',
              suggestion: 'Pre-allocate with String::with_capacity() and use write!(buf, ...) or push_str().',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_008: MutexGuard held across .await ──────────────────────────────
  {
    id: 'RUST_008',
    category: 'rust_mutex_guard_across_await',
    description: 'MutexGuard (.lock()) held across an .await point — deadlock risk in async code.',
    severity: 'BLOCKER',
    tags: ['correctness', 'rust', 'async', 'deadlock'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'std::sync::MutexGuard is not Send. Holding a guard across .await prevents the executor from moving the future to another thread and can cause deadlocks.',
      commonViolations: [
        'let guard = mutex.lock().unwrap();\ndo_something().await;',
      ],
      goodExample: '{ let mut g = mutex.lock().unwrap(); *g += 1; } // guard dropped here\nsome_future.await;',
      badExample: 'let guard = mutex.lock().unwrap();\ndo_something().await; // guard held across await',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_mutex_guard_across_await', config.severityRules);
      const findings: Finding[] = [];
      const LOCK_RE = /\.lock\s*\(\s*\)/;
      const AWAIT_RE = /\.await\b/;
      const WINDOW = 8;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!LOCK_RE.test(line)) continue;
          const end = Math.min(lines.length, i + WINDOW + 1);
          const ctx = lines.slice(i, end).join('\n');
          if (AWAIT_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'rust_mutex_guard_across_await', file: path, line: i + 1,
              message: 'MutexGuard (.lock()) potentially held across .await — deadlock risk.',
              suggestion: 'Drop the guard in a block before awaiting: { let g = m.lock()?; ... } future.await;',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_009: blocking call in async fn ──────────────────────────────────
  {
    id: 'RUST_009',
    category: 'rust_blocking_call_in_async',
    description: 'Blocking I/O (std::fs::read, std::thread::sleep, TcpStream::connect) in an async fn.',
    severity: 'HIGH',
    tags: ['correctness', 'rust', 'async', 'performance'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Blocking calls inside async functions stall the entire executor thread, preventing other tasks from running. Use the async equivalents from tokio or async-std.',
      commonViolations: [
        'async fn handler() { let data = std::fs::read("file.txt")?; }',
        'async fn wait() { std::thread::sleep(Duration::from_secs(1)); }',
      ],
      goodExample: 'async fn handler() -> Result<Vec<u8>> { let data = tokio::fs::read("file.txt").await?; Ok(data) }',
      badExample: 'async fn handler() { let data = std::fs::read("file.txt")?; } // blocks executor thread',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_blocking_call_in_async', config.severityRules);
      const findings: Finding[] = [];
      const BLOCKING_RE = /\bstd::fs::(?:read|write|read_to_string)\b|\bstd::thread::sleep\b|\bTcpStream::connect\b/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        if (!content.includes('async fn')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (BLOCKING_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_blocking_call_in_async', file: path, line: i + 1,
              message: 'Blocking I/O call in async context — stalls the executor thread.',
              suggestion: 'Use async equivalents: tokio::fs::read, tokio::time::sleep, tokio::net::TcpStream.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_010: SQL built with format! ─────────────────────────────────────
  {
    id: 'RUST_010',
    category: 'rust_sql_injection',
    description: 'SQL string built with format!() including a {} placeholder — SQL injection risk.',
    severity: 'BLOCKER',
    tags: ['security', 'rust', 'sql-injection'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Building SQL with format!() interpolates user input directly into the query string, enabling SQL injection. Use parameterized queries instead.',
      commonViolations: [
        'let q = format!("SELECT * FROM users WHERE id = {}", user_id);',
        'let q = format!("INSERT INTO logs (msg) VALUES (\'{}\')", msg);',
      ],
      goodExample: 'sqlx::query!("SELECT * FROM users WHERE id = $1", user_id).fetch_one(&pool).await?;',
      badExample: 'let q = format!("SELECT * FROM users WHERE id = {}", user_id); // SQL injection',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_sql_injection', config.severityRules);
      const findings: Finding[] = [];
      const SQL_FORMAT_RE = /format!\s*\(\s*"[^"]*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)[^"]*\{/i;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (SQL_FORMAT_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_sql_injection', file: path, line: i + 1,
              message: 'SQL query built with format!() and {} placeholder — SQL injection risk.',
              suggestion: 'Use parameterized queries: sqlx::query!("SELECT ... WHERE id = $1", id).',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_011: hardcoded secret in variable ────────────────────────────────
  {
    id: 'RUST_011',
    category: 'rust_hardcoded_secret',
    description: 'Hardcoded API key, password, or secret assigned to a sensitive-named variable.',
    severity: 'HIGH',
    tags: ['security', 'rust', 'secrets'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Hardcoded secrets end up in version control and build artifacts. Use environment variables or a secrets manager instead.',
      commonViolations: [
        'let api_key = "sk_live_abc123xyz";',
        'const PASSWORD: &str = "hunter2";',
      ],
      goodExample: 'let api_key = std::env::var("API_KEY").expect("API_KEY must be set");',
      badExample: 'let api_key = "sk_live_abc123xyz"; // hardcoded secret in source',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_hardcoded_secret', config.severityRules);
      const findings: Finding[] = [];
      const SECRET_RE = /(?:let|const|static)\s+(?:\w+\s+)?(?:password|secret|api_key|token|auth_key|private_key)\s*(?::\s*\S+\s*)?=\s*"[^"]{8,}"/i;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        if (isRustTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (SECRET_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_hardcoded_secret', file: path, line: i + 1,
              message: 'Hardcoded secret or API key in source code — use environment variables.',
              suggestion: 'Use std::env::var("SECRET_KEY").expect("SECRET_KEY must be set") instead.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_012: Result of std::fs operation discarded ──────────────────────
  {
    id: 'RUST_012',
    category: 'rust_missing_must_use',
    description: 'std::fs write/remove/create_dir called as standalone statement — Result discarded.',
    severity: 'MEDIUM',
    tags: ['correctness', 'rust', 'error-handling'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'std::fs functions return Result. Discarding the result silently ignores I/O errors — writes may fail, files may not be removed, but execution continues as if they succeeded.',
      commonViolations: [
        'std::fs::write("output.txt", data);',
        'std::fs::remove_file(path);',
      ],
      goodExample: 'std::fs::write("output.txt", &data)?;',
      badExample: 'std::fs::write("output.txt", data); // Result silently discarded',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_missing_must_use', config.severityRules);
      const findings: Finding[] = [];
      const FS_DISCARD_RE = /^\s*(?:std::fs::write|std::fs::remove_file|std::fs::create_dir|std::fs::rename)\s*\([^)]*\)\s*;/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          // Must not be preceded by let/match/if/? on same line
          if (FS_DISCARD_RE.test(line) && !/\blet\b|\bmatch\b|\bif\b/.test(line)) {
            findings.push({
              severity: sev, category: 'rust_missing_must_use', file: path, line: i + 1,
              message: 'std::fs operation result discarded — I/O errors silently ignored.',
              suggestion: 'Handle the result: use ?, match, or unwrap/expect to surface errors.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_013: old try!() macro ────────────────────────────────────────────
  {
    id: 'RUST_013',
    category: 'rust_use_of_deprecated_try_macro',
    description: 'Deprecated try!() macro — replaced by the ? operator in Rust 2018+.',
    severity: 'LOW',
    tags: ['correctness', 'rust', 'deprecated'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'try!() was the original error propagation macro, superseded by the ? operator in Rust 2018. Modern code should use ? for clarity and composability.',
      commonViolations: [
        'try!(file.read_to_string(&mut s))',
        'let n = try!(str::parse::<i32>(s));',
      ],
      goodExample: 'file.read_to_string(&mut s)?;',
      badExample: 'try!(file.read_to_string(&mut s)) // deprecated macro',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_use_of_deprecated_try_macro', config.severityRules);
      const findings: Finding[] = [];
      const TRY_MACRO_RE = /\btry!\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (TRY_MACRO_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_use_of_deprecated_try_macro', file: path, line: i + 1,
              message: 'Deprecated try!() macro — use the ? operator instead.',
              suggestion: 'Replace try!(expr) with expr?',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_014: std::mem::transmute ────────────────────────────────────────
  {
    id: 'RUST_014',
    category: 'rust_transmute_usage',
    description: 'std::mem::transmute — extremely unsafe type punning that bypasses all safety guarantees.',
    severity: 'BLOCKER',
    tags: ['correctness', 'rust', 'unsafe', 'security'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'transmute reinterprets the bit pattern of one type as another with zero checks. It is the most dangerous function in Rust and almost always has a safe alternative.',
      commonViolations: [
        'unsafe { std::mem::transmute::<u64, f64>(bits) }',
        'let ptr: *const u8 = mem::transmute(reference);',
      ],
      goodExample: 'f64::from_bits(bits) // safe equivalent for u64 -> f64\n// or use bytemuck::cast for POD types',
      badExample: 'unsafe { std::mem::transmute::<u64, f64>(bits) } // undefined behavior risk',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_transmute_usage', config.severityRules);
      const findings: Finding[] = [];
      const TRANSMUTE_RE = /\b(?:std::mem::transmute|mem::transmute)\s*[:<(]/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (TRANSMUTE_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_transmute_usage', file: path, line: i + 1,
              message: 'std::mem::transmute — unsafe type punning, risk of undefined behavior.',
              suggestion: 'Use safe alternatives: f64::from_bits(), bytemuck::cast(), or pointer casts with proper alignment checks.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_015: raw pointer dereference without SAFETY comment ─────────────
  {
    id: 'RUST_015',
    category: 'rust_raw_pointer_deref',
    description: 'Raw pointer dereference (*raw_ptr/*ptr) without a // SAFETY: comment.',
    severity: 'HIGH',
    tags: ['correctness', 'rust', 'unsafe'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Dereferencing a raw pointer is unsafe and requires proving the pointer is non-null, properly aligned, and points to valid memory for the duration of the dereference.',
      commonViolations: [
        'unsafe { *raw_ptr = value; }',
        'let val = unsafe { *mut_ptr };',
      ],
      goodExample: '// SAFETY: raw_ptr is non-null and exclusively owned, checked before this call\nunsafe { *raw_ptr = value; }',
      badExample: 'unsafe { *raw_ptr = value; } // no safety documentation',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_raw_pointer_deref', config.severityRules);
      const findings: Finding[] = [];
      const RAW_DEREF_RE = /\*\s*(?:raw_ptr|raw_pointer|unsafe_ptr|mut_ptr)\b/;
      const SAFETY_RE = /\/\/\s*SAFETY:/i;
      const WINDOW = 3;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (!RAW_DEREF_RE.test(line)) continue;
          const start = Math.max(0, i - WINDOW);
          const ctx = lines.slice(start, i + 1).join('\n');
          if (!SAFETY_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'rust_raw_pointer_deref', file: path, line: i + 1,
              message: 'Raw pointer dereference without // SAFETY: comment.',
              suggestion: 'Add a // SAFETY: comment proving the pointer is valid, aligned, and exclusively owned.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_016: .unwrap() on Option-returning method ────────────────────────
  {
    id: 'RUST_016',
    category: 'rust_panic_on_none',
    description: '.unwrap() chained on a method that returns Option (find/get/first/last/next/pop).',
    severity: 'MEDIUM',
    tags: ['correctness', 'rust', 'error-handling'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Chaining .unwrap() directly after a method that returns Option<T> (find, get, first, last, next, pop) panics when the element is absent. Use pattern matching or ok_or() instead.',
      commonViolations: [
        'let user = users.get(0).unwrap();',
        'let first = items.first().unwrap();',
        'let found = list.iter().find(|x| x.id == id).unwrap();',
      ],
      goodExample: 'let user = users.get(0).ok_or(Error::NotFound)?;\nif let Some(first) = items.first() { ... }',
      badExample: 'let user = users.get(0).unwrap(); // panics if empty',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_panic_on_none', config.severityRules);
      const findings: Finding[] = [];
      const OPTION_UNWRAP_RE = /\.(?:find|get|first|last|next|pop)\s*\([^)]*\)\s*\.unwrap\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        if (isRustTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (OPTION_UNWRAP_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_panic_on_none', file: path, line: i + 1,
              message: '.unwrap() on Option-returning method — panics when element is absent.',
              suggestion: 'Use .ok_or(Error::NotFound)? or if let Some(x) = ... pattern matching.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_017: .collect::<Vec<_>>() inside a loop ─────────────────────────
  {
    id: 'RUST_017',
    category: 'rust_vec_collect_in_loop',
    description: '.collect::<Vec<_>>() inside a for/while loop — allocates a new Vec every iteration.',
    severity: 'MEDIUM',
    tags: ['performance', 'rust'],
    sinceVersion: '1.5.0',
    explain: {
      why: '.collect() into a Vec allocates heap memory. Inside a loop this causes O(n) allocations. Accumulate results with extend() into a pre-allocated Vec instead.',
      commonViolations: [
        'for batch in batches { let items: Vec<_> = batch.iter().collect(); }',
      ],
      goodExample: 'let mut all_items = Vec::with_capacity(total);\nfor batch in &batches { all_items.extend(batch.iter()); }',
      badExample: 'for batch in batches { let items: Vec<_> = batch.iter().collect(); } // new allocation each iteration',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_vec_collect_in_loop', config.severityRules);
      const findings: Finding[] = [];
      const COLLECT_RE = /\.collect\s*::\s*</;
      const LOOP_RE = /\bfor\b|\bwhile\b/;
      const WINDOW = 4;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (!COLLECT_RE.test(line)) continue;
          const start = Math.max(0, i - WINDOW);
          const ctx = lines.slice(start, i).join('\n');
          if (LOOP_RE.test(ctx)) {
            findings.push({
              severity: sev, category: 'rust_vec_collect_in_loop', file: path, line: i + 1,
              message: '.collect::<Vec<_>>() inside a loop — allocates new Vec on every iteration.',
              suggestion: 'Use extend() on a pre-allocated Vec outside the loop instead.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_018: thread::spawn without capturing handle ─────────────────────
  {
    id: 'RUST_018',
    category: 'rust_spawn_without_join',
    description: 'thread::spawn() called without capturing the JoinHandle — fire-and-forget thread.',
    severity: 'MEDIUM',
    tags: ['correctness', 'rust', 'concurrency'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Discarding the JoinHandle from thread::spawn means panics in the thread are silently swallowed and you cannot await completion or propagate errors.',
      commonViolations: [
        'thread::spawn(|| { do_work(); }); // handle discarded',
        'std::thread::spawn(move || process(data));',
      ],
      goodExample: 'let handle = thread::spawn(|| { do_work() });\nhandle.join().expect("worker thread panicked");',
      badExample: 'thread::spawn(|| { do_work(); }); // panic and errors silently lost',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_spawn_without_join', config.severityRules);
      const findings: Finding[] = [];
      const SPAWN_DISCARD_RE = /^\s*(?:std::)?thread::spawn\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          // Fire when thread::spawn appears at the start of a statement (not after `let`)
          if (SPAWN_DISCARD_RE.test(line) && !/\blet\b/.test(line)) {
            findings.push({
              severity: sev, category: 'rust_spawn_without_join', file: path, line: i + 1,
              message: 'thread::spawn() handle discarded — thread panics and errors silently ignored.',
              suggestion: 'Capture the handle: let handle = thread::spawn(...); handle.join()?;',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_019: env::var(...).unwrap() ─────────────────────────────────────
  {
    id: 'RUST_019',
    category: 'rust_env_var_unwrap',
    description: 'std::env::var("KEY").unwrap() — panics at startup if the environment variable is missing.',
    severity: 'HIGH',
    tags: ['correctness', 'rust', 'error-handling'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'Calling .unwrap() on env::var() panics if the variable is not set, producing an unhelpful panic message. Use .expect() with a clear message or handle the error gracefully.',
      commonViolations: [
        'let key = env::var("API_KEY").unwrap();',
        'let db = std::env::var("DATABASE_URL").unwrap();',
      ],
      goodExample: 'let key = env::var("API_KEY").expect("API_KEY environment variable must be set");\n// or\nlet key = env::var("API_KEY").unwrap_or_else(|_| "default".to_string());',
      badExample: 'let key = env::var("API_KEY").unwrap(); // unhelpful panic if var is missing',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_env_var_unwrap', config.severityRules);
      const findings: Finding[] = [];
      const ENV_UNWRAP_RE = /(?:std::env::var|env::var)\s*\([^)]+\)\s*\.unwrap\s*\(\s*\)/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (ENV_UNWRAP_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_env_var_unwrap', file: path, line: i + 1,
              message: 'env::var().unwrap() — panics with unhelpful message if variable is missing.',
              suggestion: 'Use .expect("VAR_NAME must be set") or .unwrap_or_else(|_| default) for graceful handling.',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── RUST_020: todo!() / unimplemented!() in production code ──────────────
  {
    id: 'RUST_020',
    category: 'rust_todo_in_production',
    description: 'todo!() or unimplemented!() macro in non-test code — always panics at runtime.',
    severity: 'MEDIUM',
    tags: ['correctness', 'rust', 'quality'],
    sinceVersion: '1.5.0',
    explain: {
      why: 'todo!() and unimplemented!() always panic when reached. Shipping them in production code guarantees a crash when that code path is exercised.',
      commonViolations: [
        'fn process(&self) -> Result<()> { todo!() }',
        'fn handle(&self) { unimplemented!() }',
      ],
      goodExample: 'fn process(&self) -> Result<()> { Err(Error::NotImplemented) }',
      badExample: 'fn process(&self) -> Result<()> { todo!() } // crashes at runtime',
    },
    detect({ changedFiles = [], config }: DetectInput): Finding[] {
      const sev = classifySeverity('rust_todo_in_production', config.severityRules);
      const findings: Finding[] = [];
      const TODO_RE = /\b(?:todo|unimplemented)!\s*\(/;
      for (const { path, content } of changedFiles) {
        if (!isRustFile(path)) continue;
        if (isRustTest(path)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (/^\s*\/\//.test(line)) continue;
          if (TODO_RE.test(line)) {
            findings.push({
              severity: sev, category: 'rust_todo_in_production', file: path, line: i + 1,
              message: 'todo!()/unimplemented!() in production code — always panics at runtime.',
              suggestion: 'Implement the function or return Err(Error::NotImplemented) instead.',
            });
          }
        }
      }
      return findings;
    },
  },
];
