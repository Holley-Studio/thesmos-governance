// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gatherFreshnessInputs } from './gather.js';

function tmpRepo(): string {
  return mkdtempSync(join(tmpdir(), 'thesmos-gather-'));
}

describe('gatherFreshnessInputs', () => {
  it('reports isGitRepo false outside a repository', () => {
    const dir = tmpRepo();
    try {
      const out = gatherFreshnessInputs(dir);
      expect(out.repo.isGitRepo).toBe(false);
      expect(out.repo.behind).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads artifact mtimes when present and reports null when absent', () => {
    const dir = tmpRepo();
    try {
      mkdirSync(join(dir, '.thesmos'), { recursive: true });
      writeFileSync(join(dir, '.thesmos', 'report.json'), '{}');
      const out = gatherFreshnessInputs(dir);
      expect(out.artifacts.reportMtimeMs).toBeTypeOf('number');
      expect(out.artifacts.baselineMtimeMs).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects a git repository and its branch without a network call', () => {
    const dir = tmpRepo();
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });
      writeFileSync(join(dir, 'a.txt'), 'a');
      execFileSync('git', ['add', '.'], { cwd: dir });
      execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });

      const out = gatherFreshnessInputs(dir);
      expect(out.repo.isGitRepo).toBe(true);
      expect(out.repo.branch).toBe('main');
      expect(out.repo.upstream).toBeNull();
      expect(out.repo.behind).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('counts dirty files exactly', () => {
    const dir = tmpRepo();
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      writeFileSync(join(dir, 'dirty1.txt'), 'x');
      writeFileSync(join(dir, 'dirty2.txt'), 'y');
      writeFileSync(join(dir, 'dirty3.txt'), 'z');
      const out = gatherFreshnessInputs(dir);
      expect(out.repo.dirtyCount).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never throws, whatever the root is', () => {
    expect(() => gatherFreshnessInputs('/nonexistent/path/xyz')).not.toThrow();
  });

  it('completes within the time budget', () => {
    const started = Date.now();
    gatherFreshnessInputs(process.cwd(), 400);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('counts behind and ahead with local upstream tracking', () => {
    const originDir = tmpRepo();
    const cloneDir = tmpRepo();
    try {
      // Set up origin repo with initial commit
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: originDir });
      execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: originDir });
      execFileSync('git', ['config', 'user.name', 'T'], { cwd: originDir });
      writeFileSync(join(originDir, 'file.txt'), 'v1');
      execFileSync('git', ['add', '.'], { cwd: originDir });
      execFileSync('git', ['commit', '-qm', 'v1'], { cwd: originDir });

      // Clone locally (no network)
      execFileSync('git', ['clone', '-q', originDir, cloneDir]);

      // Add 2 commits to origin
      writeFileSync(join(originDir, 'file.txt'), 'v2');
      execFileSync('git', ['commit', '-qam', 'v2'], { cwd: originDir });
      writeFileSync(join(originDir, 'file.txt'), 'v3');
      execFileSync('git', ['commit', '-qam', 'v3'], { cwd: originDir });

      // Fetch in clone to update remote-tracking refs (no network)
      execFileSync('git', ['fetch', '-q'], { cwd: cloneDir });

      // Clone should be 2 behind, 0 ahead
      const out = gatherFreshnessInputs(cloneDir);
      expect(out.repo.upstream).not.toBeNull();
      expect(out.repo.behind).toBe(2);
      expect(out.repo.ahead).toBe(0);

      // Add 1 commit in clone
      writeFileSync(join(cloneDir, 'file.txt'), 'v2-local');
      execFileSync('git', ['commit', '-qam', 'v2-local'], { cwd: cloneDir });

      // Clone should be 2 behind, 1 ahead
      const out2 = gatherFreshnessInputs(cloneDir);
      expect(out2.repo.behind).toBe(2);
      expect(out2.repo.ahead).toBe(1);
    } finally {
      rmSync(originDir, { recursive: true, force: true });
      rmSync(cloneDir, { recursive: true, force: true });
    }
  });

  it('a failing probe does not prevent sibling probes from reporting', () => {
    const dir = tmpRepo();
    try {
      // Create unborn-HEAD repo: init without committing anything.
      // This causes git rev-parse --abbrev-ref HEAD to fail (exit 128),
      // while other probes like git status succeed with real values.
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 't@t.local'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir });

      // Create 2 untracked files to test that status probe succeeds
      writeFileSync(join(dir, 'file1.txt'), 'a');
      writeFileSync(join(dir, 'file2.txt'), 'b');

      const out = gatherFreshnessInputs(dir);

      // is-inside-work-tree probe succeeds
      expect(out.repo.isGitRepo).toBe(true);

      // rev-parse --abbrev-ref HEAD fails on unborn HEAD → branch is null
      expect(out.repo.branch).toBeNull();

      // status --porcelain succeeds with 2 untracked files
      expect(out.repo.dirtyCount).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
