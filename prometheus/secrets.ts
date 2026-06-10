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
 * Detect direct `process.env.VAR` dot-notation access (Prometheus Guard violation).
 * Returns the regex match (truthy) or null.
 * Ignores lines in scripts/ — those are operator tooling, not app code.
 */
export function isDirectEnvAccess(line: string): RegExpExecArray | null {
  return /process\.env\.([A-Z_a-z][A-Z_a-z0-9]*)/.exec(line);
}

/**
 * Detect bracket-notation env access — this is the CORRECT pattern.
 * Extracts the variable name(s) from `process['env' as 'env']['VAR']`.
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
 * Detect admin client import pattern in a file's content.
 * Only relevant for client components (those with 'use client' directive).
 */
export function hasAdminClientInClientFile(content: string): boolean {
  const isClientComponent =
    content.includes("'use client'") || content.includes('"use client"');
  return isClientComponent && content.includes('supabase/admin');
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
 * - Approved bracket notation: process['env' as 'env']['VAR']
 * - Direct dot notation:       process.env.VAR  (violation, but still discovered)
 * - Vite env access:           import.meta.env.VAR
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
