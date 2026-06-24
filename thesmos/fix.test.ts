import { describe, it, expect } from 'vitest';
import {
  FIXERS,
  AUTO_FIXABLE,
  applyFixer,
  formatFixConsole,
  formatFixJson,
  runFix,
  type FixResult,
} from './fix.ts';
import type { Finding } from './types.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeF = (category: string, line?: number, file = 'src/app.ts'): Finding => ({
  severity: 'MEDIUM',
  file,
  line,
  category,
  message: `${category} finding`,
});

// ── AUTO_FIXABLE set ──────────────────────────────────────────────────────────

describe('AUTO_FIXABLE', () => {
  it('contains all expected categories', () => {
    expect(AUTO_FIXABLE.has('console_log')).toBe(true);
    expect(AUTO_FIXABLE.has('console_log_production')).toBe(true);
    expect(AUTO_FIXABLE.has('console_in_test')).toBe(true);
    expect(AUTO_FIXABLE.has('debugger_statement')).toBe(true);
    expect(AUTO_FIXABLE.has('ts_ignore_no_comment')).toBe(true);
    expect(AUTO_FIXABLE.has('ts_expect_error_no_comment')).toBe(true);
    expect(AUTO_FIXABLE.has('var_declaration')).toBe(true);
    // Ruby / Rails fixers
    expect(AUTO_FIXABLE.has('rails_yaml_load_unsafe')).toBe(true);
    expect(AUTO_FIXABLE.has('rails_mass_assignment_permit_all')).toBe(true);
    expect(AUTO_FIXABLE.has('rails_gem_source_http')).toBe(true);
    expect(AUTO_FIXABLE.has('rails_hardcoded_secret_key_base')).toBe(true);
    expect(AUTO_FIXABLE.has('rails_debug_mode_production')).toBe(true);
    expect(AUTO_FIXABLE.has('rails_regex_dos')).toBe(true);
    // Java / Spring fixers
    expect(AUTO_FIXABLE.has('java_weak_password_hash')).toBe(true);
    expect(AUTO_FIXABLE.has('java_random_not_secure')).toBe(true);
    expect(AUTO_FIXABLE.has('java_log_sensitive')).toBe(true);
    expect(AUTO_FIXABLE.has('java_hardcoded_password')).toBe(true);
    expect(AUTO_FIXABLE.has('spring_h2_console_enabled')).toBe(true);
    // C# fixers
    expect(AUTO_FIXABLE.has('csharp_weak_hash_algorithm')).toBe(true);
    expect(AUTO_FIXABLE.has('csharp_async_void')).toBe(true);
    // Rust fixers
    expect(AUTO_FIXABLE.has('rust_use_of_deprecated_try_macro')).toBe(true);
    expect(AUTO_FIXABLE.has('rust_unwrap_in_lib')).toBe(true);
    expect(AUTO_FIXABLE.has('rust_env_var_unwrap')).toBe(true);
  });

  it('matches the FIXERS keys exactly', () => {
    for (const key of AUTO_FIXABLE) {
      expect(FIXERS).toHaveProperty(key);
    }
    for (const key of Object.keys(FIXERS)) {
      expect(AUTO_FIXABLE.has(key)).toBe(true);
    }
  });
});

// ── console_log ───────────────────────────────────────────────────────────────

describe('FIXERS.console_log', () => {
  const fixer = FIXERS['console_log']!;

  it('removes a console.log line', () => {
    const content = 'const x = 1;\nconsole.log(x);\nconst y = 2;\n';
    const result = fixer(content, makeF('console_log', 2));
    expect(result).toBe('const x = 1;\nconst y = 2;\n');
  });

  it('removes console.warn, .error, .info, .debug, .trace', () => {
    for (const method of ['warn', 'error', 'info', 'debug', 'trace']) {
      const content = `console.${method}('msg');\n`;
      expect(fixer(content, makeF('console_log', 1))).toBe('');
    }
  });

  it('returns null when line has no console call', () => {
    const content = 'const x = 1;\nconst y = 2;\n';
    expect(fixer(content, makeF('console_log', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'console.log("x");\n';
    expect(fixer(content, makeF('console_log', undefined))).toBeNull();
  });

  it('returns null when line number is out of range', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('console_log', 99))).toBeNull();
  });

  it('is idempotent', () => {
    const content = 'a();\nconsole.log(1);\nb();\n';
    const first = fixer(content, makeF('console_log', 2))!;
    // After removal, line 2 is b() — applying again returns null (guard fails)
    const second = fixer(first, makeF('console_log', 2));
    expect(second).toBeNull();
  });
});

// ── console_log_production ────────────────────────────────────────────────────

describe('FIXERS.console_log_production', () => {
  it('removes console.log lines in production source files', () => {
    const fixer = FIXERS['console_log_production']!;
    const content = 'logger.info("start");\nconsole.log("debug");\nreturn result;\n';
    expect(fixer(content, makeF('console_log_production', 2))).toBe(
      'logger.info("start");\nreturn result;\n',
    );
  });
});

// ── console_in_test ───────────────────────────────────────────────────────────

describe('FIXERS.console_in_test', () => {
  it('removes console.log lines in test files', () => {
    const fixer = FIXERS['console_in_test']!;
    const content = "it('test', () => {\n  console.log(result);\n  expect(result).toBe(1);\n});\n";
    expect(fixer(content, makeF('console_in_test', 2))).toBe(
      "it('test', () => {\n  expect(result).toBe(1);\n});\n",
    );
  });
});

// ── debugger_statement ────────────────────────────────────────────────────────

