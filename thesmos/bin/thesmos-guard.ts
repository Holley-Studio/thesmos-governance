// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Cross-platform Thesmos guard entrypoint.
 *
 * Source of truth for Claude Code PreToolUse / PostToolUse / Stop hooks.
 * Thin `.sh` / `.cmd` wrappers only forward here — no governance logic in shell.
 *
 * Usage:
 *   node dist/thesmos-guard.js <check|budget-check|drift> [--quiet]
 *
 * Exit codes:
 *   0 — allow / success
 *   2 — block (Claude PreToolUse contract) or failClosed infrastructure failure
 *   1 — drift BLOCKER findings (Stop hook)
 */
import { runPreToolCheck, runPostToolBudgetHook, isFailClosed } from '../claude-govern.js';
import { loadConfig, CONFIG_DEFAULTS, ConfigLoadError } from '../config.js';
import { runDriftForRoot, formatDriftConsole } from '../drift.js';
import {
  resolveGuardEntry,
  writeFailClosedDiagnostic,
} from '../guard-resolve.js';

const SUBCOMMANDS = new Set(['check', 'budget-check', 'drift']);

async function runGuardDrift(root: string, quiet: boolean): Promise<void> {
  let failClosed = isFailClosed(CONFIG_DEFAULTS);
  try {
    const config = loadConfig(root, undefined, { strict: true });
    failClosed = isFailClosed(config);
    const findings = runDriftForRoot(root, config);
    if (!quiet) {
      process.stdout.write(formatDriftConsole(findings, config.project) + '\n');
    }
    if (findings.some((f) => f.severity === 'BLOCKER')) {
      process.exit(1);
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof ConfigLoadError) {
      writeFailClosedDiagnostic({
        what: `Config unreadable or malformed: ${err.configPath}`,
        category: 'internal',
        guardPath: resolveGuardEntry().entryPath,
      });
      process.exit(2);
    }
    if (failClosed) {
      writeFailClosedDiagnostic({
        what: `Drift check failed: ${err instanceof Error ? err.message : String(err)}`,
        category: 'internal',
        guardPath: resolveGuardEntry().entryPath,
      });
      process.exit(2);
    }
    process.exit(0);
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  const subcommand = process.argv[2];
  const rest = process.argv.slice(3);

  if (!subcommand || !SUBCOMMANDS.has(subcommand)) {
    process.stderr.write(
      'Usage: thesmos-guard <check|budget-check|drift> [--quiet]\n',
    );
    process.exit(2);
  }

  if (subcommand === 'check') {
    await runPreToolCheck(root);
    return;
  }
  if (subcommand === 'budget-check') {
    await runPostToolBudgetHook(root);
    return;
  }

  const quiet = rest.includes('--quiet');
  await runGuardDrift(root, quiet);
}

main().catch((err: unknown) => {
  let failClosed = true;
  try {
    failClosed = isFailClosed(loadConfig(process.cwd()));
  } catch {
    // keep secure default
  }
  if (failClosed) {
    writeFailClosedDiagnostic({
      what: `Unexpected guard failure: ${err instanceof Error ? err.message : String(err)}`,
      category: 'internal',
      guardPath: resolveGuardEntry().entryPath,
    });
    process.exit(2);
  }
  process.exit(0);
});
