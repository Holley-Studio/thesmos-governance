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
import type { ChangedFile, InlineComment } from './types.js';
import { SUMMARY_MARKER } from './formatter.js';

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
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = [];

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
      // Skip deleted files — nothing to review
      if (file.status === 'removed') continue;

      // Skip generated/compiled files — dist/, build/, .map files contain vendor code
      if (/(?:^|[\\/])(?:node_modules|\.git|vendor|dist|build)(?:[\\/]|$)/.test(file.filename)) {
        core.debug(`Skipping generated file: ${file.filename}`);
        continue;
      }
      if (file.filename.endsWith('.js.map') || file.filename.endsWith('.ts.map')) {
        core.debug(`Skipping source map: ${file.filename}`);
        continue;
      }

      const absPath = join(workspace, file.filename);
      if (!existsSync(absPath)) continue;

      let content: string;
      try {
        content = readFileSync(absPath, 'utf8');
      } catch {
        core.debug(`Skipping unreadable file: ${file.filename}`);
        continue;
      }

      files.push({
        path: file.filename,
        content,
        diff: file.patch,
      });
    }
  }

  return files;
}

// ── Summary comment (upsert) ──────────────────────────────────────────────────

/**
 * Posts or updates the Thesmos summary comment on the PR.
 *
 * Searches existing comments for one containing SUMMARY_MARKER.
 * Updates it in-place if found; creates a new one otherwise.
 * This prevents duplicate comment spam on re-runs.
 */
export async function upsertSummaryComment(
  octokit: Octokit,
  ctx: PullRequestContext,
  body: string,
): Promise<void> {
  const { owner, repo, pullNumber } = ctx;

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
