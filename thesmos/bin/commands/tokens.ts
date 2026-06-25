// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos tokens:* — AI token cost reporting and budget management.
 *
 * Subcommands:
 *   tokens:report    Show usage by session/day/project
 *   tokens:reset     Reset session or daily budget counter
 *   tokens:budget    Show or set budget configuration
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  readTokenEvents,
  getCurrentSessionId,
  TOKEN_BUDGET_DEFAULTS,
  type TokenBudgetConfig,
} from '../../token-budget.js';

function loadBudgetConfig(root: string): TokenBudgetConfig {
  try {
    const cfgPath = join(root, '.thesmos', 'config.json');
    if (!existsSync(cfgPath)) return TOKEN_BUDGET_DEFAULTS;
    const raw = JSON.parse(readFileSync(cfgPath, 'utf8')) as { tokenBudget?: Partial<TokenBudgetConfig> };
    return { ...TOKEN_BUDGET_DEFAULTS, ...(raw.tokenBudget ?? {}) };
  } catch {
    return TOKEN_BUDGET_DEFAULTS;
  }
}

export async function cmdTokens(argv: string[]): Promise<void> {
  const sub = argv[0];
  const root = process.cwd();
  const asJson = argv.includes('--json');

  switch (sub) {
    case 'report': {
      const events = readTokenEvents(root);
      const sessionId = getCurrentSessionId(root);
      const todayStr = new Date().toISOString().slice(0, 10);

      const sessionEvents = events.filter((e) => e.sessionId === sessionId);
      const todayEvents   = events.filter((e) => e.ts.startsWith(todayStr));

      const sum = (evts: typeof events) => evts.reduce(
        (acc, e) => ({
          input:  acc.input  + e.inputTokens,
          output: acc.output + e.outputTokens,
          cost:   acc.cost   + e.costUSD,
          calls:  acc.calls  + 1,
        }),
        { input: 0, output: 0, cost: 0, calls: 0 },
      );

      const session = sum(sessionEvents);
      const today   = sum(todayEvents);
      const project = sum(events);

      if (asJson) {
        console.log(JSON.stringify({ sessionId, session, today, project, events }, null, 2));
        return;
      }

      console.log('\nThesmos Token Usage Report\n');
      console.log(`  Session (${sessionId.slice(0, 20)}...)`);
      console.log(`    Calls:   ${session.calls}`);
      console.log(`    Input:   ${session.input.toLocaleString()} tokens`);
      console.log(`    Output:  ${session.output.toLocaleString()} tokens`);
      console.log(`    Cost:    $${session.cost.toFixed(4)}`);
      console.log('');
      console.log(`  Today (${todayStr})`);
      console.log(`    Calls:   ${today.calls}`);
      console.log(`    Cost:    $${today.cost.toFixed(4)}`);
      console.log('');
      console.log('  Project total');
      console.log(`    Calls:   ${project.calls}`);
      console.log(`    Input:   ${project.input.toLocaleString()} tokens`);
      console.log(`    Output:  ${project.output.toLocaleString()} tokens`);
      console.log(`    Cost:    $${project.cost.toFixed(4)}`);
      console.log('');
      break;
    }

    case 'reset': {
      const scope = argv[1];
      if (scope === '--session') {
        const sessionIdFile = join(root, '.thesmos', 'token-session-id');
        if (existsSync(sessionIdFile)) {
          unlinkSync(sessionIdFile);
          console.log('\nSession budget counter reset. A new session ID will be created on next tool call.\n');
        } else {
          console.log('\nNo active session ID found.\n');
        }
      } else if (scope === '--all') {
        const logFile = join(root, '.thesmos', 'token-usage.jsonl');
        if (existsSync(logFile)) {
          unlinkSync(logFile);
          console.log('\nAll token usage logs cleared.\n');
        } else {
          console.log('\nNo token usage log found.\n');
        }
      } else {
        console.error('Usage: thesmos tokens:reset --session | --all\n');
        process.exitCode = 1;
      }
      break;
    }

    case 'budget': {
      const config = loadBudgetConfig(root);
      if (asJson) {
        console.log(JSON.stringify(config, null, 2));
        return;
      }
      console.log('\nThesmos Token Budget Configuration\n');
      console.log(`  Enabled:           ${config.enabled}`);
      console.log(`  Session max cost:  $${config.sessionMaxCostUSD.toFixed(2)}`);
      console.log(`  Session max tokens: ${config.sessionMaxTokens.toLocaleString()}`);
      console.log(`  Daily max cost:    $${config.dailyMaxCostUSD.toFixed(2)}`);
      console.log(`  Project max cost:  $${config.projectMaxCostUSD.toFixed(2)}`);
      console.log(`  Alert at:          ${Math.round(config.alertAt * 100)}%`);
      console.log('');
      console.log('  Model costs (per 1M tokens):');
      for (const [model, costs] of Object.entries(config.modelCostTable)) {
        console.log(`    ${model}: $${costs.inputPer1M} in / $${costs.outputPer1M} out`);
      }
      console.log('');
      console.log('  To enable: add "tokenBudget": { "enabled": true } to .thesmos/config.json\n');
      break;
    }

    default: {
      console.error(
        'Usage: thesmos tokens:<subcommand>\n\n' +
        '  tokens:report          Show usage by session/day/project\n' +
        '  tokens:report --json   Machine-readable output\n' +
        '  tokens:reset --session Reset current session counter\n' +
        '  tokens:reset --all     Clear all token usage logs\n' +
        '  tokens:budget          Show current budget configuration\n',
      );
      process.exitCode = 1;
    }
  }
}
