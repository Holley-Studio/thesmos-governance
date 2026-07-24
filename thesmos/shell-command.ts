// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Conservative, local, deterministic shell-command analyzer used to match
 * configured pattern lists (`destructivePatterns`, `operations.requireConfirmation`)
 * and to answer the narrower delete/git-push/database-write questions in
 * scope.ts's `checkCommand()` — the single bounded analysis path all five
 * of those checks share.
 *
 * This is NOT a full POSIX shell parser and never invokes an actual shell —
 * it exists purely to distinguish "this text names a command that will
 * actually run" from "this text merely appears inside a quoted argument"
 * (an echo string, a commit message, a doc string passed to another command),
 * while also recognizing the specific, narrow set of cases where a QUOTED
 * argument IS live executable text: a string passed to a shell interpreter's
 * `-c`/`/c`/`-Command` flag, or a SQL string passed to a database client's
 * `-c`/`-e`/`--command`/`--execute` flag. Those payloads are recursively
 * re-analyzed with this same tokenizer, bounded by depth and size limits.
 *
 * Handles:
 *  - single and double POSIX-ish quotes (double quotes allow backslash to
 *    escape \, $, `, " — single quotes are fully literal)
 *  - backslash escapes, narrowly: only ahead of a real shell metacharacter
 *    (space, quotes, $, `, chain operators, #) — ahead of an ordinary
 *    character the backslash is kept literally, so Windows paths like
 *    `C:\Program Files\npm.cmd` survive intact instead of losing every `\`
 *  - tokens reconstructed across mixed quoted/unquoted spans (fixes the
 *    `r"m" -rf` quote-adjacency bypass: blanking a quoted span instead of
 *    reconstructing it broke "rm" into unmatched fragments)
 *  - top-level command-chaining operators (; && || | &), not honored inside
 *    quotes — each side becomes its own segment, matched independently
 *  - a `#` starting a fresh token is treated as a comment to end of string
 *  - here-docs (`<<DELIM` / `<<-DELIM` / `<<'DELIM'` / `<<"DELIM"`): only the
 *    BODY (the lines between the header and the terminator) is excluded from
 *    tokens — text on the header line itself, before or after the redirect,
 *    including anything chained after a `;`/`&&`/etc. on that same line,
 *    remains live and is tokenized normally. `cat <<EOF; rm -rf /tmp/x` must
 *    still flag the `rm -rf` — only the heredoc body between `EOF` markers
 *    is data, never the rest of that command line.
 *  - executable recognition: POSIX/Windows path prefixes and Windows
 *    extensions (.exe/.cmd/.bat/.ps1/.sh) are stripped before comparison,
 *    and common wrapper executables (`sudo`, `env`, `command`) are skipped
 *    to find the real invoked program
 *  - global flags between an executable and its subcommand (`git -C <dir>
 *    push`, `npm --silent publish`) are skipped when matching a configured
 *    phrase, not just adjacent words
 *  - interpreter/database-client string payloads: a recognized (executable,
 *    flag) pair's next token — quoted or not — is treated as further
 *    command/SQL text and recursively analyzed with this same tokenizer,
 *    bounded by MAX_ANALYSIS_DEPTH and MAX_PAYLOAD_LENGTH; hitting either
 *    bound marks the analysis `ambiguous`, and every phrase/delete/git-push/
 *    database-write check below treats an ambiguous analysis as a match
 *    (fail closed — we cannot rule out a hidden dangerous payload)
 *
 * Documented limits (deliberately not handled — see rationale inline where
 * relevant; omissions here only make the analyzer MORE conservative, i.e.
 * more likely to flag something, never less safe):
 *  - command substitution $(...) / `...` is not expanded — its contents are
 *    kept as literal bare text of the enclosing token
 *  - process substitution <(...) / >(...) is not specially recognized
 *  - parentheses for subshells/grouping are not recursively parsed — `(` /
 *    `)` are ordinary bare characters
 *  - `$VAR` / `${VAR}` expansion is not resolved (kept as literal text)
 *  - this is NOT a complete shell-language enforcement engine: it recognizes
 *    a specific, documented set of executables, flags, and wrapper patterns,
 *    not arbitrary interpreter/CLI grammars. New wrappers, interpreters, or
 *    database clients must be added to the lookup tables below by name.
 *  - interpreter/db-client string-payload recognition takes exactly the
 *    SINGLE token immediately following the recognized flag as the payload
 *    (matching real -c/-Command semantics, where everything after that one
 *    argument becomes positional parameters, not more command text) — an
 *    unquoted multi-word payload with no surrounding quotes at all will only
 *    have its first word captured; this is a known, narrow gap for that
 *    unusual (and already fragile in real shells) invocation shape
 *  - git's `-c`/`-C` are treated as value-taking for the purpose of skipping
 *    past them to find a later subcommand word; this cannot disambiguate a
 *    pathological `git -c push` (with no `=value` and no real subcommand)
 *    from `-c`'s value happening to be the literal word "push" — documented,
 *    narrow, and does not affect the required `git -C <dir> push` case
 *  - heredoc body detection is `\n`-based (POSIX line endings); CRLF-only
 *    heredoc bodies are not specially normalized
 */

export interface CommandToken {
  /** Reconstructed literal text — quote marks removed, escapes resolved. */
  text: string;
  /**
   * True only when EVERY character of this token came from inside a single
   * quoted span (e.g. the whole `"npm publish"` argument) — inert for
   * pattern matching UNLESS it's the recognized string-payload argument to
   * an interpreter/database-client flag (see findStringPayload). A token
   * assembled from a MIX of quoted and unquoted characters (e.g. `r"m"`) is
   * NOT quoted: it reconstructs to real command text and must still be
   * treated as a live candidate.
   */
  quoted: boolean;
}

export interface CommandSegment {
  tokens: CommandToken[];
}

const EXECUTABLE_EXTENSIONS = new Set(['exe', 'cmd', 'bat', 'ps1', 'sh']);

/** Splits a token's text on both POSIX (/) and Windows (\) path separators
 *  and strips a recognized executable extension, so `C:\nodejs\npm.cmd`,
 *  `/usr/local/bin/npm`, and bare `npm` all normalize to `npm`. */
export function normalizeExecutableName(text: string): string {
  const parts = text.split(/[/\\]/);
  let base = parts[parts.length - 1] ?? text;
  const dot = base.lastIndexOf('.');
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase();
    if (EXECUTABLE_EXTENSIONS.has(ext)) base = base.slice(0, dot);
  }
  return base;
}

