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

  it('counts dirty files', () => {
    const dir = tmpRepo();
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
      writeFileSync(join(dir, 'dirty.txt'), 'x');
      const out = gatherFreshnessInputs(dir);
      expect(out.repo.dirtyCount).toBeGreaterThan(0);
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
});
