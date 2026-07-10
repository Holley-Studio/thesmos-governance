// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos savings — Credit Guardian month-to-date report.
 * All figures are estimates vs the flagship-model baseline; the ledger at
 * .thesmos/savings.jsonl is user-inspectable JSONL.
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { readSavingsEntries, summarizeSavings } from '../../savings.ts';

const TYPE_LABEL: Record<string, string> = {
  model_tier: 'Model-tier discipline (ran on a cheaper tier)',
  budget_stop: 'Token-budget hard stops',
  context_1m_block: '1M-context configs blocked (AGNT_037)',
};

export async function cmdSavings(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { flags } = parseArgs(argv);
  const entries = readSavingsEntries(root);
  const summary = summarizeSavings(entries, new Date());

  if (flag(flags, 'json')) {
    process.stdout.write(JSON.stringify({ ...summary, totalEntries: entries.length }, null, 2) + '\n');
    return;
  }

  const out: string[] = [];
  out.push('⚖  Credit Guardian — month to date');
  out.push('');
  if (summary.monthEvents === 0) {
    out.push('No savings events recorded yet this month.');
    out.push('Savings accrue as Pantheon Chat turns run on non-flagship models,');
    out.push('budget stops fire, or 1M-context configs are blocked.');
  } else {
    out.push(`Estimated saved: ~$${summary.monthEstUsd.toFixed(2)}   (${summary.monthEvents} events)`);
    out.push('');
    for (const [type, count] of Object.entries(summary.byType)) {
      out.push(`  ${TYPE_LABEL[type] ?? type}: ${count}`);
    }
  }
  out.push('');
  out.push('Estimates are vs the flagship-model baseline (AGNT_031 tier doctrine).');
  out.push(`Ledger: .thesmos/savings.jsonl (${entries.length} entries)`);
  process.stdout.write(out.join('\n') + '\n');
}
