// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Dependency Security Rules — DEP_001–010
 *
 * Architecture (async/sync boundary):
 *   - `thesmos deps:audit` (async CLI): reads package.json → queries OSV.dev
 *     → writes .thesmos/dep-cache.json
 *   - DEP_001–005, 007, 009 (sync detect): read dep-cache via readFileSync
 *   - DEP_005, 006, 008, 010 (sync detect): read package.json / lockfile directly
 *
 * This preserves the synchronous detect() interface while enabling async CVE lookups.
 * Same pattern as vercel.ts (reads vercel.json via readFileSync inside detect()).
 */

import type { ThesmosRule, DetectInput, Finding } from '../types.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Cache types (mirrors deps:audit output) ───────────────────────────────────

export interface DepCacheEntry {
  name: string;
  version: string;
  /** CVE severity of worst known vulnerability, or null if clean */
  worstCve: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;
  /** All CVE IDs for this package */
  cveIds: string[];
  /** True if npm deprecated flag is set */
  deprecated: boolean;
  /** Latest available version from npm */
  latestVersion?: string;
  /** npm publish date of the installed version */
  publishedAt?: string;
}

export interface DepCache {
  generated: string;
  ttlHours: number;
  packages: DepCacheEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function f(
  category: string,
  severity: Finding['severity'],
  message: string,
  suggestion: string,
  file = 'package.json',
): Finding {
  return { severity, file, category, message, suggestion };
}

function loadDepCache(root: string): DepCache | null {
  const cachePath = join(root, '.thesmos', 'dep-cache.json');
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as DepCache;
  } catch {
    return null;
  }
}

function isCacheStale(cache: DepCache): boolean {
  const ageMs = Date.now() - new Date(cache.generated).getTime();
  const ttlMs = (cache.ttlHours ?? 24) * 60 * 60 * 1000;
  return ageMs > ttlMs;
}

