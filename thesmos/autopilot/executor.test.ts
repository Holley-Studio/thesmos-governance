// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Tests for the rollback untracked-file cleanup invariant.
 *
 * These tests verify getUntrackedFiles() in isolation and prove that the
 * executor's pre/post-task snapshot pattern correctly identifies only files
 * created during a task — preserving pre-existing untracked files and never
 * removing files that were present before the task started.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { getUntrackedFiles } from './git-ops.js';

let testRoot: string;

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), 'thesmos-executor-test-'));
  execSync('git init', { cwd: testRoot });
  execSync('git config user.email "test@test.com"', { cwd: testRoot });
  execSync('git config user.name "Test"', { cwd: testRoot });
  execSync('git commit --allow-empty -m "init"', { cwd: testRoot });
});

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('getUntrackedFiles', () => {
  it('returns empty array when no untracked files exist', () => {
    const files = getUntrackedFiles(testRoot);
    expect(files).toEqual([]);
  });

  it('returns newly created files that are not git-tracked', () => {
    writeFileSync(join(testRoot, 'new-file.ts'), 'const x = 1;');
    const files = getUntrackedFiles(testRoot);
    expect(files).toContain('new-file.ts');
  });

  it('does not return files that have been git-added', () => {
    writeFileSync(join(testRoot, 'tracked.ts'), 'const x = 1;');
    execSync('git add tracked.ts', { cwd: testRoot });
    const files = getUntrackedFiles(testRoot);
    // staged files are tracked by git index, not "untracked"
    expect(files).not.toContain('tracked.ts');
  });

  it('does not return committed files', () => {
    writeFileSync(join(testRoot, 'committed.ts'), 'const x = 1;');
    execSync('git add committed.ts', { cwd: testRoot });
    execSync('git commit -m "add committed"', { cwd: testRoot });
    const files = getUntrackedFiles(testRoot);
    expect(files).not.toContain('committed.ts');
  });

  it('returns an array safely when the directory is not a git repo', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'not-a-git-'));
    try {
      const files = getUntrackedFiles(nonGitDir);
      // gitSafe catches the error and returns '' → []
      expect(Array.isArray(files)).toBe(true);
      expect(files).toEqual([]);
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});

describe('rollback untracked file cleanup invariant', () => {
  it('correctly identifies files created after a pre-task snapshot', () => {
    // Baseline: one committed file, no untracked files
    writeFileSync(join(testRoot, 'pre-existing.ts'), 'old');
    execSync('git add pre-existing.ts && git commit -m "add pre"', { cwd: testRoot });

    // Take pre-task snapshot — executor does this before running the adapter
    const preTaskUntracked = new Set(getUntrackedFiles(testRoot));
    expect(preTaskUntracked.size).toBe(0);

    // Task creates a new untracked file
    writeFileSync(join(testRoot, 'task-created.ts'), 'new');

    // Rollback: compute newFiles as executor does
    const postRollbackUntracked = getUntrackedFiles(testRoot);
    const newFiles = postRollbackUntracked.filter(f => !preTaskUntracked.has(f));

    expect(newFiles).toContain('task-created.ts');
    expect(newFiles).not.toContain('pre-existing.ts');

    // Simulate executor cleanup
    for (const f of newFiles) {
      unlinkSync(join(testRoot, f));
    }
    expect(existsSync(join(testRoot, 'task-created.ts'))).toBe(false);
    // Committed file is untouched
    expect(existsSync(join(testRoot, 'pre-existing.ts'))).toBe(true);
  });

  it('does not remove pre-existing untracked files during cleanup', () => {
    // A file that was untracked before the task started
    writeFileSync(join(testRoot, 'pre-untracked.ts'), 'old untracked');

    // Pre-task snapshot includes this pre-existing untracked file
    const preTaskUntracked = new Set(getUntrackedFiles(testRoot));
    expect(preTaskUntracked.has('pre-untracked.ts')).toBe(true);

    // Task creates another new file
    writeFileSync(join(testRoot, 'task-new.ts'), 'task output');

    // Rollback cleanup: only task-new.ts should be in newFiles
    const postRollbackUntracked = getUntrackedFiles(testRoot);
    const newFiles = postRollbackUntracked.filter(f => !preTaskUntracked.has(f));

    expect(newFiles).toContain('task-new.ts');
    expect(newFiles).not.toContain('pre-untracked.ts');

    // Simulate cleanup
    for (const f of newFiles) {
      unlinkSync(join(testRoot, f));
    }
    // Pre-existing untracked file must survive
    expect(existsSync(join(testRoot, 'pre-untracked.ts'))).toBe(true);
    expect(existsSync(join(testRoot, 'task-new.ts'))).toBe(false);
  });

  it('handles multiple task-created files in one pass', () => {
    const preTaskUntracked = new Set(getUntrackedFiles(testRoot));

    // Task creates several files
    writeFileSync(join(testRoot, 'alpha.ts'), 'a');
    writeFileSync(join(testRoot, 'beta.ts'), 'b');
    writeFileSync(join(testRoot, 'gamma.ts'), 'c');

    const postUntracked = getUntrackedFiles(testRoot);
    const newFiles = postUntracked.filter(f => !preTaskUntracked.has(f));

    expect(newFiles.sort()).toEqual(['alpha.ts', 'beta.ts', 'gamma.ts']);

    // All three get cleaned up
    for (const f of newFiles) {
      unlinkSync(join(testRoot, f));
    }
    expect(getUntrackedFiles(testRoot)).toEqual([]);
  });

  it('produces an empty newFiles set when the task created no untracked files', () => {
    const preTaskUntracked = new Set(getUntrackedFiles(testRoot));

    // Task only modifies an already-committed file (no new untracked files)
    writeFileSync(join(testRoot, 'existing.ts'), 'content');
    execSync('git add existing.ts && git commit -m "add existing"', { cwd: testRoot });
    // Overwrite content — this is a tracked modification, not untracked
    writeFileSync(join(testRoot, 'existing.ts'), 'updated content');

    const postUntracked = getUntrackedFiles(testRoot);
    const newFiles = postUntracked.filter(f => !preTaskUntracked.has(f));

    expect(newFiles).toEqual([]);
  });
});
