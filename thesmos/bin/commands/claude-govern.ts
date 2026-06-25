// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos claude:govern — install/uninstall/status/check Claude Code governance hooks.
 *
 * Subcommands:
 *   claude:govern install     Write PreToolUse + Stop hooks to .claude/settings.json
 *   claude:govern uninstall   Remove thesmos hooks from .claude/settings.json
 *   claude:govern status      Show current hook installation state
 *   claude:govern check       Internal: run by the PreToolUse hook — reads stdin, exits 0 or 2
 */
import {
  installGovernanceHooks,
  uninstallGovernanceHooks,
  getGovernanceHooksStatus,
  runPreToolCheck,
  runPostToolBudgetHook,
  GOVERNANCE_VERSION,
} from '../../claude-govern.js';

export async function cmdClaudeGovern(argv: string[]): Promise<void> {
  const sub = argv[0];
  const root = process.cwd();

  switch (sub) {
    case 'install': {
      installGovernanceHooks(root);
      const status = getGovernanceHooksStatus(root);
      console.log(`\nThesmos governance hooks installed (v${GOVERNANCE_VERSION})`);
      console.log(`  Settings: ${status.settingsPath}`);
      console.log('\n  PreToolUse (Write)  ✓  blocks BLOCKER violations before writes');
      console.log('  PreToolUse (Edit)   ✓  blocks BLOCKER violations before edits');
      console.log('  PreToolUse (Bash)   ✓  blocks phantom npm/pip installs');
      console.log('  Stop                ✓  checks adapter drift after each session');
      console.log('\nClaude Code Auto Mode is now governed by Thesmos.\n');
      break;
    }

    case 'uninstall': {
      uninstallGovernanceHooks(root);
      console.log('\nThesmos governance hooks removed from .claude/settings.json\n');
      break;
    }

    case 'status': {
      const status = getGovernanceHooksStatus(root);
      console.log('\nThesmos Claude Code Governance\n');
      console.log(`  Settings:           ${status.settingsPath}`);
      console.log(`  Version:            ${status.version ?? 'not installed'}`);
      console.log('');
      console.log(`  PreToolUse (Write): ${status.preToolUseWrite ? '✓ installed' : '✗ missing'}`);
      console.log(`  PreToolUse (Edit):  ${status.preToolUseEdit ? '✓ installed' : '✗ missing'}`);
      console.log(`  PreToolUse (Bash):  ${status.preToolUseBash ? '✓ installed' : '✗ missing'}`);
      console.log(`  Stop (drift):       ${status.stopDrift ? '✓ installed' : '✗ missing'}`);
      console.log('');
      if (status.installed) {
        console.log('  Auto Mode is governed — Thesmos blocks BLOCKER violations and phantom installs in real time.\n');
      } else {
        console.log('  Run `thesmos claude:govern install` to enable Auto Mode governance.\n');
        process.exitCode = 1;
      }
      break;
    }

    case 'check': {
      // Called by Claude Code as a PreToolUse hook — reads stdin, exits 0 or 2
      await runPreToolCheck(root);
      break;
    }

    case 'budget-check': {
      // Called by Claude Code as a PostToolUse hook — reads stdin, logs tokens, exits 0 or 2
      await runPostToolBudgetHook(root);
      break;
    }

    default: {
      console.error(
        'Usage: thesmos claude:govern <install|uninstall|status|check|budget-check>\n\n' +
        '  install       Install governance hooks into .claude/settings.json\n' +
        '  uninstall     Remove governance hooks\n' +
        '  status        Show current hook state\n' +
        '  check         [internal] PreToolUse hook — reads stdin, blocks on violations\n' +
        '  budget-check  [internal] PostToolUse hook — logs token usage, enforces budgets\n',
      );
      process.exitCode = 1;
    }
  }
}
