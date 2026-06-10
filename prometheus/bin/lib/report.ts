/**
 * Shared CLI utility for loading and writing .prometheus/report.json.
 * Extracted here to avoid duplicating the read/parse/null-guard across commands.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanResult } from '../../types.ts';

/**
 * Load and parse .prometheus/report.json relative to `root`.
 * Returns the ScanResult or undefined if the file is absent or unparseable.
 */
export function loadReport(root: string): ScanResult | undefined {
  const reportPath = join(root, '.prometheus', 'report.json');
  if (!existsSync(reportPath)) return undefined;
  try {
    return JSON.parse(readFileSync(reportPath, 'utf8')) as ScanResult;
  } catch {
    return undefined;
  }
}
