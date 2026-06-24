/**
 * thesmos self:check / self:update / self:repair
 *
 * Prometheus governs itself — detects version drift, broken hooks,
 * stale adapters, and stale context snapshots.
 *
 * Usage:
 *   thesmos self:check                 # Run all SELF_* checks
 *   thesmos self:check --json          # Machine-readable output
 *   thesmos self:update                # Update to latest version
 *   thesmos self:repair                # Fix broken hooks + stale adapters
 *   thesmos self:repair --hooks        # Only repair git hooks
 *   thesmos self:repair --adapters     # Only regenerate stale adapters
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { SELF_RULES } from '../../rules/self.js';
import { CONFIG_DEFAULTS, loadConfig } from '../../config.js';
import type { Finding, ScanResult } from '../../types.js';
import { makeLogger } from '../../logger.js';

const log = makeLogger('self');

// ── EMPTY_SCAN shim (SELF rules don't use scan data) ─────────────────────────

const EMPTY_SCAN: ScanResult = {
  _generatedSections: [],
  generatedAt: new Date().toISOString(),
  scanVersion: '2.0.0',
  pages: [],
  apiRoutes: [],
  componentCount: 0,
  sharedUiFiles: [],
  designSystemFiles: [],
  storeFiles: [],
  testFiles: [],
  largeFiles: [],
  riskyFiles: [],
  scriptFiles: [],
  envFiles: [],
  clientBoundaryRisks: [],
};

// ── File collectors ───────────────────────────────────────────────────────────

function collectSelfCheckFiles(root: string): Array<{ path: string; content: string }> {
  const files: Array<{ path: string; content: string }> = [];

  function tryRead(rel: string): void {
    const abs = join(root, rel);
    if (existsSync(abs)) {
      try {
        files.push({ path: rel, content: readFileSync(abs, 'utf-8') });
      } catch {
        // ignore unreadable files
      }
    }
  }

  // Package manifest
  tryRead('package.json');

  // Config
  tryRead('.thesmos/config.json');

  // Adapter files
  tryRead('CLAUDE.md');
  tryRead('AGENTS.md');
  tryRead('.cursor/rules/thesmos.md');

  // Context snapshot
  tryRead('.thesmos/context.md');
  tryRead('.thesmos/context-capsule.md');

  // Brain file
  tryRead('.thesmos/brain.md');
  tryRead('.thesmos/brain.json');

  // Git hooks
  tryRead('.git/hooks/pre-commit');
  tryRead('.git/hooks/pre-push');
  tryRead('.husky/pre-commit');
  tryRead('.husky/pre-push');

  // CI workflows
  const workflowDir = join(root, '.github/workflows');
  if (existsSync(workflowDir)) {
    try {
      for (const f of readdirSync(workflowDir)) {
        if (/\.ya?ml$/.test(f)) {
          tryRead(join('.github/workflows', f));
        }
      }
    } catch {
      // ignore
    }
  }

  // Scan source files for suppression comments
  const SOURCE_DIRS = ['src', 'app', 'lib', 'server', 'api'];
  for (const dir of SOURCE_DIRS) {
    const abs = join(root, dir);
    if (!existsSync(abs)) continue;
    try {
      collectSourceFiles(abs, dir, files, 0);
    } catch {
      // ignore
    }
  }

  return files;
}

function collectSourceFiles(
  absDir: string,
  relDir: string,
  out: Array<{ path: string; content: string }>,
  depth: number,
): void {
  if (depth > 4) return;
  const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;
  for (const entry of readdirSync(absDir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const abs = join(absDir, entry);
    const rel = join(relDir, entry);
    try {
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        collectSourceFiles(abs, rel, out, depth + 1);
      } else if (SOURCE_EXT.test(entry)) {
        out.push({ path: rel, content: readFileSync(abs, 'utf-8') });
      }
    } catch {
      // ignore
    }
  }
}

// ── Severity ordering ─────────────────────────────────────────────────────────

const SEV_ORDER: Record<string, number> = { BLOCKER: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4),
  );
}

// ── self:check ────────────────────────────────────────────────────────────────

async function runSelfCheck(argv: string[]): Promise<void> {
  const jsonMode = argv.includes('--json');
  const root = process.cwd();
  const config = loadConfig(root) ?? CONFIG_DEFAULTS;

  log.info('self:check started', { root });

  const files = collectSelfCheckFiles(root);
  const findings: Finding[] = [];

  for (const rule of SELF_RULES) {
    try {
      findings.push(...rule.detect({ scan: EMPTY_SCAN, config, changedFiles: files }));
    } catch (e) {
      log.error('self rule threw', {
        rule: rule.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const sorted = sortFindings(findings);

  if (jsonMode) {
    process.stdout.write(JSON.stringify({ findings: sorted, filesChecked: files.length }, null, 2) + '\n');
    if (sorted.some((f) => f.severity === 'BLOCKER' || f.severity === 'HIGH')) {
      process.exitCode = 1;
    }
    return;
  }

  if (sorted.length === 0) {
    console.log('\n  ✅ thesmos self:check — all checks passed\n');
    log.info('self:check clean');
    return;
  }

  console.log(`\n  Thesmos Self-Governance — ${sorted.length} finding${sorted.length === 1 ? '' : 's'}\n`);

  const blockers = sorted.filter((f) => f.severity === 'BLOCKER');
  const highs = sorted.filter((f) => f.severity === 'HIGH');
  const mediums = sorted.filter((f) => f.severity === 'MEDIUM');
  const lows = sorted.filter((f) => f.severity === 'LOW');

  if (blockers.length) console.log(`  🔴 BLOCKER (${blockers.length})`);
  if (highs.length) console.log(`  🟠 HIGH (${highs.length})`);
  if (mediums.length) console.log(`  🟡 MEDIUM (${mediums.length})`);
  if (lows.length) console.log(`  🔵 LOW (${lows.length})`);

  console.log('');

  for (const f of sorted) {
    const sev = f.severity === 'BLOCKER' ? '🔴 BLOCKER'
      : f.severity === 'HIGH' ? '🟠 HIGH'
      : f.severity === 'MEDIUM' ? '🟡 MEDIUM'
      : '🔵 LOW';
    const loc = f.line ? `:${f.line}` : '';
    console.log(`  ${sev}  ${f.file}${loc}`);
    console.log(`    ${f.message}`);
    if (f.suggestion) {
      console.log(`    → ${f.suggestion}`);
    }
    console.log('');
  }

  const hasIssues = blockers.length > 0 || highs.length > 0;
  if (hasIssues) {
    console.log('  Fix: thesmos self:repair\n');
    process.exitCode = 1;
  }

  log.info('self:check complete', { findings: sorted.length });
}

// ── self:update ───────────────────────────────────────────────────────────────

async function runSelfUpdate(argv: string[]): Promise<void> {
  const dryRun = argv.includes('--dry-run');

  console.log('\n  Thesmos Self-Update\n');

  // Detect package manager
  const root = process.cwd();
  const hasPnpm = existsSync(join(root, 'pnpm-lock.yaml'));
  const hasYarn = existsSync(join(root, 'yarn.lock'));
  const pm = hasPnpm ? 'pnpm' : hasYarn ? 'yarn' : 'npm';

  const updateCmd = pm === 'npm'
    ? 'npm install --save-dev thesmos-governance@latest'
    : pm === 'yarn'
    ? 'yarn add --dev thesmos-governance@latest'
    : 'pnpm add --save-dev thesmos-governance@latest';

  console.log(`  Package manager: ${pm}`);
  console.log(`  Command: ${updateCmd}`);

  if (dryRun) {
    console.log('\n  (dry-run) Would run: ' + updateCmd + '\n');
    return;
  }

  console.log('\n  Updating...\n');
  try {
    execSync(updateCmd, { stdio: 'inherit', cwd: root });
    console.log('\n  ✅ thesmos-governance updated to latest\n');
    console.log('  Run `thesmos self:repair --adapters` to regenerate adapter files.\n');
    log.info('self:update complete');
  } catch (e) {
    console.error('\n  ❌ Update failed:', e instanceof Error ? e.message : String(e));
    log.error('self:update failed', { error: e instanceof Error ? e.message : String(e) });
    process.exitCode = 1;
  }
}

// ── self:repair ───────────────────────────────────────────────────────────────

async function runSelfRepair(argv: string[]): Promise<void> {
  const hooksOnly = argv.includes('--hooks');
  const adaptersOnly = argv.includes('--adapters');
  const doHooks = !adaptersOnly;
  const doAdapters = !hooksOnly;

  console.log('\n  Thesmos Self-Repair\n');

  const root = process.cwd();

  // ── Repair hooks ──────────────────────────────────────────────────────────
  if (doHooks) {
    console.log('  Checking git hooks...');
    const hookPaths = [
      join(root, '.git', 'hooks', 'pre-commit'),
      join(root, '.git', 'hooks', 'pre-push'),
      join(root, '.husky', 'pre-commit'),
      join(root, '.husky', 'pre-push'),
    ];

    let brokenFound = false;
    for (const hookPath of hookPaths) {
      if (!existsSync(hookPath)) continue;
      try {
        const content = readFileSync(hookPath, 'utf-8');
        if (!content.includes('thesmos')) continue;
        // Look for absolute binary paths
        const ABS_PATH_RE = /\/(?:home|usr|opt|root|Users)[^"'\s]*\/(?:bin\/|\.npm[^"'\s]*)thesmos/;
        if (ABS_PATH_RE.test(content)) {
          brokenFound = true;
          console.log(`  ⚠  ${hookPath} — uses absolute path, recommend re-installing hooks`);
        }
      } catch {
        // ignore unreadable
      }
    }

    if (!brokenFound) {
      console.log('  ✅ Git hooks look healthy\n');
    } else {
      console.log('\n  Reinstalling hooks...');
      try {
        execSync('npx thesmos hooks:install', { stdio: 'inherit', cwd: root });
        console.log('  ✅ Hooks reinstalled\n');
        log.info('self:repair hooks reinstalled');
      } catch (e) {
        console.error('  ❌ Hook reinstall failed:', e instanceof Error ? e.message : String(e));
        log.error('self:repair hooks failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  // ── Repair adapters ───────────────────────────────────────────────────────
  if (doAdapters) {
    console.log('  Regenerating adapter files...');
    try {
      execSync('npx thesmos adapters', { stdio: 'inherit', cwd: root });
      console.log('  ✅ Adapter files regenerated\n');
      log.info('self:repair adapters regenerated');
    } catch (e) {
      console.error('  ❌ Adapter regeneration failed:', e instanceof Error ? e.message : String(e));
      log.error('self:repair adapters failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log('  Self-repair complete.\n');
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function cmdSelf(argv: string[]): Promise<void> {
  const subcommand = argv[0];

  switch (subcommand) {
    case 'check':
    case undefined:
      return runSelfCheck(argv.slice(1));

    case 'update':
      return runSelfUpdate(argv.slice(1));

    case 'repair':
      return runSelfRepair(argv.slice(1));

    default:
      console.error(`  Unknown self subcommand: ${subcommand}`);
      console.error('  Usage: thesmos self:check | self:update | self:repair');
      process.exitCode = 1;
  }
}
