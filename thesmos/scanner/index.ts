// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Scanner orchestrator — the only I/O entry point for the scan subsystem.
 * Coordinates walker, file categorizers, route extractors, and detector.
 */

import { join } from 'node:path';
import type { ThesmosConfig, ScanResult, LanguageStats } from '../types';
import { runDetector } from '../detector';
import { walkFiles, readFileSafe, countLines } from './walker';
import {
  findLargeFiles,
  findRiskyFiles,
  findStoreFiles,
  findTestFiles,
  findScriptFiles,
  findSharedUiFiles,
  findDesignSystemFiles,
  findEnvFiles,
  findClientBoundaryRisks,
  type FileEntry,
} from './files';
import { extractPageRoutes, extractApiRoutes } from './routes';

export const SCAN_VERSION = '2.0.0';

const SOURCE_EXTS = /\.(ts|tsx|js|jsx)$/;
const API_ROUTE_PATTERN = /^(app\/.*\/route\.(ts|js)|pages\/api\/.+\.(ts|js))$/;
const COMPONENT_PATTERN = /\.(tsx|jsx)$/;
const TEST_SKIP = /\.(test|spec)\./;

// ── Excluded path segments for language counting ──────────────────────────────

const EXCLUDED_DIRS = /(?:^|[\\/])(?:node_modules|\.git|vendor|dist|build)(?:[\\/]|$)/;

// ── Extension → language mapping ──────────────────────────────────────────────

const EXT_TO_LANG: Record<string, string> = {
  '.ts':   'TypeScript',
  '.tsx':  'TypeScript',
  '.js':   'JavaScript',
  '.jsx':  'JavaScript',
  '.mjs':  'JavaScript',
  '.cjs':  'JavaScript',
  '.py':   'Python',
  '.go':   'Go',
  '.rb':   'Ruby',
  '.rs':   'Rust',
  '.java': 'Java',
};

// Representative extension per language (used in LanguageStats.extension)
const LANG_PRIMARY_EXT: Record<string, string> = {
  TypeScript: '.ts',
  JavaScript: '.js',
  Python:     '.py',
  Go:         '.go',
  Ruby:       '.rb',
  Rust:       '.rs',
  Java:       '.java',
  Other:      '',
};

/**
 * Count source files by language and compute total line counts.
 * Files under node_modules, .git, vendor, dist, build are excluded.
 */
export function computeLanguageStats(
  paths: string[],
  lineCounter: (p: string) => number,
): LanguageStats[] {
  const langFiles = new Map<string, { fileCount: number; lineCount: number; ext: string }>();

  for (const p of paths) {
    if (EXCLUDED_DIRS.test(p)) continue;
    const dotIdx = p.lastIndexOf('.');
    if (dotIdx === -1) continue;
    const ext = p.slice(dotIdx).toLowerCase();
    const lang = EXT_TO_LANG[ext] ?? 'Other';
    const current = langFiles.get(lang) ?? { fileCount: 0, lineCount: 0, ext: LANG_PRIMARY_EXT[lang] ?? ext };
    current.fileCount += 1;
    current.lineCount += lineCounter(p);
    langFiles.set(lang, current);
  }

  return [...langFiles.entries()]
    .sort((a, b) => b[1].fileCount - a[1].fileCount || a[0].localeCompare(b[0]))
    .map(([language, { fileCount, lineCount, ext }]) => ({
      language,
      extension: ext,
      fileCount,
      lineCount,
    }));
}

// ── Tech stack detection from manifest files ──────────────────────────────────

/**
 * Detect primary tech stacks from file presence in the repo.
 */
export function detectStacks(allPaths: string[]): string[] {
  const stacks: string[] = [];

  // Check root-level manifest files
  const rootFiles = new Set(allPaths.filter((p) => !p.includes('/')));

  if (rootFiles.has('go.mod')) stacks.push('Go');
  if (rootFiles.has('Gemfile')) stacks.push('Ruby/Rails');
  if (
    rootFiles.has('requirements.txt') ||
    rootFiles.has('pyproject.toml') ||
    rootFiles.has('setup.py')
  ) stacks.push('Python');
  if (rootFiles.has('Cargo.toml')) stacks.push('Rust');
  if (rootFiles.has('package.json')) stacks.push('Node.js');

  // next.config.* can appear with various extensions
  const hasNextConfig = allPaths.some((p) => /(?:^|\/)next\.config\.[^/]+$/.test(p) && !p.includes('/node_modules/'));
  if (hasNextConfig) stacks.push('Next.js');

  return stacks;
}

/** Produce a full ScanResult for the repository at `root`.
 * @param now - ISO timestamp for generatedAt; defaults to current time. Inject in tests for determinism. */
export function runScanner(root: string, config: ThesmosConfig, now?: string): ScanResult {
  const ignored = config.ignoredFolders;
  const allPaths = walkFiles(root, { ignoredFolders: ignored });

  const sourcePaths = allPaths.filter((p) => SOURCE_EXTS.test(p));

  // Read source files — needed for line counting, route analysis, and boundary risk detection
  const sourceEntries = sourcePaths.map((p) => {
    const content = readFileSafe(join(root, p)) ?? '';
    return { path: p, lines: countLines(content), content };
  });

  const fileEntries: FileEntry[] = sourceEntries.map(({ path, lines }) => ({ path, lines }));

  const routeFiles = sourceEntries.filter((f) => API_ROUTE_PATTERN.test(f.path));

  // Pass precomputed paths and source files so detector avoids double-walking
  const detector = runDetector(root, allPaths, sourceEntries);

  const componentCount = allPaths.filter(
    (p) => COMPONENT_PATTERN.test(p) && !TEST_SKIP.test(p) && !/^scripts\//.test(p)
  ).length;

  // Build a line-count lookup for the source files already read, to avoid re-reading
  const lineCountCache = new Map<string, number>(
    sourceEntries.map(({ path, lines }) => [path, lines])
  );

  // Language stats: count every file (not just JS/TS), reading unknown files on demand
  const languages = computeLanguageStats(allPaths, (p) => {
    if (lineCountCache.has(p)) return lineCountCache.get(p)!;
    const content = readFileSafe(join(root, p)) ?? '';
    const n = countLines(content);
    lineCountCache.set(p, n);
    return n;
  });

  const detectedStacks = detectStacks(allPaths);

  return {
    _generatedSections: ['scan', 'routes'],
    generatedAt: now ?? new Date().toISOString(),
    scanVersion: SCAN_VERSION,
    pages: extractPageRoutes(allPaths, detector.framework),
    apiRoutes: extractApiRoutes(routeFiles, detector.framework),
    componentCount,
    sharedUiFiles: findSharedUiFiles(allPaths),
    designSystemFiles: findDesignSystemFiles(allPaths),
    storeFiles: findStoreFiles(allPaths),
    testFiles: findTestFiles(allPaths),
    largeFiles: findLargeFiles(fileEntries, config.largeFileThreshold),
    riskyFiles: findRiskyFiles(allPaths, config.scan?.riskyFilePatterns ?? []),
    scriptFiles: findScriptFiles(allPaths),
    envFiles: findEnvFiles(allPaths),
    clientBoundaryRisks: findClientBoundaryRisks(sourceEntries),
    languages,
    detectedStacks,
    detector,
  };
}
