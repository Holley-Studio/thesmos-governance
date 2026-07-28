// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
// @vitest-environment node
/**
 * Source hygiene for the mission runtime.
 *
 * This suite exists because of a real regression. A stray U+0000 reached a
 * template literal in `execute.ts` and served, by accident, as a working map-key
 * separator: TypeScript compiled it, every test passed, and the build was
 * clean. What it broke was everything that treats source as *text* — `grep`
 * found nothing in the file, `file` reported "data", and a review pass done
 * with those tools was silently blind to the largest file in the module.
 *
 * Nothing in a normal type-and-test gate catches that, so it is caught here.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MISSION_DIR = import.meta.dirname;

/**
 * Every directory that carries mission code, not just the runtime.
 *
 * The first version of this suite watched `mission/` alone. That scope was too
 * narrow and it showed: while building the mission CLI, a raw escape byte was
 * written into `bin/commands/mission.test.ts` — the same class of defect this
 * suite exists to prevent — and nothing failed, because the guard was not
 * looking at that directory. A hygiene check is only worth what it covers.
 */
const WATCHED_DIRS = [MISSION_DIR, join(MISSION_DIR, '..', 'bin', 'commands')];

const sourceFiles = WATCHED_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(dir, f))
).sort();

/** Shown in test titles — the absolute path would be noise and machine-specific. */
const label = (file: string): string => file.split('/').slice(-2).join('/');

describe('mission sources stay text', () => {
  it('finds every watched module', () => {
    expect(sourceFiles.length).toBeGreaterThan(5);

    // Named explicitly rather than derived from WATCHED_DIRS. An earlier
    // version looped over that constant, so narrowing the constant made the
    // assertion trivially true and the coverage regression invisible — which
    // mutation testing caught. These are the files that must be watched,
    // stated independently of the thing under test.
    const required = [
      'mission/execute.ts',
      'mission/graph.ts',
      'bin/commands/mission.ts',
      'bin/commands/mission.test.ts',
    ];
    for (const suffix of required) {
      expect(
        sourceFiles.some((f) => f.endsWith(suffix)),
        `${suffix} is not being checked for source hygiene`
      ).toBe(true);
    }
  });

  it.each(sourceFiles)('%s contains no NUL byte', (file) => {
    const bytes = readFileSync(file);
    const nul = bytes.indexOf(0);
    expect(
      nul,
      nul === -1
        ? ''
        : `${label(file)} contains U+0000 at byte ${nul} — the file is binary to grep and to any text tool`
    ).toBe(-1);
  });

  it.each(sourceFiles)('%s contains no other C0 control character', (file) => {
    // Tab, newline, and carriage return are the only control codes a source
    // file has any business containing.
    const text = readFileSync(file, 'utf8');
    const offending = [...text].filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r';
    });
    expect(offending.map((c) => `U+${(c.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`)).toEqual(
      []
    );
  });

  it.each(sourceFiles)('%s round-trips as UTF-8', (file) => {
    const bytes = readFileSync(file);
    const decoded = new TextDecoder('utf-8', { fatal: true });
    expect(() => decoded.decode(bytes)).not.toThrow();
  });
});
