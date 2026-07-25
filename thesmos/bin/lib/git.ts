// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Git helpers for obtaining changed files in review/validate commands.
 * execSync calls are side-effects; the returned ChangedFile objects are plain data.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChangedFile } from '../../review.ts';
import { stripGeneratedRegions } from '../../rules/helpers.ts';
import { makeLogger } from '../../logger.js';

const log = makeLogger('git');

// Git refs never need shell metacharacters. Rejecting anything else (and
// leading dashes) blocks both shell injection and git argument injection
// (e.g. --base='--output=/tmp/pwn').
const SAFE_GIT_REF_RE = /^[A-Za-z0-9_./@^~-]+$/;

function isSafeGitRef(ref: string): boolean {
  return SAFE_GIT_REF_RE.test(ref) && !ref.startsWith('-');
}

/**
 * Return changed files by diffing HEAD against `base`.
 * Files deleted in HEAD are excluded (they no longer exist on disk).
 */
export function getChangedFiles(
  root: string,
  base: string,
  ignoredFolders: string[] = [],
  reviewIgnorePaths: string[] = [],
): ChangedFile[] {
  if (!isSafeGitRef(base)) {
    log.warn('unsafe base ref rejected', { base });
    return [];
  }
  let names: string[];
  try {
    // execFileSync with an argument array — no shell, no interpolation.
    const out = execFileSync('git', ['diff', `${base}...HEAD`, '--name-only'], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    names = out.toString().trim().split('\n').filter(Boolean);
  } catch (e) {
    log.warn('git diff failed', { base, error: e instanceof Error ? e.message : String(e) });
    return [];
  }

  // Respect config.ignoredFolders — committed dist/ bundles and persona
  // catalogs intentionally contain bad-pattern examples and must not be
  // reviewed as application code.
  if (ignoredFolders.length > 0) {
    const ignored = new Set(ignoredFolders);
    names = names.filter((path) => !path.split('/').some((seg) => ignored.has(seg)));
  }

  names = filterReviewIgnoredPaths(names, reviewIgnorePaths);

  return names.flatMap((path) => {
    const absPath = join(root, path);
    if (!existsSync(absPath)) return []; // deleted file — skip
    try {
      // Generated sections (CLAUDE.md rules tables etc.) document rule patterns
      // as text and must not be reviewed as code — strip, preserving line count.
      const content = stripGeneratedRegions(readFileSync(absPath, 'utf8'));
      let diff: string | undefined;
      try {
        // Argument array again; `--` terminates options so path is data-only.
        diff = execFileSync('git', ['diff', `${base}...HEAD`, '--', path], {
          cwd: root,
          stdio: ['pipe', 'pipe', 'pipe'],
        }).toString();
      } catch (e) {
        log.warn('git diff (per-file) failed', { path, error: e instanceof Error ? e.message : String(e) });
        diff = undefined;
      }
      // Hunk ranges let runReview scope findings to the actual change — a
      // 2-line diff must not surface findings on the file's untouched lines.
      const changedRanges = diff === undefined ? undefined : parseChangedRanges(diff);
      return [{ path, content, diff, changedRanges }];
    } catch (e) {
      log.warn('file read failed', { path, error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  });
}

/**
 * Parse a unified diff into changed line ranges in the NEW file (1-based,
 * inclusive). Only lines actually added/modified count — context lines are
 * excluded, so the ranges are exact regardless of the diff's context width.
 * Deletion-only hunks get a single-point range at the deletion site so edits
 * that only remove lines still anchor nearby findings.
 */
export function parseChangedRanges(diff: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  // @@ -oldStart[,oldCount] +newStart[,newCount] @@
  const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  let newLine = 0; // next new-file line number while walking a hunk body
  let inHunk = false;
  let hunkHadAdditions = false;
  let hunkNewStart = 0;

  const closeHunk = () => {
    if (inHunk && !hunkHadAdditions) {
      // Deletion-only hunk: newCount is 0 and newStart points just BEFORE the
      // deletion site — anchor at max(start, 1) so the range stays valid.
      ranges.push({ start: Math.max(hunkNewStart, 1), end: Math.max(hunkNewStart, 1) });
    }
  };

  for (const line of diff.split('\n')) {
    const m = HUNK_RE.exec(line);
    if (m) {
      closeHunk();
      inHunk = true;
      hunkHadAdditions = false;
      hunkNewStart = Number(m[1]);
      newLine = hunkNewStart;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) {
      const last = ranges[ranges.length - 1];
      if (last && last.end === newLine - 1 && hunkHadAdditions) {
        last.end = newLine; // extend a contiguous run of added lines
      } else {
        ranges.push({ start: newLine, end: newLine });
      }
      hunkHadAdditions = true;
      newLine++;
    } else if (line.startsWith('-')) {
      // removed line — old file only, new-file counter does not advance
    } else if (line.startsWith(' ') || line === '') {
      newLine++; // context line
    } else {
      // "diff --git", "index", "\ No newline at end of file", etc. — a new
      // file header ends the current hunk body.
      if (line.startsWith('diff ')) { closeHunk(); inHunk = false; }
    }
  }
  closeHunk();
  return ranges;
}

/**
 * Drop paths matched by a config.reviewIgnorePaths prefix (repo-relative).
 * Distinct from ignoredFolders (segment match): prefixes let a repo exclude
 * a specific subtree — e.g. rule-definition sources that ARE the patterns
 * they detect — without ignoring every folder of that name.
 */
export function filterReviewIgnoredPaths(paths: string[], reviewIgnorePaths: string[]): string[] {
  if (reviewIgnorePaths.length === 0) return paths;
  return paths.filter((p) => !reviewIgnorePaths.some((prefix) => p.startsWith(prefix)));
}

/**
 * Read specific files from disk as ChangedFile records.
 * Non-existent or unreadable files are silently skipped.
 */
export function readFilesFromPaths(
  root: string,
  paths: string[],
  reviewIgnorePaths: string[] = [],
): ChangedFile[] {
  return filterReviewIgnoredPaths(paths, reviewIgnorePaths).flatMap((path) => {
    const absPath = join(root, path);
    try {
      const content = stripGeneratedRegions(readFileSync(absPath, 'utf8'));
      return [{ path, content }];
    } catch (e) {
      log.warn('file read failed', { path, error: e instanceof Error ? e.message : String(e) });
      return [];
    }
  });
}
