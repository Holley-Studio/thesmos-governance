// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos tier — show the active licensing tier and what it unlocks.
 *
 * FREE (Essentials): all BLOCKERs + the AI-code net (VIBE/AI/SLOP).
 * PREMIUM ($79 lifetime): the full engine + all Pantheon agents for every LLM.
 *
 * Flags:
 *   --json   machine-readable output
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import { THESMOS_RULES } from '../../rules/registry.ts';
import { partitionByTier } from '../../tiers.ts';

const UPGRADE_URL = 'https://holleystudio.gumroad.com/l/thesmos-pantheon';

export async function cmdTier(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const { config } = createContext();
  const tier = config.tier ?? 'free';
  const { free, premium } = partitionByTier(THESMOS_RULES);

  if (flag(flags, 'json')) {
    process.stdout.write(JSON.stringify({
      tier,
      total: THESMOS_RULES.length,
      free: free.length,
      premium: premium.length,
      active: tier === 'premium' ? THESMOS_RULES.length : free.length,
      upgradeUrl: tier === 'premium' ? null : UPGRADE_URL,
    }, null, 2) + '\n');
    return;
  }

  const lines: string[] = [];
  if (tier === 'premium') {
    lines.push('⚡ Thesmos — PREMIUM (full engine)');
    lines.push(`   ${THESMOS_RULES.length} rules active · all Pantheon agents unlocked.`);
    lines.push('   Thank you — lifetime updates included.');
  } else {
    lines.push('🜃 Thesmos — FREE (Essentials)');
    lines.push(`   ${free.length} rules active: every BLOCKER + the full AI-code safety net.`);
    lines.push(`   ${premium.length} more rules are premium — frameworks, compliance packs,`);
    lines.push('   quality/perf, and all 67 Pantheon agents for every LLM.');
    lines.push('');
    lines.push(`   Unlock everything, once, forever — $79:  ${UPGRADE_URL}`);
    lines.push('   Already bought? Drop your pack in ~/.thesmos/premium/ or set THESMOS_TIER=premium.');
  }
  process.stdout.write(lines.join('\n') + '\n');
}
