// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos tier — show the active licensing tier and what it unlocks.
 *
 * FREE (Essentials): all BLOCKERs + the AI-code net (VIBE/AI/SLOP).
 * PREMIUM ($24 lifetime): the full 68-god agent pack for every LLM. Every rule is free.
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
      active: THESMOS_RULES.length,
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
    lines.push('🜃 Thesmos — FREE');
    lines.push(`   ALL ${THESMOS_RULES.length} rules active — the complete engine is free. Every framework,`);
    lines.push('   every compliance pack, every BLOCKER. Rules are never paywalled.');
    lines.push('');
    lines.push('   The Full Pantheon — 68 specialist agents orchestrated by Zeus —');
    lines.push(`   is $24, one-time, yours forever:  ${UPGRADE_URL}`);
    lines.push('   Already bought? thesmos pantheon:install --pack <downloaded-zip>');
  }
  process.stdout.write(lines.join('\n') + '\n');
}
