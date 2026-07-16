import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getPowerMode, setPowerMode } from './pantheon.ts';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'thesmos-mode-root-'));
  mkdirSync(join(root, '.thesmos'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('pantheon power mode', () => {
  it('defaults to lean when config has no power key', () => {
    writeFileSync(join(root, '.thesmos', 'config.json'), JSON.stringify({ project: 'test' }));
    expect(getPowerMode(root)).toBe('lean');
  });

  it('normalizes conservative synonyms to lean', () => {
    expect(setPowerMode(root, 'normal')).toBe('lean');
    expect(getPowerMode(root)).toBe('lean');

    expect(setPowerMode(root, 'conservative')).toBe('lean');
    expect(getPowerMode(root)).toBe('lean');
  });

  it('sets and reads god power mode', () => {
    expect(setPowerMode(root, 'god')).toBe('god');
    expect(getPowerMode(root)).toBe('god');
  });

  it('throws on unknown mode', () => {
    expect(() => setPowerMode(root, 'turbo')).toThrow(/Unknown mode/);
  });
});