/** Characters after which a backslash is a real escape (consumed, next char
 *  kept literally). Deliberately narrow — anything else (letters, digits)
 *  means the backslash is NOT an escape, so Windows paths (`C:\Program
 *  Files\npm.cmd`) survive intact instead of losing every backslash. */
const ESCAPABLE_CHARS = new Set([' ', '\t', '"', "'", '\\', '$', '`', ';', '&', '|', '#', '(', ')']);

/**
 * Recognizes a here-doc header — `<<DELIM`, `<<-DELIM`, `<<'DELIM'`, or
 * `<<"DELIM"` — starting at position `at`. Returns the delimiter word and
 * the index right after the header (start of the rest of that line), or
 * null if `at` isn't a here-doc start.
 */
function tryParseHeredocHeader(command: string, at: number): { delimiter: string; headerEnd: number } | null {
  if (command.slice(at, at + 2) !== '<<') return null;
  let i = at + 2;
  if (command[i] === '-') i++;
  while (i < command.length && (command[i] === ' ' || command[i] === '\t')) i++;
  let quote: string | null = null;
  if (command[i] === '"' || command[i] === "'") {
    quote = command[i]!;
    i++;
  }
  const wordStart = i;
  // Unquoted delimiter: stop at whitespace, a quote, OR a shell metacharacter
  // — without this, `<<EOF;` would parse "EOF;" as the delimiter (swallowing
  // the chain operator into the word) instead of "EOF" followed by a live
  // `;`. A QUOTED delimiter (`<<"MY;DELIM"`) may legitimately contain those
  // characters, so it only stops at its own matching quote.
  const stopChars = quote ? new RegExp(quote) : /[\s'";&|#<>()]/;
  while (i < command.length && !stopChars.test(command[i]!)) i++;
  const delimiter = command.slice(wordStart, i);
  if (!delimiter) return null;
  if (quote) {
    if (command[i] !== quote) return null; // malformed quoting around the delimiter — bail, don't guess
    i++;
  }
  return { delimiter, headerEnd: i };
}

/**
 * Given a position right after a `\n` (the start of a here-doc body), finds
 * where THIS body ends: the next line that, trimmed, exactly equals
 * `delimiter`. Returns the index just past that terminator line's newline.
 * An unterminated here-doc (no matching delimiter line found) consumes to
 * end-of-string — conservative: it can only exclude MORE text from
 * matching, never less, so it cannot hide a live command outside the
 * here-doc.
 */
function findHeredocBodyEnd(command: string, bodyStart: number, delimiter: string): number {
  let pos = bodyStart;
  while (pos <= command.length) {
    const nextNewline = command.indexOf('\n', pos);
    const line = nextNewline === -1 ? command.slice(pos) : command.slice(pos, nextNewline);
    if (line.trim() === delimiter) {
      return nextNewline === -1 ? command.length : nextNewline + 1;
    }
    if (nextNewline === -1) return command.length; // unterminated
    pos = nextNewline + 1;
  }
  return command.length;
}

/**
 * Tokenize a shell command string into chain-separated segments of tokens.
 * Never throws — malformed/unterminated quotes are handled by treating the
 * rest of the string as part of the open quote (fails toward "still a
 * single reconstructed token", never toward silently dropping text).
 *
 * Here-doc handling: a `<<DELIM` header does NOT end tokenization of the
 * current line — text before AND after the header (including chained
 * commands like `; rm -rf x`) is tokenized normally. Only the BODY, from
 * the next newline through the line where `DELIM` appears alone, is
 * excluded from tokens. Multiple here-docs opened on one line have their
 * bodies consumed in order, immediately after that line ends.
 */
export function tokenizeShellCommand(command: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let tokens: CommandToken[] = [];
  let current = '';
  let currentQuoted = true; // flips to false the moment a bare char is added
  let hasContent = false;
  let pendingHeredocs: string[] = [];

  const pushToken = (): void => {
    if (hasContent) tokens.push({ text: current, quoted: currentQuoted });
    current = '';
    currentQuoted = true;
    hasContent = false;
  };
  const pushSegment = (): void => {
    pushToken();
    if (tokens.length > 0) segments.push({ tokens });
    tokens = [];
  };

  let i = 0;
  const n = command.length;
  while (i < n) {
    const ch = command[i]!;

    // A `#` at a token boundary starts a comment running to end of string.
    if (ch === '#' && !hasContent) break;

    // Here-doc HEADER: record the delimiter to be consumed at the next
    // newline, but keep tokenizing the rest of THIS line normally — the
    // header is redirection syntax, not command text, so it contributes no
    // token itself, but nothing else on the line is excluded because of it.
    const heredoc = tryParseHeredocHeader(command, i);
    if (heredoc) {
      pushToken();
      pendingHeredocs.push(heredoc.delimiter);
      i = heredoc.headerEnd;
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      hasContent = true;
      while (i < n && command[i] !== quote) {
        if (quote === '"' && command[i] === '\\' && i + 1 < n && '\\$`"'.includes(command[i + 1]!)) {
          current += command[i + 1];
          i += 2;
          continue;
        }
        current += command[i];
        i++;
      }
      i++; // consume closing quote (or end of string if unterminated)
      continue; // currentQuoted stays true unless a bare char is added elsewhere
    }

    // Backslash only acts as an escape ahead of a real shell-metacharacter
    // (space, quotes, $, `, chain operators, #). Ahead of an ORDINARY
    // character it is NOT an escape — this matters because Windows paths
    // use backslash as a literal directory separator (`C:\Program Files`),
    // and treating every backslash as "consume it, keep the next char" would
    // corrupt those paths into unrecognizable text.
    if (ch === '\\' && i + 1 < n && ESCAPABLE_CHARS.has(command[i + 1]!)) {
      current += command[i + 1];
      currentQuoted = false;
      hasContent = true;
      i += 2;
      continue;
    }

    const two = command.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      pushSegment();
      i += 2;
      continue;
    }
    if (ch === ';' || ch === '|' || ch === '&') {
      pushSegment();
      i += 1;
      continue;
    }

    if (ch === '\n' && pendingHeredocs.length > 0) {
      // End of the header line(s): consume each pending here-doc's body in
      // order, starting right after this newline. Only the body text is
      // excluded — once every pending here-doc is consumed, whatever
      // follows is a genuinely new statement (that's what real shells do
      // too: a here-doc body is delimited input for the PRECEDING command,
      // and text on the following line is the next command), so start a
      // fresh segment rather than gluing it onto whatever came before.
      pushSegment();
      let pos = i + 1;
      for (const delimiter of pendingHeredocs) {
        pos = findHeredocBodyEnd(command, pos, delimiter);
      }
      pendingHeredocs = [];
      i = pos;
      continue;
    }

    if (/\s/.test(ch)) {
      pushToken();
      i++;
      continue;
    }

    current += ch;
    currentQuoted = false;
    hasContent = true;
    i++;
  }
  pushSegment();
  return segments;
}

