// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Pure file-categorization functions. All inputs are arrays of relative paths
 * or { path, lines } entries — no fs access.
 */

import type { ClientBoundaryRisk, LargeFile } from '../types';

export interface FileEntry {
  path: string;
  lines: number;
}

/** Files whose line count exceeds `threshold`, sorted by lines desc. */
export function findLargeFiles(entries: FileEntry[], threshold: number): LargeFile[] {
  return entries
    .filter((e) => e.lines > threshold)
    .map((e) => ({ file: e.path, lines: e.lines }))
    .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));
}

/**
 * Files whose path matches any of the provided regex patterns.
 * Invalid patterns are silently skipped.
 */
export function findRiskyFiles(paths: string[], patterns: string[]): string[] {
  if (patterns.length === 0) return [];
  const regexes = patterns.flatMap((p) => {
    try { return [new RegExp(p)]; } catch { return []; }
  });
  return paths.filter((p) => regexes.some((re) => re.test(p))).sort();
}

/** Files that look like state stores (Zustand, Redux, Jotai, etc.). */
export function findStoreFiles(paths: string[]): string[] {
  return paths
    .filter(
      (p) =>
        /\bstores?\b/.test(p) ||
        /\.store\.(ts|tsx|js|jsx)$/.test(p) ||
        /[Ss]lice\.(ts|tsx|js|jsx)$/.test(p)
    )
    .sort();
}

/** Test and spec files. */
export function findTestFiles(paths: string[]): string[] {
  return paths
    .filter(
      (p) =>
        /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p) ||
        /(^|\/)__tests__\//.test(p)
    )
    .sort();
}

/** Scripts in the top-level `scripts/` directory. */
export function findScriptFiles(paths: string[]): string[] {
  return paths.filter((p) => /^scripts\//.test(p)).sort();
}

/** Shared UI component files (e.g. components/ui/, ui/, shared/components/). */
export function findSharedUiFiles(paths: string[]): string[] {
  return paths
    .filter(
      (p) =>
        /^components\/ui\//.test(p) ||
        /^ui\//.test(p) ||
        /^shared\/components\//.test(p) ||
        /^src\/components\/ui\//.test(p) ||
        /^src\/ui\//.test(p)
    )
    .sort();
}

/** Design-system / token files (theme, design-tokens, styles/, tokens/). */
export function findDesignSystemFiles(paths: string[]): string[] {
  return paths
    .filter(
      (p) =>
        /design.?system/i.test(p) ||
        /design.?tokens?/i.test(p) ||
        /\btheme\b/.test(p) ||
        /^styles\//.test(p) ||
        /^tokens\//.test(p)
    )
    .sort();
}

/** .env files (dotenv, .env.local, .env.production, etc.). */
export function findEnvFiles(paths: string[]): string[] {
  return paths
    .filter((p) => /(^|\/)\.env(\.|$)/.test(p) || /(^|\/)\.env$/.test(p))
    .sort();
}

/**
 * Detect client-component files that cross the server/client boundary.
 * Checks for admin-client imports, server-only imports, and direct env access
 * inside files that declare 'use client'.
 */
export function findClientBoundaryRisks(
  files: ReadonlyArray<{ path: string; content: string }>
): ClientBoundaryRisk[] {
  const risks: ClientBoundaryRisk[] = [];

  for (const { path, content } of files) {
    const isClient =
      content.includes("'use client'") || content.includes('"use client"');
    if (!isClient) continue;

    if (content.includes('supabase/admin') || content.includes('supabase/service')) {
      risks.push({ file: path, risk: 'admin-client' });
    } else if (content.includes('server-only') || content.includes('next/headers')) {
      risks.push({ file: path, risk: 'server-only-import' });
    } else if (/process\.env\.[A-Z_]/.test(content)) {
      risks.push({ file: path, risk: 'direct-env-access' });
    }
  }

  return risks.sort((a, b) => a.file.localeCompare(b.file));
}
