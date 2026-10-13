import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isObject, isTimestamp, isNonNegativeNumber, readValidatedJsonl } from './jsonl.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thesmos evidence '));
  roots.push(root);
  return join(root, 'evidence.jsonl');
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const validate = (value: unknown): value is { id: string } =>
  isObject(value) && typeof value.id === 'string';

describe('JSONL evidence boundary', () => {
  it('reports syntax and schema damage while retaining valid BOM/CRLF siblings', () => {
    const file = fixture();
    writeFileSync(file, '\uFEFF{"id":"first"}\r\nnull\r\n{broken\r\n{"id":"last"}\r\n', 'utf8');
    expect(readValidatedJsonl(file, validate)).toEqual({
      records: [{ id: 'first' }, { id: 'last' }],
      invalidLines: [2, 3],
    });
    expect(readValidatedJsonl(file, validate, 1).records).toEqual([{ id: 'last' }]);
    expect(readValidatedJsonl(file, validate, 0)).toEqual({ records: [], invalidLines: [2, 3] });
  });
  it('distinguishes a missing file from an unreadable evidence path', () => {
    const file = fixture();
    expect(readValidatedJsonl(file, validate)).toEqual({ records: [], invalidLines: [] });
    mkdirSync(file);
    expect(readValidatedJsonl(file, validate).error).toBeTruthy();
  });
  it.each([-1, 1.5, NaN])('rejects an invalid limit %s', (limit) => {
    expect(() => readValidatedJsonl(fixture(), validate, limit)).toThrow(RangeError);
  });
  it('checks object, timestamp, and finite numeric values at runtime', () => {
    expect(isObject(null)).toBe(false);
    expect(isObject([])).toBe(false);
    expect(isTimestamp('2026-09-30T00:00:00Z')).toBe(true);
    expect(isTimestamp('2026-09-30')).toBe(false);
    expect(isTimestamp('invalid')).toBe(false);
    expect(isNonNegativeNumber(0)).toBe(true);
    expect(isNonNegativeNumber(-1)).toBe(false);
    expect(isNonNegativeNumber(Infinity)).toBe(false);
  });
});
