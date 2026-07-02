// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * GitHub API interactions for the Thesmos Governance PR Review Action.
 *
 * Responsibilities:
 *   - Read PR metadata and changed files (with content + diff)
 *   - Upsert the summary comment (edit existing, not duplicate)
 *   - Post inline review comments (best-effort; tolerates diff misses)
 */

import * as core from '@actions/core';
import * as gh from '@actions/github';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripGeneratedRegions } from 'thesmos-governance';
import type { ChangedFile, InlineComment } from './types.js';
import { SUMMARY_MARKER } from './formatter.js';
import { resolveChangedLines } from './diff-lines.js';

type Octokit = ReturnType<typeof gh.getOctokit>;

// ── PR context ────────────────────────────────────────────────────────────────

export interface PullRequestContext {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  baseRef: string;
  repoName: string;
}

/**
 * Extracts PR context from the GitHub Actions event payload.
 * Throws if the action is not running on a pull_request event.
 */
export function getPullRequestContext(): PullRequestContext {
  const { eventName, payload, repo } = gh.context;

  if (eventName !== 'pull_request' && eventName !== 'pull_request_target') {
    throw new Error(
      `Thesmos PR Review must run on a pull_request event (got: ${eventName})`,
    );
  }

  const pr = payload.pull_request;
  if (!pr) throw new Error('pull_request payload is missing');

  return {
    owner: repo.owner,
    repo: repo.repo,
    pullNumber: pr.number as number,
    headSha: (pr.head as { sha: string }).sha,
    baseRef: (pr.base as { ref: string }).ref,
    repoName: `${repo.owner}/${repo.repo}`,
  };
}

// ── Changed files ─────────────────────────────────────────────────────────────

/**
 * Returns the list of files changed in the PR as ChangedFile objects.
 *
 * File content is read from GITHUB_WORKSPACE (the checked-out repo).
 * The diff/patch text comes from the GitHub API.
 * Deleted files are excluded.
 */
export async function getChangedFiles(
  octokit: Octokit,
  ctx: PullRequestContext,
  workspace: string,
  reviewIgnorePaths: string[] = [],
): Promise<{ files: ChangedFile[]; governanceFilesModified: string[] }> {
  const files: ChangedFile[] = [];

  // Governance control files: the baseline and config this very review loads
  // from the PR's own checkout. They live under .thesmos/ which is filtered
  // out of `files` below — so tampering MUST be detected here, on the raw
  // API list, before the prefix filter. (Argus ruling, Phase 4b item 3.)
  const GOVERNANCE_CONTROL_FILES = new Set(['.thesmos/baseline.json', '.thesmos/config.json']);
  const governanceFilesModified: string[] = [];

  // Directories whose contents should never be reviewed — they contain
  // governance rule templates that intentionally describe bad patterns.
  // The repo's own config.reviewIgnorePaths (prefix-match) merges in so
  // the action honors the same exclusions as the CLI gates.
  const IGNORED_PREFIXES = [
    ...reviewIgnorePaths,
    '.claude/',
    '.thesmos/',
    '.cursor/',
    'dist/',
    'thesmos/dist/',
    'actions/pr-review/dist/',
    'coverage/',
    'node_modules/',
    // Agent persona files — they intentionally contain example attack patterns
    // (SQL injection lessons, threat-model snippets) as teaching material.
    'pantheon/',
    'thesmos/catalog/agents/',
    'website/downloads/',
  ];

  // Paginate through all changed files (PRs can have >100 files)
  for await (const response of octokit.paginate.iterator(
    octokit.rest.pulls.listFiles,
    {
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.pullNumber,
      per_page: 100,
    },
  )) {
    for (const file of response.data) {
      if (GOVERNANCE_CONTROL_FILES.has(file.filename)) {
        governanceFilesModified.push(file.filename);
      }

      // Skip deleted files — nothing to review
      if (file.status === 'removed') continue;

      // Skip governance/generated directories — they describe bad patterns
      // intentionally and would self-trigger false BLOCKERs.
      if (IGNORED_PREFIXES.some((prefix) => file.filename.startsWith(prefix)))
        continue;

      // Skip source map files
      if (file.filename.endsWith('.js.map') || file.filename.endsWith('.ts.map'))
        continue;

      const absPath = join(workspace, file.filename);
      if (!existsSync(absPath)) continue;

      let content: string;
      try {
        // Generated sections (CLAUDE.md rules tables etc.) document rule
        // patterns as text — strip them (line count preserved) so the rules
        // they describe do not fire on their own documentation.
        content = stripGeneratedRegions(readFileSync(absPath, 'utf8'));
      } catch {
        core.debug(`Skipping unreadable file: ${file.filename}`);
        continue;
      }

      if (file.patch == null && file.status !== 'added') {
        // GitHub omitted the patch (file too large or binary) — diff-aware
        // gating fails CLOSED for this file: every finding in it is treated
        // as NEW and can block. Surface why, so a "legacy" finding blocking
        // the gate is explainable. (Argus ruling, Phase 4a item 1.)
        core.info(
          `No patch data for ${file.filename} (large/binary) — ` +
            `treating ALL lines as changed; findings in it will gate.`,
        );
      }
      files.push({
        path: file.filename,
        content,
        diff: file.patch,
        // Diff-aware gating (Task 4a): status distinguishes brand-new files
        // (everything in them is "introduced by this PR") from modified
        // existing files, and changedLines pinpoints exactly which lines in
        // an existing file were touched — see partition.ts.
        status: file.status,
        changedLines: resolveChangedLines(file.patch),
      });
    }
  }

  return { files, governanceFilesModified };
}

