// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos hooks — install/uninstall/status of governance git hooks.
 *
 * Subcommands:
 *   hooks install              Write hooks to .git/hooks/ (local, default)
 *   hooks install --husky      Write hooks to .husky/ (committed, team-wide)
 *   hooks uninstall            Remove thesmos blocks from git hooks
 *   hooks status               Show current hook state
 *
 * Flags:
 *   --base=<ref>    Git base ref for validate hook (default: origin/main)
 *   --dry-run       Preview changes without writing
 *   --json          Machine-readable output
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  installHooks,
  uninstallHooks,
  getHookStatus,
  type HookTarget,
  type HookName,
  type HookResult,
  type HookStatusResult,
} from '../../hooks.ts';

export async function cmdHooks(argv: string[]): Promise<void> {
  const subcommand = argv[0] ?? 'install';
  const rest = argv.slice(1);
  const { root } = createContext();
  const { flags } = parseArgs(rest);

  const target: HookTarget = flag(flags, 'husky') ? 'husky' : 'git';
  const base       = flagVal(flags, 'base') ?? 'origin/main';
  const dryRun     = flag(flags, 'dry-run');
  const json       = flag(flags, 'json');
  const commitMsg  = flag(flags, 'commit-msg');
  const hooks: HookName[] = commitMsg
    ? ['pre-commit', 'pre-push', 'commit-msg']
    : ['pre-commit', 'pre-push'];

  if (subcommand === 'status') {
    const status = getHookStatus(root, target, hooks);
    if (json) {
      process.stdout.write(JSON.stringify(status, null, 2) + '\n');
      return;
    }
    printStatus(status, target);
    return;
  }

  if (subcommand === 'uninstall') {
    let results: HookResult[];
    try {
      results = uninstallHooks(root, { target, hooks, dryRun });
    } catch (err) {
      process.stderr.write(`hooks uninstall: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }

    if (json) {
      process.stdout.write(JSON.stringify({ dryRun, results }, null, 2) + '\n');
      return;
    }
    printResults(results, dryRun, 'Uninstall');
    return;
  }

  // Default: install
  let results: HookResult[];
  try {
    results = installHooks(root, { target, base, hooks, dryRun });
  } catch (err) {
    process.stderr.write(`hooks install: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ dryRun, target, base, results }, null, 2) + '\n');
    return;
  }

  printResults(results, dryRun, 'Install');

  if (!dryRun) {
    const targetLabel = target === 'husky' ? '.husky/' : '.git/hooks/';
    console.log(`\nHooks installed in ${targetLabel}`);
    if (target === 'git') {
      console.log('Note: .git/hooks/ is local-only and not committed to the repo.');
      console.log('      Run with --husky to create committed hooks in .husky/');
    } else {
      console.log('Tip: commit the .husky/ directory so the whole team gets these hooks.');
    }
    console.log('\nTo remove hooks: thesmos hooks uninstall');
  }
}

function printResults(results: HookResult[], dryRun: boolean, label: string): void {
  console.log(`\nThesmos Hooks ${label}${dryRun ? ' (dry run)' : ''}\n`);
  for (const r of results) {
    const icon =
      r.status === 'created'            ? '✓' :
      r.status === 'updated'            ? '↻' :
      r.status === 'already-configured' ? '–' : '·';
    const note =
      r.status === 'already-configured' ? ' (already up to date)' :
      r.status === 'skipped'            ? ' (not found)' : '';
    console.log(`  ${icon}  ${r.hook.padEnd(14)} ${r.path}${note}`);
  }
  if (dryRun) console.log('\n(dry run — no files written)');
}

function printStatus(statuses: HookStatusResult[], target: HookTarget): void {
  const targetLabel = target === 'husky' ? '.husky/' : '.git/hooks/';
  console.log(`\nThesmos Hook Status (${targetLabel})\n`);
  for (const s of statuses) {
    const exists = s.exists ? 'exists' : 'missing';
    const prom   = s.hasThesmos ? '✓ thesmos' : '✗ no thesmos block';
    console.log(`  ${s.hook.padEnd(14)} [${exists}]  ${prom}`);
    console.log(`                 ${s.path}`);
  }
}
