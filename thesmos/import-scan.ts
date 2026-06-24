/**
 * import:scan — live registry validation for AI-generated package imports.
 *
 * Fetches npm and PyPI registry APIs to confirm packages exist, check their
 * age, and detect newly registered names (< 30 days old). Gracefully degrades
 * when offline — network errors return `exists: null` instead of throwing.
 *
 * Used by:
 *   - `thesmos import:scan` CLI command
 *   - claude:govern Bash PreToolUse hook (intercepts npm install / pip install)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLockfilePackages, KNOWN_PHANTOMS, SUSPICIOUS_PATTERNS } from './rules/slopsquatting.js';

const FETCH_TIMEOUT_MS = 5_000;

// ── Registry result ───────────────────────────────────────────────────────────

export interface RegistryResult {
  name: string;
  ecosystem: 'npm' | 'pypi';
  /** true = exists, false = 404, null = offline/error */
  exists: boolean | null;
  /** Days since first publish. null if unknown or offline. */
  ageInDays: number | null;
  /** true if the package page has a description or README. */
  hasReadme: boolean | null;
}

export type RegistrySeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'OK' | 'OFFLINE';

export interface RegistryFinding {
  name: string;
  ecosystem: 'npm' | 'pypi';
  severity: RegistrySeverity;
  reason: string;
  suggestion: string;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── npm registry check ────────────────────────────────────────────────────────

export async function checkNpm(name: string): Promise<RegistryResult> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@').replace('%2F', '/')}`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 404) {
      return { name, ecosystem: 'npm', exists: false, ageInDays: null, hasReadme: null };
    }
    if (!res.ok) {
      return { name, ecosystem: 'npm', exists: null, ageInDays: null, hasReadme: null };
    }
    const data = await res.json() as {
      time?: Record<string, string>;
      readme?: string;
      description?: string;
      homepage?: string;
    };
    const created = data.time?.['created'];
    const ageInDays = created
      ? Math.floor((Date.now() - new Date(created).getTime()) / 86_400_000)
      : null;
    const hasReadme = !!(data.readme || data.description || data.homepage);
    return { name, ecosystem: 'npm', exists: true, ageInDays, hasReadme };
  } catch {
    return { name, ecosystem: 'npm', exists: null, ageInDays: null, hasReadme: null };
  }
}

// ── PyPI registry check ───────────────────────────────────────────────────────

export async function checkPypi(name: string): Promise<RegistryResult> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  try {
    const res = await fetchWithTimeout(url);
    if (res.status === 404) {
      return { name, ecosystem: 'pypi', exists: false, ageInDays: null, hasReadme: null };
    }
    if (!res.ok) {
      return { name, ecosystem: 'pypi', exists: null, ageInDays: null, hasReadme: null };
    }
    const data = await res.json() as {
      info?: { home_page?: string; description?: string; summary?: string };
      releases?: Record<string, Array<{ upload_time?: string }> | null>;
    };
    // Find the earliest upload time across ALL releases to get package creation date
    const allUploadTimes = Object.values(data.releases ?? {})
      .flatMap((files) => files ?? [])
      .map((f) => f.upload_time)
      .filter((t): t is string => typeof t === 'string');
    allUploadTimes.sort();
    const firstUpload = allUploadTimes[0];
    const ageInDays = firstUpload
      ? Math.floor((Date.now() - new Date(firstUpload).getTime()) / 86_400_000)
      : null;
    const hasReadme = !!(data.info?.description || data.info?.summary || data.info?.home_page);
    return { name, ecosystem: 'pypi', exists: true, ageInDays, hasReadme };
  } catch {
    return { name, ecosystem: 'pypi', exists: null, ageInDays: null, hasReadme: null };
  }
}

// ── Classify registry result ──────────────────────────────────────────────────

const NEW_PACKAGE_DAYS = 30;