// ── Executable / invocation recognition ──────────────────────────────────────

/** Executables that pass through to a real command — skipped when
 *  resolving "what program does this segment actually invoke". */
const WRAPPER_EXECUTABLES = new Set(['sudo', 'env', 'command']);

/** True for a bare token that looks like an option (`-x`, `--xyz`) or an
 *  env-style assignment (`FOO=bar`) — the shapes `resolveInvocation` skips
 *  past when unwrapping a wrapper executable's own arguments. */
function looksLikeWrapperOption(text: string): boolean {
  return text.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(text);
}

export interface ResolvedInvocation {
  /** Normalized, lowercased executable name (path/extension stripped, and
   *  any leading sudo/env/command wrapper unwrapped). */
  executable: string;
  /** Index of the resolved executable's token within the segment. */
  index: number;
}

/**
 * Finds the real invoked executable in a segment, skipping any leading
 * `sudo`/`env`/`command` wrapper (and that wrapper's own options/assignments)
 * so `sudo env rm -rf x` resolves to `rm`, not `sudo`. Returns null when the
 * segment is empty or its first live position is a fully-quoted token (a
 * command name can never itself be entirely quoted content).
 */
export function resolveInvocation(segment: CommandSegment): ResolvedInvocation | null {
  const tokens = segment.tokens;
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (tok.quoted) return null;
    const name = normalizeExecutableName(tok.text).toLowerCase();
    if (!WRAPPER_EXECUTABLES.has(name)) break;
    i++;
    while (i < tokens.length && !tokens[i]!.quoted && looksLikeWrapperOption(tokens[i]!.text)) i++;
  }
  if (i >= tokens.length || tokens[i]!.quoted) return null;
  return { executable: normalizeExecutableName(tokens[i]!.text).toLowerCase(), index: i };
}

