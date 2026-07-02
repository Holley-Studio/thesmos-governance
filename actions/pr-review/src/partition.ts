// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * NEW vs PRE-EXISTING finding partitioning (diff-aware gating).
 *
 * Problem: runReview() re-scans the FULL content of every changed file, so a
 * one-line fix in a legacy file re-reports every finding already latent in
 * that file — blaming the PR for debt it didn't introduce.
 *
 * This module buckets findings using each file's diff info:
 *   NEW          — finding.line falls on an added/modified line, OR the file
 *                  itself is newly added (status: 'added') — everything in a
 *                  brand-new file counts as introduced by this PR, including
 *                  findings with no line number.
 *   PRE-EXISTING — everything else: findings on untouched lines of an
 *                  existing file, AND file-level findings (no line number)
 *                  on an existing file. A whole-file rule (e.g. "file too
 *                  large") firing on a file this PR only touched one line of
 *                  is not something this PR introduced — see the no-line-number
 *                  rule below.
 *
 * Deliberate simplification (documented per Task 4a #4): a file-level finding
 * (no `line`) on an EXISTING file always goes to PRE-EXISTING, even if the
 * rule was arguably provoked by this PR's change (e.g. a large-file rule that
 * only crossed its threshold because of lines this PR added). Distinguishing
 * "this PR pushed it over the line" from "it was already over the line" would
 * require diffing file-level metrics before/after, which is out of scope here.
 * The safe default is: no-line findings on existing files never block a PR.
 *
 * Findings on files OUTSIDE the changed set (Argus review, Phase 4a): rules
 * can attach findings to files that are not in the PR at all. Two classes:
 *
 *   (A) Scan-based findings on real, untouched workspace files (e.g.
 *       missing_api_auth on a route this PR never opened) — genuinely
 *       pre-existing repo debt. Default: PRE-EXISTING (non-blocking).
 *
 *   (B) Missing-artifact findings — presence rules that fire BECAUSE of
 *       content in this PR's changed files but attach the finding to the
 *       missing document they demand (e.g. EU_AI_001 BLOCKER attaches to
 *       '.thesmos/conformity-assessment.md', which does not exist — that is
 *       why the rule fired). Defaulting these to PRE-EXISTING would silently
 *       un-gate compliance BLOCKERs the moment this feature ships. These
 *       gate: NEW. The sanctioned escape hatch for accepted repo-state debt
 *       is the baseline (applied before partitioning), not silence.
 *
 * The two are separated by the `fileExists` callback: file exists on disk →
 * class A (PRE-EXISTING); file does not exist → class B (NEW). Without the
 * callback, all unknown-file findings default to PRE-EXISTING (previous
 * behavior, kept for pure unit tests).
 */

import { lineIsChanged, type ChangedLines } from './diff-lines.js';
import type { Finding } from './types.js';

export interface FileDiffInfo {
  /** GitHub file status: 'added' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'. */
  status?: string;
  /** Resolved changed-line set for this file (or ALL_LINES — see diff-lines.ts). */
  changedLines?: ChangedLines;
}

export interface PartitionResult {
  /** Findings introduced or touched by this PR — these gate the merge. */
  newFindings: Finding[];
  /** Findings that pre-date this PR in a touched file — informational only. */
  preExistingFindings: Finding[];
}

/**
 * Partitions findings into NEW (blocking) and PRE-EXISTING (informational)
 * buckets using per-file diff info.
 *
 * Pure and synchronous — no GitHub API calls, fully unit-testable.
 */
export function partitionNewVsPreExisting(
  findings: Finding[],
  filesByPath: Map<string, FileDiffInfo>,
  options: {
    /** Returns true if the path exists in the checked-out workspace. Used to
     *  split unknown-file findings: existing file → pre-existing scan debt;
     *  missing file → missing-artifact finding provoked by this PR → gates. */
    fileExists?: (path: string) => boolean;
  } = {},
): PartitionResult {
  const newFindings: Finding[] = [];
  const preExistingFindings: Finding[] = [];

  for (const finding of findings) {
    const fileInfo = filesByPath.get(finding.file);

    if (!fileInfo) {
      // File not in the PR's changed set — see header: class A vs class B.
      if (options.fileExists && !options.fileExists(finding.file)) {
        // Missing artifact (e.g. required compliance doc) demanded by content
        // this PR touches — fail CLOSED, it gates. Baseline it to accept.
        newFindings.push(finding);
      } else {
        preExistingFindings.push(finding);
      }
      continue;
    }

    if (fileInfo.status === 'added') {
      // The entire file is new to the repo — every finding in it (including
      // file-level findings with no line number) was introduced by this PR.
      newFindings.push(finding);
      continue;
    }

    if (finding.line !== undefined && fileInfo.changedLines !== undefined) {
      if (lineIsChanged(fileInfo.changedLines, finding.line)) {
        newFindings.push(finding);
        continue;
      }
    }

    // No line number on an existing file, or a line number outside the diff —
    // pre-existing debt in a touched file. Does not block.
    preExistingFindings.push(finding);
  }

  return { newFindings, preExistingFindings };
}