function loadPackageJson(root: string): Record<string, unknown> | null {
  const p = join(root, 'package.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

function loadLockfile(root: string): string | null {
  const p = join(root, 'package-lock.json');
  if (!existsSync(p)) return null;
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function isPackageJson(path: string): boolean {
  return path === 'package.json' || path.endsWith('/package.json');
}

function isLockfile(path: string): boolean {
  return path === 'package-lock.json' || path.endsWith('/package-lock.json');
}

const PRERELEASE_RE = /[-+](?:alpha|beta|rc|canary|next|dev|preview|experimental)\./i;
const GIT_DEP_RE = /^(?:github:|gitlab:|bitbucket:|git\+|git:\/\/|https:\/\/github)/i;
const VERSION_MAJOR_RE = /^(\d+)/;

// ── Rule: DEP_001 — Critical CVE ─────────────────────────────────────────────

const DEP_001: ThesmosRule = {
  id: 'DEP_001',
  category: 'dep_critical_cve',
  severity: 'BLOCKER',
  description: 'Dependency has a CRITICAL CVE — immediate upgrade required.',
  tags: ['dependency', 'security', 'cve'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'CRITICAL CVEs typically have CVSS score ≥9.0 and are actively exploited. Running code with known critical vulnerabilities violates standard security practice.',
    commonViolations: ['Outdated dependencies not upgraded after CVE disclosure'],
    goodExample: 'Run: thesmos deps:audit  then upgrade the flagged package.',
    badExample: '(package with CRITICAL CVE in production)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    const cache = loadDepCache(root);
    if (!cache) return [];
    return cache.packages
      .filter((p) => p.worstCve === 'CRITICAL')
      .map((p) =>
        f('dep_critical_cve', 'BLOCKER',
          `${p.name}@${p.version} has a CRITICAL CVE: ${p.cveIds.slice(0, 3).join(', ')}`,
          `Upgrade ${p.name} immediately. Check: https://osv.dev/list?q=${encodeURIComponent(p.name)}`),
      );
  },
};

// ── Rule: DEP_002 — High CVE ──────────────────────────────────────────────────

const DEP_002: ThesmosRule = {
  id: 'DEP_002',
  category: 'dep_high_cve',
  severity: 'HIGH',
  description: 'Dependency has a HIGH severity CVE.',
  tags: ['dependency', 'security', 'cve'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'HIGH CVEs (CVSS 7.0–8.9) represent significant risk and should be patched within 30 days per most security policies.',
    commonViolations: ['Dependency pinned to old version that has known HIGH CVE'],
    goodExample: 'Upgrade to the patched version listed in the CVE advisory.',
    badExample: '(package with HIGH CVE running in production)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    const cache = loadDepCache(root);
    if (!cache) return [];
    return cache.packages
      .filter((p) => p.worstCve === 'HIGH')
      .map((p) =>
        f('dep_high_cve', 'HIGH',
          `${p.name}@${p.version} has a HIGH CVE: ${p.cveIds.slice(0, 3).join(', ')}`,
          `Upgrade ${p.name} to a patched version.`),
      );
  },
};

// ── Rule: DEP_003 — Medium CVE ───────────────────────────────────────────────

const DEP_003: ThesmosRule = {
  id: 'DEP_003',
  category: 'dep_medium_cve',
  severity: 'MEDIUM',
  description: 'Dependency has a MEDIUM severity CVE.',
  tags: ['dependency', 'security', 'cve'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'MEDIUM CVEs should be reviewed and scheduled for patching. Many become more dangerous with chained exploits.',
    commonViolations: ['MEDIUM CVE ignored because "not critical enough"'],
    goodExample: 'Schedule upgrade within next sprint.',
    badExample: '(package with MEDIUM CVE ignored indefinitely)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    const cache = loadDepCache(root);
    if (!cache) return [];
    return cache.packages
      .filter((p) => p.worstCve === 'MEDIUM')
      .map((p) =>
        f('dep_medium_cve', 'MEDIUM',
          `${p.name}@${p.version} has a MEDIUM CVE: ${p.cveIds.slice(0, 3).join(', ')}`,
          `Review and schedule upgrade for ${p.name}.`),
      );
  },
};

// ── Rule: DEP_004 — Abandoned with CVE ───────────────────────────────────────

const DEP_004: ThesmosRule = {
  id: 'DEP_004',
  category: 'dep_abandoned_with_cve',
  severity: 'HIGH',
  description: 'Dependency not updated in 2+ years AND has a known CVE — no fix expected.',
  tags: ['dependency', 'security', 'abandoned'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'An abandoned package with a CVE will never be patched. You must either fork it, replace it, or accept the permanent risk.',
    commonViolations: ['Using legacy package that maintainer abandoned with open CVEs'],
    goodExample: 'Find an actively maintained alternative or fork and patch.',
    badExample: '(old package with CVE, last published 3 years ago)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    const cache = loadDepCache(root);
    if (!cache) return [];
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
    return cache.packages
      .filter((p) => p.cveIds.length > 0 && p.publishedAt && new Date(p.publishedAt) < twoYearsAgo)
      .map((p) =>
        f('dep_abandoned_with_cve', 'HIGH',
          `${p.name}@${p.version} has CVE(s) and hasn't been updated since ${p.publishedAt?.slice(0, 10)} — no fix expected.`,
          `Replace ${p.name} with an actively maintained alternative.`),
      );
  },
};

// ── Rule: DEP_005 — No lockfile integrity ────────────────────────────────────

const DEP_005: ThesmosRule = {
  id: 'DEP_005',
  category: 'dep_no_integrity',
  severity: 'MEDIUM',
  description: 'package-lock.json entries are missing integrity hashes — supply chain risk.',
  tags: ['dependency', 'supply-chain', 'lockfile'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Integrity hashes in package-lock.json ensure the downloaded package matches what was published. Missing hashes allow substitution attacks.',
    commonViolations: ['Lockfile generated with old npm version', 'Manually edited lockfile'],
    goodExample: '"integrity": "sha512-..."  present in every package entry',
    badExample: '(lockfile entry missing "integrity" key)',
  },
  detect(input: DetectInput): Finding[] {
    const lockfileContent =
      input.changedFiles !== undefined
        ? (input.changedFiles.find((cf) => isLockfile(cf.path))?.content ?? null)
        : loadLockfile(process.cwd());
    if (!lockfileContent) return [];

    const missingCount = (lockfileContent.match(/"resolved":/g) ?? []).length -
      (lockfileContent.match(/"integrity":/g) ?? []).length;

    if (missingCount <= 0) return [];
    return [f('dep_no_integrity', 'MEDIUM',
      `package-lock.json has ${missingCount} entries missing integrity hashes.`,
      'Run: npm install --package-lock-only  to regenerate with integrity hashes.',
      'package-lock.json')];
  },
};

// ── Rule: DEP_006 — Git dependency ───────────────────────────────────────────

const DEP_006: ThesmosRule = {
  id: 'DEP_006',
  category: 'dep_git_dependency',
  severity: 'HIGH',
  description: 'Dependency points to a git URL instead of a semver version — no integrity guarantee.',
  tags: ['dependency', 'supply-chain'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Git dependencies bypass the npm registry and have no integrity check. The commit being used can silently change, enabling supply chain attacks.',
    commonViolations: ['github:user/repo entries in package.json', 'git+https:// URLs'],
    goodExample: '"my-package": "^1.2.3"',
    badExample: '"my-package": "github:org/repo#main"',
  },
  detect(input: DetectInput): Finding[] {
    const pkgContent =
      input.changedFiles !== undefined
        ? (input.changedFiles.find((cf) => isPackageJson(cf.path))?.content ?? null)
        : (() => { try { return readFileSync(join(process.cwd(), 'package.json'), 'utf8'); } catch { return null; } })();
    if (!pkgContent) return [];

    let pkg: Record<string, Record<string, string>>;
    try { pkg = JSON.parse(pkgContent) as typeof pkg; } catch { return []; }

    const allDeps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };

    return Object.entries(allDeps)
      .filter(([, v]) => GIT_DEP_RE.test(v))
      .map(([name, v]) =>
        f('dep_git_dependency', 'HIGH',
          `"${name}" uses a git dependency "${v}" — no integrity guarantee.`,
          `Publish ${name} to npm registry and use a semver version instead.`),
      );
  },
};

// ── Rule: DEP_007 — Major version drift ──────────────────────────────────────

const DEP_007: ThesmosRule = {
  id: 'DEP_007',
  category: 'dep_major_version_drift',
  severity: 'LOW',
  description: 'Dependency is more than 2 major versions behind latest.',
  tags: ['dependency', 'maintenance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Packages more than 2 major versions behind often receive no security patches for the old branch. Migration debt compounds over time.',
    commonViolations: ['Using v2 when v5 is current', 'Pinned to major version never upgraded'],
    goodExample: 'Upgrade within 1-2 major versions of latest.',
    badExample: '"lodash": "3.x" when lodash@4 is current',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    const cache = loadDepCache(root);
    if (!cache) return [];
    return cache.packages
      .filter((p) => {
        if (!p.latestVersion) return false;
        const installedMajor = parseInt(VERSION_MAJOR_RE.exec(p.version)?.[1] ?? '0', 10);
        const latestMajor = parseInt(VERSION_MAJOR_RE.exec(p.latestVersion)?.[1] ?? '0', 10);
        return latestMajor - installedMajor > 2;
      })
      .map((p) =>
        f('dep_major_version_drift', 'LOW',
          `${p.name}@${p.version} is ${parseInt(VERSION_MAJOR_RE.exec(p.latestVersion ?? '0')?.[1] ?? '0', 10) - parseInt(VERSION_MAJOR_RE.exec(p.version)?.[1] ?? '0', 10)} major versions behind latest (${p.latestVersion}).`,
          `Upgrade ${p.name} to ^${p.latestVersion}.`),
      );
  },
};

// ── Rule: DEP_008 — Pre-release in prod ──────────────────────────────────────

const DEP_008: ThesmosRule = {
  id: 'DEP_008',
  category: 'dep_prerelease_in_prod',
  severity: 'MEDIUM',
  description: 'Pre-release (alpha/beta/rc) dependency in production dependencies.',
  tags: ['dependency', 'stability'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Pre-release packages have unstable APIs and may contain unreviewed security changes. They should not be in production dependencies.',
    commonViolations: ['"dependencies" key contains alpha/beta/rc versions'],
    goodExample: 'Use pre-releases in devDependencies only, or wait for stable release.',
    badExample: '"some-lib": "2.0.0-beta.1" in dependencies (not devDependencies)',
  },
  detect(input: DetectInput): Finding[] {
    const pkgContent =
      input.changedFiles !== undefined
        ? (input.changedFiles.find((cf) => isPackageJson(cf.path))?.content ?? null)
        : (() => { try { return readFileSync(join(process.cwd(), 'package.json'), 'utf8'); } catch { return null; } })();
    if (!pkgContent) return [];

    let pkg: Record<string, Record<string, string>>;
    try { pkg = JSON.parse(pkgContent) as typeof pkg; } catch { return []; }

    const prodDeps = (pkg.dependencies as Record<string, string>) ?? {};
    return Object.entries(prodDeps)
      .filter(([, v]) => PRERELEASE_RE.test(v))
      .map(([name, v]) =>
        f('dep_prerelease_in_prod', 'MEDIUM',
          `"${name}": "${v}" is a pre-release version in production dependencies.`,
          `Move to devDependencies or upgrade to a stable release.`),
      );
  },
};

// ── Rule: DEP_009 — Deprecated package ───────────────────────────────────────

const DEP_009: ThesmosRule = {
  id: 'DEP_009',
  category: 'dep_deprecated_package',
  severity: 'MEDIUM',
  description: 'Dependency is npm-deprecated — maintainer recommends replacement.',
  tags: ['dependency', 'maintenance'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'Deprecated packages receive no updates, including security patches. The maintainer has explicitly flagged the package as unmaintained or superseded.',
    commonViolations: ['Using a package that was deprecated when a successor was released'],
    goodExample: 'Follow the deprecation notice to migrate to the recommended replacement.',
    badExample: '(package where npm shows "DEPRECATED" warning)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    const cache = loadDepCache(root);
    if (!cache) return [];
    return cache.packages
      .filter((p) => p.deprecated)
      .map((p) =>
        f('dep_deprecated_package', 'MEDIUM',
          `${p.name}@${p.version} is npm-deprecated. Run: npm deprecate notice.`,
          `Find the recommended replacement for ${p.name} in the npm deprecation notice.`),
      );
  },
};

// ── Rule: DEP_010 — Cache stale ──────────────────────────────────────────────

const DEP_010: ThesmosRule = {
  id: 'DEP_010',
  category: 'dep_cache_stale',
  severity: 'LOW',
  description: '.thesmos/dep-cache.json is older than 24 hours — CVE data may be outdated.',
  tags: ['dependency', 'security'],
  sinceVersion: '2.0.0',
  explain: {
    why: 'New CVEs are disclosed daily. A stale cache means new vulnerabilities in your dependencies will not be detected.',
    commonViolations: ['deps:audit not run in CI', 'Cache file committed without refresh step'],
    goodExample: 'Add "thesmos deps:audit" to your CI pipeline before thesmos scan.',
    badExample: '(dep-cache.json last updated 3 days ago)',
  },
  detect(input: DetectInput): Finding[] {
    const root = process.cwd();
    const cache = loadDepCache(root);
    if (!cache) return []; // DEP_001-009 will produce no findings anyway
    if (!isCacheStale(cache)) return [];
    return [f('dep_cache_stale', 'LOW',
      `.thesmos/dep-cache.json was generated ${cache.generated.slice(0, 10)} and is stale.`,
      'Run: thesmos deps:audit  to refresh CVE data.',
      '.thesmos/dep-cache.json')];
  },
};

// ── Export ────────────────────────────────────────────────────────────────────

export const DEP_RULES: ThesmosRule[] = [
  DEP_001,
  DEP_002,
  DEP_003,
  DEP_004,
  DEP_005,
  DEP_006,
  DEP_007,
  DEP_008,
  DEP_009,
  DEP_010,
];