/**
 * Executables whose flag (as the key's value set) takes the SINGLE
 * following token as a string of further command/SQL text — recognized so
 * that a quoted payload to `bash -c "..."` or `psql -c "..."` is treated as
 * live text to recursively analyze, not inert quoted content. Flag lookups
 * are case-insensitive (the token text is lowercased before comparison).
 */
const STRING_PAYLOAD_FLAGS: Record<string, Set<string>> = {
  bash: new Set(['-c']),
  sh: new Set(['-c']),
  zsh: new Set(['-c']),
  ksh: new Set(['-c']),
  dash: new Set(['-c']),
  cmd: new Set(['/c']),
  powershell: new Set(['-command']),
  pwsh: new Set(['-command']),
  psql: new Set(['-c', '--command']),
  mysql: new Set(['-e', '--execute']),
};

/**
 * If `invocation`'s executable is a recognized interpreter/database-client
 * AND one of its recognized string-payload flags appears later in this
 * segment, returns the reconstructed literal text of the token immediately
 * after that flag — regardless of whether that token is quoted, since this
 * is exactly the narrow case where quoted content is live, not inert.
 * Returns null when there's no recognized flag or no following token.
 */
export function findStringPayload(segment: CommandSegment, invocation: ResolvedInvocation): string | null {
  const flags = STRING_PAYLOAD_FLAGS[invocation.executable];
  if (!flags) return null;
  const tokens = segment.tokens;
  for (let i = invocation.index + 1; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (!tok.quoted && flags.has(tok.text.toLowerCase())) {
      const next = tokens[i + 1];
      return next ? next.text : null;
    }
  }
  return null;
}

