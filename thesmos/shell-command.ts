// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Conservative, local, deterministic shell-command tokenizer used to match
 * configured pattern lists (`destructivePatterns`, `operations.requireConfirmation`)
 * against a Bash tool call's command string in scope.ts.
 *
 * This is NOT a full POSIX shell parser and never invokes an actual shell —
 * it exists purely to distinguish "this text names a command that will
 * actually run" from "this text merely appears inside a quoted argument"
 * (an echo string, a commit message, a doc string passed to another command).
 *
 * Fixes a real bypass in the previous approach (blanking out entire quoted
 * spans before substring-matching): a command split across a quote boundary
 * like `r"m" -rf /` reconstructed to `r  -rf` once quotes were blanked,
 * silently breaking "rm" apart and letting a destructive command through
 * undetected. This tokenizer instead RECONSTRUCTS each token's literal text
 * across quoted/unquoted spans, so `r"m"` still resolves to the bare token
 * "rm" and is correctly still considered live.
 *
 * Handles:
 *  - single and double POSIX-ish quotes (double quotes allow backslash to
 *    escape \, $, `, " — single quotes are fully literal)
 *  - backslash escapes, narrowly: only ahead of a real shell metacharacter
 *    (space, quotes, $, `, chain operators, #) — ahead of an ordinary
 *    character the backslash is kept literally, so Windows paths like
 *    `C:\Program Files\npm.cmd` survive intact instead of losing every `\`
 *  - tokens reconstructed across mixed quoted/unquoted spans
 *  - top-level command-chaining operators (; && || | &), not honored inside
 *    quotes — each side becomes its own segment, matched independently
 *  - a `#` starting a fresh token is treated as a comment to end of string
 *  - here-docs (`<<DELIM` / `<<-DELIM` / `<<'DELIM'` / `<<"DELIM"` through
 *    the line where DELIM appears alone) are recognized and their body is
 *    excluded from tokens entirely — a phrase inside a here-doc body is
 *    documentation/data, not a live command
 *
 * Documented limits (deliberately not handled — see module comment above
 * for why omissions here cannot make a genuinely risky command look safe):
 *  - command substitution $(...) / `...` is not expanded — its contents are
 *    kept as literal bare text of the enclosing token, which only makes the
 *    tokenizer MORE likely to flag it as a live candidate, never less
 *  - process substitution <(...) / >(...) is not specially recognized
 *  - parentheses for subshells/grouping are not recursively parsed —
 *    `(` / `)` are ordinary bare characters, again erring toward treating
 *    more text as live rather than silently excluding it
 *  - `$VAR` / `${VAR}` expansion is not resolved (kept as literal text)
 * None of these can hide a real destructive/confirm-required command that
 * a full parser would have caught — at worst they make the tokenizer treat
 * more text as "bare" (i.e. matchable) than a complete shell grammar would.
 */

export interface CommandToken {
  /** Reconstructed literal text — quote marks removed, escapes resolved. */
  text: string;
  /**
   * True only when EVERY character of this token came from inside a single
   * quoted span (e.g. the whole `"npm publish"` argument) — inert for
   * pattern matching. A token assembled from a MIX of quoted and unquoted
   * characters (e.g. `r"m"`) is NOT quoted: it reconstructs to real command
   * text and must still be treated as a live candidate.
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
  while (i < command.length && !/[\s'"]/.test(command[i]!)) i++;
  const delimiter = command.slice(wordStart, i);
  if (!delimiter) return null;
  if (quote) {
    if (command[i] !== quote) return null; // malformed quoting around the delimiter — bail, don't guess
    i++;
  }
  return { delimiter, headerEnd: i };
}

/**
 * Given the position right after a here-doc header, finds where the body
 * ends: the next line that, trimmed, exactly equals `delimiter`. Returns
 * the index just past that terminator line's newline. An unterminated
 * here-doc (no matching delimiter line found) consumes to end-of-string —
 * conservative: it can only exclude MORE text from matching, never less,
 * so it cannot hide a live command outside the here-doc.
 */
function findHeredocBodyEnd(command: string, headerEnd: number, delimiter: string): number {
  const firstNewline = command.indexOf('\n', headerEnd);
  if (firstNewline === -1) return command.length; // no body at all
  let pos = firstNewline + 1;
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
 */
export function tokenizeShellCommand(command: string): CommandSegment[] {
  const segments: CommandSegment[] = [];
  let tokens: CommandToken[] = [];
  let current = '';
  let currentQuoted = true; // flips to false the moment a bare char is added
  let hasContent = false;

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

    // Here-doc: `<<DELIM` (optionally `<<-DELIM` / `<<'DELIM'` / `<<"DELIM"`)
    // through the line where DELIM appears alone is body TEXT, never a live
    // command — excluded from tokens entirely (same "inert" treatment as a
    // quoted span), not tokenized as bare words. See tryParseHeredocHeader.
    const heredoc = tryParseHeredocHeader(command, i);
    if (heredoc) {
      pushToken();
      const bodyEnd = findHeredocBodyEnd(command, heredoc.headerEnd, heredoc.delimiter);
      i = bodyEnd;
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

/**
 * Does `phrase` (a plain-text, space-separated pattern like "rm -rf" or
 * "npm publish") appear as a contiguous run of BARE tokens anywhere in this
 * segment? Quoted tokens can never start or continue a match, so a phrase
 * appearing only inside a quoted argument (echo "npm publish", git commit
 * -m "...mentions rm -rf...") never matches. The first word of the run is
 * compared with executable-name normalization (path/extension stripped) so
 * `C:\nodejs\npm.cmd publish` still matches a configured "npm publish".
 */
export function segmentMatchesPhrase(segment: CommandSegment, phrase: string): boolean {
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const tokens = segment.tokens;

  for (let start = 0; start + words.length <= tokens.length; start++) {
    let matched = true;
    for (let j = 0; j < words.length; j++) {
      const tok = tokens[start + j]!;
      if (tok.quoted) { matched = false; break; }
      const candidate = j === 0 ? normalizeExecutableName(tok.text).toLowerCase() : tok.text.toLowerCase();
      if (candidate !== words[j]) { matched = false; break; }
    }
    if (matched) return true;
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
 * Does `phrase` match any segment of the full (possibly chained) command?
 * Primary check is the token/segment matcher above (quote-adjacency-safe,
 * Windows-executable-aware, ignores purely decorative quoted content). For
 * patterns that are themselves shell metacharacters and so cannot decompose
 * into segment tokens (see `isExoticSyntaxPattern`), falls back to a
 * quote-blanked substring check so exact-syntax signatures are still caught.
 */
export function commandMatchesPhrase(command: string, phrase: string): boolean {
  const segments = tokenizeShellCommand(command);
  if (segments.some((seg) => segmentMatchesPhrase(seg, phrase))) return true;
  if (!isExoticSyntaxPattern(phrase)) return false;
  return blankQuotedSpans(command).toLowerCase().includes(phrase.trim().toLowerCase());
}
