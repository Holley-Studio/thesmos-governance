/**
 * thesmos deps:audit  — query OSV.dev for CVEs in all npm dependencies
 *                          and write .thesmos/dep-cache.json.
 *
 * DEP_001–010 rules read this cache synchronously inside detect() — this
 * async CLI command is the only place network calls happen.
 *
 * Usage:
 *   thesmos deps:audit              Scan all deps + devDeps and cache results
 *   thesmos deps:audit --prod-only  Scan only production dependencies
 *   thesmos deps:audit --json       Print results as JSON instead of table
 *   thesmos deps:audit --sbom       Also write thesmos.sbom.json (CycloneDX)
 *
 * Requires package.json in the current directory.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { request } from 'node:https';
import { parseArgs, flag } from '../lib/args.ts';
import type { DepCacheEntry, DepCache } from '../../rules/deps.ts';

// ── npm registry ──────────────────────────────────────────────────────────────

interface NpmPackageInfo {
  deprecated?: string;
  time?: Record<string, string>;
  version?: string;
}

async function fetchNpmInfo(name: string): Promise<NpmPackageInfo> {
  return new Promise((resolve) => {
    const req = request(
      { hostname: 'registry.npmjs.org', path: `/${encodeURIComponent(name)}/latest`, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString()) as NpmPackageInfo); }
          catch { resolve({}); }
        });
      },
    );
    req.on('error', () => resolve({}));
    req.end();
  });
}

// ── OSV batch query ───────────────────────────────────────────────────────────

interface OsvVuln { id: string; severity?: Array<{ type: string; score: string }> }
interface OsvBatchResponse { results: Array<{ vulns?: OsvVuln[] }> }

type CveSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

function mapCvss(score: number): CveSeverity {
  if (score >= 9.0) return 'CRITICAL';
  if (score >= 7.0) return 'HIGH';
  if (score >= 4.0) return 'MEDIUM';
  return 'LOW';
}

function worstSeverity(vulns: OsvVuln[]): CveSeverity | null {
  const ORDER: CveSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  let worst: CveSeverity | null = null;
  for (const v of vulns) {
    for (const s of v.severity ?? []) {
      if (s.type === 'CVSS_V3' || s.type === 'CVSS_V2') {
        const score = parseFloat(s.score);
        const sev = mapCvss(score);
        if (!worst || ORDER.indexOf(sev) < ORDER.indexOf(worst)) worst = sev;
      }
    }
    // If no CVSS score, treat presence of vuln as at least LOW
    if (!worst && vulns.length > 0) worst = 'LOW';
  }
  return worst;
}

async function queryOsvBatch(
  packages: Array<{ name: string; version: string }>,
): Promise<Array<{ vulns: OsvVuln[] }>> {
  if (packages.length === 0) return [];
  const body = JSON.stringify({
    queries: packages.map((p) => ({
      package: { name: p.name, ecosystem: 'npm' },
      version: p.version,
    })),
  });

  return new Promise((resolve) => {
    const req = request(
      {
        hostname: 'api.osv.dev',
        path: '/v1/querybatch',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString()) as OsvBatchResponse;
            resolve((parsed.results ?? []).map((r) => ({ vulns: r.vulns ?? [] })));
          } catch {
            resolve(packages.map(() => ({ vulns: [] })));
          }
        });
      },
    );
    req.on('error', () => resolve(packages.map(() => ({ vulns: [] }))));
    req.write(body);
    req.end();
  });
}

// ── CycloneDX SBOM ───────────────────────────────────────────────────────────

function buildSbom(packages: DepCacheEntry[], projectName: string, projectVersion: string): string {
  const components = packages.map((p) => ({
    type: 'library',
    'bom-ref': `${p.name}@${p.version}`,
    name: p.name,
    version: p.version,
    purl: `pkg:npm/${encodeURIComponent(p.name)}@${p.version}`,
  }));

  return JSON.stringify({
    bomFormat: 'CycloneDX',
    specVersion: '1.4',
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'Thesmos Governance', name: 'thesmos-governance', version: '2.0.0' }],
      component: { type: 'application', name: projectName, version: projectVersion },
    },
    components,
  }, null, 2) + '\n';
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function cmdDeps(argv: string[]): Promise<void> {
  const sub = argv[0];

  if (sub !== 'audit') {
    process.stderr.write('Usage: thesmos deps:audit [--prod-only] [--json] [--sbom]\n');
    process.exit(1);
  }

  const { flags } = parseArgs(argv.slice(1));
  const prodOnly = flag(flags, 'prod-only');
  const json = flag(flags, 'json');
  const sbom = flag(flags, 'sbom');

  const root = process.cwd();
  const pkgPath = join(root, 'package.json');

  if (!existsSync(pkgPath)) {
    process.stderr.write('deps:audit: no package.json found in current directory\n');
    process.exit(1);
  }

  let pkg: { name?: string; version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof pkg;
  } catch {
    process.stderr.write('deps:audit: failed to parse package.json\n');
    process.exit(1);
    return;
  }

  const prodDeps = pkg.dependencies ?? {};
  const devDeps = prodOnly ? {} : (pkg.devDependencies ?? {});
  const allDeps = { ...prodDeps, ...devDeps };

  if (Object.keys(allDeps).length === 0) {
    process.stdout.write('deps:audit: no dependencies found in package.json\n');
    return;
  }

  const packages = Object.entries(allDeps).map(([name, version]) => ({
    name,
    version: version.replace(/^[~^>=<]/, ''),
  }));

  if (!json) process.stdout.write(`Scanning ${packages.length} packages via OSV.dev...\n`);

  // Batch query OSV (1000 at a time)
  const CHUNK = 1000;
  const osvResults: Array<{ vulns: OsvVuln[] }> = [];
  for (let i = 0; i < packages.length; i += CHUNK) {
    const chunk = packages.slice(i, i + CHUNK);
    const results = await queryOsvBatch(chunk);
    osvResults.push(...results);
  }

  // Build cache entries
  const entries: DepCacheEntry[] = [];
  let vulnCount = 0;
  for (let i = 0; i < packages.length; i++) {
    const p = packages[i]!;
    const vulns = osvResults[i]?.vulns ?? [];
    const worst = worstSeverity(vulns);
    if (worst) vulnCount++;
    entries.push({
      name: p.name,
      version: p.version,
      worstCve: worst,
      cveIds: vulns.map((v) => v.id),
      deprecated: false, // enriched below for flagged packages only
    });
  }

  // Fetch npm metadata for packages with CVEs (minimize API calls)
  const vuln = entries.filter((e) => e.worstCve);
  if (vuln.length > 0 && !json) process.stdout.write(`Fetching npm metadata for ${vuln.length} vulnerable package(s)...\n`);
  for (const entry of vuln) {
    const info = await fetchNpmInfo(entry.name);
    if (info.deprecated) entry.deprecated = true;
    if (info.version) entry.latestVersion = info.version;
    if (info.time?.[entry.version]) entry.publishedAt = info.time[entry.version];
  }

  // Write cache
  const cache: DepCache = { generated: new Date().toISOString(), ttlHours: 24, packages: entries };
  const cacheDir = join(root, '.thesmos');
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'dep-cache.json'), JSON.stringify(cache, null, 2) + '\n');

  // Write SBOM if requested
  if (sbom) {
    const sbomContent = buildSbom(entries, pkg.name ?? 'unknown', pkg.version ?? '0.0.0');
    writeFileSync(join(root, 'thesmos.sbom.json'), sbomContent);
    if (!json) process.stdout.write(`SBOM written to thesmos.sbom.json (CycloneDX 1.4)\n`);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ packages: entries, vulnCount, generated: cache.generated }, null, 2) + '\n');
    return;
  }

  if (vulnCount === 0) {
    process.stdout.write(`\nAll ${packages.length} packages clean — no known CVEs.\n`);
  } else {
    process.stdout.write(`\nFound CVEs in ${vulnCount} package(s):\n`);
    for (const e of entries.filter((e) => e.worstCve)) {
      process.stdout.write(`  ${e.worstCve?.padEnd(8)} ${e.name}@${e.version}  ${e.cveIds.slice(0, 2).join(', ')}\n`);
    }
    process.stdout.write(`\nRun 'thesmos scan' to see DEP findings in context.\n`);
  }
  process.stdout.write(`Cache written to .thesmos/dep-cache.json (TTL: 24h)\n`);
}
