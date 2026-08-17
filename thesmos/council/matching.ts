// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Pure normalization and glob matching for permission targets.
 *
 * Two properties matter more than convenience here:
 *
 * 1. **Host independence.** A contract tested on macOS must resolve the same
 *    way on Windows and Linux. Nothing in this file consults `node:path`,
 *    `process.platform`, or the filesystem — separators, drive letters, and
 *    case folding are handled explicitly.
 * 2. **No shell.** Command rules are matched as *text*. Nothing here splits on
 *    shell metacharacters, expands variables, or executes anything.
 */

// ── Codes ─────────────────────────────────────────────────────────────────────

export type PatternRejection =
  | 'empty'
  | 'control-character'
  | 'too-long'
  | 'too-many-segments'
  | 'segment-too-long'
  | 'too-many-globstars'
  | 'traversal';

/**
 * Bounds that keep matching predictably cheap.
 *
 * `maxSegmentLength` is the one that is not obvious: within a segment, `*`
 * matching backtracks, so a very long pattern segment against a very long
 * target segment is quadratic. Capping both ends caps the product, which means
 * no contract — however hostile its patterns — can make resolution expensive.
 */
export const MATCH_LIMITS = {
  maxPatternLength: 512,
  maxTargetLength: 4096,
  maxSegments: 64,
  maxSegmentLength: 256,
  maxGlobstars: 8,
} as const;

// ── Path normalization ────────────────────────────────────────────────────────

export interface NormalizedPath {
  /** Canonical forward-slash form. Absolute paths keep a leading `/`. */
  path: string;
  /** Lower-cased form used for restrictive (deny/ask) matching. */
  folded: string;
  absolute: boolean;
}

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

/**
 * Normalize a repo path or absolute path for matching.
 *
 * Windows forms are folded into the POSIX shape *before* any rule is consulted:
 * `C:\Repo\src` and `c:/repo/SRC` and `\\?\C:\Repo\src` all reduce to the same
 * canonical string, so a deny written in POSIX form cannot be side-stepped by
 * writing the target in Windows form.
 */
export function normalizeMatchPath(
  raw: string
): { ok: true; value: NormalizedPath } | { ok: false; reason: PatternRejection } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'empty' };
  if (raw.length > MATCH_LIMITS.maxTargetLength) return { ok: false, reason: 'too-long' };
  if (CONTROL_CHAR_RE.test(raw)) return { ok: false, reason: 'control-character' };

  let s = raw.replace(/\\/g, '/');

  // Strip Windows extended-length / UNC device prefixes (\\?\, \\.\).
  s = s.replace(/^\/\/[?.]\//, '');

  let absolute = false;
  let drive = '';

  const driveMatch = /^([a-zA-Z]):(\/|$)/.exec(s);
  if (driveMatch) {
    drive = `${driveMatch[1]!.toLowerCase()}:`;
    s = s.slice(driveMatch[1]!.length + 1);
    absolute = true;
  }
  if (s.startsWith('/')) {
    absolute = true;
  }

  const segments: string[] = [];
  for (const segment of s.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return { ok: false, reason: 'traversal' };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (segments.length > MATCH_LIMITS.maxSegments) {
    return { ok: false, reason: 'too-many-segments' };
  }
  if (segments.some((s) => s.length > MATCH_LIMITS.maxSegmentLength)) {
    return { ok: false, reason: 'segment-too-long' };
  }

  const body = segments.join('/');
  const path = absolute ? `${drive}/${body}` : body;
  if (path === '' || path === '/') {
    // The repo root itself is a legitimate target only in absolute form.
    if (!absolute) return { ok: false, reason: 'empty' };
  }
  return { ok: true, value: { path, folded: path.toLowerCase(), absolute } };
}

/** Normalize a glob pattern. Same folding as targets, but `*`/`?` survive. */
export function normalizeMatchPattern(
  raw: string
): { ok: true; value: NormalizedPath } | { ok: false; reason: PatternRejection } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'empty' };
  if (raw.length > MATCH_LIMITS.maxPatternLength) return { ok: false, reason: 'too-long' };
  if (CONTROL_CHAR_RE.test(raw)) return { ok: false, reason: 'control-character' };

  let s = raw.replace(/\\/g, '/').replace(/^\/\/[?.]\//, '');

  let absolute = false;
  let drive = '';
  const driveMatch = /^([a-zA-Z]):(\/|$)/.exec(s);
  if (driveMatch) {
    drive = `${driveMatch[1]!.toLowerCase()}:`;
    s = s.slice(driveMatch[1]!.length + 1);
    absolute = true;
  }
  if (s.startsWith('/')) absolute = true;

  const segments: string[] = [];
  for (const segment of s.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return { ok: false, reason: 'traversal' };
    // Collapse `**/**` — repeated globstars change nothing but cost matcher work.
    if (segment === '**' && segments[segments.length - 1] === '**') continue;
    segments.push(segment);
  }
  if (segments.length === 0) return { ok: false, reason: 'empty' };
  if (segments.length > MATCH_LIMITS.maxSegments) return { ok: false, reason: 'too-many-segments' };
  if (segments.some((s) => s.length > MATCH_LIMITS.maxSegmentLength)) {
    return { ok: false, reason: 'segment-too-long' };
  }
  if (segments.filter((x) => x === '**').length > MATCH_LIMITS.maxGlobstars) {
    return { ok: false, reason: 'too-many-globstars' };
  }

  const body = segments.join('/');
  const path = absolute ? `${drive}/${body}` : body;
  return { ok: true, value: { path, folded: path.toLowerCase(), absolute } };
}

