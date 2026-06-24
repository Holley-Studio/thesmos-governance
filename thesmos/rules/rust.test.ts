import { describe, it, expect } from 'vitest';
import { RUST_RULES } from './rust';
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
  const r = RUST_RULES.find((r) => r.id === id);
  if (!r) throw new Error(`Rule ${id} not found`);
  return r;
}

function detect(id: string, files: Array<{ path: string; content: string }>) {
  const input: DetectInput = { scan: EMPTY_SCAN, config: CONFIG_DEFAULTS, changedFiles: files };
  return rule(id).detect(input);
}

// ── RUST_001 — .unwrap() in lib crate ────────────────────────────────────

describe('RUST_001 — .unwrap() in lib crate', () => {
  it('fires on .unwrap() in a lib .rs file', () => {
    const findings = detect('RUST_001', [
      {
        path: 'src/lib.rs',
        content: 'let val = result.unwrap();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_unwrap_in_lib');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire in src/main.rs', () => {
    const findings = detect('RUST_001', [
      {
        path: 'src/main.rs',
        content: 'let val = result.unwrap();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire in test files', () => {
    const findings = detect('RUST_001', [
      {
        path: 'tests/integration_test.rs',
        content: 'let val = result.unwrap();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on comment lines', () => {
    const findings = detect('RUST_001', [
      {
        path: 'src/lib.rs',
        content: '// result.unwrap() is dangerous',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on non-.rs files', () => {
    const findings = detect('RUST_001', [
      {
        path: 'src/lib.py',
        content: 'result.unwrap()',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_002 — .expect("") or .expect("TODO") ────────────────────────────

describe('RUST_002 — .expect() with placeholder message', () => {
  it('fires on .expect("TODO")', () => {
    const findings = detect('RUST_002', [
      {
        path: 'src/lib.rs',
        content: 'let val = result.expect("TODO");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_expect_without_message');
  });

  it('fires on .expect("")', () => {
    const findings = detect('RUST_002', [
      {
        path: 'src/service.rs',
        content: 'let f = File::open("config").expect("");',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fires on .expect("FIXME")', () => {
    const findings = detect('RUST_002', [
      {
        path: 'src/handler.rs',
        content: 'let x = val.expect("FIXME");',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on a descriptive expect message', () => {
    const findings = detect('RUST_002', [
      {
        path: 'src/lib.rs',
        content: 'let val = result.expect("config file must exist at startup");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_003 — panic!() in lib crate ────────────────────────────────────

describe('RUST_003 — panic!() in lib crate', () => {
  it('fires on panic!() in a lib file', () => {
    const findings = detect('RUST_003', [
      {
        path: 'src/parser.rs',
        content: 'panic!("something went wrong");',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_panic_in_lib');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire in main.rs', () => {
    const findings = detect('RUST_003', [
      {
        path: 'src/main.rs',
        content: 'panic!("fatal startup error");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire in test files', () => {
    const findings = detect('RUST_003', [
      {
        path: 'tests/parser_test.rs',
        content: 'panic!("expected to reach here");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_004 — unsafe block without SAFETY comment ───────────────────────

describe('RUST_004 — unsafe block without SAFETY comment', () => {
  it('fires on unsafe block without // SAFETY: comment', () => {
    const findings = detect('RUST_004', [
      {
        path: 'src/ffi.rs',
        content: 'unsafe { *raw_ptr = 42; }',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_unsafe_block');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('does not fire when // SAFETY: comment is on the line before', () => {
    const findings = detect('RUST_004', [
      {
        path: 'src/ffi.rs',
        content: '// SAFETY: pointer is non-null and aligned\nunsafe { *raw_ptr = 42; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when // SAFETY: is within 3 lines before', () => {
    const findings = detect('RUST_004', [
      {
        path: 'src/ffi.rs',
        content: '// SAFETY: we verified the pointer above\nlet x = 1;\nlet y = 2;\nunsafe { *raw_ptr = 42; }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_005 — unchecked as u8/i8 cast ──────────────────────────────────

describe('RUST_005 — unchecked integer as u8/i8 cast', () => {
  it('fires on `as u8` cast', () => {
    const findings = detect('RUST_005', [
      {
        path: 'src/codec.rs',
        content: 'let byte = big_number as u8;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_integer_overflow_cast');
  });

  it('fires on `as i8` cast', () => {
    const findings = detect('RUST_005', [
      {
        path: 'src/codec.rs',
        content: 'let small = value as i8;',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on `as u32` cast', () => {
    const findings = detect('RUST_005', [
      {
        path: 'src/codec.rs',
        content: 'let n = small_val as u32;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_006 — .clone() on large struct / inside loop ────────────────────

describe('RUST_006 — .clone() on large struct or inside loop', () => {
  it('fires on payload.clone()', () => {
    const findings = detect('RUST_006', [
      {
        path: 'src/handler.rs',
        content: 'let copy = payload.clone();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_clone_on_large_struct');
  });

  it('fires on .clone() inside a for loop', () => {
    const findings = detect('RUST_006', [
      {
        path: 'src/processor.rs',
        content: 'for item in items {\n    process(value.clone());\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on simple small-type .clone()', () => {
    const findings = detect('RUST_006', [
      {
        path: 'src/processor.rs',
        content: 'let name = user_name.clone();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_007 — format!() inside a loop ──────────────────────────────────

describe('RUST_007 — format!() inside a loop', () => {
  it('fires on format!() inside a for loop', () => {
    const findings = detect('RUST_007', [
      {
        path: 'src/serializer.rs',
        content: 'for item in items {\n    let s = format!("{}: {}", key, item);\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_string_format_in_loop');
  });

  it('fires on format!() inside a while loop', () => {
    const findings = detect('RUST_007', [
      {
        path: 'src/serializer.rs',
        content: 'while running {\n    let msg = format!("tick {}", count);\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on format!() outside a loop', () => {
    const findings = detect('RUST_007', [
      {
        path: 'src/serializer.rs',
        content: 'let msg = format!("hello {}", name);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_008 — MutexGuard held across .await ─────────────────────────────

describe('RUST_008 — MutexGuard held across .await', () => {
  it('fires when .lock() and .await appear within 8 lines', () => {
    const findings = detect('RUST_008', [
      {
        path: 'src/handler.rs',
        content: 'let guard = mutex.lock().unwrap();\ndo_something().await;',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_mutex_guard_across_await');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('does not fire when .await is not nearby', () => {
    const findings = detect('RUST_008', [
      {
        path: 'src/handler.rs',
        content: 'let guard = mutex.lock().unwrap();\n*guard += 1;\n// guard dropped here',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('fires on .lock() followed by .await within the window', () => {
    const findings = detect('RUST_008', [
      {
        path: 'src/async_handler.rs',
        content: [
          'let data = shared.lock().unwrap();',
          'let x = 1;',
          'let y = 2;',
          'some_async_fn().await;',
        ].join('\n'),
      },
    ]);
    expect(findings).toHaveLength(1);
  });
});

// ── RUST_009 — blocking call in async fn ────────────────────────────────

describe('RUST_009 — blocking call in async fn', () => {
  it('fires on std::fs::read in a file with async fn', () => {
    const findings = detect('RUST_009', [
      {
        path: 'src/handler.rs',
        content: 'async fn handler() {\n    let data = std::fs::read("file.txt").unwrap();\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_blocking_call_in_async');
  });

  it('fires on std::thread::sleep in a file with async fn', () => {
    const findings = detect('RUST_009', [
      {
        path: 'src/service.rs',
        content: 'async fn wait() {\n    std::thread::sleep(Duration::from_secs(1));\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when file has no async fn', () => {
    const findings = detect('RUST_009', [
      {
        path: 'src/sync.rs',
        content: 'fn handler() {\n    let data = std::fs::read("file.txt").unwrap();\n}',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_010 — SQL injection via format!() ───────────────────────────────

describe('RUST_010 — SQL injection via format!()', () => {
  it('fires on format! with SELECT and {} placeholder', () => {
    const findings = detect('RUST_010', [
      {
        path: 'src/repo.rs',
        content: 'let q = format!("SELECT * FROM users WHERE id = {}", user_id);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_sql_injection');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on format! with INSERT and {} placeholder', () => {
    const findings = detect('RUST_010', [
      {
        path: 'src/repo.rs',
        content: 'let q = format!("INSERT INTO logs (msg) VALUES (\'{}\')", msg);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on parameterized sqlx query', () => {
    const findings = detect('RUST_010', [
      {
        path: 'src/repo.rs',
        content: 'sqlx::query!("SELECT * FROM users WHERE id = $1", user_id)',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_011 — hardcoded secret ──────────────────────────────────────────

describe('RUST_011 — hardcoded secret', () => {
  it('fires on let api_key = "sk_live_..."', () => {
    const findings = detect('RUST_011', [
      {
        path: 'src/client.rs',
        content: 'let api_key = "sk_live_abc123xyz456";',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_hardcoded_secret');
  });

  it('fires on const PASSWORD: &str = "..."', () => {
    const findings = detect('RUST_011', [
      {
        path: 'src/auth.rs',
        content: 'const PASSWORD: &str = "hunter2secret";',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on env::var() usage', () => {
    const findings = detect('RUST_011', [
      {
        path: 'src/client.rs',
        content: 'let api_key = std::env::var("API_KEY").expect("API_KEY must be set");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_012 — discarded Result from std::fs ────────────────────────────

describe('RUST_012 — discarded Result from std::fs', () => {
  it('fires on standalone std::fs::write() statement', () => {
    const findings = detect('RUST_012', [
      {
        path: 'src/writer.rs',
        content: 'std::fs::write("output.txt", data);',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_missing_must_use');
  });

  it('fires on standalone std::fs::remove_file() statement', () => {
    const findings = detect('RUST_012', [
      {
        path: 'src/cleanup.rs',
        content: 'std::fs::remove_file(path);',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when result is used with ?', () => {
    const findings = detect('RUST_012', [
      {
        path: 'src/writer.rs',
        content: 'std::fs::write("output.txt", &data)?;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when result is assigned to a variable', () => {
    const findings = detect('RUST_012', [
      {
        path: 'src/writer.rs',
        content: 'let result = std::fs::write("output.txt", &data);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_013 — deprecated try!() macro ──────────────────────────────────

describe('RUST_013 — deprecated try!() macro', () => {
  it('fires on try!(expr)', () => {
    const findings = detect('RUST_013', [
      {
        path: 'src/old_code.rs',
        content: 'try!(file.read_to_string(&mut s))',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_use_of_deprecated_try_macro');
    expect(findings[0]!.severity).toBe('LOW');
  });

  it('does not fire on the ? operator', () => {
    const findings = detect('RUST_013', [
      {
        path: 'src/modern.rs',
        content: 'file.read_to_string(&mut s)?;',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when try is in a comment', () => {
    const findings = detect('RUST_013', [
      {
        path: 'src/old_code.rs',
        content: '// use try!() or ? operator',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_014 — std::mem::transmute ──────────────────────────────────────

describe('RUST_014 — std::mem::transmute', () => {
  it('fires on std::mem::transmute::<...>(...)', () => {
    const findings = detect('RUST_014', [
      {
        path: 'src/unsafe_ops.rs',
        content: 'let f: f64 = unsafe { std::mem::transmute::<u64, f64>(bits) };',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_transmute_usage');
    expect(findings[0]!.severity).toBe('BLOCKER');
  });

  it('fires on mem::transmute(...)', () => {
    const findings = detect('RUST_014', [
      {
        path: 'src/ffi.rs',
        content: 'let ptr: *const u8 = unsafe { mem::transmute(reference) };',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on f64::from_bits()', () => {
    const findings = detect('RUST_014', [
      {
        path: 'src/codec.rs',
        content: 'let f = f64::from_bits(bits);',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_015 — raw pointer dereference without SAFETY comment ────────────

describe('RUST_015 — raw pointer dereference without SAFETY comment', () => {
  it('fires on *raw_ptr without SAFETY comment', () => {
    const findings = detect('RUST_015', [
      {
        path: 'src/ffi.rs',
        content: 'unsafe { *raw_ptr = 42; }',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_raw_pointer_deref');
  });

  it('fires on *mut_ptr without SAFETY comment', () => {
    const findings = detect('RUST_015', [
      {
        path: 'src/ffi.rs',
        content: 'let val = unsafe { *mut_ptr };',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when SAFETY comment is present', () => {
    const findings = detect('RUST_015', [
      {
        path: 'src/ffi.rs',
        content: '// SAFETY: raw_ptr is non-null and aligned\nlet val = unsafe { *raw_ptr };',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_016 — .unwrap() on Option-returning method ─────────────────────

describe('RUST_016 — .unwrap() on Option-returning method', () => {
  it('fires on users.get(0).unwrap()', () => {
    const findings = detect('RUST_016', [
      {
        path: 'src/service.rs',
        content: 'let user = users.get(0).unwrap();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_panic_on_none');
  });

  it('fires on items.first().unwrap()', () => {
    const findings = detect('RUST_016', [
      {
        path: 'src/service.rs',
        content: 'let first = items.first().unwrap();',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire in test files', () => {
    const findings = detect('RUST_016', [
      {
        path: 'tests/service_test.rs',
        content: 'let user = users.get(0).unwrap();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire when using pattern matching instead', () => {
    const findings = detect('RUST_016', [
      {
        path: 'src/service.rs',
        content: 'if let Some(user) = users.get(0) { process(user); }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_017 — .collect::<Vec<_>>() inside a loop ───────────────────────

describe('RUST_017 — .collect::<Vec<_>>() inside a loop', () => {
  it('fires on .collect::<Vec<_>>() inside a for loop', () => {
    const findings = detect('RUST_017', [
      {
        path: 'src/processor.rs',
        content: 'for batch in batches {\n    let items: Vec<_> = batch.iter().collect::<Vec<_>>();\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_vec_collect_in_loop');
  });

  it('fires on .collect::<Vec<_>>() inside a while loop', () => {
    const findings = detect('RUST_017', [
      {
        path: 'src/processor.rs',
        content: 'while has_next() {\n    let chunk: Vec<_> = reader.lines().collect::<Vec<_>>();\n}',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on .collect() outside a loop', () => {
    const findings = detect('RUST_017', [
      {
        path: 'src/processor.rs',
        content: 'let all: Vec<_> = items.iter().collect::<Vec<_>>();',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_018 — thread::spawn without capturing handle ───────────────────

describe('RUST_018 — thread::spawn without capturing handle', () => {
  it('fires when thread::spawn is not assigned to a variable', () => {
    const findings = detect('RUST_018', [
      {
        path: 'src/worker.rs',
        content: '    thread::spawn(|| { do_work(); });',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_spawn_without_join');
  });

  it('fires on std::thread::spawn without let', () => {
    const findings = detect('RUST_018', [
      {
        path: 'src/worker.rs',
        content: '    std::thread::spawn(move || process(data));',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire when handle is captured', () => {
    const findings = detect('RUST_018', [
      {
        path: 'src/worker.rs',
        content: 'let handle = thread::spawn(|| { do_work() });\nhandle.join().expect("worker panicked");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_019 — env::var().unwrap() ──────────────────────────────────────

describe('RUST_019 — env::var().unwrap()', () => {
  it('fires on env::var("KEY").unwrap()', () => {
    const findings = detect('RUST_019', [
      {
        path: 'src/config.rs',
        content: 'let key = env::var("API_KEY").unwrap();',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_env_var_unwrap');
    expect(findings[0]!.severity).toBe('HIGH');
  });

  it('fires on std::env::var("KEY").unwrap()', () => {
    const findings = detect('RUST_019', [
      {
        path: 'src/config.rs',
        content: 'let db = std::env::var("DATABASE_URL").unwrap();',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire on env::var().expect(msg)', () => {
    const findings = detect('RUST_019', [
      {
        path: 'src/config.rs',
        content: 'let key = env::var("API_KEY").expect("API_KEY must be set");',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on env::var().unwrap_or_else()', () => {
    const findings = detect('RUST_019', [
      {
        path: 'src/config.rs',
        content: 'let key = env::var("API_KEY").unwrap_or_else(|_| "default".to_string());',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});

// ── RUST_020 — todo!()/unimplemented!() in production ───────────────────

describe('RUST_020 — todo!()/unimplemented!() in production code', () => {
  it('fires on todo!() in production code', () => {
    const findings = detect('RUST_020', [
      {
        path: 'src/handler.rs',
        content: 'fn process(&self) -> Result<()> { todo!() }',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('rust_todo_in_production');
    expect(findings[0]!.severity).toBe('MEDIUM');
  });

  it('fires on unimplemented!() in production code', () => {
    const findings = detect('RUST_020', [
      {
        path: 'src/service.rs',
        content: 'fn handle(&self) { unimplemented!() }',
      },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not fire in test files', () => {
    const findings = detect('RUST_020', [
      {
        path: 'tests/service_test.rs',
        content: 'fn stub() { todo!() }',
      },
    ]);
    expect(findings).toHaveLength(0);
  });

  it('does not fire on comment lines', () => {
    const findings = detect('RUST_020', [
      {
        path: 'src/handler.rs',
        content: '// todo!() is a placeholder macro',
      },
    ]);
    expect(findings).toHaveLength(0);
  });
});
