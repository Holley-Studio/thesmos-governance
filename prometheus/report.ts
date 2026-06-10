/**
 * Idempotency utilities for .prometheus/report.json.
 *
 * Design rules:
 * 1. `_generatedSections` is an explicit list of top-level keys that prometheus:scan owns.
 * 2. Any key NOT in that list is manual — never overwritten.
 * 3. All generated arrays are sorted by stable keys before writing.
 * 4. Running twice with the same input → byte-for-byte identical output.
 */
import type { PageRoute, ApiRoute, LargeFile } from './types';

export const GENERATED_SECTIONS = ['scan', 'routes'] as const;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Merge an incoming scan result into the existing report, respecting
 * `_generatedSections` as the boundary between generated and manual content.
 *
 * @param existing  - The current parsed report.json object
 * @param incoming  - Newly scanned data (only generated keys)
 * @param generatedKeys - Which top-level keys may be overwritten
 */
export function applyGeneratedSections(
  existing: Record<string, JsonValue>,
  incoming: Record<string, JsonValue>,
  generatedKeys: string[] = [...GENERATED_SECTIONS]
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = { ...existing };

  for (const key of generatedKeys) {
    if (key in incoming) {
      result[key] = incoming[key];
    }
  }

  // Always update the generation metadata
  result['_generatedSections'] = generatedKeys as unknown as JsonValue;
  result['_manualNote'] =
    'Keys not in _generatedSections are manually curated. Do not overwrite.' as JsonValue;

  return result;
}

/**
 * Sort all arrays within a report by stable keys so repeated runs are idempotent.
 * - PageRoute[]: by `path`
 * - ApiRoute[]: by `path`
 * - LargeFile[]: by `lines` desc, then `file`
 * - string[]: alphabetically
 */
export function sortReport(report: Record<string, JsonValue>): Record<string, JsonValue> {
  const result = { ...report };

  // Sort top-level string arrays
  for (const key of Object.keys(result)) {
    const val = result[key];
    if (Array.isArray(val) && val.every((v) => typeof v === 'string')) {
      result[key] = [...val].sort() as JsonValue;
    }
  }

  // Sort routes
  if (
    result['routes'] &&
    typeof result['routes'] === 'object' &&
    !Array.isArray(result['routes'])
  ) {
    const routes = result['routes'] as { pages?: PageRoute[]; api?: ApiRoute[] };
    result['routes'] = {
      ...routes,
      ...(routes.pages
        ? { pages: sortByPath(routes.pages) }
        : {}),
      ...(routes.api
        ? { api: sortByPath(routes.api) }
        : {}),
    } as JsonValue;
  }

  // Sort scan sub-arrays
  if (
    result['scan'] &&
    typeof result['scan'] === 'object' &&
    !Array.isArray(result['scan'])
  ) {
    const scan = result['scan'] as Record<string, JsonValue>;
    result['scan'] = {
      ...scan,
      ...(Array.isArray(scan['storeFiles'])
        ? { storeFiles: [...(scan['storeFiles'] as string[])].sort() }
        : {}),
      ...(Array.isArray(scan['testFiles'])
        ? { testFiles: [...(scan['testFiles'] as string[])].sort() }
        : {}),
      ...(Array.isArray(scan['scriptFiles'])
        ? { scriptFiles: [...(scan['scriptFiles'] as string[])].sort() }
        : {}),
      ...(Array.isArray(scan['largeFiles'])
        ? { largeFiles: sortLargeFiles(scan['largeFiles'] as unknown as LargeFile[]) }
        : {}),
      ...(Array.isArray(scan['riskyFiles'])
        ? { riskyFiles: [...(scan['riskyFiles'] as string[])].sort() }
        : {}),
    } as JsonValue;
  }

  return result;
}

function sortByPath<T extends { path: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.path.localeCompare(b.path));
}

function sortLargeFiles(arr: LargeFile[]): LargeFile[] {
  return [...arr].sort((a, b) => {
    const lineDiff = b.lines - a.lines;
    return lineDiff !== 0 ? lineDiff : a.file.localeCompare(b.file);
  });
}

/**
 * Returns true if the report's `generatedAt` timestamp is older than `maxAgeDays`.
 * Returns true also if `generatedAt` is missing (treat as stale).
 * @param nowMs - Current epoch ms. Defaults to Date.now(). Inject in tests for determinism.
 */
export function isReportStale(
  generatedAt: string | undefined,
  maxAgeDays: number,
  nowMs = Date.now()
): boolean {
  if (!generatedAt) return true;
  const ageMs = nowMs - new Date(generatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  return ageDays > maxAgeDays;
}