export function classifyResult(
  result: RegistryResult,
  strict: boolean,
): RegistryFinding | null {
  if (result.exists === null) {
    return {
      name: result.name,
      ecosystem: result.ecosystem,
      severity: 'OFFLINE',
      reason: 'Registry check skipped — network unavailable or timed out.',
      suggestion: `Manually verify: ${result.ecosystem === 'npm' ? `https://npmjs.com/package/${result.name}` : `https://pypi.org/project/${result.name}`}`,
    };
  }

  if (result.exists === false) {
    return {
      name: result.name,
      ecosystem: result.ecosystem,
      severity: 'BLOCKER',
      reason: `"${result.name}" does not exist on the ${result.ecosystem} registry — AI hallucination or typo.`,
      suggestion: `Remove this import. If you need this functionality, find the real package that provides it.`,
    };
  }

  if (strict && result.ageInDays !== null && result.ageInDays < NEW_PACKAGE_DAYS) {
    return {
      name: result.name,
      ecosystem: result.ecosystem,
      severity: 'HIGH',
      reason: `"${result.name}" was published only ${result.ageInDays} day${result.ageInDays !== 1 ? 's' : ''} ago — newly registered packages are higher risk.`,
      suggestion: `Consider using a more established alternative. If this is intentional, add a suppression comment.`,
    };
  }

  if (strict && result.hasReadme === false) {
    return {
      name: result.name,
      ecosystem: result.ecosystem,
      severity: 'MEDIUM',
      reason: `"${result.name}" has no description, README, or homepage on the registry — low-quality or placeholder package.`,
      suggestion: `Verify this is the correct package and not an attacker-registered placeholder.`,
    };
  }

  return null;
}

// ── Import parser (for scanning source files) ─────────────────────────────────

const IMPORT_RE = /^(?:import\s+.*\s+from\s+|import\s+|export\s+.*\s+from\s+|const\s+\w+\s*=\s*require\s*\()\s*['"`]([^'"`./][^'"`]*)['"`]/;
const DYNAMIC_IMPORT_RE = /(?:await\s+)?import\s*\(\s*['"`]([^'"`./][^'"`]*)['"`]\s*\)/;

function extractPackageName(importPath: string): string {
  if (importPath.startsWith('@')) return importPath.split('/').slice(0, 2).join('/');
  return importPath.split('/')[0] ?? importPath;
}

function parseFileImports(content: string): string[] {
  const pkgs: string[] = [];
  for (const line of content.split('\n')) {
    const m = IMPORT_RE.exec(line) ?? DYNAMIC_IMPORT_RE.exec(line);
    if (m?.[1]) pkgs.push(extractPackageName(m[1]));
  }
  return pkgs;
}

const NODE_BUILTINS = new Set([
  'node:fs', 'node:path', 'node:os', 'node:crypto', 'node:http', 'node:https',
  'node:url', 'node:util', 'node:stream', 'node:events', 'node:child_process',
  'node:buffer', 'node:assert', 'node:net', 'node:dns', 'node:readline',
  'node:vm', 'node:module', 'node:worker_threads', 'node:perf_hooks',
  'node:inspector', 'node:cluster', 'node:zlib', 'node:querystring',
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream',
  'events', 'child_process', 'buffer', 'assert', 'net', 'dns', 'readline',
  'vm', 'module', 'worker_threads', 'perf_hooks', 'inspector', 'cluster',
  'zlib', 'querystring', 'string_decoder', 'timers', 'tty', 'v8',
]);

// ── Scan options ──────────────────────────────────────────────────────────────

export interface ScanOptions {
  /** Also flag packages < 30 days old and packages with no README. */
  strict?: boolean;
  /** Concurrency limit for registry requests. */
  concurrency?: number;
}

export interface ScanImportsResult {
  scanned: number;
  packages: string[];
  findings: RegistryFinding[];
  offlineCount: number;
  unknownCount: number;
}

// ── Core scan function ────────────────────────────────────────────────────────

export async function scanImports(
  files: string[],
  options: ScanOptions = {},
): Promise<ScanImportsResult> {
  const { strict = false, concurrency = 10 } = options;

  // Collect unique package names across all files
  const packageSet = new Set<string>();
  const lockfilePackages = getLockfilePackages(process.cwd());

  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const ext = filePath.split('.').pop() ?? '';

    if (/^(ts|tsx|js|jsx|mjs|cjs)$/.test(ext)) {
      const content = readFileSync(filePath, 'utf8');
      for (const pkg of parseFileImports(content)) {
        if (!NODE_BUILTINS.has(pkg)) packageSet.add(pkg);
      }
    }

    if (filePath.endsWith('requirements.txt') || filePath.endsWith('requirements.in')) {
      const lines = readFileSync(filePath, 'utf8').split('\n');
      for (const line of lines) {
        const name = line.trim().split(/[=<>!~\s@[]/)[0];
        if (name && !name.startsWith('#') && !name.startsWith('-')) {
          packageSet.add(`pypi:${name}`);
        }
      }
    }
  }

  // Separate npm and pypi packages
  const npmPkgs: string[] = [];
  const pypiPkgs: string[] = [];
  for (const pkg of packageSet) {
    if (pkg.startsWith('pypi:')) {
      pypiPkgs.push(pkg.slice(5));
    } else {
      // Skip packages already in lockfile — they've been vetted
      if (lockfilePackages && lockfilePackages.has(pkg)) continue;
      npmPkgs.push(pkg);
    }
  }

  // Check packages with concurrency limit
  const allResults: RegistryResult[] = [];
  const checkBatch = async <T>(
    items: T[],
    fn: (item: T) => Promise<RegistryResult>,
  ) => {
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = items.slice(i, i + concurrency);
      const results = await Promise.all(batch.map(fn));
      allResults.push(...results);
    }
  };

  await checkBatch(npmPkgs, checkNpm);
  await checkBatch(pypiPkgs, checkPypi);

  // Classify results
  const findings: RegistryFinding[] = [];
  let offlineCount = 0;
  let unknownCount = 0;

  for (const result of allResults) {
    const finding = classifyResult(result, strict);
    if (!finding) continue;
    if (finding.severity === 'OFFLINE') { offlineCount++; continue; }
    if (finding.severity === 'BLOCKER') unknownCount++;
    findings.push(finding);
  }

  return {
    scanned: files.length,
    packages: [...npmPkgs, ...pypiPkgs],
    findings,
    offlineCount,
    unknownCount,
  };
}

