/**
 * thesmos import:scan — live registry validation for AI-generated imports.
 *
 * Parses import/require statements and requirements.txt in specified files
 * (or all JS/TS/Python files), checks each package against npm and PyPI,
 * and reports packages that don't exist, are newly registered, or lack metadata.
 *
 * Usage:
 *   thesmos import:scan                  # Scan all JS/TS/Python files
 *   thesmos import:scan src/api/auth.ts  # Scan specific files
 *   thesmos import:scan --strict          # Also flag packages < 30 days old
 *   thesmos import:scan --ci              # Exit 1 on any BLOCKER finding
 *   thesmos import:scan --json            # Machine-readable output
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanImports, type RegistryFinding } from '../../import-scan.js';

const SEVERITY_ORDER: Record<string, number> = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, OK: 3, OFFLINE: 4 };

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
  const PYTHON_EXT = /requirements(?:\.in|\.txt)$/;
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '__pycache__']);

  function walk(d: string) {
    const entries = readdirSync(d, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (SOURCE_EXT.test(entry.name) || PYTHON_EXT.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

function severityIcon(severity: string): string {
  switch (severity) {
    case 'BLOCKER': return '🚫';
    case 'HIGH':    return '🔴';
    case 'MEDIUM':  return '🟡';
    case 'OFFLINE': return '⚫';
    default:        return '⚪';
  }
}

export async function cmdImportScan(argv: string[]): Promise<void> {
  const strict  = argv.includes('--strict');
  const ci      = argv.includes('--ci');
  const asJson  = argv.includes('--json');
  const root    = process.cwd();

  // Collect files to scan: explicit paths or entire project
  const explicitFiles = argv.filter((a) => !a.startsWith('--') && existsSync(a));
  const files = explicitFiles.length > 0 ? explicitFiles : collectSourceFiles(root);

  if (files.length === 0) {
    if (asJson) {
      console.log(JSON.stringify({ scanned: 0, packages: [], findings: [] }, null, 2));
    } else {
      console.log('import:scan — no source files found.');
    }
    return;
  }

  if (!asJson) {
    console.log(`\nThesmos Import Scan${strict ? ' (strict mode)' : ''}\n`);
    console.log(`  Scanning ${files.length} file${files.length !== 1 ? 's' : ''}...`);
  }

  const result = await scanImports(files, { strict });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    if (ci && result.unknownCount > 0) process.exit(1);
    return;
  }

  const { packages, findings, offlineCount } = result;

  if (packages.length === 0) {
    console.log('  No external packages found.\n');
    return;
  }

  console.log(`  Checked ${packages.length} package${packages.length !== 1 ? 's' : ''} against npm and PyPI registries.\n`);

  if (offlineCount > 0) {
    console.log(`  ⚫ ${offlineCount} package${offlineCount !== 1 ? 's' : ''} could not be checked (offline or timed out).\n`);
  }

  if (findings.length === 0) {
    console.log('  ✓ All packages verified — no registry issues found.\n');
    return;
  }

  // Sort by severity
  const sorted = [...findings].sort((a, b) =>
    (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  for (const finding of sorted) {
    const icon = severityIcon(finding.severity);
    const relPath = finding.name;
    console.log(`  ${icon} [${finding.severity}] ${relPath} (${finding.ecosystem})`);
    console.log(`       ${finding.reason}`);
    console.log(`       → ${finding.suggestion}`);
    console.log('');
  }

  const blockers = findings.filter((f) => f.severity === 'BLOCKER');
  const highs    = findings.filter((f) => f.severity === 'HIGH');
  const mediums  = findings.filter((f) => f.severity === 'MEDIUM');

  const parts: string[] = [];
  if (blockers.length) parts.push(`${blockers.length} BLOCKER`);
  if (highs.length)    parts.push(`${highs.length} HIGH`);
  if (mediums.length)  parts.push(`${mediums.length} MEDIUM`);

  console.log(`  Summary: ${parts.join(', ')}\n`);

  if (ci && blockers.length > 0) {
    process.stderr.write('import:scan: BLOCKER findings — exiting 1 for CI gate.\n');
    process.exit(1);
  }
}