/**
 * Patterns that put the entire tree in scope. Broad *restrictions* are fine —
 * broad *grants* are what needs deliberate justification.
 */
export function isBroadPattern(pattern: string): boolean {
  const normalized = normalizeMatchPattern(pattern);
  if (!normalized.ok) return false;
  const p = normalized.value.path;
  return p === '**' || p === '*' || p === '**/*' || p === '/**' || p === '/*' || p === '**/**';
}

// ── Glob matching ─────────────────────────────────────────────────────────────

function segmentMatches(pattern: string, segment: string): boolean {
  // Iterative wildcard match over one segment: `*` (any run) and `?` (one char).
  let p = 0;
  let s = 0;
  let starP = -1;
  let starS = 0;
  while (s < segment.length) {
    const pc = pattern[p];
    if (p < pattern.length && (pc === '?' || pc === segment[s])) {
      p++;
      s++;
    } else if (p < pattern.length && pc === '*') {
      starP = p;
      starS = s;
      p++;
    } else if (starP !== -1) {
      p = starP + 1;
      starS++;
      s = starS;
    } else {
      return false;
    }
  }
  while (pattern[p] === '*') p++;
  return p === pattern.length;
}

/**
 * Segment-wise glob match. `**` spans zero or more segments; `*` and `?` never
 * cross a `/`. Dynamic-programming table — linear in pattern × target segments,
 * with no regex construction from author input (so no catastrophic backtracking).
 */
function globSegmentsMatch(patternSegs: string[], targetSegs: string[]): boolean {
  const rows = patternSegs.length + 1;
  const cols = targetSegs.length + 1;
  // dp[i][j] — first i pattern segments match first j target segments.
  const dp: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  dp[0]![0] = true;
  for (let i = 1; i < rows; i++) {
    dp[i]![0] = dp[i - 1]![0]! && patternSegs[i - 1] === '**';
  }
  for (let i = 1; i < rows; i++) {
    const pseg = patternSegs[i - 1]!;
    for (let j = 1; j < cols; j++) {
      if (pseg === '**') {
        dp[i]![j] = dp[i - 1]![j]! || dp[i]![j - 1]!;
      } else {
        dp[i]![j] = dp[i - 1]![j - 1]! && segmentMatches(pseg, targetSegs[j - 1]!);
      }
    }
  }
  return dp[rows - 1]![cols - 1]!;
}

/**
 * Match a normalized target against a normalized pattern.
 *
 * `caseInsensitive` is not a convenience flag — it is the Windows-safety lever.
 * Restrictive rules (deny/ask) match case-insensitively so that `SRC/App.env`
 * cannot slip past `deny src/*.env` on a case-insensitive filesystem, while
 * permissive rules (allow) match exactly so case folding can never *widen* a
 * grant.
 */
export function matchesPattern(
  target: NormalizedPath,
  pattern: NormalizedPath,
  caseInsensitive: boolean
): boolean {
  const t = caseInsensitive ? target.folded : target.path;
  const p = caseInsensitive ? pattern.folded : pattern.path;
  if (p === t) return true;

  const patternSegs = p.split('/').filter((x) => x !== '');
  const targetSegs = t.split('/').filter((x) => x !== '');

  // An absolute pattern only ever matches an absolute target, and vice versa.
  if (pattern.absolute !== target.absolute) {
    // `**` is the one pattern that spans both shapes.
    if (!(patternSegs.length === 1 && patternSegs[0] === '**')) return false;
  }
  return globSegmentsMatch(patternSegs, targetSegs);
}