describe('FIXERS.debugger_statement', () => {
  const fixer = FIXERS['debugger_statement']!;

  it('removes a bare debugger statement', () => {
    const content = 'function foo() {\n  debugger;\n  return 1;\n}\n';
    expect(fixer(content, makeF('debugger_statement', 2))).toBe(
      'function foo() {\n  return 1;\n}\n',
    );
  });

  it('removes an indented debugger statement', () => {
    const content = 'if (x) {\n    debugger\n  doSomething();\n}\n';
    expect(fixer(content, makeF('debugger_statement', 2))).toBe(
      'if (x) {\n  doSomething();\n}\n',
    );
  });

  it('returns null when line has no debugger keyword', () => {
    const content = 'const debuggerEnabled = true;\n';
    // The word "debugger" appears but not as a statement keyword — guard uses \bdebuger\b
    // Actually "debuggerEnabled" contains "debugger" as substring — let's check the regex
    // /\bdebugger\b/ would NOT match "debuggerEnabled" because of word boundary after "r"... wait
    // "debuggerEnabled" — \bdebugger\b — the \b after 'r' is not a boundary because 'E' is a word char
    // So this correctly returns null for "debuggerEnabled"
    expect(fixer(content, makeF('debugger_statement', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    expect(fixer('debugger;\n', makeF('debugger_statement', undefined))).toBeNull();
  });

  it('is idempotent', () => {
    const content = 'a();\n  debugger;\nb();\n';
    const fixed = fixer(content, makeF('debugger_statement', 2))!;
    expect(fixed).not.toContain('debugger');
  });
});

// ── ts_ignore_no_comment ──────────────────────────────────────────────────────

describe('FIXERS.ts_ignore_no_comment', () => {
  const fixer = FIXERS['ts_ignore_no_comment']!;

  it('adds a placeholder comment when none exists', () => {
    const content = '// @ts-ignore\nconst x: string = 1;\n';
    const result = fixer(content, makeF('ts_ignore_no_comment', 1));
    expect(result).toContain('@ts-ignore: TODO:');
    expect(result).toContain('suppression');
  });

  it('does not modify a line that already has a comment (colon form)', () => {
    const content = '// @ts-ignore: this is a third-party type issue\nconst x = 1;\n';
    expect(fixer(content, makeF('ts_ignore_no_comment', 1))).toBeNull();
  });

  it('does not modify a line that already has a comment (space form)', () => {
    const content = '// @ts-ignore legacy library has no types\nconst x = 1;\n';
    expect(fixer(content, makeF('ts_ignore_no_comment', 1))).toBeNull();
  });

  it('returns null when line has no @ts-ignore', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('ts_ignore_no_comment', 1))).toBeNull();
  });

  it('is idempotent', () => {
    const content = '// @ts-ignore\nconst x = 1;\n';
    const first = fixer(content, makeF('ts_ignore_no_comment', 1))!;
    const second = fixer(first, makeF('ts_ignore_no_comment', 1));
    expect(second).toBeNull(); // guard prevents re-application
  });
});

// ── ts_expect_error_no_comment ────────────────────────────────────────────────

describe('FIXERS.ts_expect_error_no_comment', () => {
  const fixer = FIXERS['ts_expect_error_no_comment']!;

  it('adds a placeholder comment when none exists', () => {
    const content = '// @ts-expect-error\nconst x: number = "str";\n';
    const result = fixer(content, makeF('ts_expect_error_no_comment', 1));
    expect(result).toContain('@ts-expect-error: TODO:');
  });

  it('does not modify a line that already has a comment', () => {
    const content = '// @ts-expect-error: intentional for test fixture\nconst x = 1;\n';
    expect(fixer(content, makeF('ts_expect_error_no_comment', 1))).toBeNull();
  });

  it('returns null when line has no @ts-expect-error', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('ts_expect_error_no_comment', 1))).toBeNull();
  });

  it('is idempotent', () => {
    const content = '// @ts-expect-error\nconst x = 1;\n';
    const first = fixer(content, makeF('ts_expect_error_no_comment', 1))!;
    const second = fixer(first, makeF('ts_expect_error_no_comment', 1));
    expect(second).toBeNull();
  });
});

// ── var_declaration ───────────────────────────────────────────────────────────

