// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Git operations for autopilot sessions.
 * All operations use execSync with explicit cwd — never rely on process.cwd().
 * Every function that writes to the repo documents what it does and why.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugFromTitle } from './plan-parser.js';

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch (err) {
    const msg = err instanceof Error ? (err as NodeJS.ErrnoException).message : String(err);
    throw new Error(`git ${args[0]}: ${msg}`);
  }
}

function gitSafe(root: string, args: string[]): string {
  try {
    return git(root, args);
  } catch {
    return '';
  }
}

// ── State queries ─────────────────────────────────────────────────────────────

export function getCurrentBranch(root: string): string {
  return gitSafe(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
}

export function getLastCommitHash(root: string): string {
  return gitSafe(root, ['rev-parse', 'HEAD']).slice(0, 8);
}

export function doesBranchExist(root: string, branch: string): boolean {
  const result = gitSafe(root, ['branch', '--list', branch]);
  return result.includes(branch);
}

export function doesTagExist(root: string, tag: string): boolean {
  const result = gitSafe(root, ['tag', '--list', tag]);
  return result.trim() === tag;
}

export function getChangedFilesSinceLastCommit(root: string): string[] {
  const result = gitSafe(root, ['diff', '--name-only', 'HEAD']);
  return result ? result.split('\n').filter(Boolean) : [];
}

export function getChangedFilesInCommit(root: string, commitHash: string): string[] {
  const result = gitSafe(root, ['diff-tree', '--no-commit-id', '-r', '--name-only', commitHash]);
  return result ? result.split('\n').filter(Boolean) : [];
}

export function getRemoteUrl(root: string): string | null {
  const result = gitSafe(root, ['remote', 'get-url', 'origin']);
  return result || null;
}

export function detectPreCommitHooks(root: string): string[] {
  const hooks: string[] = [];
  const candidates = [
    join(root, '.git', 'hooks', 'pre-commit'),
    join(root, '.husky', 'pre-commit'),
    join(root, '.husky', 'commit-msg'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) hooks.push(p.replace(root + '/', ''));
  }
  return hooks;
}

export function isGitRepo(root: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function hasUncommittedChanges(root: string): boolean {
  const result = gitSafe(root, ['status', '--porcelain']);
  return result.trim().length > 0;
}

// ── Session branch management ─────────────────────────────────────────────────

export function createAutopilotBranch(root: string, planTitle: string, sessionId: string): string {
  const slug = slugFromTitle(planTitle);
  const branch = `autopilot/${slug}-${sessionId}`;

  if (doesBranchExist(root, branch)) {
    throw new Error(`Branch "${branch}" already exists. Use --resume to continue an existing session.`);
  }

  git(root, ['checkout', '-b', branch]);
  return branch;
}

export function checkoutBranch(root: string, branch: string): void {
  git(root, ['checkout', branch]);
}

export function deleteBranch(root: string, branch: string): void {
  git(root, ['branch', '-D', branch]);
}

// ── Restore tag — marks the state of main before the session touched anything ─

export function createRestoreTag(root: string, sessionId: string): string {
  const tag = `thesmos-pre-autopilot-${sessionId}`;
  if (!doesTagExist(root, tag)) {
    git(root, ['tag', tag]);
  }
  return tag;
}

export function deleteRestoreTag(root: string, sessionId: string): void {
  const tag = `thesmos-pre-autopilot-${sessionId}`;
  if (doesTagExist(root, tag)) {
    gitSafe(root, ['tag', '-d', tag]);
  }
}

// ── Per-task stash — ensures clean restart if session is interrupted mid-task ─

export function stashPreTask(root: string, sessionId: string, taskIndex: number): string | null {
  if (!hasUncommittedChanges(root)) return null;

  const message = `thesmos-autopilot-${sessionId}-pre-task-${taskIndex}`;
  git(root, ['stash', 'push', '-m', message, '--include-untracked']);

  // Get the stash ref we just created
  const list = gitSafe(root, ['stash', 'list']);
  const match = list.split('\n').find((l) => l.includes(message));
  return match ? match.split(':')[0]?.trim() ?? null : null;
}

export function popStash(root: string, stashRef: string): void {
  gitSafe(root, ['stash', 'pop', stashRef]);
}

export function dropStash(root: string, stashRef: string): void {
  gitSafe(root, ['stash', 'drop', stashRef]);
}

// ── Committing completed task work ────────────────────────────────────────────

export function stageAll(root: string): void {
  git(root, ['add', '-A']);
}

export function commitTask(root: string, taskTitle: string, taskIndex: number): string {
  stageAll(root);
  const message = `autopilot: task ${taskIndex + 1} — ${taskTitle}\n\nExecuted by Thesmos Autopilot. Review the session journal before merging.`;
  git(root, ['commit', '-m', message]);
  return getLastCommitHash(root);
}

// ── Reverting a session (deletes branch, removes tag) ────────────────────────

export function revertSession(root: string, branch: string, sessionId: string, baseBranch: string): void {
  const current = getCurrentBranch(root);
  if (current === branch) {
    git(root, ['checkout', baseBranch]);
  }
  if (doesBranchExist(root, branch)) {
    deleteBranch(root, branch);
  }
  deleteRestoreTag(root, sessionId);
}

// ── Pushing for PR creation ───────────────────────────────────────────────────

export function pushBranch(root: string, branch: string): void {
  git(root, ['push', '-u', 'origin', branch]);
}

export function createDraftPR(root: string, branch: string, title: string, body: string): string {
  try {
    const result = execFileSync(
      'gh',
      ['pr', 'create', '--title', title, '--body-file', '-', '--draft', '--head', branch],
      {
        cwd: root,
        input: body,
        stdio: ['pipe', 'pipe', 'pipe'],
        encoding: 'utf8',
      }
    );
    return result.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to create PR: ${msg}`);
  }
}

// ── Scope audit — detects files changed outside declared task scope ───────────

export function auditScope(root: string, declaredScope: string[], commitHash: string): string[] {
  const changed = getChangedFilesInCommit(root, commitHash);
  const outOfScope: string[] = [];

  for (const file of changed) {
    const inScope = declaredScope.some((scope) =>
      file.startsWith(scope) || file === scope
    );
    if (!inScope) outOfScope.push(file);
  }

  return outOfScope;
}

// ── Package audit — detects package.json changes not in allowed list ──────────

/** Checks a committed package.json change against the allowed list. */
export function auditPackages(root: string, allowedPackages: string[], commitHash: string): string[] {
  const changed = getChangedFilesInCommit(root, commitHash);
  if (!changed.some((f) => f === 'package.json')) return [];

  try {
    const before = gitSafe(root, ['show', `${commitHash}~1:package.json`]);
    const after = gitSafe(root, ['show', `${commitHash}:package.json`]);
    if (!before || !after) return [];
    return findUnauthorizedAdded(before, after, allowedPackages);
  } catch {
    return [];
  }
}

/** Checks uncommitted package.json changes (before commit) against the allowed list. */
export function auditUncommittedPackages(root: string, allowedPackages: string[]): string[] {
  const changedFiles = getChangedFilesSinceLastCommit(root);
  if (!changedFiles.some((f) => f === 'package.json')) return [];

  try {
    const before = gitSafe(root, ['show', 'HEAD:package.json']);
    const pkgPath = join(root, 'package.json');
    if (!before || !existsSync(pkgPath)) return [];
    const after = readFileSync(pkgPath, 'utf8');
    return findUnauthorizedAdded(before, after, allowedPackages);
  } catch {
    return [];
  }
}

function findUnauthorizedAdded(before: string, after: string, allowedPackages: string[]): string[] {
  const depsBefore = extractDeps(before);
  const depsAfter = extractDeps(after);
  const added = depsAfter.filter((d) => !depsBefore.includes(d));
  return added.filter((dep) => {
    const baseName = dep.split('@')[0] ?? dep;
    return !allowedPackages.some(
      (allowed) => (allowed.split('@')[0] ?? allowed) === baseName || allowed === dep
    );
  });
}

function extractDeps(pkgJson: string): string[] {
  try {
    const pkg = JSON.parse(pkgJson) as Record<string, unknown>;
    const deps = { ...(pkg['dependencies'] as Record<string, unknown> ?? {}), ...(pkg['devDependencies'] as Record<string, unknown> ?? {}) };
    return Object.keys(deps);
  } catch {
    return [];
  }
}
