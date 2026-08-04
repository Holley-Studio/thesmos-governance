// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos models:lint — fail on raw provider model IDs outside the registry.
 *
 * Exit codes: 0 clean · 1 raw ids found · 2 coverage failure
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, flag } from '../lib/args.ts';
import {
  RAW_ID_EXCLUSIONS,
  RAW_ID_ROOTS,
  formatRawIdFindings,
  lintRawIds,
  type RawIdFinding,
} from '../../models/raw-id-lint.ts';
import { buildCoverageReport, formatCoverage, trackedEligibleFiles } from '../../lint-coverage.ts';

export async function cmdModelsLint(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const cwd = process.cwd();
  const repoRoot = cwd.endsWith('thesmos') ? join(cwd, '..') : cwd;

  const extensions = ['.md', '.ts', '.tsx', '.json'];
  let eligible: string[];
  try {
    eligible = trackedEligibleFiles(repoRoot, RAW_ID_ROOTS, extensions);
  } catch (err) {
    console.error(`models:lint: ${(err as Error).message}`);
    process.exit(2);
  }

  const findings: RawIdFinding[] = [];
  const scannedFiles: string[] = [];
  for (const rel of eligible) {
    if (RAW_ID_EXCLUSIONS.some((e) => rel.includes(e.path))) continue;
    let content: string;
    try {
      content = readFileSync(join(repoRoot, rel), 'utf8');
    } catch {
      continue;
    }
    scannedFiles.push(rel);
    findings.push(...lintRawIds(content, rel));
  }

  let coverage;
  try {
    coverage = buildCoverageReport({
      lint: 'models:lint',
      repoRoot,
      configuredRoots: RAW_ID_ROOTS,
      extensions,
      exclusions: RAW_ID_EXCLUSIONS,
      scannedFiles,
      findings: findings.length,
    });
  } catch (err) {
    console.error(`models:lint: ${(err as Error).message}`);
    process.exit(2);
  }

  if (json) process.stdout.write(JSON.stringify({ coverage, findings }, null, 2) + '\n');
  else {
    console.log(formatRawIdFindings(findings));
    console.log('');
    console.log(formatCoverage(coverage));
  }
  process.exit(coverage.exitCode);
}