// ── Bounded recursive analysis ────────────────────────────────────────────────

export interface CommandAnalysis {
  /** All segments across the top-level command AND every recursively
   *  analyzed interpreter/database-client payload, flattened into one list. */
  segments: CommandSegment[];
  /**
   * True when a recognized interpreter/database-client payload could not be
   * fully analyzed because it exceeded MAX_ANALYSIS_DEPTH or
   * MAX_PAYLOAD_LENGTH. Every matcher below treats an ambiguous analysis as
   * a match — we cannot rule out a hidden dangerous payload, so the
   * conservative (fail-closed) answer is to flag it.
   */
  ambiguous: boolean;
}

/** Recursion bound for nested interpreter/database-client payloads
 *  (`bash -c "psql -c '...'"` is depth 2). Deep enough for realistic nesting,
 *  shallow enough to bound worst-case work on adversarial input. */
const MAX_ANALYSIS_DEPTH = 3;
/** Size bound (characters) on a single payload before it's treated as
 *  unanalyzable (ambiguous) rather than recursed into. */
const MAX_PAYLOAD_LENGTH = 4096;

/**
 * Tokenizes `command` and recursively re-analyzes any interpreter/database-
 * client string payload found in it (see findStringPayload), bounded by
 * MAX_ANALYSIS_DEPTH and MAX_PAYLOAD_LENGTH. Never invokes an actual shell —
 * this is pure string analysis, deterministic on any platform.
 */
export function analyzeCommand(command: string, depth = 0): CommandAnalysis {
  const segments = tokenizeShellCommand(command);
  const allSegments: CommandSegment[] = [...segments];
  let ambiguous = false;

  for (const segment of segments) {
    const invocation = resolveInvocation(segment);
    if (!invocation) continue;
    const payload = findStringPayload(segment, invocation);
    if (payload === null) continue;
    if (depth >= MAX_ANALYSIS_DEPTH || payload.length > MAX_PAYLOAD_LENGTH) {
      ambiguous = true;
      continue;
    }
    const nested = analyzeCommand(payload, depth + 1);
    allSegments.push(...nested.segments);
    if (nested.ambiguous) ambiguous = true;
  }

  return { segments: allSegments, ambiguous };
}

// ── Phrase matching ───────────────────────────────────────────────────────────

