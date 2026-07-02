// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Unified diff (GitHub "patch") parsing for diff-aware gating.
 *
 * GitHub's `pulls.listFiles` API returns a `patch` field per changed file — a
 * standard unified diff body (no `diff --git` / `index` preamble, just hunks).
 * This module turns that into the set of NEW-side line numbers that were
 * actually added or modified, so findings can be bucketed into NEW (on a
 * touched line) vs PRE-EXISTING (everywhere else in the same file).
 *
 * Hunk header format: `@@ -a,b +c,d @@ optional trailing context`
 *   a,b = old-file start line / line count (b omitted means 1)
 *   c,d = new-file start line / line count (d omitted means 1)
 * We only need c (the new-file start line) to walk the new-side counter.
 */

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parses a unified diff patch body into the set of new-side line numbers
 * that were added or modified (i.e. every line prefixed with `+`).
 *
 * Handles:
 *   - Multiple hunks (each hunk header resets the new-side line counter)
 *   - "\ No newline at end of file" markers (skipped — not a content line)
 *   - Preamble lines before the first hunk header (e.g. rename metadata —
 *     ignored; nothing is counted until a `@@` header is seen)
 *   - A patch with zero hunks (pure rename, no content change) — returns
 *     an empty set, which is correct: nothing was added or modified.
 *
 * Does NOT handle a missing/undefined patch — see resolveChangedLines()
 * for the "GitHub omitted the patch" fallback.
 */
export function parseChangedLines(patch: string): Set<number> {
  const changed = new Set<number>();
  if (!patch) return changed;

  const lines = patch.split('\n');
  let newLine = 0;
  let inHunk = false;

  for (const line of lines) {
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      newLine = Number(hunkMatch[1]);
      inHunk = true;
      continue;
    }

    if (!inHunk) continue; // preamble before the first hunk (e.g. rename metadata)

    if (line.startsWith('\\')) {
      // "\ No newline at end of file" — not a content line, no counter change
      continue;
    }

    if (line.startsWith('+')) {
      changed.add(newLine);
      newLine++;
    } else if (line.startsWith('-')) {
      // Old-side-only line — the new-side counter does not advance
    } else {
      // Context line (starts with ' ', or is an edge-case blank line) —
      // present in both old and new files, so the new-side counter advances
      // but the line is not "changed".
      newLine++;
    }
  }

  return changed;
}

/** Sentinel meaning "treat every line in this file as changed". */
export const ALL_LINES = 'all' as const;

export type ChangedLines = Set<number> | typeof ALL_LINES;

/**
 * Resolves the changed-line set for a file, handling GitHub's documented
 * behavior of omitting `patch` entirely for large or binary files.
 *
 * `patch === undefined` → GitHub didn't send diff data for this file (too
 * large, or binary). We cannot know which lines changed, so — for safety,
 * to avoid silently hiding findings that may well be on new code — every
 * line is treated as changed (ALL_LINES).
 *
 * `patch` present (even with zero hunks, e.g. a pure rename) → parsed normally.
 */
export function resolveChangedLines(patch: string | undefined | null): ChangedLines {
  // == null catches both undefined AND null — a null patch must mean
  // "no diff data" (fail CLOSED → ALL_LINES), never fall through to
  // parseChangedLines('') semantics (empty set → nothing gates, fail OPEN).
  if (patch == null) return ALL_LINES;
  return parseChangedLines(patch);
}

/** True if `line` is within the changed-line set (or ALL_LINES applies). */
export function lineIsChanged(changedLines: ChangedLines, line: number): boolean {
  return changedLines === ALL_LINES || changedLines.has(line);
}
