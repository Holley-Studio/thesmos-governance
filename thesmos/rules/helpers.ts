// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Shared helpers for Thesmos rule detect() functions. */

export const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
export const TS_EXT = /\.(ts|tsx)$/;
export const JSX_EXT = /\.(tsx|jsx)$/;
export const SQL_EXT = /\.(sql)$/;

export function isTestPath(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path) || /(^|\/)__tests__\//.test(path);
}

export function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

// Match operands, rather than secret-like words elsewhere on the same line.
// This is a bounded lexical heuristic, not authentication data-flow analysis.
const COMPARISON_OPERAND = String.raw`(?:typeof\s+)?(?:[A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*|\[(?:['"][^'"]+['"]|[A-Za-z_$][\w$]*)\])*|['"][^'"]*['"]|\d+(?:\.\d+)?)`;
const COMPARISON_PATTERN = `${COMPARISON_OPERAND}\\s*(?:===|!==|==|!=)\\s*${COMPARISON_OPERAND}`;
const COMPARISON_SENTINEL = /^(?:undefined|null|true|false|\d+(?:\.\d+)?)$/;
const PUBLIC_HASH_FIELD = /(?:(?:content|capsule|prompt|result|commit)Hash|hashContent)$/i;
const TOKEN_METADATA_FIELD = /tokens?(?:Estimate|Count|Usage|Limit|Budget|Available|Enabled)$/i;

/** Recognize direct secret comparisons without treating schema checks as auth. */
export function hasUnsafeSecretComparison(line: string): boolean {
  const comparisons = line.matchAll(new RegExp(COMPARISON_PATTERN, 'g'));
  for (const comparison of comparisons) {
    const operands = comparison[0].split(/===|!==|==|!=/).map((value) => value.trim());
    if (operands.some((value) => /^typeof\s/.test(value) || COMPARISON_SENTINEL.test(value)))
      continue;
    for (const operand of operands) {
      if (PUBLIC_HASH_FIELD.test(operand) || TOKEN_METADATA_FIELD.test(operand)) continue;
      const words = operand.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
      if (/\b(?:password|token|secret|key|hash|digest|signature|hmac)\b/i.test(words)) return true;
    }
  }
  return false;
}

/** Find all 1-based line numbers in content matching re, skipping pure comment lines. */
export function matchLines(
  content: string,
  re: RegExp,
  opts: { skipComments?: boolean; skipTest?: boolean; path?: string } = {}
): number[] {
  const lines = content.split('\n');
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (opts.skipComments && isCommentLine(line)) continue;
    if (re.test(line)) hits.push(i + 1);
  }
  return hits;
}

/** Return true if any line in a N-line window starting at lineIdx matches re. */
export function windowMatches(
  lines: string[],
  startIdx: number,
  windowSize: number,
  re: RegExp
): boolean {
  const end = Math.min(startIdx + windowSize, lines.length);
  for (let i = startIdx; i < end; i++) {
    if (re.test(lines[i]!)) return true;
  }
  return false;
}

// ── Generated-region stripping ────────────────────────────────────────────────

const GENERATED_START_RE = /<!--\s*THESMOS:GENERATED START/;
const GENERATED_END_RE = /<!--\s*THESMOS:GENERATED END/;

/**
 * Blank out everything between THESMOS:GENERATED START/END marker pairs.
 * Generated sections document rule patterns as text — reviewing them as
 * code self-triggers the rules they describe.
 *
 * Line count is preserved: stripped lines become empty strings, so finding
 * line numbers outside generated regions stay accurate. An unclosed START
 * marker strips to end of file.
 */
export function stripGeneratedRegions(content: string): string {
  if (!GENERATED_START_RE.test(content)) return content;
  const lines = content.split('\n');
  let inGenerated = false;
  const out = lines.map((line) => {
    if (!inGenerated) {
      if (GENERATED_START_RE.test(line)) {
        inGenerated = true;
        return '';
      }
      return line;
    }
    if (GENERATED_END_RE.test(line)) inGenerated = false;
    return '';
  });
  return out.join('\n');
}