describe('FIXERS.var_declaration', () => {
  const fixer = FIXERS['var_declaration']!;

  it('replaces var with let', () => {
    const content = 'function foo() {\n  var x = 1;\n  return x;\n}\n';
    const result = fixer(content, makeF('var_declaration', 2));
    expect(result).toContain('let x = 1;');
    expect(result).not.toContain('var x');
  });

  it('only replaces the first var on the line', () => {
    const content = "  var name = 'var test';\n";
    const result = fixer(content, makeF('var_declaration', 1));
    expect(result).toContain("let name = 'var test'");
  });

  it('returns null when line has no var keyword', () => {
    const content = 'const x = 1;\n';
    expect(fixer(content, makeF('var_declaration', 1))).toBeNull();
  });

  it('returns null when line already uses let', () => {
    const content = 'let x = 1; // var already fixed\n';
    expect(fixer(content, makeF('var_declaration', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    expect(fixer('var x = 1;\n', makeF('var_declaration', undefined))).toBeNull();
  });

  it('is idempotent', () => {
    const content = 'var x = 1;\n';
    const first = fixer(content, makeF('var_declaration', 1))!;
    expect(first).toContain('let x');
    const second = fixer(first, makeF('var_declaration', 1));
    expect(second).toBeNull(); // now has "let", not "var"
  });
});

// ── applyFixer ────────────────────────────────────────────────────────────────

describe('applyFixer', () => {
  it('dispatches to the correct fixer by category', () => {
    const content = 'debugger;\nreturn 1;\n';
    const finding = makeF('debugger_statement', 1);
    expect(applyFixer(content, finding)).toBe('return 1;\n');
  });

  it('returns null for unknown categories', () => {
    const finding = makeF('missing_api_auth', 1);
    expect(applyFixer('const x = 1;\n', finding)).toBeNull();
  });

  it('is case-insensitive on category', () => {
    const content = 'debugger;\nreturn;\n';
    const finding = makeF('DEBUGGER_STATEMENT', 1);
    // Category lookup is lowercase — but we store as lowercase in FIXERS
    // applyFixer does finding.category.toLowerCase() so this should work
    expect(applyFixer(content, finding)).toBe('return;\n');
  });
});

// ── runFix (no I/O — uses tmpdir) ─────────────────────────────────────────────

import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'thesmos-fix-'));
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

describe('runFix', () => {
  it('returns dryRun: true by default and does not write files', () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, 'app.ts'), 'debugger;\nreturn 1;\n', 'utf8');
      const finding = { ...makeF('debugger_statement', 1), file: 'app.ts' };
      const result = runFix(dir, [finding]);
      expect(result.dryRun).toBe(true);
      expect(result.applied).toHaveLength(1);
      // File should be unchanged in dry-run
      expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toContain('debugger');
    } finally {
      cleanup(dir);
    }
  });

  it('writes files when apply: true', () => {
    const dir = makeTmpDir();
    try {
      writeFileSync(join(dir, 'app.ts'), 'debugger;\nreturn 1;\n', 'utf8');
      const finding = { ...makeF('debugger_statement', 1), file: 'app.ts' };
      const result = runFix(dir, [finding], { apply: true });
      expect(result.dryRun).toBe(false);
      expect(result.applied).toHaveLength(1);
      expect(readFileSync(join(dir, 'app.ts'), 'utf8')).not.toContain('debugger');
    } finally {
      cleanup(dir);
    }
  });

  it('skips findings with no fixer and lists them as unfixable', () => {
    const dir = makeTmpDir();
    try {
      const finding = makeF('missing_api_auth', 1);
      const result = runFix(dir, [finding]);
      expect(result.unfixableFindings).toHaveLength(1);
      expect(result.applied).toHaveLength(0);
    } finally {
      cleanup(dir);
    }
  });

  it('skips missing files gracefully', () => {
    const dir = makeTmpDir();
    try {
      const finding = { ...makeF('debugger_statement', 1), file: 'nonexistent.ts' };
      const result = runFix(dir, [finding]);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0]!.reason).toContain('not found');
    } finally {
      cleanup(dir);
    }
  });

  it('applies multiple fixers to the same file bottom-to-top', () => {
    const dir = makeTmpDir();
    try {
      const content = 'debugger;\nconsole.log(1);\nreturn;\n';
      writeFileSync(join(dir, 'app.ts'), content, 'utf8');
      const findings: Finding[] = [
        { ...makeF('debugger_statement', 1), file: 'app.ts' },
        { ...makeF('console_log', 2), file: 'app.ts' },
      ];
      const result = runFix(dir, findings, { apply: true });
      expect(result.applied).toHaveLength(2);
      expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toBe('return;\n');
    } finally {
      cleanup(dir);
    }
  });

  it('respects ruleFilter', () => {
    const dir = makeTmpDir();
    try {
      const content = 'debugger;\nconsole.log(1);\nreturn;\n';
      writeFileSync(join(dir, 'app.ts'), content, 'utf8');
      const findings: Finding[] = [
        { ...makeF('debugger_statement', 1), file: 'app.ts' },
        { ...makeF('console_log', 2), file: 'app.ts' },
      ];
      const result = runFix(dir, findings, { ruleFilter: 'debugger_statement' });
      // Only the debugger fixer should run
      expect(result.applied).toHaveLength(1);
      expect(result.applied[0]!.rule).toBe('debugger_statement');
    } finally {
      cleanup(dir);
    }
  });
});

// ── Ruby / Rails fixers ───────────────────────────────────────────────────────

