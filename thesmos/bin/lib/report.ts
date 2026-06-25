// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * Shared CLI utility for loading and writing .thesmos/report.json.
 * Extracted here to avoid duplicating the read/parse/null-guard across commands.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanResult } from '../../types.ts';

/**
 * Load and parse .thesmos/report.json relative to `root`.
 * Returns the ScanResult or undefined if the file is absent or unparseable.
 */
export function loadReport(root: string): ScanResult | null {
  const reportPath = join(root, '.thesmos', 'report.json');
  if (!existsSync(reportPath)) return null;
  try {
    return JSON.parse(readFileSync(reportPath, 'utf8')) as ScanResult;
  } catch {
    return null;
  }
}
