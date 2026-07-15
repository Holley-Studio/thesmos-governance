// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getChangedFiles, readFilesFromPaths, filterReviewIgnoredPaths, parseChangedRanges } from './git.ts';

// ── filterReviewIgnoredPaths — pure prefix filter ─────────────────────────────

describe('filterReviewIgnoredPaths', () => {
  it('drops paths matching a prefix, keeps the rest', () => {
    const paths = ['thesmos/rules/agents.ts', 'thesmos/review.ts', 'src/app.ts'];
    expect(filterReviewIgnoredPaths(paths, ['thesmos/rules/'])).toEqual([
      'thesmos/review.ts',
      'src/app.ts',
    ]);
  });

  it('is a PREFIX match, not a segment match — "rules/" elsewhere is kept', () => {
    const paths = ['packages/rules/x.ts', 'thesmos/rules/x.ts'];
    expect(filterReviewIgnoredPaths(paths, ['thesmos/rules/'])).toEqual(['packages/rules/x.ts']);
  });

  it('returns paths unchanged for an empty prefix list (customer default)', () => {
    const paths = ['a.ts', 'b.ts'];
    expect(filterReviewIgnoredPaths(paths, [])).toBe(paths);
  });

  it('supports multiple prefixes', () => {
    const paths = ['gen/a.ts', 'rules/b.ts', 'src/c.ts'];
    expect(filterReviewIgnoredPaths(paths, ['gen/', 'rules/'])).toEqual(['src/c.ts']);
  });
});

// ── readFilesFromPaths — prefix filtering on explicit paths ──────────────────

describe('readFilesFromPaths — reviewIgnorePaths', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'thesmos-git-test-'));
    mkdirSync(join(root, 'rules'), { recursive: true });
    writeFileSync(join(root, 'app.ts'), 'const a = 1;');
    writeFileSync(join(root, 'rules', 'r.ts'), 'const r = 1;');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('excludes files under an ignored prefix', () => {
    const files = readFilesFromPaths(root, ['app.ts', 'rules/r.ts'], ['rules/']);
    expect(files.map((f) => f.path)).toEqual(['app.ts']);
  });

  it('reads everything when no prefixes are configured', () => {
    const files = readFilesFromPaths(root, ['app.ts', 'rules/r.ts']);
    expect(files.map((f) => f.path)).toEqual(['app.ts', 'rules/r.ts']);
  });
});

// ── getChangedFiles — execFileSync regression (real temp git repo) ────────────

describe('getChangedFiles — injection-safe git invocation', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'thesmos-git-repo-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(repo, 'base.ts'), 'const base = 1;');
    git('add', '.');
    git('commit', '-m', 'base');
    mkdirSync(join(repo, 'rules'), { recursive: true });
    writeFileSync(join(repo, 'changed.ts'), 'const changed = 2;');
    writeFileSync(join(repo, 'rules', 'ignored.ts'), 'const ignored = 3;');
    git('add', '.');
    git('commit', '-m', 'change');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('returns changed files for a legitimate base ref', () => {
    const files = getChangedFiles(repo, 'HEAD~1');
    expect(files.map((f) => f.path).sort()).toEqual(['changed.ts', 'rules/ignored.ts']);
    expect(files.find((f) => f.path === 'changed.ts')?.content).toContain('const changed');
  });

  it('applies reviewIgnorePaths prefixes to the diff file list', () => {
    const files = getChangedFiles(repo, 'HEAD~1', [], ['rules/']);
    expect(files.map((f) => f.path)).toEqual(['changed.ts']);
  });

  it('rejects a shell-metacharacter base ref without executing it', () => {
    const marker = join(repo, 'pwned-by-subshell');
    const files = getChangedFiles(repo, `$(touch ${marker})`, []);
    expect(files).toEqual([]);
    expect(existsSync(marker)).toBe(false); // no subshell ran
  });

  it('rejects a leading-dash base ref (git argument injection)', () => {
    expect(getChangedFiles(repo, '--output=/tmp/thesmos-pwn', [])).toEqual([]);
  });

  it('rejects a semicolon-chained base ref', () => {
    expect(getChangedFiles(repo, 'main; rm -rf /', [])).toEqual([]);
  });
});

// ── parseChangedRanges — unified diff hunk parsing ─────────────────────────────

describe('parseChangedRanges', () => {
  it('extracts added-line ranges from a unified diff (context lines excluded)', () => {
    const diff = [
      'diff --git a/x.ts b/x.ts',
      'index 111..222 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -8,7 +8,8 @@ function f() {',
      ' const a = 1;', // line 8 (context)
      ' const b = 2;', // line 9
      ' const c = 3;', // line 10
      '-const old = 4;',
      '+const new1 = 4;', // line 11
      '+const new2 = 5;', // line 12
      ' const d = 6;', // line 13
      ' const e = 7;', // line 14
      ' const g = 8;', // line 15
    ].join('\n');
    expect(parseChangedRanges(diff)).toEqual([{ start: 11, end: 12 }]);
  });

  it('returns multiple ranges for multiple hunks', () => {
    const diff = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '-const a = 0;',
      '+const a = 1;',
      '@@ -50,1 +50,2 @@',
      ' const ctx = 1;',
      '+const added = 2;',
    ].join('\n');
    expect(parseChangedRanges(diff)).toEqual([
      { start: 1, end: 1 },
      { start: 51, end: 51 },
    ]);
  });

  it('records a single-point range for deletion-only hunks', () => {
    const diff = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -10,2 +9,0 @@',
      '-const gone1 = 1;',
      '-const gone2 = 2;',
    ].join('\n');
    expect(parseChangedRanges(diff)).toEqual([{ start: 9, end: 9 }]);
  });

  it('returns [] for an empty or hunk-less diff', () => {
    expect(parseChangedRanges('')).toEqual([]);
    expect(parseChangedRanges('diff --git a/x b/x\nsimilarity index 100%\nrename from x\nrename to y')).toEqual([]);
  });
});

// ── getChangedFiles — changedRanges plumbing (real temp git repo) ──────────────

describe('getChangedFiles — changedRanges', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'thesmos-git-hunks-'));
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    const lines = Array.from({ length: 40 }, (_, i) => `const l${i + 1} = ${i + 1};`);
    writeFileSync(join(repo, 'big.ts'), lines.join('\n') + '\n');
    git('add', '.');
    git('commit', '-m', 'base');
    // Change exactly lines 20–21
    lines[19] = 'const l20 = 2020;';
    lines[20] = 'const l21 = 2121;';
    writeFileSync(join(repo, 'big.ts'), lines.join('\n') + '\n');
    git('add', '.');
    git('commit', '-m', 'edit two lines');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it('populates changedRanges covering only the edited lines', () => {
    const files = getChangedFiles(repo, 'HEAD~1');
    const big = files.find((f) => f.path === 'big.ts');
    expect(big?.changedRanges).toEqual([{ start: 20, end: 21 }]);
  });
});
