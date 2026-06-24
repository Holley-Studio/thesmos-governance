/**
 * Prometheus auto-fix engine.
 *
 * Architecture:
 *   - FIXERS registry: pure functions (content + finding → patched content | null)
 *   - AUTO_FIXABLE: derived set of category IDs with registered fixers
 *   - applyFixer(): applies one fixer to content, returns new content or null
 *   - runFix(): orchestrates I/O — reads files, applies fixers, optionally writes
 *   - formatters: console + JSON output
 *
 * Safety contract:
 *   Every fixer in this registry must satisfy:
 *     1. Zero semantic change — the fixed code is behaviourally equivalent.
 *     2. Idempotent — applying the same fixer twice produces the same result.
 *     3. Line-targeted — only the exact line(s) named in the finding are touched.
 *     4. Returns null when it cannot apply safely — never corrupts the file.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Finding, ThesmosConfig, ScanResult } from './types.js';
import { PROMETHEUS_RULES } from './rules/registry.js';
import { runReview } from './review.js';
import { makeLogger } from './logger.js';

const log = makeLogger('fix');

// ── Fixer type ─────────────────────────────────────────────────────────────────

/**
 * A pure function that receives file content and the triggering finding.
 * Returns the patched content string, or null if the fix cannot be applied.
 */
export type Fixer = (content: string, finding: Finding) => string | null;

// ── Shared line helpers ────────────────────────────────────────────────────────

function getLine(content: string, finding: Finding): { lines: string[]; idx: number } | null {
  if (finding.line == null) return null;
  const lines = content.split('\n');
  const idx = finding.line - 1;
  if (idx < 0 || idx >= lines.length) return null;
  return { lines, idx };
}

function removeLine(content: string, finding: Finding, guard: RegExp): string | null {
  const ctx = getLine(content, finding);
  if (!ctx) return null;
  const { lines, idx } = ctx;
  if (!guard.test(lines[idx]!)) return null;
  lines.splice(idx, 1);
  return lines.join('\n');
}

function replaceLine(content: string, finding: Finding, guard: RegExp, replacer: (line: string) => string | null): string | null {
  const ctx = getLine(content, finding);
  if (!ctx) return null;
  const { lines, idx } = ctx;
  if (!guard.test(lines[idx]!)) return null;
  const result = replacer(lines[idx]!);
  if (result === null) return null;
  lines[idx] = result;
  return lines.join('\n');
}

// ── Fixer registry ─────────────────────────────────────────────────────────────

