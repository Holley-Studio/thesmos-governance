// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos scope:* — agent blast radius enforcement.
 *
 * Subcommands:
 *   scope:init     Scaffold .thesmos/scope.json with safe defaults
 *   scope:status   Show current scope configuration
 *   scope:check    Test if a given file path or command would be blocked
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadScopeConfig,
  saveScopeConfig,
  getScopeStatus,
  checkScope,
  SCOPE_DEFAULTS,
} from '../../scope.js';

export async function cmdScope(argv: string[]): Promise<void> {
  const sub = argv[0];
  const root = process.cwd();

  switch (sub) {
    case 'init': {
      const scopePath = join(root, '.thesmos', 'scope.json');
      if (existsSync(scopePath) && !argv.includes('--force')) {
        console.log(`\nScope config already exists: ${scopePath}`);
        console.log('Use --force to overwrite.\n');
        return;
      }

      saveScopeConfig(root, SCOPE_DEFAULTS);
      console.log(`\nThesmos Scope Config created: ${scopePath}\n`);
      console.log('Default configuration:');
      console.log('  ✓ Blocked paths:         node_modules/, .env*, *.pem, *.key');
      console.log('  ✓ Absolute blocked:      /etc/, /usr/, /bin/, /System/');
      console.log('  ✓ File deletion:         blocked');
      console.log('  ✓ git push:              blocked');
      console.log('  ✓ Database writes:       blocked');
      console.log('  ✓ Requires confirmation: git push, npm publish, db migrate');
      console.log('\nEdit .thesmos/scope.json to customize boundaries.\n');
      console.log('Install with: thesmos claude:govern install\n');
      break;
    }

    case 'status': {
      const status = getScopeStatus(root);
      console.log('\nThesmos Agent Scope\n');
      console.log(`  Config file:   ${status.scopeFilePath}`);
      console.log(`  Configured:    ${status.configured ? '✓ yes' : '✗ no (all operations allowed)'}`);
      if (!status.configured) {
        console.log('\n  Run `thesmos scope:init` to create a scope config.\n');
        return;
      }
      const cfg = status.config!;
      console.log('');
      if (cfg.workspace.allowedPaths.length > 0) {
        console.log('  Allowed paths:');
        for (const p of cfg.workspace.allowedPaths) console.log(`    + ${p}`);
      } else {
        console.log('  Allowed paths:  (all paths allowed)');
      }
      console.log('  Blocked paths:');
      for (const p of cfg.workspace.blockedPaths) console.log(`    - ${p}`);
      console.log('  Always-blocked:');
      for (const p of cfg.workspace.absoluteBlockPaths) console.log(`    - ${p}`);
      console.log('');
      console.log(`  File deletion:      ${cfg.operations.allowDelete ? '✓ allowed' : '✗ blocked'}`);
      console.log(`  git push:           ${cfg.operations.allowGitPush ? '✓ allowed' : '✗ blocked'}`);
      console.log(`  Database writes:    ${cfg.operations.allowDatabaseWrites ? '✓ allowed' : '✗ blocked'}`);
      if (cfg.operations.requireConfirmation.length > 0) {
        console.log('  Requires confirmation:');
        for (const p of cfg.operations.requireConfirmation) console.log(`    ⚠ ${p}`);
      }
      if (cfg.destructivePatterns.length > 0) {
        console.log(`  Destructive patterns: ${cfg.destructivePatterns.length} blocked`);
      }
      console.log('');
      break;
    }

    case 'check': {
      const target = argv[1];
      if (!target) {
        console.error('Usage: thesmos scope:check <file-path|command>\n');
        process.exitCode = 1;
        return;
      }

      // Determine if it's a file path or a command
      const isFilePath = !target.startsWith('npm') && !target.startsWith('pip') &&
        !target.startsWith('git') && !target.startsWith('rm') &&
        (target.startsWith('/') || target.startsWith('./') || target.startsWith('../') || target.includes('.'));

      const violation = isFilePath
        ? checkScope({ toolName: 'Write', filePath: target, root })
        : checkScope({ toolName: 'Bash', command: target, root });

      if (!violation) {
        console.log(`\n✓ Allowed: "${target}"\n`);
        return;
      }

      console.log(`\n🛑 Blocked: "${target}"\n`);
      console.log(`  Reason:     ${violation.message}`);
      console.log(`  Suggestion: ${violation.suggestion}\n`);
      process.exitCode = 1;
      break;
    }

    default: {
      console.error(
        'Usage: thesmos scope:<subcommand>\n\n' +
        '  scope:init    Scaffold .thesmos/scope.json with safe defaults\n' +
        '  scope:status  Show current scope boundaries\n' +
        '  scope:check <path|command>  Test if an operation would be blocked\n',
      );
      process.exitCode = 1;
    }
  }
}
