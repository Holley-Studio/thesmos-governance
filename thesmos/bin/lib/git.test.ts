// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getChangedFiles, readFilesFromPaths, filterReviewIgnoredPaths } from './git.ts';

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