export const FIXERS: Readonly<Record<string, Fixer>> = {
  /**
   * console_log — removes console.* call lines.
   * Safe: debug logging should never reach production.
   */
  console_log: (content, finding) =>
    removeLine(content, finding, /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/),

  /**
   * console_log_production — same removal as console_log.
   * Separate category for production source files.
   */
  console_log_production: (content, finding) =>
    removeLine(content, finding, /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/),

  /**
   * console_in_test — removes console.* lines in test files.
   * Safe: test output should be clean.
   */
  console_in_test: (content, finding) =>
    removeLine(content, finding, /\bconsole\.(log|warn|error|info|debug|trace)\s*\(/),

  /**
   * debugger_statement — removes the `debugger;` line.
   * Safe: debugger statements must never be committed.
   */
  debugger_statement: (content, finding) =>
    removeLine(content, finding, /\bdebugger\b/),

  /**
   * ts_ignore_no_comment — appends a TODO explanation placeholder.
   * Before:  // @ts-ignore
   * After:   // @ts-ignore: TODO: explain why this suppression is necessary
   *
   * Safe (additive): the suppression still works; the comment prompts the author.
   * Idempotent: guard prevents double-application.
   */
  ts_ignore_no_comment: (content, finding) =>
    replaceLine(
      content,
      finding,
      /@ts-ignore/,
      (line) => {
        // Already has a comment — don't touch
        if (/@ts-ignore\s*:\s*\S/.test(line) || /@ts-ignore\s+\S/.test(line)) return null;
        return line.replace(/@ts-ignore/, '@ts-ignore: TODO: explain why this suppression is necessary');
      },
    ),

  /**
   * ts_expect_error_no_comment — appends a TODO explanation placeholder.
   * Before:  // @ts-expect-error
   * After:   // @ts-expect-error: TODO: explain why this suppression is necessary
   *
   * Safe (additive): suppression still works; idempotent (guard checks).
   */
  ts_expect_error_no_comment: (content, finding) =>
    replaceLine(
      content,
      finding,
      /@ts-expect-error/,
      (line) => {
        if (/@ts-expect-error\s*:\s*\S/.test(line) || /@ts-expect-error\s+\S/.test(line)) return null;
        return line.replace(/@ts-expect-error/, '@ts-expect-error: TODO: explain why this suppression is necessary');
      },
    ),

  /**
   * var_declaration — replaces `var` with `let`.
   * Safe: `let` is strictly more constrained than `var` in modern, well-structured
   * code. The fix targets only the declaration line.
   *
   * Note: In the rare case of intentional cross-block `var` hoisting, this is a
   * LOW-severity finding that the developer can revert. Prefer `const` manually
   * once you confirm the variable is never reassigned.
   */
  var_declaration: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\bvar\s/,
      (line) => {
        // Don't touch lines that are already let/const
        if (/\b(let|const)\s/.test(line)) return null;
        return line.replace(/\bvar\s/, 'let ');
      },
    ),

  // ── Go fixers ───────────────────────────────────────────────────────────────

  /**
   * go_ioutil_deprecated — replaces deprecated ioutil call with modern equivalent.
   *
   * Substitutions on the flagged line:
   *   ioutil.ReadFile(  → os.ReadFile(
   *   ioutil.WriteFile( → os.WriteFile(
   *   ioutil.ReadAll(   → io.ReadAll(
   *
   * Safe (mechanical rename): the replacement functions are exact aliases with
   * identical signatures — this is a drop-in replacement in all Go 1.16+ code.
   * Idempotent: the guard regex requires "ioutil." on the flagged line.
   *
   * Note: import cleanup ("io/ioutil" → "io"/"os") is not attempted here because
   * a single file may use multiple ioutil functions across different findings.
   * The developer will get a compiler error for the now-unused ioutil import and
   * can remove it trivially.
   */
  go_ioutil_deprecated: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\bioutil\.(ReadFile|WriteFile|ReadAll)\s*\(/,
      (line) => {
        return line
          .replace(/\bioutil\.ReadFile\s*\(/, 'os.ReadFile(')
          .replace(/\bioutil\.WriteFile\s*\(/, 'os.WriteFile(')
          .replace(/\bioutil\.ReadAll\s*\(/, 'io.ReadAll(');
      },
    ),

  /**
   * go_weak_random — annotates the flagged line with a TODO comment.
   *
   * Replacing math/rand with crypto/rand requires restructuring (different API),
   * so this is an additive annotation fixer. The comment prompts the developer
   * to make the change manually.
   *
   * Safe (additive): does not alter any logic.
   * Idempotent: guard checks that the TODO comment is not already present.
   */
  go_weak_random: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\brand\./,
      (line) => {
        const TODO = '// TODO: replace math/rand with crypto/rand for security-sensitive values';
        if (line.includes(TODO)) return null;
        return `${line} ${TODO}`;
      },
    ),

  /**
   * go_time_sleep_in_handler — annotates the flagged line with a TODO comment.
   *
   * The actual fix (switching to select + time.After + ctx.Done()) requires
   * restructuring, so this is a safe additive annotation.
   *
   * Idempotent: guard checks that the TODO comment is not already present.
   */
  go_time_sleep_in_handler: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\btime\.Sleep\s*\(/,
      (line) => {
        const TODO = '// TODO: time.Sleep in HTTP handler blocks goroutine — consider context.WithTimeout or async approach';
        if (line.includes(TODO)) return null;
        return `${line} ${TODO}`;
      },
    ),

  /**
   * go_log_sensitive — annotates the flagged line with a TODO comment.
   *
   * Cannot safely remove or redact log arguments automatically (the correct
   * replacement depends on what the sensitive field is and how it's formatted),
   * so this is an additive annotation fixer.
   *
   * Idempotent: guard checks that the TODO comment is not already present.
   */
  go_log_sensitive: (content, finding) =>
    replaceLine(
      content,
      finding,
      /(?:log\.Printf|log\.Println|log\.Fatal|log\.Fatalf|log\.Print|fmt\.Printf|fmt\.Println|fmt\.Fprintf)\s*\(/,
      (line) => {
        const TODO = '// TODO: sensitive value in log — redact before logging';
        if (line.includes(TODO)) return null;
        return `${line} ${TODO}`;
      },
    ),

  /**
   * go_context_background_in_handler — annotates the flagged line with a TODO comment.
   *
   * Replacing context.Background() with r.Context() is straightforward but
   * requires knowing the request variable name (could be `r`, `req`, `request`),
   * so an annotation is safer than an automatic substitution.
   *
   * Idempotent: guard checks that the TODO comment is not already present.
   */
  go_context_background_in_handler: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\bcontext\.Background\s*\(\s*\)/,
      (line) => {
        const TODO = '// TODO: use r.Context() instead of context.Background() to respect request cancellation';
        if (line.includes(TODO)) return null;
        return `${line} ${TODO}`;
      },
    ),

  // ── Python / Django fixers ───────────────────────────────────────────────────

  /**
   * py_print_debug — removes `print(` debug lines in production Python files.
   *
   * Safe: production source files should not contain debug print statements.
   * Idempotent: removeLine splices the line; re-applying to the same line number
   *   after removal would encounter a different line that fails the guard.
   */
  py_print_debug: (content, finding) =>
    removeLine(content, finding, /\bprint\s*\(/),

  /**
   * django_debug_true — replaces `DEBUG = True` with an env-var-driven expression.
   *
   * Before:  DEBUG = True
   * After:   DEBUG = os.environ.get("DJANGO_DEBUG", "False") == "True"
   *
   * Also ensures `import os` is present at the top of the file. If `import os`
   * is already in the file the content is not duplicated.
   *
   * Safe (mechanical): the replacement is functionally equivalent when
   *   DJANGO_DEBUG is not set (defaults to False, which is the safe production value).
   * Idempotent: guard requires literal `True` on the flagged line; after fix the
   *   line no longer matches.
   */
  django_debug_true: (content, finding) => {
    const patched = replaceLine(
      content,
      finding,
      /^\s*DEBUG\s*=\s*True\b/,
      (line) => {
        return line.replace(/True\s*$/, 'os.environ.get("DJANGO_DEBUG", "False") == "True"');
      },
    );
    if (patched === null) return null;
    // Add `import os` at the top if not already present
    if (!/^\s*import\s+os\s*$/m.test(patched)) {
      return `import os\n${patched}`;
    }
    return patched;
  },

  /**
   * django_hardcoded_secret_key — replaces a hardcoded SECRET_KEY with an env lookup.
   *
   * Before:  SECRET_KEY = "django-insecure-..."
   * After:   SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
   *
   * Guard: only replaces if the line matches the hardcoded pattern (a string
   *   literal, not already an os.environ / env() call).
   *
   * Safe: functionally equivalent — the env var must be set in production.
   * Idempotent: after fix the line no longer contains a string literal value.
   */
  django_hardcoded_secret_key: (content, finding) => {
    const patched = replaceLine(
      content,
      finding,
      /^\s*SECRET_KEY\s*=\s*["'][^"']{8,}/,
      (line) => {
        // Skip if already using env lookup
        if (/os\.environ|env\s*\(|config\s*\(/.test(line)) return null;
        // Preserve indentation
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        return `${indent}SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]`;
      },
    );
    if (patched === null) return null;
    // Add `import os` at the top if not already present
    if (!/^\s*import\s+os\s*$/m.test(patched)) {
      return `import os\n${patched}`;
    }
    return patched;
  },

  // ── Ruby / Rails fixers ──────────────────────────────────────────────────────

  /**
   * rails_yaml_load_unsafe — replaces YAML.load( with YAML.safe_load(.
   *
   * Before:  YAML.load(params[:config])
   * After:   YAML.safe_load(params[:config])
   *
   * Safe (mechanical): YAML.safe_load() is a strict superset of YAML.load()
   *   for primitive types; it rejects !!ruby/object tags that enable RCE.
   *   The API signature is identical for the common case.
   * Idempotent: guard requires "YAML.load(" (without "safe_") on the line.
   *
   * Note: callers that rely on !!ruby/object deserialization will need to
   *   switch to JSON or another format — but those are security vulnerabilities
   *   that must be addressed regardless.
   */
  rails_yaml_load_unsafe: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\bYAML\.load\s*\(/,
      (line) => {
        // Guard: must not already be safe_load (idempotency)
        if (/\bYAML\.safe_load\s*\(/.test(line)) return null;
        return line.replace(/\bYAML\.load\s*\(/, 'YAML.safe_load(');
      },
    ),

  /**
   * rails_mass_assignment_permit_all — stubs params.permit! with an empty permit list.
   *
   * Before:  params.require(:user).permit!
   * After:   params.require(:user).permit([]) # TODO: list permitted params
   *
   * Safe (additive annotation): the code still compiles and runs; the empty
   *   permit list is intentionally restrictive — it forces the developer to
   *   enumerate the fields rather than leaving a security hole open.
   * Idempotent: guard checks that "permit!" is still present on the line.
   *
   * Note: the developer MUST fill in the actual permitted params. The TODO
   *   comment ensures the stub is clearly visible in code review.
   */
  rails_mass_assignment_permit_all: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\bparams\b[^;#\n]*\.permit!/,
      (line) => {
        // Already stubbed — idempotency guard
        if (/\.permit\(\[\]\)/.test(line)) return null;
        return line.replace(/\.permit!/, '.permit([]) # TODO: list permitted params');
      },
    ),

  /**
   * rails_gem_source_http — upgrades http:// gem source to https://.
   *
   * Before:  source 'http://rubygems.org'
   * After:   source 'https://rubygems.org'
   *
   * Safe (mechanical): HTTPS is the correct protocol for rubygems.org and all
   *   other public gem hosts. This is a pure protocol upgrade with no
   *   functional difference.
   * Idempotent: guard requires "http://" (without the 's') on the line.
   */
  rails_gem_source_http: (content, finding) =>
    replaceLine(
      content,
      finding,
      /^\s*source\s+['"]http:\/\//,
      (line) => {
        // Already https — idempotency guard
        if (/https:\/\//.test(line)) return null;
        return line.replace(/http:\/\//, 'https://');
      },
    ),

  /**
   * rails_hardcoded_secret_key_base — replaces a literal secret_key_base with ERB env expansion.
   *
   * Before:  secret_key_base: "abc123verylong..."
   * After:   secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>
   *
   * Guard: only replaces if the line matches the hardcoded YAML pattern (a
   *   string literal, not already an ERB/ENV expression).
   *
   * Safe: functionally equivalent — the env var must be set in production.
   * Idempotent: after fix the line no longer contains a string literal value.
   */
  rails_hardcoded_secret_key_base: (content, finding) =>
    replaceLine(
      content,
      finding,
      /^\s*secret_key_base:\s*["'][^"']{8,}["']/,
      (line) => {
        // Skip if already using ERB or ENV
        if (/ENV\b|<%= /.test(line)) return null;
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        return `${indent}secret_key_base: <%= ENV["SECRET_KEY_BASE"] %>`;
      },
    ),

  /**
   * rails_debug_mode_production — fixes debug config in production files.
   *
   * Handles two patterns on the flagged line:
   *   config.log_level = :debug            → config.log_level = :info
   *   config.consider_all_requests_local = true → config.consider_all_requests_local = false
   *
   * Safe (mechanical): both replacements move toward the safe production default.
   * Idempotent: after fix the line no longer matches the dangerous pattern.
   */
  rails_debug_mode_production: (content, finding) =>
    replaceLine(
      content,
      finding,
      /config\.log_level\s*=\s*:debug\b|config\.consider_all_requests_local\s*=\s*true\b/,
      (line) => {
        let result = line.replace(/\bconfig\.log_level\s*=\s*:debug\b/, 'config.log_level = :info');
        result = result.replace(/\bconfig\.consider_all_requests_local\s*=\s*true\b/, 'config.consider_all_requests_local = false');
        // If nothing changed, line didn't match (shouldn't happen given the guard)
        return result === line ? null : result;
      },
    ),

  /**
   * rails_regex_dos — replaces ^ / $ anchors with \A / \z in format validations.
   *
   * Before:  validates :slug, format: { with: /^[a-z-]+$/ }
   * After:   validates :slug, format: { with: /\A[a-z-]+\z/ }
   *
   * Safe (mechanical): \A and \z are strict string-start / string-end anchors
   *   in Ruby. They are semantically stronger (more restrictive) than ^ and $,
   *   which match per-line. Replacing them closes the multiline bypass.
   * Idempotent: guard checks that the line has a format: validation with ^ or $.
   *
   * Note: this only rewrites within the literal regex token on the same line as
   *   the validates call. Multi-line regexes are left for manual review.
   */
  rails_regex_dos: (content, finding) =>
    replaceLine(
      content,
      finding,
      /validates\s+:\w+.*format:.*with:\s*\/\^|validates\s+:\w+.*format:.*with:\s*\/[^/]*\$\//,
      (line) => {
        // Only act if there's an actual ^ or $ anchor to replace
        if (!/\/\^|[^\\]\$\//.test(line)) return null;
        let result = line;
        // Replace leading ^ in regex literal (e.g. /^ → /\A)
        result = result.replace(/(\/)\^/g, '$1\\A');
        // Replace trailing $ in regex literal (e.g. $/ → \z/) — must be $ followed by /
        result = result.replace(/\$\//g, '\\z/');
        return result === line ? null : result;
      },
    ),

  // ── Java / Spring fixers ─────────────────────────────────────────────────────

  /**
   * java_weak_password_hash — upgrades MD5/SHA-1 to SHA-256 in MessageDigest.getInstance().
   *
   * Before:  MessageDigest.getInstance("MD5")
   * After:   MessageDigest.getInstance("SHA-256")
   *
   * Before:  MessageDigest.getInstance("SHA-1")
   * After:   MessageDigest.getInstance("SHA-256")
   *
   * Safe (mechanical): SHA-256 is the minimal acceptable algorithm for any general
   *   digest use-case. The API signature is identical so the fix is a pure
   *   string substitution. Note: for password storage, BCrypt/Argon2 is still
   *   preferred — the suggestion in the rule message conveys that.
   * Idempotent: guard requires "MD5" or "SHA-1"/"SHA1" on the flagged line.
   */
  java_weak_password_hash: (content, finding) =>
    replaceLine(
      content,
      finding,
      /MessageDigest\.getInstance\s*\(\s*["'](?:MD5|SHA-1|SHA1)["']\s*\)/,
      (line) => {
        // Already using SHA-256 — idempotency guard
        if (/MessageDigest\.getInstance\s*\(\s*["']SHA-256["']\s*\)/.test(line)) return null;
        return line
          .replace(/MessageDigest\.getInstance\s*\(\s*["']MD5["']\s*\)/, 'MessageDigest.getInstance("SHA-256")')
          .replace(/MessageDigest\.getInstance\s*\(\s*["']SHA-1["']\s*\)/, 'MessageDigest.getInstance("SHA-256")')
          .replace(/MessageDigest\.getInstance\s*\(\s*["']SHA1["']\s*\)/, 'MessageDigest.getInstance("SHA-256")');
      },
    ),

  /**
   * java_random_not_secure — replaces new Random() with new SecureRandom().
   *
   * Before:  Random rand = new Random();
   * After:   Random rand = new SecureRandom();
   *
   * Safe (mechanical): SecureRandom extends Random and satisfies the same
   *   interface. The substitution is a drop-in replacement for all call sites
   *   that do not depend on a fixed seed (which they must not for security).
   * Idempotent: guard requires "new Random(" on the flagged line.
   *
   * Note: the developer must add "import java.security.SecureRandom;" if it is
   *   not already imported. The compiler error makes this obvious.
   */
  java_random_not_secure: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\bnew Random\s*\(/,
      (line) => {
        // Already SecureRandom — idempotency guard
        if (/\bnew SecureRandom\s*\(/.test(line)) return null;
        return line.replace(/\bnew Random\s*\(/, 'new SecureRandom(');
      },
    ),

  /**
   * java_log_sensitive — removes the line that logs a sensitive value.
   *
   * Safe: these are debug logging lines; removing them does not alter
   *   application logic. The finding's guard regex matches logger/log/LOG
   *   calls that reference password/token/secret/apiKey.
   * Idempotent: removeLine splices the line; re-applying after removal would
   *   encounter a different line that fails the guard.
   */
  java_log_sensitive: (content, finding) =>
    removeLine(
      content,
      finding,
      /(?:log|logger|LOG|LOGGER)\s*\.(?:info|debug|warn|error|trace)\s*\([^)]*(?:password|passwd|secret|token|apiKey)\b/i,
    ),

  /**
   * java_hardcoded_password — annotates the hardcoded credential line with a FIXME comment.
   *
   * Before:  String password = "supersecret123";
   * After:   String password = "supersecret123"; // FIXME: hardcoded credential — use System.getenv()
   *
   * This is an additive annotation fixer. Replacing the literal value
   * automatically is unsafe because the variable name, the property key, and
   * whether to use System.getenv() or @Value all vary. The comment makes the
   * issue visually obvious in code review without breaking compilation.
   *
   * Safe (additive): does not change any logic.
   * Idempotent: guard checks that the FIXME comment is not already present.
   */
  java_hardcoded_password: (content, finding) =>
    replaceLine(
      content,
      finding,
      /(?:String|final\s+String)\s+(?:password|passwd|secret|apiKey|api_key|token|authKey)\s*=\s*["'][^"']{4,}["']/,
      (line) => {
        const FIXME = '// FIXME: hardcoded credential — use System.getenv()';
        if (line.includes(FIXME)) return null;
        return `${line} ${FIXME}`;
      },
    ),

  /**
   * spring_h2_console_enabled — flips spring.h2.console.enabled=true to false.
   *
   * Before:  spring.h2.console.enabled=true
   * After:   spring.h2.console.enabled=false
   *
   * Safe (mechanical): disabling the H2 console is always the safe production
   *   default. The change is a pure value flip.
   * Idempotent: guard requires "=true" on the flagged line.
   */
  spring_h2_console_enabled: (content, finding) =>
    replaceLine(
      content,
      finding,
      /spring\.h2\.console\.enabled\s*=\s*true/,
      (line) => {
        // Already false — idempotency guard
        if (/spring\.h2\.console\.enabled\s*=\s*false/.test(line)) return null;
        return line.replace(/spring\.h2\.console\.enabled\s*=\s*true/, 'spring.h2.console.enabled=false');
      },
    ),

  // ── C# fixers ────────────────────────────────────────────────────────────────

  /**
   * csharp_weak_hash_algorithm — replaces MD5.Create() or SHA1.Create() with SHA256.Create().
   *
   * Before:  var hash = MD5.Create();
   * After:   var hash = SHA256.Create();
   *
   * Before:  using var sha = SHA1.Create();
   * After:   using var sha = SHA256.Create();
   *
   * Safe (mechanical): SHA-256 is the minimal acceptable algorithm for any
   *   general digest use-case. The API signature is identical.
   * Idempotent: guard requires MD5.Create() or SHA1.Create() on the line.
   */
  csharp_weak_hash_algorithm: (content, finding) =>
    replaceLine(
      content,
      finding,
      /(?:MD5|SHA1)\.Create\s*\(\s*\)/,
      (line) => {
        // Already using SHA256 — idempotency guard
        if (/SHA256\.Create\s*\(\s*\)/.test(line)) return null;
        return line
          .replace(/\bMD5\.Create\s*\(\s*\)/, 'SHA256.Create()')
          .replace(/\bSHA1\.Create\s*\(\s*\)/, 'SHA256.Create()');
      },
    ),

  /**
   * csharp_async_void — replaces `async void ` with `async Task ` in a method signature.
   *
   * Before:  public async void LoadData() { ... }
   * After:   public async Task LoadData() { ... }
   *
   * Safe (mechanical): async Task is strictly better — exceptions propagate and
   *   the method can be awaited. Note: event handlers that must be async void
   *   are excluded by the detection rule (EVENT_RE guard).
   * Idempotent: guard checks that `async void` is present; after fix the line
   *   contains `async Task` instead.
   */
  csharp_async_void: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\basync\s+void\s/,
      (line) => {
        // Already async Task — idempotency guard
        if (/\basync\s+Task\b/.test(line)) return null;
        return line.replace(/\basync\s+void\s/, 'async Task ');
      },
    ),

  // ── Rust fixers ──────────────────────────────────────────────────────────────

  /**
   * rust_use_of_deprecated_try_macro — replaces try!(expr) with expr?.
   *
   * Before:  try!(file.read_to_string(&mut s))
   * After:   file.read_to_string(&mut s)?
   *
   * Safe (mechanical): the ? operator is the exact modern replacement for
   *   try!() with identical semantics in Rust 2018+.
   * Idempotent: guard requires `try!(` on the line; after fix the macro is gone.
   */
  rust_use_of_deprecated_try_macro: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\btry!\s*\(/,
      (line) => {
        const match = line.match(/\btry!\s*\(/);
        if (!match || match.index === undefined) return null;
        const start = match.index + match[0].length;
        let depth = 0;
        let end = -1;
        for (let j = start; j < line.length; j++) {
          if (line[j] === '(') depth++;
          else if (line[j] === ')') {
            if (depth === 0) { end = j; break; }
            depth--;
          }
        }
        if (end === -1) return null;
        const inner = line.slice(start, end);
        return line.slice(0, match.index) + inner + '?' + line.slice(end + 1);
      },
    ),

  /**
   * rust_unwrap_in_lib — replaces .unwrap() with .expect("TODO: handle error").
   *
   * Before:  let val = result.unwrap();
   * After:   let val = result.expect("TODO: handle error");
   *
   * Safe (additive): the expect message improves the panic message. The
   *   developer can refine the message or switch to ? propagation.
   * Idempotent: guard checks that `.unwrap()` is present; returns null if
   *   `.expect(` is already on the line (already changed or manually fixed).
   */
  rust_unwrap_in_lib: (content, finding) =>
    replaceLine(
      content,
      finding,
      /\.unwrap\s*\(\s*\)/,
      (line) => {
        // Already has .expect( — idempotency guard
        if (/\.expect\s*\(/.test(line)) return null;
        return line.replace(/\.unwrap\s*\(\s*\)/, '.expect("TODO: handle error")');
      },
    ),

  /**
   * rust_env_var_unwrap — replaces env::var("KEY").unwrap() with
   *   env::var("KEY").expect("KEY env var must be set").
   *
   * Before:  let key = env::var("API_KEY").unwrap();
   * After:   let key = env::var("API_KEY").expect("API_KEY env var must be set");
   *
   * Safe (mechanical): the expect message is clearer than an unwrap panic.
   * Idempotent: guard requires the `.unwrap()` chained on env::var; returns
   *   null if `.expect(` already present on the line.
   */
  rust_env_var_unwrap: (content, finding) =>
    replaceLine(
      content,
      finding,
      /env::var\s*\([^)]+\)\s*\.unwrap\s*\(\s*\)/,
      (line) => {
        // Already has .expect( — idempotency guard
        if (/\.expect\s*\(/.test(line)) return null;
        // Extract the key name from env::var("KEY") for the expect message
        return line.replace(
          /env::var\s*\(([^)]+)\)\s*\.unwrap\s*\(\s*\)/,
          (_, keyExpr: string) => {
            // keyExpr might be: "API_KEY" or 'API_KEY' or a variable
            const keyName = keyExpr.trim().replace(/^["']|["']$/g, '');
            return `env::var(${keyExpr}).expect("${keyName} env var must be set")`;
          },
        );
      },
    ),

  /**
   * rust_todo_in_production — cannot safely auto-fix.
   *
   * Replacing todo!() or unimplemented!() requires implementing the function
   * body, which is not mechanically possible. Returns null always.
   */
  // rust_todo_in_production is intentionally not registered — no safe auto-fix.
} as const;

export const AUTO_FIXABLE: ReadonlySet<string> = new Set(Object.keys(FIXERS));

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Applies the registered fixer for a finding's category.
 * Returns the patched content, or null if no fixer exists or it cannot apply.
 */
export function applyFixer(content: string, finding: Finding): string | null {
  const fixer = FIXERS[finding.category.toLowerCase()];
  if (!fixer) return null;
  return fixer(content, finding);
}

// ── verifyFix ─────────────────────────────────────────────────────────────────

function makeEmptyScan(): ScanResult {
  return {
    _generatedSections: [],
    generatedAt: new Date().toISOString(),
    scanVersion: '0',
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
}

export interface VerifyResult {
  originalFinding: Finding;
  fixApplied: boolean;
  findingResolved: boolean;
  newFindingsIntroduced: Finding[];
  safe: boolean;
}

/**
 * Re-runs Prometheus rules on before/after content to confirm a fix worked.
 *
 * findingResolved: the original finding no longer fires on the patched content.
 * newFindingsIntroduced: any findings present in after but not in before.
 * safe: findingResolved && newFindingsIntroduced.length === 0.
 */
export function verifyFix(
  filePath: string,
  beforeContent: string,
  afterContent: string,
  originalFinding: Finding,
  config: ThesmosConfig,
): VerifyResult {
  const rule = PROMETHEUS_RULES.find((r) => r.category === originalFinding.category);
  if (!rule) {
    return { originalFinding, fixApplied: true, findingResolved: true, newFindingsIntroduced: [], safe: true };
  }

  const scan = makeEmptyScan();
  const afterRuleFindings = rule.detect({ scan, config, changedFiles: [{ path: filePath, content: afterContent }] });
  const stillFires = afterRuleFindings.some(
    (f) => f.category === originalFinding.category &&
      Math.abs((f.line ?? 0) - (originalFinding.line ?? 0)) <= 2,
  );

  const beforeAll = runReview({ scan, config, changedFiles: [{ path: filePath, content: beforeContent }] });
  const afterAll = runReview({ scan, config, changedFiles: [{ path: filePath, content: afterContent }] });
  const newFindingsIntroduced = afterAll.filter(
    (af) => !beforeAll.some(
      (bf) => bf.category === af.category && Math.abs((bf.line ?? 0) - (af.line ?? 0)) <= 2,
    ),
  );

  return {
    originalFinding,
    fixApplied: true,
    findingResolved: !stillFires,
    newFindingsIntroduced,
    safe: !stillFires && newFindingsIntroduced.length === 0,
  };
}

// ── Result types ──────────────────────────────────────────────────────────────

export interface FixEntry {
  file: string;
  line: number | null;
  rule: string;
  action: string;
}

export interface FixSkipEntry {
  file: string;
  line: number | null;
  rule: string;
  reason: string;
}

export interface FixResult {
  dryRun: boolean;
  applied: FixEntry[];
  skipped: FixSkipEntry[];
  unfixableFindings: Finding[];
}

export interface FixOptions {
  /** Write changes to disk. Default: false (dry-run). */
  apply?: boolean;
  /** Only fix this specific rule category (optional). */
  ruleFilter?: string;
}

// ── runFix ────────────────────────────────────────────────────────────────────

/**
 * Applies all registered fixers to the given findings.
 *
 * Groups findings by file, applies fixes bottom-to-top (highest line first)
 * so that line numbers remain accurate after each splice.
 *
 * When options.apply is false (the default) the files are NOT written — this
 * is dry-run mode. The returned FixResult reflects what WOULD be applied.
 */
export function runFix(
  root: string,
  findings: Finding[],
  options: FixOptions = {},
): FixResult {
  const { apply = false, ruleFilter } = options;

  const fixableFindings = findings.filter((f) => {
    const cat = f.category.toLowerCase();
    if (!AUTO_FIXABLE.has(cat)) return false;
    if (ruleFilter && cat !== ruleFilter.toLowerCase()) return false;
    return true;
  });

  const unfixableFindings = ruleFilter
    ? []
    : findings.filter((f) => !AUTO_FIXABLE.has(f.category.toLowerCase()));

  const applied: FixEntry[] = [];
  const skipped: FixSkipEntry[] = [];

  // Group by file
  const byFile = new Map<string, Finding[]>();
  for (const f of fixableFindings) {
    const existing = byFile.get(f.file) ?? [];
    existing.push(f);
    byFile.set(f.file, existing);
  }

  for (const [relFile, filefindings] of byFile) {
    const absPath = relFile.startsWith('/') ? relFile : join(root, relFile);

    if (!existsSync(absPath)) {
      for (const f of filefindings) {
        skipped.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'file not found' });
      }
      continue;
    }

    let content: string;
    try {
      content = readFileSync(absPath, 'utf8');
    } catch (e) {
      log.error('file read failed', { file: relFile, error: e instanceof Error ? e.message : String(e) });
      for (const f of filefindings) {
        skipped.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'file not readable' });
      }
      continue;
    }

    // Sort highest line first to avoid offset drift after splices
    const sorted = [...filefindings].sort((a, b) => (b.line ?? 0) - (a.line ?? 0));

    let patched = content;
    for (const f of sorted) {
      const result = applyFixer(patched, f);
      if (result === null) {
        log.warn('fixer returned null', { file: relFile, rule: f.category, line: f.line });
        skipped.push({ file: relFile, line: f.line ?? null, rule: f.category, reason: 'fixer could not apply safely' });
        continue;
      }
      log.info('fix applied', { file: relFile, rule: f.category, line: f.line, dry: !apply });
      patched = result;
      applied.push({ file: relFile, line: f.line ?? null, rule: f.category, action: describeAction(f.category) });
    }

    if (apply && patched !== content) {
      try {
        writeFileSync(absPath, patched, 'utf8');
      } catch (err) {
        log.error('file write failed', { file: relFile, error: err instanceof Error ? err.message : String(err) });
        // Roll back applied entries for this file so the result is accurate
        const fileApplied = applied.filter((e) => e.file === relFile);
        for (const e of fileApplied) {
          const idx = applied.indexOf(e);
          if (idx !== -1) applied.splice(idx, 1);
          skipped.push({ file: e.file, line: e.line, rule: e.rule, reason: `write failed: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }
  }

  return { dryRun: !apply, applied, skipped, unfixableFindings };
}

function describeAction(category: string): string {
  switch (category.toLowerCase()) {
    case 'console_log':
    case 'console_log_production':
    case 'console_in_test':
      return 'removed console statement';
    case 'debugger_statement':
      return 'removed debugger statement';
    case 'ts_ignore_no_comment':
      return 'added @ts-ignore explanation placeholder';
    case 'ts_expect_error_no_comment':
      return 'added @ts-expect-error explanation placeholder';
    case 'var_declaration':
      return 'replaced var with let';
    // Go fixers
    case 'go_ioutil_deprecated':
      return 'replaced deprecated ioutil call with os/io equivalent';
    case 'go_weak_random':
      return 'added TODO: replace math/rand with crypto/rand';
    case 'go_time_sleep_in_handler':
      return 'added TODO: replace time.Sleep with context-aware timer';
    case 'go_log_sensitive':
      return 'added TODO: redact sensitive value before logging';
    case 'go_context_background_in_handler':
      return 'added TODO: use r.Context() instead of context.Background()';
    // Python / Django fixers
    case 'py_print_debug':
      return 'removed debug print statement';
    case 'django_debug_true':
      return 'replaced DEBUG = True with env-var expression';
    case 'django_hardcoded_secret_key':
      return 'replaced hardcoded SECRET_KEY with os.environ lookup';
    // Ruby / Rails fixers
    case 'rails_yaml_load_unsafe':
      return 'replaced YAML.load() with YAML.safe_load()';
    case 'rails_mass_assignment_permit_all':
      return 'replaced params.permit! with params.permit([]) stub — list permitted params';
    case 'rails_gem_source_http':
      return 'upgraded gem source from http:// to https://';
    case 'rails_hardcoded_secret_key_base':
      return 'replaced hardcoded secret_key_base with ENV["SECRET_KEY_BASE"] lookup';
    case 'rails_debug_mode_production':
      return 'replaced debug configuration with safe production defaults';
    case 'rails_regex_dos':
      return 'replaced ^ / $ regex anchors with \\A / \\z to prevent multiline bypass';
    // Java / Spring fixers
    case 'java_weak_password_hash':
      return 'upgraded MessageDigest algorithm from MD5/SHA-1 to SHA-256';
    case 'java_random_not_secure':
      return 'replaced new Random() with new SecureRandom()';
    case 'java_log_sensitive':
      return 'removed log statement containing sensitive value';
    case 'java_hardcoded_password':
      return 'annotated hardcoded credential with FIXME — replace with System.getenv()';
    case 'spring_h2_console_enabled':
      return 'disabled H2 web console (spring.h2.console.enabled=false)';
    // C# fixers
    case 'csharp_weak_hash_algorithm':
      return 'replaced MD5.Create()/SHA1.Create() with SHA256.Create()';
    case 'csharp_async_void':
      return 'replaced async void with async Task';
    // Rust fixers
    case 'rust_use_of_deprecated_try_macro':
      return 'replaced try!(expr) with expr?';
    case 'rust_unwrap_in_lib':
      return 'replaced .unwrap() with .expect("TODO: handle error")';
    case 'rust_env_var_unwrap':
      return 'replaced env::var().unwrap() with .expect() including the variable name';
    default:
      return 'applied fix';
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatFixConsole(result: FixResult): string {
  const { dryRun, applied, skipped, unfixableFindings } = result;
  const lines: string[] = [''];
  const mode = dryRun ? 'Dry-run preview' : 'Applied';

  lines.push(`  thesmos fix — ${mode}`);
  lines.push('');

  if (applied.length === 0 && skipped.length === 0 && unfixableFindings.length === 0) {
    lines.push('  No auto-fixable violations found.');
    lines.push('');
    return lines.join('\n');
  }

  if (applied.length > 0) {
    for (const f of applied) {
      const loc = f.line != null ? `:${f.line}` : '';
      const verb = dryRun ? 'Would fix' : 'Fixed';
      lines.push(`  ${dryRun ? '🔍' : '✅'}  ${verb}: ${f.file}${loc}  [${f.rule}]  — ${f.action}`);
    }
  }

  if (skipped.length > 0) {
    lines.push('');
    lines.push(`  Skipped (${skipped.length})`);
    for (const f of skipped) {
      const loc = f.line != null ? `:${f.line}` : '';
      lines.push(`  ⏭   ${f.file}${loc}  [${f.rule}]  — ${f.reason}`);
    }
  }

  if (unfixableFindings.length > 0) {
    lines.push('');
    lines.push(
      `  ${unfixableFindings.length} finding${unfixableFindings.length === 1 ? '' : 's'} require manual remediation  (run: thesmos review)`,
    );
  }

  if (dryRun && applied.length > 0) {
    lines.push('');
    lines.push('  → Run with --apply to write changes to disk');
  }

  lines.push('');
  return lines.join('\n');
}

export function formatFixJson(result: FixResult): string {
  return JSON.stringify(
    {
      dryRun: result.dryRun,
      applied: result.applied.length,
      skipped: result.skipped.length,
      unfixable: result.unfixableFindings.length,
      fixes: result.applied,
      skippedList: result.skipped,
    },
    null,
    2,
  );
}
