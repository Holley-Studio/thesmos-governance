// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Secret detection and env-access pattern checking.
 * All functions are pure (no fs, no side effects) — fully testable.
 */

/**
 * Check a single line against a list of secret regex patterns.
 * Returns the first matching pattern string, or null if clean.
 */
export function matchesSecretPattern(line: string, patterns: string[]): string | null {
  for (const pattern of patterns) {
    try {
      const re = new RegExp(pattern);
      if (re.test(line)) return pattern;
    } catch {
      // Skip invalid regex patterns in config
    }
  }
  return null;
}

/**
 * Detect scattered `process.env.VAR` dot-notation access outside a central
 * env module. Returns the regex match (truthy) or null.
 * Ignores lines in scripts/ — those are operator tooling, not app code.
 *
 * NEXT_PUBLIC_* and NODE_ENV are exempt: bundlers (Next.js, webpack, Vite's
 * define) statically inline these at build time and ONLY recognize the
 * literal dot-notation form — rewriting them breaks the build-time
 * replacement and ships undefined to the browser.
 */
export function isDirectEnvAccess(line: string): RegExpExecArray | null {
  const match = /process\.env\.([A-Z_a-z][A-Z_a-z0-9]*)/.exec(line);
  if (!match) return null;
  if (match[1].startsWith('NEXT_PUBLIC_') || match[1] === 'NODE_ENV') return null;
  return match;
}

/**
 * Extract variable name(s) from bracket-notation env access
 * (`process['env' as 'env']['VAR']`) — a legacy pattern some governed repos
 * still carry; env-var discovery must keep recognizing it.
 */
export function extractBracketEnvVars(source: string): string[] {
  const re = /process\['env'\s+as\s+'env'\]\['([^']+)'\]/g;
  const vars: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    vars.push(match[1]);
  }
  return [...new Set(vars)];
}

/**
 * True when the file genuinely declares the 'use client' directive — i.e. the
 * first non-comment, non-blank statement is the directive. Next.js only honors
 * it in that position, so a "'use client'" string anywhere else in the file
 * (test fixtures, scanner source, docs) must not mark it as a client component.
 */
export function isClientComponentFile(content: string): boolean {
  let inBlockComment = false;
  for (const rawLine of content.split('\n', 30)) {
    let line = rawLine.trim();
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) continue;
      line = line.slice(end + 2).trim();
      inBlockComment = false;
    }
    if (line === '' || line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2);
      if (end === -1) {
        inBlockComment = true;
        continue;
      }
      line = line.slice(end + 2).trim();
      if (line === '') continue;
    }
    return /^['"]use client['"];?\s*$/.test(line);
  }
  return false;
}

/**
 * Detect admin client import pattern in a file's content.
 * Only relevant for client components (those with 'use client' directive).
 */
export function hasAdminClientInClientFile(content: string): boolean {
  return isClientComponentFile(content) && content.includes('supabase/admin');
}

/**
 * Detect missing auth pattern in an API route file.
 * Returns true when the file has mutating exports but no visible auth check.
 */
export function isMissingApiAuth(content: string): boolean {
  const hasMutation =
    /export\s+(async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b/.test(content) ||
    /export\s+const\s+(POST|PATCH|PUT|DELETE)\s*=/.test(content);
  if (!hasMutation) return false;

  const hasAuth =
    /getSession\s*\(|getCallerProfile\s*\(|createRouteHandlerClient\s*\(|supabase\.auth\.getUser\s*\(/.test(
      content
    );
  return !hasAuth;
}

/**
 * Detect RLS disable patterns in migration/SQL content.
 */
export function hasRlsDisable(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes('disable row level') ||
    lower.includes('rls_disabled') ||
    /security\s+definer/i.test(content)
  );
}

/**
 * Extract ALL env var names from source — covers every access pattern:
 * - Legacy bracket notation: process['env' as 'env']['VAR']
 * - Direct dot notation:     process.env.VAR
 * - Vite env access:         import.meta.env.VAR
 * Returns a deduplicated, sorted list.
 */
export function extractAllEnvVars(source: string): string[] {
  const vars = new Set<string>();
  let m: RegExpExecArray | null;

  const bracketRe = /process\['env'\s+as\s+'env'\]\['([^']+)'\]/g;
  while ((m = bracketRe.exec(source)) !== null) vars.add(m[1]);

  const dotRe = /process\.env\.([A-Z_a-z][A-Z_a-z0-9]*)/g;
  while ((m = dotRe.exec(source)) !== null) vars.add(m[1]);

  const viteRe = /import\.meta\.env\.([A-Z_a-z][A-Z_a-z0-9]*)/g;
  while ((m = viteRe.exec(source)) !== null) vars.add(m[1]);

  return [...vars].sort();
}

/**
 * Detect Monday.com write mutations outside of the gatekeeper intake path.
 */
export function hasMondayWriteOutsideGateway(content: string, filePath: string): boolean {
  const hasMondayWrite =
    /monday|MONDAY/.test(content) &&
    /mutation|createItem|changeColumnValues/.test(content);
  if (!hasMondayWrite) return false;
  return !filePath.includes('intake') && !filePath.includes('requests');
}
