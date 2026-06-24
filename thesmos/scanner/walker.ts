/**
 * Recursive file walker — shared by the scanner and any other module
 * that needs a flat list of repo files. Returns relative paths from root.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface WalkOptions {
  ignoredFolders?: string[];
  maxDepth?: number;
}

const DEFAULT_IGNORED = new Set([
  'node_modules', '.git', '.next', 'out', '.vercel', 'dist',
]);

/** Returns all file paths under `root`, relative to `root`, sorted. */
export function walkFiles(root: string, options: WalkOptions = {}): string[] {
  const ignored = new Set(options.ignoredFolders ?? [...DEFAULT_IGNORED]);
  const maxDepth = options.maxDepth ?? 8;
  const results: string[] = [];

  function recurse(dir: string, depth: number): void {
    if (depth > maxDepth || !existsSync(dir)) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const abs = join(dir, entry.name);
      results.push(relative(root, abs));
      if (entry.isDirectory()) {
        recurse(abs, depth + 1);
      }
    }
  }

  recurse(root, 0);
  return results.sort();
}

/** Read a file, returning null on any error. */
export function readFileSafe(absPath: string): string | null {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

/** Count newline-delimited lines in a string. Empty string → 0. */
export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let n = 1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') n++;
  }
  return n;
}