// ── Command normalization ─────────────────────────────────────────────────────

export interface NormalizedCommand {
  /** Whitespace-collapsed original. */
  command: string;
  folded: string;
  /** First token, quotes stripped — the executable as written. Never resolved. */
  executable: string;
}

/**
 * Normalize a command line for *textual* matching.
 *
 * Deliberately not a shell parser: no quoting rules, no variable expansion, no
 * operator splitting. A contract that wants to reason about `a && b` must say
 * so in its patterns; Thesmos will not silently decide what a shell would do.
 */
export function normalizeCommand(
  raw: string
): { ok: true; value: NormalizedCommand } | { ok: false; reason: PatternRejection } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'empty' };
  if (raw.length > MATCH_LIMITS.maxTargetLength) return { ok: false, reason: 'too-long' };
  if (CONTROL_CHAR_RE.test(raw)) return { ok: false, reason: 'control-character' };
  const command = raw.trim().replace(/\s+/g, ' ');
  const firstToken = command.split(' ')[0] ?? '';
  const executable = firstToken.replace(/^["']|["']$/g, '');
  return { ok: true, value: { command, folded: command.toLowerCase(), executable } };
}

/** Pattern side of `normalizeCommand` — same folding, wildcards preserved. */
export function normalizeCommandPattern(
  raw: string
): { ok: true; value: NormalizedCommand } | { ok: false; reason: PatternRejection } {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'empty' };
  if (raw.length > MATCH_LIMITS.maxPatternLength) return { ok: false, reason: 'too-long' };
  if (CONTROL_CHAR_RE.test(raw)) return { ok: false, reason: 'control-character' };
  const command = raw.trim().replace(/\s+/g, ' ');
  return {
    ok: true,
    value: { command, folded: command.toLowerCase(), executable: command.split(' ')[0] ?? '' },
  };
}

/** Command patterns are matched as a single segment — `/` is not special. */
export function matchesCommandPattern(
  target: NormalizedCommand,
  pattern: NormalizedCommand,
  caseInsensitive: boolean
): boolean {
  const t = caseInsensitive ? target.folded : target.command;
  const p = caseInsensitive ? pattern.folded : pattern.command;
  return segmentMatches(p, t);
}

/** Command patterns that grant the whole shell. */
export function isBroadCommandPattern(pattern: string): boolean {
  const normalized = normalizeCommandPattern(pattern);
  if (!normalized.ok) return false;
  const p = normalized.value.command;
  return p === '*' || p === '**' || p === '*.*';
}

/**
 * Shapes that must never appear behind a blanket `allow`. Matched against the
 * *pattern text* at validation time — this is a contract-authoring check, not a
 * runtime command filter.
 */
export const DANGEROUS_COMMAND_SHAPES: ReadonlyArray<{ code: string; re: RegExp }> = [
  { code: 'recursive-delete', re: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i },
  { code: 'privilege-escalation', re: /\b(sudo|doas|runas)\b/i },
  { code: 'pipe-to-shell', re: /\b(curl|wget|iwr|invoke-webrequest)\b[^|]*\|\s*(ba|z|k|fi)?sh\b/i },
  { code: 'world-writable', re: /\bchmod\s+(-[a-z]+\s+)*(777|a\+rwx)\b/i },
  { code: 'history-rewrite', re: /\bgit\s+push\b[^|]*(--force(?!-with-lease)|(\s|^)-f(\s|$))/i },
  { code: 'disk-write', re: /\b(dd|mkfs|fdisk|diskutil)\b/i },
  { code: 'credential-read', re: /\b(cat|type|less|more)\b[^|]*(\.env|id_rsa|\.pem|credentials)\b/i },
];

/** Returns the dangerous-shape codes a command pattern matches. Sorted. */
export function dangerousCommandShapes(pattern: string): string[] {
  const normalized = normalizeCommandPattern(pattern);
  if (!normalized.ok) return [];
  return DANGEROUS_COMMAND_SHAPES.filter((s) => s.re.test(normalized.value.command))
    .map((s) => s.code)
    .sort();
}
