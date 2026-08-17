// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Untrusted-text handling for anything that leaves an agent document.
 *
 * Agent Markdown is user-supplied content that ends up in generated adapters,
 * terminal output, webviews, and JSON reports. Three separate hazards, handled
 * here so no call site has to remember all three:
 *
 *   1. **Structure breaking** — a description containing a comment terminator,
 *      a fence, or a `THESMOS:GENERATED` marker could close a generated section
 *      early and splice author-controlled text into governance instructions.
 *   2. **Terminal / webview injection** — ANSI escapes and control characters
 *      reaching a TTY or a webview.
 *   3. **Secret leakage** — keys and tokens serialized into contracts, hashes,
 *      validation reports, or handoffs.
 *
 * Credential shapes are held as pattern *strings*, mirroring
 * `CONFIG_DEFAULTS.secretPatterns` in `config.ts` — the repo's canonical list —
 * so this module adds coverage without becoming a second source of truth.
 * `council/sanitize.test.ts` asserts the two lists cannot drift apart.
 *
 * Control characters are referenced by code point via `String.fromCharCode`
 * rather than written as escapes: a literal control byte in this file would be
 * invisible to review, which is the exact failure mode the module exists to
 * prevent.
 */

// ── Control characters ────────────────────────────────────────────────────────

const CHAR_BELL = String.fromCharCode(7);
const CHAR_ESC = String.fromCharCode(27);

/** ANSI CSI (`ESC [ … final`) and OSC (`ESC ] … BEL|ESC \`) sequences. */
const ANSI_SEQUENCE_RE = new RegExp(
  `${CHAR_ESC}\\[[0-9;?]*[ -/]*[@-~]` +
    `|${CHAR_ESC}\\][^${CHAR_BELL}]*(?:${CHAR_BELL}|${CHAR_ESC}\\\\)`,
  'g'
);

/**
 * True for C0/C1 control code points. Tab, newline, and carriage return are
 * excluded — they are legitimate in a document and get collapsed to spaces by
 * the whitespace pass rather than deleted outright.
 */
function isControlCodePoint(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Replace every control character with `replacement`. */
export function stripControlChars(input: string, replacement = ''): string {
  let out = '';
  for (const char of input) {
    const code = char.codePointAt(0) ?? 0;
    out += isControlCodePoint(code) ? replacement : char;
  }
  return out;
}

// ── Text sanitization ─────────────────────────────────────────────────────────

const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const HTML_COMMENT_RE = /<!--|--!?>/g;
const MARKER_RE = /THESMOS:(GENERATED|META|MANAGED)/gi;
const FENCE_RE = /`{3,}/g;

export const SANITIZE_LIMITS = {
  description: 400,
  displayName: 120,
  short: 80,
} as const;

/**
 * Make an untrusted string safe to embed in Markdown, JSON, and terminal output.
 * Single-line by construction: newlines are collapsed so a description can never
 * introduce headings, list items, or table rows into a generated document.
 */
export function sanitizeText(raw: unknown, maxLength: number = SANITIZE_LIMITS.description): string {
  if (typeof raw !== 'string') return '';
  let text = stripControlChars(raw.replace(ANSI_SEQUENCE_RE, ' '), ' ')
    .replace(HTML_COMMENT_RE, ' ')
    .replace(HTML_TAG_RE, ' ')
    .replace(MARKER_RE, 'THESMOS_')
    .replace(FENCE_RE, ' ')
    .replace(/^\s*[#>|\-*]+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Strip a symmetric pair of surrounding quotes left by the frontmatter parser.
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      text = text.slice(1, -1).trim();
    }
  }

  if (text.length > maxLength) {
    text = `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }
  return text;
}

/** Sanitize a token-ish value (tag, capability, provider). Lower-cased, kebab-safe. */
export function sanitizeToken(raw: unknown, maxLength: number = SANITIZE_LIMITS.short): string {
  if (typeof raw !== 'string') return '';
  return stripControlChars(raw.replace(ANSI_SEQUENCE_RE, ''))
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._@/+-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
}

/** Deduplicate, drop empties, sort — the canonical form for every string list. */
export function normalizeStringList(values: unknown, limit = 64): string[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<string>();
  for (const value of values) {
    const token = sanitizeToken(value);
    if (token) out.add(token);
    if (out.size >= limit) break;
  }
  return [...out].sort();
}

// ── Secret redaction ──────────────────────────────────────────────────────────

/**
 * Credential shapes, as regex source strings.
 *
 * This is a superset of `CONFIG_DEFAULTS.secretPatterns`: the config list is
 * what the scanner enforces on a repo, and this list is what Thesmos refuses to
 * *emit* about itself. Emission is the stricter side of the boundary — a report
 * gets pasted into issues and chat logs — so it also covers the vendor prefixes
 * the scanner list leaves to project configuration.
 */
