/**
 * Git helpers for obtaining changed files in review/validate commands.
 * execSync calls are side-effects; the returned ChangedFile objects are plain data.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFile } from '../../review.ts';

/**
 * Return changed files by diffing HEAD against `base`.
 * Files deleted in HEAD are excluded (they no longer exist on disk).
 */
export function getChangedFiles(root: string, base: string): ChangedFile[] {
  let names: string[];
  try {
    const out = execSync(`git diff "${base}"...HEAD --name-only`, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    names = out.toString().trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }

  return names.flatMap((path) => {
    const absPath = join(root, path);
    if (!existsSync(absPath)) return []; // deleted file — skip
    try {
      const content = readFileSync(absPath, 'utf8');
      let diff: string | undefined;
      try {
        diff = execSync(`git diff "${base}"...HEAD -- "${path}"`, {
          cwd: root,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).toString();
      } catch {
        diff = undefined;
      }
      return [{ path, content, diff }];
    } catch {
      return [];
    }
  });
}

/**
 * Read specific files from disk as ChangedFile records.
 * Non-existent or unreadable files are silently skipped.
 */
export function readFilesFromPaths(root: string, paths: string[]): ChangedFile[] {
  return paths.flatMap((path) => {
    const absPath = join(root, path);
    try {
      const content = readFileSync(absPath, 'utf8');
      return [{ path, content }];
    } catch {
      return [];
    }
  });
}
