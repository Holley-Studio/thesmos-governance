// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/** Shared boundary for local JSONL evidence. JSON syntax alone is not a schema. */
import { readFileSync } from 'node:fs';

export interface JsonlReadResult<T> {
  records: T[];
  /** One-based lines that could not be parsed or did not match the schema. */
  invalidLines: number[];
  error?: string;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Limits count valid records, so a damaged tail cannot hide earlier evidence. */
export function readValidatedJsonl<T>(
  file: string,
  validate: (value: unknown) => value is T,
  limit = Number.POSITIVE_INFINITY
): JsonlReadResult<T> {
  if (limit !== Number.POSITIVE_INFINITY && (!Number.isSafeInteger(limit) || limit < 0)) {
    throw new RangeError('JSONL limit must be a non-negative integer or Infinity');
  }
  const result: JsonlReadResult<T> = { records: [], invalidLines: [] };
  let contents: string;
  try {
    contents = readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      result.error = error instanceof Error ? error.message : String(error);
    }
    return result;
  }
  contents.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!validate(parsed)) {
        result.invalidLines.push(index + 1);
        return;
      }
      result.records.push(parsed);
    } catch {
      result.invalidLines.push(index + 1);
    }
  });
  if (limit === 0) result.records = [];
  else if (limit !== Number.POSITIVE_INFINITY) result.records = result.records.slice(-limit);
  return result;
}
