// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { walkFiles, countLines, readFileSafe } from './walker';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `prom-walker-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function scaffold(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
}

describe('walkFiles', () => {
  it('returns relative paths from root', () => {
    const root = makeTmpDir();
    scaffold(root, { 'a.ts': '', 'b.ts': '' });
    const files = walkFiles(root);
    expect(files).toContain('a.ts');
    expect(files).toContain('b.ts');
    expect(files.every((f) => !f.startsWith(root))).toBe(true);
    rmSync(root, { recursive: true });
  });

  it('returns sorted results', () => {
    const root = makeTmpDir();
    scaffold(root, { 'z.ts': '', 'a.ts': '', 'm.ts': '' });
    const files = walkFiles(root);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
    rmSync(root, { recursive: true });
  });

  it('recurses into subdirectories', () => {
    const root = makeTmpDir();
    scaffold(root, { 'src/lib/util.ts': '', 'index.ts': '' });
    const files = walkFiles(root);
    expect(files).toContain('src/lib/util.ts');
    expect(files).toContain('index.ts');
    rmSync(root, { recursive: true });
  });

  it('respects ignoredFolders', () => {
    const root = makeTmpDir();
    scaffold(root, {
      'node_modules/pkg/index.js': '',
      'src/app.ts': '',
    });
    const files = walkFiles(root, { ignoredFolders: ['node_modules'] });
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files).toContain('src/app.ts');
    rmSync(root, { recursive: true });
  });

  it('respects custom ignored folder names', () => {
    const root = makeTmpDir();
    scaffold(root, { 'custom_ignore/file.ts': '', 'kept/file.ts': '' });
    const files = walkFiles(root, { ignoredFolders: ['custom_ignore'] });
    expect(files.some((f) => f.includes('custom_ignore'))).toBe(false);
    expect(files).toContain('kept/file.ts');
    rmSync(root, { recursive: true });
  });

  it('respects maxDepth', () => {
    const root = makeTmpDir();
    scaffold(root, {
      'level1/level2/level3/deep.ts': '',
      'top.ts': '',
    });
    const files = walkFiles(root, { maxDepth: 1 });
    expect(files).toContain('top.ts');
    expect(files.some((f) => f.includes('level3'))).toBe(false);
    rmSync(root, { recursive: true });
  });

  it('returns empty array for empty directory', () => {
    const root = makeTmpDir();
    expect(walkFiles(root)).toEqual([]);
    rmSync(root, { recursive: true });
  });

  it('returns empty array for non-existent root', () => {
    expect(walkFiles('/tmp/__nonexistent_prometheus_test__')).toEqual([]);
  });
});

describe('countLines', () => {
  it('returns 0 for empty string', () => {
    expect(countLines('')).toBe(0);
  });

  it('returns 1 for a single line with no newline', () => {
    expect(countLines('hello')).toBe(1);
  });

  it('returns 2 for two lines', () => {
    expect(countLines('line1\nline2')).toBe(2);
  });

  it('counts trailing newline as an extra line', () => {
    expect(countLines('line1\nline2\n')).toBe(3);
  });

  it('counts only newlines', () => {
    expect(countLines('\n\n\n')).toBe(4);
  });
});

describe('readFileSafe', () => {
  it('reads an existing file', () => {
    const root = makeTmpDir();
    const file = join(root, 'test.ts');
    writeFileSync(file, 'const x = 1;', 'utf8');
    expect(readFileSafe(file)).toBe('const x = 1;');
    rmSync(root, { recursive: true });
  });

  it('returns null for a missing file', () => {
    expect(readFileSafe('/tmp/__nonexistent_file__.ts')).toBeNull();
  });
});
