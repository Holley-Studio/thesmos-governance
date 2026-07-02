// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Non-blocking npm update check for the Thesmos CLI.
 *
 * - Fetches latest version from the npm registry (2s timeout, fail-silent)
 * - Caches the result in ~/.thesmos/.update-check for 24 hours
 * - Prints a notice to stderr if a newer version is available
 * - Never blocks or throws — all errors are swallowed
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PACKAGE_NAME = 'thesmos-governance';
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT_MS = 2000;

interface CacheEntry {
  ts: number;
  latest: string;
}

function getCacheDir(): string {
  return join(homedir(), '.thesmos');
}

function readCache(): CacheEntry | null {
  try {
    const path = join(getCacheDir(), '.update-check');
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf8');
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts < CACHE_TTL_MS) return entry;
    return null;
  } catch {
    return null;
  }
}

function writeCache(latest: string): void {
  try {
    const dir = getCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '.update-check'),
      JSON.stringify({ ts: Date.now(), latest }),
      'utf8',
    );
  } catch {
    // Ignore — cache is best-effort
  }
}

function getCurrentVersion(): string | null {
  try {
    // Walk up from this file to find the thesmos package.json
    const pkgPath = join(import.meta.dirname ?? '', '..', '..', 'package.json');
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(REGISTRY_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return data.version ?? null;
  } catch {
    return null;
  }
}

function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^[^0-9]*/, '').split('.').map(Number);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

/**
 * Fires off a non-blocking update check and prints a notice if behind.
 * Call this after the main command completes (void — never await).
 */
export async function checkForUpdate(): Promise<void> {
  const current = getCurrentVersion();
  if (!current) return;

  let latest = readCache()?.latest ?? null;
  if (!latest) {
    latest = await fetchLatestVersion();
    if (latest) writeCache(latest);
  }

  if (latest && isNewer(current, latest)) {
    process.stderr.write(
      `\n  💡 thesmos-governance ${latest} is available (you have ${current})\n` +
        `     Run: npm install --save-dev thesmos-governance@latest\n\n`,
    );
  }
}
