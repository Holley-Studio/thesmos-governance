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

const sourceFiles = readdirSync(MISSION_DIR)
  .filter((f) => f.endsWith('.ts'))
  .sort();

describe('mission sources stay text', () => {
  it('finds the module to check', () => {
    expect(sourceFiles.length).toBeGreaterThan(5);
  });

  it.each(sourceFiles)('%s contains no NUL byte', (file) => {
    const bytes = readFileSync(join(MISSION_DIR, file));
    const nul = bytes.indexOf(0);
    expect(
      nul,
      nul === -1
        ? ''
        : `${file} contains U+0000 at byte ${nul} — the file is binary to grep and to any text tool`
    ).toBe(-1);
  });

  it.each(sourceFiles)('%s contains no other C0 control character', (file) => {
    // Tab, newline, and carriage return are the only control codes a source
    // file has any business containing.
    const text = readFileSync(join(MISSION_DIR, file), 'utf8');
    const offending = [...text].filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 && ch !== '\t' && ch !== '\n' && ch !== '\r';
    });
    expect(offending.map((c) => `U+${(c.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`)).toEqual(
      []
    );
  });

  it.each(sourceFiles)('%s round-trips as UTF-8', (file) => {
    const bytes = readFileSync(join(MISSION_DIR, file));
    const decoded = new TextDecoder('utf-8', { fatal: true });
    expect(() => decoded.decode(bytes)).not.toThrow();
  });
});