// ── Summary comment (upsert) ──────────────────────────────────────────────────

/**
 * Posts or updates the Thesmos summary comment on the PR.
 *
 * Searches existing comments for one containing SUMMARY_MARKER.
 * Updates it in-place if found; creates a new one otherwise.
 * This prevents duplicate comment spam on re-runs.
 */
// GitHub issue comment body limit is 65536 characters.
const GH_COMMENT_MAX = 65_000;

export async function upsertSummaryComment(
  octokit: Octokit,
  ctx: PullRequestContext,
  body: string,
): Promise<void> {
  const { owner, repo, pullNumber } = ctx;

  if (body.length > GH_COMMENT_MAX) {
    const notice =
      '\n\n---\n_⚠️ Comment truncated — too many findings to display in full. ' +
      'Run `thesmos scan` locally for the complete report._';
    body = body.slice(0, GH_COMMENT_MAX - notice.length) + notice;
  }

  // Find existing summary comment
  let existingCommentId: number | undefined;

  for await (const response of octokit.paginate.iterator(
    octokit.rest.issues.listComments,
    { owner, repo, issue_number: pullNumber, per_page: 100 },
  )) {
    for (const comment of response.data) {
      if (comment.body?.includes(SUMMARY_MARKER)) {
        existingCommentId = comment.id;
        break;
      }
    }
    if (existingCommentId) break;
  }

  if (existingCommentId !== undefined) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingCommentId,
      body,
    });
    core.info(`Updated existing Thesmos summary comment (#${existingCommentId})`);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
    core.info('Created Thesmos summary comment');
  }
}

// ── Inline review comments ────────────────────────────────────────────────────

/**
 * Posts inline review comments on the PR diff.
 *
 * Uses pulls.createReview with event: 'COMMENT' so it doesn't
 * block the merge (REQUEST_CHANGES requires explicit dismiss).
 *
 * If GitHub rejects any comment (line not in diff → 422), the entire
 * review creation fails. We retry with no inline comments so the
 * summary always posts correctly.
 */
export async function postInlineReview(
  octokit: Octokit,
  ctx: PullRequestContext,
  comments: InlineComment[],
): Promise<void> {
  if (comments.length === 0) return;

  const { owner, repo, pullNumber, headSha } = ctx;

  const reviewComments = comments.map((c) => ({
    path: c.path,
    line: c.line,
    side: 'RIGHT' as const,
    body: c.body,
  }));

  try {
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number: pullNumber,
      commit_id: headSha,
      event: 'COMMENT',
      body: '', // Summary is in the separate issue comment
      comments: reviewComments,
    });
    core.info(`Posted ${comments.length} inline review comment(s)`);
  } catch (err) {
    // Some lines may not be in the diff — retry without inline comments
    // so the action never hard-fails due to comment placement issues
    core.warning(
      `Could not post inline comments (some lines may be outside the diff): ${String(err)}\n` +
        `All findings are still visible in the summary comment.`,
    );

    // Retry with no comments — just create an empty-body review to signal completion
    try {
      await octokit.rest.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: headSha,
        event: 'COMMENT',
        body: '',
      });
    } catch {
      // If even the empty review fails, that's fine — summary comment is enough
    }
  }
}
