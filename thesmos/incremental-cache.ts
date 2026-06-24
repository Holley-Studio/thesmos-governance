/**
 * Incremental scan cache for Prometheus.
 *
 * Keyed by sha256(file content) + rules version. On re-scan, unchanged files
 * return their cached findings instantly. Any version bump invalidates all entries.
 *
 * Cache location: .thesmos/.scan-cache.json  (add to .gitignore)
 * Expected impact: 70–90% faster on second scan when most files are unchanged.
 *
 * Usage:
 *   const cache = loadCache(root);
 *   const cached = getCachedFindings(filePath, content, cache, version);
 *   if (cached) return cached;
 *   const findings = rule.detect(...);
 *   setCachedFindings(filePath, content, findings, cache, version);
 *   saveCache(root, cache);
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Finding, ThesmosConfig, ScanResult, ChangedFile } from './types.js';
import { PROMETHEUS_RULES } from './rules/registry.js';
import { makeLogger } from './logger.js';

const log = makeLogger('cache');

// ── Cache types ───────────────────────────────────────────────────────────────

interface CacheEntry {
  contentHash: string;
  rulesVersion: string;
  findings: Finding[];
  cachedAt: string;
}

export interface ScanCache {
  entries: Record<string, CacheEntry>;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function cachePath(root: string): string {
  return join(root, '.thesmos', '.scan-cache.json');
}

// ── Load / save ───────────────────────────────────────────────────────────────

export function loadCache(root: string): ScanCache {
  const p = cachePath(root);
  if (!existsSync(p)) return { entries: {} };
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'entries' in parsed) {
      return parsed as ScanCache;
    }
    log.warn('corrupt cache, resetting', { path: p });
  } catch {
    log.warn('corrupt cache, resetting', { path: p });
  }
  return { entries: {} };
}

export function saveCache(root: string, cache: ScanCache): void {
  const p = cachePath(root);
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    log.warn('cache write failed', { path: p, error: e instanceof Error ? e.message : String(e) });
  }
}

// ── Entry access ──────────────────────────────────────────────────────────────

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function getCachedFindings(
  filePath: string,
  content: string,
  cache: ScanCache,
  rulesVersion: string,
): Finding[] | null {
  const entry = cache.entries[filePath];
  if (!entry) { log.debug('cache miss', { file: filePath, reason: 'no entry' }); return null; }
  if (entry.rulesVersion !== rulesVersion) { log.debug('cache miss', { file: filePath, reason: 'version changed' }); return null; }
  if (entry.contentHash !== contentHash(content)) { log.debug('cache miss', { file: filePath, reason: 'content changed' }); return null; }
  log.debug('cache hit', { file: filePath });
  return entry.findings;
}

export function setCachedFindings(
  filePath: string,
  content: string,
  findings: Finding[],
  cache: ScanCache,
  rulesVersion: string,
): void {
  cache.entries[filePath] = {
    contentHash: contentHash(content),
    rulesVersion,
    findings,
    cachedAt: new Date().toISOString(),
  };
}

export function invalidateCache(root: string): void {
  saveCache(root, { entries: {} });
}

// ── Cached runReview wrapper ──────────────────────────────────────────────────

export interface CachedReviewOptions {
  scan: ScanResult;
  config: ThesmosConfig;
  changedFiles?: ChangedFile[];
  root: string;
  rulesVersion?: string;
  noCache?: boolean;
}

/**
 * Drop-in replacement for runReview() that uses the incremental cache.
 * Files whose content hasn't changed since the last scan return cached findings.
 */
export function runReviewCached(opts: CachedReviewOptions): Finding[] {
  const { scan, config, changedFiles = [], root, noCache = false } = opts;
  const version = opts.rulesVersion ?? PROMETHEUS_RULES.length.toString();

  if (noCache || changedFiles.length === 0) {
    const { runReview } = require('./review.js') as typeof import('./review.js');
    return runReview({ scan, config, changedFiles });
  }

  const cache = loadCache(root);
  const allFindings: Finding[] = [];
  const uncachedFiles: ChangedFile[] = [];

  for (const file of changedFiles) {
    const cached = getCachedFindings(file.path, file.content, cache, version);
    if (cached !== null) {
      allFindings.push(...cached);
    } else {
      uncachedFiles.push(file);
    }
  }

  if (uncachedFiles.length > 0) {
    const { runReview } = require('./review.js') as typeof import('./review.js');
    const freshFindings = runReview({ scan, config, changedFiles: uncachedFiles });

    // Group fresh findings back by file so we can cache per-file
    const byFile = new Map<string, Finding[]>();
    for (const f of freshFindings) {
      const list = byFile.get(f.file) ?? [];
      list.push(f);
      byFile.set(f.file, list);
    }

    for (const file of uncachedFiles) {
      const fileFindings = byFile.get(file.path) ?? [];
      setCachedFindings(file.path, file.content, fileFindings, cache, version);
      allFindings.push(...fileFindings);
    }

    saveCache(root, cache);
  }

  return allFindings;
}