// ── Extract package name from install command ─────────────────────────────────

/**
 * Parses a shell install command and returns the package name(s) being installed.
 * Used by the claude:govern Bash hook.
 *
 * Handles:
 *   npm install <pkg>
 *   npm install --save-dev <pkg>
 *   pip install <pkg>
 *   pip install <pkg>==1.0.0
 */
export function extractInstallPackages(command: string): Array<{ name: string; ecosystem: 'npm' | 'pypi' }> {
  const results: Array<{ name: string; ecosystem: 'npm' | 'pypi' }> = [];

  // npm install / npm i / npm add
  const npmMatch = /\bnpm\s+(?:install|i|add)\b(.*)/i.exec(command);
  if (npmMatch) {
    const rest = npmMatch[1] ?? '';
    const tokens = rest.trim().split(/\s+/);
    for (const token of tokens) {
      if (!token || token.startsWith('-')) continue;
      // Strip version specifier: pkg@1.0.0 → pkg
      const name = token.replace(/@[^@]+$/, '');
      if (name && !NODE_BUILTINS.has(name)) results.push({ name, ecosystem: 'npm' });
    }
  }

  // pip install
  const pipMatch = /\bpip(?:3)?\s+install\b(.*)/i.exec(command);
  if (pipMatch) {
    const rest = pipMatch[1] ?? '';
    const tokens = rest.trim().split(/\s+/);
    for (const token of tokens) {
      if (!token || token.startsWith('-')) continue;
      // Strip version specifier: pkg==1.0.0 → pkg
      const name = token.split(/[=<>!~\[]/)[0] ?? '';
      if (name) results.push({ name, ecosystem: 'pypi' });
    }
  }

  return results;
}

// ── Quick BLOCKER check for Bash hook (no network needed) ────────────────────

/**
 * Instantly checks a list of package names against the known phantom list and
 * suspicious patterns. Used by the claude:govern Bash hook for zero-latency
 * blocking before network checks complete.
 */
export function quickPhantomCheck(
  packages: Array<{ name: string; ecosystem: 'npm' | 'pypi' }>,
): RegistryFinding[] {
  const findings: RegistryFinding[] = [];
  for (const { name, ecosystem } of packages) {
    if (ecosystem !== 'npm') continue;
    if (KNOWN_PHANTOMS.has(name)) {
      findings.push({
        name,
        ecosystem,
        severity: 'BLOCKER',
        reason: `"${name}" is on the documented list of AI-hallucinated package names.`,
        suggestion: 'Remove this install. Verify you need this functionality and find the real package that provides it.',
      });
    } else if (SUSPICIOUS_PATTERNS.some((re) => re.test(name))) {
      findings.push({
        name,
        ecosystem,
        severity: 'HIGH',
        reason: `"${name}" follows a naming pattern common in AI-hallucinated packages.`,
        suggestion: `Verify this package exists at https://npmjs.com/package/${name} before installing.`,
      });
    }
  }
  return findings;
}