describe('FIXERS.rails_yaml_load_unsafe', () => {
  const fixer = FIXERS['rails_yaml_load_unsafe']!;

  it('replaces YAML.load( with YAML.safe_load(', () => {
    const content = 'config = YAML.load(File.read("config.yml"))\n';
    const result = fixer(content, makeF('rails_yaml_load_unsafe', 1));
    expect(result).toBe('config = YAML.safe_load(File.read("config.yml"))\n');
  });

  it('replaces YAML.load( with user params', () => {
    const content = 'data = YAML.load(params[:config])\n';
    const result = fixer(content, makeF('rails_yaml_load_unsafe', 1));
    expect(result).toContain('YAML.safe_load(params[:config])');
    expect(result).not.toContain('YAML.load(');
  });

  it('handles indented lines', () => {
    const content = 'def parse\n  result = YAML.load(input)\n  result\nend\n';
    const result = fixer(content, makeF('rails_yaml_load_unsafe', 2));
    expect(result).toContain('  result = YAML.safe_load(input)');
  });

  it('returns null when line already uses YAML.safe_load (idempotent)', () => {
    const content = 'config = YAML.safe_load(File.read("f.yml"))\n';
    expect(fixer(content, makeF('rails_yaml_load_unsafe', 1))).toBeNull();
  });

  it('returns null when line has no YAML.load(', () => {
    const content = 'puts "hello"\n';
    expect(fixer(content, makeF('rails_yaml_load_unsafe', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'YAML.load(data)\n';
    expect(fixer(content, makeF('rails_yaml_load_unsafe', undefined))).toBeNull();
  });

  it('is idempotent — applying twice produces same result', () => {
    const content = 'data = YAML.load(input)\n';
    const first = fixer(content, makeF('rails_yaml_load_unsafe', 1))!;
    expect(first).toContain('YAML.safe_load(');
    const second = fixer(first, makeF('rails_yaml_load_unsafe', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.rails_mass_assignment_permit_all', () => {
  const fixer = FIXERS['rails_mass_assignment_permit_all']!;

  it('replaces .permit! with .permit([]) stub', () => {
    const content = '  def user_params; params.require(:user).permit!; end\n';
    const result = fixer(content, makeF('rails_mass_assignment_permit_all', 1));
    expect(result).toContain('.permit([])');
    expect(result).toContain('# TODO: list permitted params');
    expect(result).not.toContain('.permit!');
  });

  it('replaces bare params.permit!', () => {
    const content = 'User.create(params.permit!)\n';
    const result = fixer(content, makeF('rails_mass_assignment_permit_all', 1));
    expect(result).toContain('params.permit([])');
    expect(result).not.toContain('permit!');
  });

  it('returns null when line has no params.permit!', () => {
    const content = 'params.permit(:name, :email)\n';
    expect(fixer(content, makeF('rails_mass_assignment_permit_all', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'params.permit!\n';
    expect(fixer(content, makeF('rails_mass_assignment_permit_all', undefined))).toBeNull();
  });

  it('is idempotent — applying twice returns null (already stubbed)', () => {
    const content = 'params.permit!\n';
    const first = fixer(content, makeF('rails_mass_assignment_permit_all', 1))!;
    expect(first).toContain('permit([])');
    const second = fixer(first, makeF('rails_mass_assignment_permit_all', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.rails_gem_source_http', () => {
  const fixer = FIXERS['rails_gem_source_http']!;

  it("upgrades source 'http://rubygems.org' to https", () => {
    const content = "source 'http://rubygems.org'\n";
    const result = fixer(content, makeF('rails_gem_source_http', 1));
    expect(result).toBe("source 'https://rubygems.org'\n");
  });

  it('handles double-quoted source lines', () => {
    const content = 'source "http://gems.example.com"\n';
    const result = fixer(content, makeF('rails_gem_source_http', 1));
    expect(result).toContain('https://');
    expect(result).not.toContain('http://');
  });

  it('handles indented source lines', () => {
    const content = "  source 'http://rubygems.org'\n";
    const result = fixer(content, makeF('rails_gem_source_http', 1));
    expect(result).toContain('https://');
  });

  it('returns null when source already uses https (idempotent)', () => {
    const content = "source 'https://rubygems.org'\n";
    expect(fixer(content, makeF('rails_gem_source_http', 1))).toBeNull();
  });

  it('returns null when line has no source directive', () => {
    const content = "gem 'rails', '~> 7.0'\n";
    expect(fixer(content, makeF('rails_gem_source_http', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = "source 'http://rubygems.org'\n";
    expect(fixer(content, makeF('rails_gem_source_http', undefined))).toBeNull();
  });

  it('is idempotent — applying twice produces null on second pass', () => {
    const content = "source 'http://rubygems.org'\n";
    const first = fixer(content, makeF('rails_gem_source_http', 1))!;
    expect(first).toContain('https://');
    const second = fixer(first, makeF('rails_gem_source_http', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.rails_hardcoded_secret_key_base', () => {
  const fixer = FIXERS['rails_hardcoded_secret_key_base']!;

  it('replaces hardcoded secret_key_base with ERB env lookup', () => {
    const content = "  secret_key_base: 'abc123verylong'\n";
    const result = fixer(content, makeF('rails_hardcoded_secret_key_base', 1));
    expect(result).toContain('ENV["SECRET_KEY_BASE"]');
    expect(result).not.toContain('abc123');
  });

  it('preserves indentation', () => {
    const content = '    secret_key_base: "some-long-secret-value"\n';
    const result = fixer(content, makeF('rails_hardcoded_secret_key_base', 1));
    expect(result).toMatch(/^    secret_key_base/m);
  });

  it('returns null when already using ENV', () => {
    const content = 'secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>\n';
    expect(fixer(content, makeF('rails_hardcoded_secret_key_base', 1))).toBeNull();
  });

  it('returns null when line has no secret_key_base', () => {
    const content = "secret_key: 'something'\n";
    expect(fixer(content, makeF('rails_hardcoded_secret_key_base', 1))).toBeNull();
  });

  it('returns null for short values (< 8 chars) that look like placeholders', () => {
    // The guard regex requires 8+ characters in the value
    const content = "secret_key_base: 'short'\n";
    expect(fixer(content, makeF('rails_hardcoded_secret_key_base', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = "secret_key_base: 'abc123verylong'\n";
    expect(fixer(content, makeF('rails_hardcoded_secret_key_base', undefined))).toBeNull();
  });

  it('is idempotent', () => {
    const content = "secret_key_base: 'abc123verylong'\n";
    const first = fixer(content, makeF('rails_hardcoded_secret_key_base', 1))!;
    expect(first).toContain('ENV["SECRET_KEY_BASE"]');
    const second = fixer(first, makeF('rails_hardcoded_secret_key_base', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.rails_debug_mode_production', () => {
  const fixer = FIXERS['rails_debug_mode_production']!;

  it('replaces config.log_level = :debug with :info', () => {
    const content = '  config.log_level = :debug\n';
    const result = fixer(content, makeF('rails_debug_mode_production', 1));
    expect(result).toBe('  config.log_level = :info\n');
  });

  it('replaces consider_all_requests_local = true with false', () => {
    const content = '  config.consider_all_requests_local = true\n';
    const result = fixer(content, makeF('rails_debug_mode_production', 1));
    expect(result).toBe('  config.consider_all_requests_local = false\n');
  });

  it('returns null when neither debug pattern is present', () => {
    const content = '  config.log_level = :info\n';
    expect(fixer(content, makeF('rails_debug_mode_production', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'config.log_level = :debug\n';
    expect(fixer(content, makeF('rails_debug_mode_production', undefined))).toBeNull();
  });

  it('is idempotent — log_level already :info returns null', () => {
    const content = 'config.log_level = :debug\n';
    const first = fixer(content, makeF('rails_debug_mode_production', 1))!;
    expect(first).toContain(':info');
    const second = fixer(first, makeF('rails_debug_mode_production', 1));
    expect(second).toBeNull();
  });

  it('is idempotent — consider_all_requests_local already false returns null', () => {
    const content = 'config.consider_all_requests_local = true\n';
    const first = fixer(content, makeF('rails_debug_mode_production', 1))!;
    expect(first).toContain('= false');
    const second = fixer(first, makeF('rails_debug_mode_production', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.rails_regex_dos', () => {
  const fixer = FIXERS['rails_regex_dos']!;

  it('replaces ^ and $ anchors in format validation regex', () => {
    const content = "  validates :slug, format: { with: /^[a-z-]+$/ }\n";
    const result = fixer(content, makeF('rails_regex_dos', 1));
    expect(result).toContain('/\\A[a-z-]+\\z/');
    expect(result).not.toContain('/^');
    expect(result).not.toContain('$/');
  });

  it('replaces only the leading ^ anchor when no trailing $', () => {
    const content = "  validates :username, format: { with: /^[a-z0-9]+/ }\n";
    const result = fixer(content, makeF('rails_regex_dos', 1));
    expect(result).toContain('/\\A[a-z0-9]+/');
    expect(result).not.toContain('/^');
  });

  it('returns null when line has no validates format call', () => {
    const content = "  validates :name, presence: true\n";
    expect(fixer(content, makeF('rails_regex_dos', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = "  validates :slug, format: { with: /^[a-z]+$/ }\n";
    expect(fixer(content, makeF('rails_regex_dos', undefined))).toBeNull();
  });

  it('is idempotent — \\A and \\z anchors return null', () => {
    const content = "  validates :slug, format: { with: /^[a-z-]+$/ }\n";
    const first = fixer(content, makeF('rails_regex_dos', 1))!;
    expect(first).toContain('\\A');
    const second = fixer(first, makeF('rails_regex_dos', 1));
    // After fix, line no longer contains /^ or $/ pattern — guard fails
    expect(second).toBeNull();
  });
});

// ── Java / Spring fixers ──────────────────────────────────────────────────────

describe('FIXERS.java_weak_password_hash', () => {
  const fixer = FIXERS['java_weak_password_hash']!;

  it('upgrades MD5 to SHA-256', () => {
    const content = '    MessageDigest md = MessageDigest.getInstance("MD5");\n';
    const result = fixer(content, makeF('java_weak_password_hash', 1));
    expect(result).toBe('    MessageDigest md = MessageDigest.getInstance("SHA-256");\n');
    expect(result).not.toContain('"MD5"');
  });

  it('upgrades SHA-1 to SHA-256', () => {
    const content = '    MessageDigest sha = MessageDigest.getInstance("SHA-1");\n';
    const result = fixer(content, makeF('java_weak_password_hash', 1));
    expect(result).toBe('    MessageDigest sha = MessageDigest.getInstance("SHA-256");\n');
    expect(result).not.toContain('"SHA-1"');
  });

  it('upgrades SHA1 (no hyphen) to SHA-256', () => {
    const content = 'MessageDigest.getInstance("SHA1");\n';
    const result = fixer(content, makeF('java_weak_password_hash', 1));
    expect(result).toContain('"SHA-256"');
    expect(result).not.toContain('"SHA1"');
  });

  it('returns null when line has no weak hash algorithm', () => {
    const content = 'MessageDigest.getInstance("SHA-256");\n';
    expect(fixer(content, makeF('java_weak_password_hash', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'MessageDigest.getInstance("MD5");\n';
    expect(fixer(content, makeF('java_weak_password_hash', undefined))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'MessageDigest.getInstance("MD5");\n';
    const first = fixer(content, makeF('java_weak_password_hash', 1))!;
    expect(first).toContain('"SHA-256"');
    const second = fixer(first, makeF('java_weak_password_hash', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.java_random_not_secure', () => {
  const fixer = FIXERS['java_random_not_secure']!;

  it('replaces new Random() with new SecureRandom()', () => {
    const content = '    Random rand = new Random();\n';
    const result = fixer(content, makeF('java_random_not_secure', 1));
    expect(result).toBe('    Random rand = new SecureRandom();\n');
    expect(result).not.toContain('new Random(');
  });

  it('replaces new Random() inside an expression', () => {
    const content = '    String token = String.valueOf(new Random().nextLong());\n';
    const result = fixer(content, makeF('java_random_not_secure', 1));
    expect(result).toContain('new SecureRandom()');
    expect(result).not.toContain('new Random()');
  });

  it('returns null when line already uses SecureRandom (idempotent)', () => {
    const content = '    SecureRandom sr = new SecureRandom();\n';
    expect(fixer(content, makeF('java_random_not_secure', 1))).toBeNull();
  });

  it('returns null when line has no new Random()', () => {
    const content = '    int x = random.nextInt();\n';
    expect(fixer(content, makeF('java_random_not_secure', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'new Random();\n';
    expect(fixer(content, makeF('java_random_not_secure', undefined))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'Random r = new Random();\n';
    const first = fixer(content, makeF('java_random_not_secure', 1))!;
    expect(first).toContain('new SecureRandom()');
    const second = fixer(first, makeF('java_random_not_secure', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.java_log_sensitive', () => {
  const fixer = FIXERS['java_log_sensitive']!;

  it('removes a logger line that logs a password', () => {
    const content = 'doSetup();\nlogger.info("password=" + password);\nreturn result;\n';
    const result = fixer(content, makeF('java_log_sensitive', 2));
    expect(result).toBe('doSetup();\nreturn result;\n');
    expect(result).not.toContain('logger.info');
  });

  it('removes a log line that logs a token', () => {
    const content = 'log.debug("API call with token=" + apiToken);\n';
    const result = fixer(content, makeF('java_log_sensitive', 1));
    expect(result).toBe('');
  });

  it('removes a LOG line with secret', () => {
    const content = 'LOG.error("Auth failed, secret=" + secret);\n';
    const result = fixer(content, makeF('java_log_sensitive', 1));
    expect(result).toBe('');
  });

  it('returns null when line has no sensitive log call', () => {
    const content = 'logger.info("User {} authenticated", userId);\n';
    expect(fixer(content, makeF('java_log_sensitive', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'logger.debug("token=" + token);\n';
    expect(fixer(content, makeF('java_log_sensitive', undefined))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'a();\nlogger.info("secret=" + secret);\nb();\n';
    const first = fixer(content, makeF('java_log_sensitive', 2))!;
    expect(first).not.toContain('logger.info');
    // After removal, line 2 is b() — guard fails
    const second = fixer(first, makeF('java_log_sensitive', 2));
    expect(second).toBeNull();
  });
});

describe('FIXERS.java_hardcoded_password', () => {
  const fixer = FIXERS['java_hardcoded_password']!;

  it('annotates a hardcoded password with FIXME comment', () => {
    const content = '    String password = "supersecret123";\n';
    const result = fixer(content, makeF('java_hardcoded_password', 1));
    expect(result).toContain('// FIXME: hardcoded credential');
    expect(result).toContain('System.getenv()');
    expect(result).toContain('"supersecret123"');
  });

  it('annotates a hardcoded apiKey with FIXME comment', () => {
    const content = 'final String apiKey = "sk-abcdef1234";\n';
    const result = fixer(content, makeF('java_hardcoded_password', 1));
    expect(result).toContain('FIXME');
    expect(result).toContain('"sk-abcdef1234"');
  });

  it('returns null when line has no hardcoded credential pattern', () => {
    const content = 'String password = System.getenv("DB_PASSWORD");\n';
    expect(fixer(content, makeF('java_hardcoded_password', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'String secret = "abc12345";\n';
    expect(fixer(content, makeF('java_hardcoded_password', undefined))).toBeNull();
  });

  it('is idempotent — applying twice returns null (FIXME already present)', () => {
    const content = '    String password = "supersecret123";\n';
    const first = fixer(content, makeF('java_hardcoded_password', 1))!;
    expect(first).toContain('FIXME');
    const second = fixer(first, makeF('java_hardcoded_password', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.spring_h2_console_enabled', () => {
  const fixer = FIXERS['spring_h2_console_enabled']!;

  it('flips spring.h2.console.enabled=true to false', () => {
    const content = 'spring.h2.console.enabled=true\n';
    const result = fixer(content, makeF('spring_h2_console_enabled', 1));
    expect(result).toBe('spring.h2.console.enabled=false\n');
  });

  it('handles whitespace around the = sign', () => {
    const content = 'spring.h2.console.enabled = true\n';
    const result = fixer(content, makeF('spring_h2_console_enabled', 1));
    expect(result).toContain('false');
    expect(result).not.toContain('true');
  });

  it('handles the line in a multi-line properties file', () => {
    const content = 'server.port=8080\nspring.h2.console.enabled=true\nspring.datasource.url=jdbc:h2:mem:testdb\n';
    const result = fixer(content, makeF('spring_h2_console_enabled', 2));
    expect(result).toContain('spring.h2.console.enabled=false');
    expect(result).not.toContain('spring.h2.console.enabled=true');
  });

  it('returns null when already set to false (idempotent)', () => {
    const content = 'spring.h2.console.enabled=false\n';
    expect(fixer(content, makeF('spring_h2_console_enabled', 1))).toBeNull();
  });

  it('returns null when line has no h2.console.enabled setting', () => {
    const content = 'server.port=8080\n';
    expect(fixer(content, makeF('spring_h2_console_enabled', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'spring.h2.console.enabled=true\n';
    expect(fixer(content, makeF('spring_h2_console_enabled', undefined))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'spring.h2.console.enabled=true\n';
    const first = fixer(content, makeF('spring_h2_console_enabled', 1))!;
    expect(first).toContain('=false');
    const second = fixer(first, makeF('spring_h2_console_enabled', 1));
    expect(second).toBeNull();
  });
});

// ── C# fixers ─────────────────────────────────────────────────────────────────

describe('FIXERS.csharp_weak_hash_algorithm', () => {
  const fixer = FIXERS['csharp_weak_hash_algorithm']!;

  it('replaces MD5.Create() with SHA256.Create()', () => {
    const content = '    var hash = MD5.Create();\n';
    const result = fixer(content, makeF('csharp_weak_hash_algorithm', 1));
    expect(result).toBe('    var hash = SHA256.Create();\n');
    expect(result).not.toContain('MD5');
  });

  it('replaces SHA1.Create() with SHA256.Create()', () => {
    const content = '    using var sha = SHA1.Create();\n';
    const result = fixer(content, makeF('csharp_weak_hash_algorithm', 1));
    expect(result).toBe('    using var sha = SHA256.Create();\n');
    expect(result).not.toContain('SHA1');
  });

  it('returns null when already using SHA256.Create() (idempotent)', () => {
    const content = 'var hash = SHA256.Create();\n';
    expect(fixer(content, makeF('csharp_weak_hash_algorithm', 1))).toBeNull();
  });

  it('returns null when line has no weak hash algorithm', () => {
    const content = 'var hash = SHA512.Create();\n';
    expect(fixer(content, makeF('csharp_weak_hash_algorithm', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'var hash = MD5.Create();\n';
    expect(fixer(content, makeF('csharp_weak_hash_algorithm', undefined))).toBeNull();
  });

  it('returns null when line number is out of range', () => {
    const content = 'var hash = MD5.Create();\n';
    expect(fixer(content, makeF('csharp_weak_hash_algorithm', 99))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'var hash = MD5.Create();\n';
    const first = fixer(content, makeF('csharp_weak_hash_algorithm', 1))!;
    expect(first).toContain('SHA256.Create()');
    const second = fixer(first, makeF('csharp_weak_hash_algorithm', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.csharp_async_void', () => {
  const fixer = FIXERS['csharp_async_void']!;

  it('replaces async void with async Task', () => {
    const content = '    public async void LoadData() { }\n';
    const result = fixer(content, makeF('csharp_async_void', 1));
    expect(result).toBe('    public async Task LoadData() { }\n');
    expect(result).not.toContain('async void');
  });

  it('handles various access modifiers', () => {
    const content = 'private async void ProcessQueue() { }\n';
    const result = fixer(content, makeF('csharp_async_void', 1));
    expect(result).toContain('async Task');
    expect(result).not.toContain('async void');
  });

  it('returns null when already async Task (idempotent)', () => {
    const content = 'public async Task LoadData() { }\n';
    expect(fixer(content, makeF('csharp_async_void', 1))).toBeNull();
  });

  it('returns null when line has no async void', () => {
    const content = 'public void LoadData() { }\n';
    expect(fixer(content, makeF('csharp_async_void', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'public async void Foo() { }\n';
    expect(fixer(content, makeF('csharp_async_void', undefined))).toBeNull();
  });

  it('returns null when line number is out of range', () => {
    const content = 'public async void Foo() { }\n';
    expect(fixer(content, makeF('csharp_async_void', 99))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'public async void Foo() { }\n';
    const first = fixer(content, makeF('csharp_async_void', 1))!;
    expect(first).toContain('async Task');
    const second = fixer(first, makeF('csharp_async_void', 1));
    expect(second).toBeNull();
  });
});

// ── Rust fixers ───────────────────────────────────────────────────────────────

describe('FIXERS.rust_use_of_deprecated_try_macro', () => {
  const fixer = FIXERS['rust_use_of_deprecated_try_macro']!;

  it('replaces try!(expr) with expr?', () => {
    const content = '    try!(file.read_to_string(&mut s));\n';
    const result = fixer(content, makeF('rust_use_of_deprecated_try_macro', 1));
    expect(result).toContain('file.read_to_string(&mut s)?');
    expect(result).not.toContain('try!');
  });

  it('replaces try!(simple_expr) with simple_expr?', () => {
    const content = 'let n = try!(str::parse::<i32>(s));\n';
    const result = fixer(content, makeF('rust_use_of_deprecated_try_macro', 1));
    expect(result).toContain('str::parse::<i32>(s)?');
    expect(result).not.toContain('try!');
  });

  it('returns null when line has no try! macro', () => {
    const content = 'let n = str::parse::<i32>(s)?;\n';
    expect(fixer(content, makeF('rust_use_of_deprecated_try_macro', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'try!(something());\n';
    expect(fixer(content, makeF('rust_use_of_deprecated_try_macro', undefined))).toBeNull();
  });

  it('returns null when line number is out of range', () => {
    const content = 'try!(something());\n';
    expect(fixer(content, makeF('rust_use_of_deprecated_try_macro', 99))).toBeNull();
  });

  it('is idempotent — applying to already-fixed line returns null', () => {
    const content = 'try!(file.read_to_string(&mut s));\n';
    const first = fixer(content, makeF('rust_use_of_deprecated_try_macro', 1))!;
    expect(first).toContain('?');
    expect(first).not.toContain('try!');
    const second = fixer(first, makeF('rust_use_of_deprecated_try_macro', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.rust_unwrap_in_lib', () => {
  const fixer = FIXERS['rust_unwrap_in_lib']!;

  it('replaces .unwrap() with .expect("TODO: handle error")', () => {
    const content = '    let val = result.unwrap();\n';
    const result = fixer(content, makeF('rust_unwrap_in_lib', 1));
    expect(result).toBe('    let val = result.expect("TODO: handle error");\n');
    expect(result).not.toContain('.unwrap()');
  });

  it('replaces .unwrap() in a chained expression', () => {
    const content = 'let s = std::fs::read_to_string("f").unwrap();\n';
    const result = fixer(content, makeF('rust_unwrap_in_lib', 1));
    expect(result).toContain('.expect("TODO: handle error")');
    expect(result).not.toContain('.unwrap()');
  });

  it('returns null when .expect( is already present (idempotent)', () => {
    const content = 'let val = result.expect("already handled");\n';
    expect(fixer(content, makeF('rust_unwrap_in_lib', 1))).toBeNull();
  });

  it('returns null when line has no .unwrap()', () => {
    const content = 'let val = result?;\n';
    expect(fixer(content, makeF('rust_unwrap_in_lib', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'result.unwrap();\n';
    expect(fixer(content, makeF('rust_unwrap_in_lib', undefined))).toBeNull();
  });

  it('returns null when line number is out of range', () => {
    const content = 'result.unwrap();\n';
    expect(fixer(content, makeF('rust_unwrap_in_lib', 99))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'let val = result.unwrap();\n';
    const first = fixer(content, makeF('rust_unwrap_in_lib', 1))!;
    expect(first).toContain('.expect(');
    const second = fixer(first, makeF('rust_unwrap_in_lib', 1));
    expect(second).toBeNull();
  });
});

describe('FIXERS.rust_env_var_unwrap', () => {
  const fixer = FIXERS['rust_env_var_unwrap']!;

  it('replaces env::var("KEY").unwrap() with .expect("KEY env var must be set")', () => {
    const content = '    let key = env::var("API_KEY").unwrap();\n';
    const result = fixer(content, makeF('rust_env_var_unwrap', 1));
    expect(result).toContain('.expect("API_KEY env var must be set")');
    expect(result).not.toContain('.unwrap()');
  });

  it('handles std::env::var prefix', () => {
    const content = 'let db = std::env::var("DATABASE_URL").unwrap();\n';
    const result = fixer(content, makeF('rust_env_var_unwrap', 1));
    expect(result).toContain('.expect(');
    expect(result).not.toContain('.unwrap()');
  });

  it('returns null when .expect( already present (idempotent)', () => {
    const content = 'let key = env::var("API_KEY").expect("API_KEY must be set");\n';
    expect(fixer(content, makeF('rust_env_var_unwrap', 1))).toBeNull();
  });

  it('returns null when line has no env::var().unwrap() pattern', () => {
    const content = 'let val = result.unwrap();\n';
    expect(fixer(content, makeF('rust_env_var_unwrap', 1))).toBeNull();
  });

  it('returns null when line number is missing', () => {
    const content = 'env::var("KEY").unwrap();\n';
    expect(fixer(content, makeF('rust_env_var_unwrap', undefined))).toBeNull();
  });

  it('returns null when line number is out of range', () => {
    const content = 'env::var("KEY").unwrap();\n';
    expect(fixer(content, makeF('rust_env_var_unwrap', 99))).toBeNull();
  });

  it('is idempotent — applying twice returns null on second pass', () => {
    const content = 'let key = env::var("API_KEY").unwrap();\n';
    const first = fixer(content, makeF('rust_env_var_unwrap', 1))!;
    expect(first).toContain('.expect(');
    expect(first).not.toContain('.unwrap()');
    const second = fixer(first, makeF('rust_env_var_unwrap', 1));
    expect(second).toBeNull();
  });
});

// ── formatFixConsole ──────────────────────────────────────────────────────────

describe('formatFixConsole', () => {
  const baseResult: FixResult = {
    dryRun: true,
    applied: [],
    skipped: [],
    unfixableFindings: [],
  };

  it('shows "no fixable violations" when nothing to fix', () => {
    const out = formatFixConsole(baseResult);
    expect(out).toContain('No auto-fixable');
  });

  it('lists applied fixes with file and line', () => {
    const result: FixResult = {
      ...baseResult,
      applied: [{ file: 'src/app.ts', line: 42, rule: 'console_log', action: 'removed console statement' }],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('src/app.ts:42');
    expect(out).toContain('console_log');
  });

  it('shows dry-run hint when there are applied fixes and dryRun is true', () => {
    const result: FixResult = {
      ...baseResult,
      applied: [{ file: 'f.ts', line: 1, rule: 'debugger_statement', action: 'removed debugger statement' }],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('--apply');
  });

  it('does not show dry-run hint when apply is true', () => {
    const result: FixResult = {
      ...baseResult,
      dryRun: false,
      applied: [{ file: 'f.ts', line: 1, rule: 'debugger_statement', action: 'removed debugger statement' }],
    };
    const out = formatFixConsole(result);
    expect(out).not.toContain('--apply');
  });

  it('lists skipped fixes with reason', () => {
    const result: FixResult = {
      ...baseResult,
      skipped: [{ file: 'f.ts', line: 5, rule: 'console_log', reason: 'fixer could not apply safely' }],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('fixer could not apply safely');
  });

  it('shows unfixable count', () => {
    const result: FixResult = {
      ...baseResult,
      unfixableFindings: [makeF('missing_api_auth', 1)],
    };
    const out = formatFixConsole(result);
    expect(out).toContain('manual remediation');
  });
});

// ── formatFixJson ─────────────────────────────────────────────────────────────

describe('formatFixJson', () => {
  it('produces valid JSON with correct shape', () => {
    const result: FixResult = {
      dryRun: true,
      applied: [{ file: 'a.ts', line: 1, rule: 'console_log', action: 'removed console statement' }],
      skipped: [],
      unfixableFindings: [makeF('missing_api_auth')],
    };
    const json = JSON.parse(formatFixJson(result));
    expect(json).toMatchObject({
      dryRun: true,
      applied: 1,
      skipped: 0,
      unfixable: 1,
      fixes: expect.arrayContaining([expect.objectContaining({ rule: 'console_log' })]),
    });
  });
});