/** Known global flags (per executable) that take a following value token,
 *  skipped ALONG WITH their value when matching a phrase across them —
 *  e.g. `git -C ./repo push` must still match the phrase "git push". Flags
 *  not listed here (or for executables not listed here) are still skipped,
 *  just without consuming an extra value token (a boolean-style flag like
 *  `npm --silent publish`). */
const VALUE_TAKING_GLOBAL_FLAGS: Record<string, Set<string>> = {
  git: new Set(['-c', '-C']),
};

function isFlagToken(text: string): boolean {
  return text.length > 1 && text[0] === '-';
}

/**
 * Does `phrase` (a plain-text, space-separated pattern like "rm -rf" or
 * "npm publish") appear as a run of BARE tokens in this segment, starting
 * at some executable-shaped token and reaching every later phrase word —
 * skipping over any flag-shaped tokens (and, for a small set of known
 * executables, that flag's value token) in between? Quoted tokens can never
 * participate in a match, so a phrase appearing only inside a quoted
 * argument (echo "npm publish", git commit -m "...mentions rm -rf...")
 * never matches. The first word of the run is compared with
 * executable-name normalization (path/extension stripped) so
 * `C:\nodejs\npm.cmd publish` still matches a configured "npm publish", and
 * a leading wrapper (`sudo git push`) is naturally handled by trying every
 * start position, not just position 0.
 */
export function segmentMatchesPhrase(segment: CommandSegment, phrase: string): boolean {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const tokens = segment.tokens;

  for (let start = 0; start < tokens.length; start++) {
    const first = tokens[start]!;
    if (first.quoted) continue;
    if (normalizeExecutableName(first.text).toLowerCase() !== words[0]) continue;
    if (words.length === 1) return true;

    const execName = words[0]!;
    let pos = start + 1;
    let wordIdx = 1;
    let ok = true;
    while (wordIdx < words.length) {
      while (
        pos < tokens.length &&
        !tokens[pos]!.quoted &&
        isFlagToken(tokens[pos]!.text) &&
        tokens[pos]!.text.toLowerCase() !== words[wordIdx]
      ) {
        const flagText = tokens[pos]!.text.toLowerCase();
        pos++;
        if (VALUE_TAKING_GLOBAL_FLAGS[execName!]?.has(flagText) && pos < tokens.length && !tokens[pos]!.quoted) {
          pos++; // also skip this flag's value token
        }
      }
      const tok = tokens[pos];
      if (!tok || tok.quoted || tok.text.toLowerCase() !== words[wordIdx]) {
        ok = false;
        break;
      }
      pos++;
      wordIdx++;
    }
    if (ok) return true;
  }
  return false;
}

/**
 * Fallback reconstruction for patterns that don't decompose into clean,
 * whitespace-separated words — e.g. an exact shell-syntax signature like the
 * fork-bomb pattern `:(){:|:&};:`, which is built entirely from the same
 * characters (`;`, `&`, `|`) the segment tokenizer above treats as chain
 * operators. Word-shaped patterns never reach this path (see
 * `commandMatchesPhrase`), so it cannot reopen the quote-adjacency bypass
 * the tokenizer fixes for normal commands — it exists solely so patterns
 * that are themselves shell metacharacters don't regress to undetectable.
 * Blanks whole quoted spans (does not reconstruct mixed quoted/bare
 * characters) — a narrower, documented trade-off acceptable only because
 * this path is reserved for exact-syntax signatures, not word phrases.
 */
