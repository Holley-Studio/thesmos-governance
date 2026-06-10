/**
 * Scanner orchestrator — the only I/O entry point for the scan subsystem.
 * Coordinates walker, file categorizers, route extractors, and detector.
 */

import { join } from 'node:path';
import type { PrometheusConfig, ScanResult } from '../types';
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

/** Produce a full ScanResult for the repository at `root`.
 * @param now - ISO timestamp for generatedAt; defaults to current time. Inject in tests for determinism. */
export function runScanner(root: string, config: PrometheusConfig, now?: string): ScanResult {
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
    detector,
  };
}