export const DEFAULT_REDACTION_PATTERNS: readonly string[] = [
  '-----BEGIN[^-]{0,40}PRIVATE KEY-----[\\s\\S]*?-----END[^-]{0,40}PRIVATE KEY-----',
  // Trigger matches the scanner's JWT pattern exactly (prefix + 20 chars + dot);
  // the trailing class then consumes the payload and signature so redaction
  // removes the whole token rather than its header.
  'eyJ[a-zA-Z0-9+/_-]{20,}={0,2}\\.[A-Za-z0-9+/_=.-]*',
  'sk-[a-zA-Z0-9-]{20,}',
  'sk-[A-Za-z0-9_-]{16,}',
  'gh[pousr]_[A-Za-z0-9]{16,}',
  'github_pat_[A-Za-z0-9_]{20,}',
  'AKIA[0-9A-Z]{16}',
  'AIza[0-9A-Za-z_-]{20,}',
  'xox[baprs]-[A-Za-z0-9-]{10,}',
  'AAAA[0-9A-Za-z+/]{40,}',
  'Bearer\\s+[A-Za-z0-9._-]{16,}',
  'secret_access_key\\s*[:=]\\s*[A-Za-z0-9/+]{20,}',
  '(?:api[_-]?key|apikey|secret|passwd|password|token|access[_-]?key)\\s*[:=]\\s*["\']?[^\\s"\',;]{8,}',
];

export const REDACTION_PLACEHOLDER = '[redacted]';

function compilePatterns(patterns: readonly string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const source of patterns) {
    try {
      out.push(new RegExp(source, 'gi'));
    } catch {
      // A malformed configured pattern must not break redaction for the rest.
    }
  }
  return out;
}

/** True when the text contains something shaped like a credential. */
export function containsSecretLike(
  text: string,
  patterns: readonly string[] = DEFAULT_REDACTION_PATTERNS
): boolean {
  if (typeof text !== 'string' || text === '') return false;
  return compilePatterns(patterns).some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/** Replace credential-shaped substrings with a fixed placeholder. */
export function redactSecrets(
  text: string,
  patterns: readonly string[] = DEFAULT_REDACTION_PATTERNS
): string {
  if (typeof text !== 'string' || text === '') return '';
  let out = text;
  for (const re of compilePatterns(patterns)) {
    re.lastIndex = 0;
    out = out.replace(re, REDACTION_PLACEHOLDER);
  }
  return out;
}

// ── Machine-path redaction ────────────────────────────────────────────────────

const HOME_PATH_RES: readonly RegExp[] = [
  /\/(?:Users|home)\/[^/\s:"']+/g,
  /[A-Za-z]:[\\/]Users[\\/][^\\/\s:"']+/g,
  /\/var\/folders\/[^\s:"']+/g,
];

/**
 * Strip absolute machine paths. A contract or handoff that names
 * `/Users/<person>/…` leaks the operator's identity and local layout into every
 * report it is pasted into; the repo-relative form is what actually reviews.
 */
export function redactAbsolutePaths(text: string, root?: string): string {
  if (typeof text !== 'string' || text === '') return '';
  let out = text;
  if (root && root.length > 1) {
    const forwardRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (forwardRoot.length > 1) {
      out = out.split(`${forwardRoot}/`).join('').split(forwardRoot).join('.');
    }
  }
  for (const re of HOME_PATH_RES) {
    re.lastIndex = 0;
    out = out.replace(re, '~');
  }
  return out;
}

/** Full outbound scrub: secrets first, then machine paths. */
export function scrubForOutput(text: string, root?: string): string {
  return redactAbsolutePaths(redactSecrets(text), root);
}

// ── Repo-relative source paths ────────────────────────────────────────────────

/**
 * Convert any path to a repo-relative, forward-slash form suitable for
 * provenance. Absolute paths outside the root degrade to their basename rather
 * than leaking the surrounding directory structure.
 */
export function toProvenancePath(rawPath: string, root?: string): string {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') return '';
  let p = stripControlChars(rawPath.replace(/\\/g, '/'));
  if (root) {
    const forwardRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (forwardRoot && p.startsWith(`${forwardRoot}/`)) {
      p = p.slice(forwardRoot.length + 1);
    }
  }
  if (/^([a-zA-Z]:)?\//.test(p)) {
    // A path outside the repo still carries useful provenance — *where* it came
    // from matters when an external agent shadows a managed one. What must not
    // survive is the operator's identity, so a home path keeps its shape with
    // the username replaced, and anything else degrades to its basename rather
    // than exposing an arbitrary machine layout.
    const homeRelative = redactAbsolutePaths(p);
    if (homeRelative.startsWith('~/')) return homeRelative;
    const segments = p.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? '';
  }
  return p.replace(/^\.\/+/, '');
}