function blankQuotedSpans(command: string): string {
  let out = '';
  let i = 0;
  const n = command.length;
  while (i < n) {
    const ch = command[i]!;
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n && command[i] !== quote) {
        if (command[i] === '\\') i++;
        i++;
      }
      i++;
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** True when every whitespace-split word of `phrase` contains at least one
 *  shell metacharacter that the segment tokenizer treats as a chain
 *  operator or grouping character — i.e. `phrase` is an exact-syntax
 *  signature (fork bomb, etc.), not a natural word-based command phrase. */
function isExoticSyntaxPattern(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.some((w) => /[;&|(){}]/.test(w));
}

/**
 * Does `phrase` match any segment of the full (possibly chained, possibly
 * nested-via-interpreter-payload) command? Primary check is the token/
 * segment matcher above (quote-adjacency-safe, Windows-executable-aware,
 * global-flag-skip-aware, ignores purely decorative quoted content) run
 * over every segment `analyzeCommand` produces, including segments from
 * recursively-analyzed interpreter/database-client payloads. An ambiguous
 * analysis (a payload too deep or too large to safely recurse into) is
 * treated as a match — conservative, since we can't rule out a hidden one.
 * For patterns that are themselves shell metacharacters and so cannot
 * decompose into segment tokens (see `isExoticSyntaxPattern`), falls back
 * to a quote-blanked substring check so exact-syntax signatures are still
 * caught.
 */
export function commandMatchesPhrase(command: string, phrase: string): boolean {
  const { segments, ambiguous } = analyzeCommand(command);
  if (segments.some((seg) => segmentMatchesPhrase(seg, phrase))) return true;
  if (ambiguous) return true;
  if (!isExoticSyntaxPattern(phrase)) return false;
  return blankQuotedSpans(command).toLowerCase().includes(phrase.trim().toLowerCase());
}

// ── Delete / git-push / database-write ────────────────────────────────────────

/**
 * Does this command invoke `rm` (any path/wrapper form: `rm`, `/bin/rm`,
 * `sudo rm`, `env rm`, `command rm`) with a real target — i.e. anything
 * other than `--help`/`-h`? Runs over every segment `analyzeCommand`
 * produces (including recursively-analyzed interpreter payloads), and
 * treats an ambiguous analysis as a match.
 */
export function commandInvokesDelete(command: string): boolean {
  const { segments, ambiguous } = analyzeCommand(command);
  if (ambiguous) return true;
  for (const segment of segments) {
    const invocation = resolveInvocation(segment);
    if (!invocation || invocation.executable !== 'rm') continue;
    const rest = segment.tokens.slice(invocation.index + 1).filter((t) => !t.quoted);
    if (rest.length === 0) continue;
    const onlyHelp = rest.every((t) => {
      const lower = t.text.toLowerCase();
      return lower === '--help' || lower === '-h';
    });
    if (!onlyHelp) return true;
  }
  return false;
}

/**
 * Does this command invoke `git push` — including through a leading wrapper
 * (`sudo git push`), a quote-adjacency bypass (`g"it" push`), or a global
 * flag between `git` and `push` (`git -C ./repo push origin main`)?
 */
export function commandInvokesGitPush(command: string): boolean {
  const { segments, ambiguous } = analyzeCommand(command);
  if (ambiguous) return true;
  return segments.some((segment) => segmentMatchesPhrase(segment, 'git push'));
}

const DATABASE_WRITE_PATTERNS = [/\bdrop\s+table\b/i, /\bdelete\s+from\b/i, /\btruncate\s+/i, /\balter\s+table\b/i];

/**
 * Does this command contain a live (non-quoted) database-write keyword —
 * either as bare text directly in a segment, or inside a recognized
 * database-client string payload (`psql -c "DROP TABLE users"`,
 * `mysql -e "DELETE FROM users"`), recursively? A quoted argument to a
 * command that ISN'T a recognized database client or shell interpreter
 * (`echo "DROP TABLE users"`) stays inert — its text is never scanned.
 */
export function commandInvokesDatabaseWrite(command: string): boolean {
  const { segments, ambiguous } = analyzeCommand(command);
  if (ambiguous) return true;
  for (const segment of segments) {
    const liveText = segment.tokens
      .filter((t) => !t.quoted)
      .map((t) => t.text)
      .join(' ');
    if (DATABASE_WRITE_PATTERNS.some((re) => re.test(liveText))) return true;
  }
  return false;
}
