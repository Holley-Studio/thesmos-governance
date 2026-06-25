// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos profile:* — user-local preference and learning system.
 *
 * Stored at ~/.thesmos/profile.json. Local only, never transmitted.
 *
 * Subcommands:
 *   profile:init                          Create profile with defaults
 *   profile:view                          Show current profile
 *   profile:correct <rule> --severity=X   Override learned severity for a rule
 *   profile:reset                         Reset to defaults (asks for confirmation)
 *   profile:disable <rule>                Add rule to global disabled list
 *   profile:enable <rule>                 Remove rule from global disabled list
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  loadProfile,
  saveProfile,
  getFrequentlyIgnored,
  type UserProfile,
  type ProfileCorrection,
} from '../../profile.ts';
import type { Severity } from '../../types.ts';

const VALID_SEVERITIES = new Set<string>(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'TECH_DEBT']);

function severityLabel(sev: Severity | null): string {
  if (!sev) return '—';
  const colors: Record<Severity, string> = {
    BLOCKER: '🔴',
    HIGH: '🟠',
    MEDIUM: '🟡',
    LOW: '🔵',
    TECH_DEBT: '💡',
  };
  return `${colors[sev]} ${sev}`;
}

// ── profile:init ──────────────────────────────────────────────────────────────

function cmdProfileInit(json: boolean): void {
  const profileFile = join(homedir(), '.thesmos', 'profile.json');
  if (existsSync(profileFile)) {
    if (json) {
      process.stdout.write(JSON.stringify({ status: 'exists', path: profileFile }) + '\n');
    } else {
      console.log(`  Profile already exists at ${profileFile}`);
      console.log(`  Run \`thesmos profile:view\` to inspect it.\n`);
    }
    return;
  }

  const profile = loadProfile(); // returns defaults if missing
  saveProfile(profile);

  if (json) {
    process.stdout.write(JSON.stringify({ status: 'created', path: profileFile }) + '\n');
  } else {
    console.log(`\n  ✅ Profile created at ${profileFile}\n`);
    console.log(`  Defaults:`);
    console.log(`    Severity filter : ${profile.preferences.defaultSeverityFilter}`);
    console.log(`    Verbosity       : ${profile.preferences.verbosity}`);
    console.log(`\n  Run \`thesmos profile:view\` to see the full profile.\n`);
  }
}

// ── profile:view ──────────────────────────────────────────────────────────────

function cmdProfileView(json: boolean): void {
  const profile = loadProfile();

  if (json) {
    process.stdout.write(JSON.stringify(profile, null, 2) + '\n');
    return;
  }

  const profileFile = join(homedir(), '.thesmos', 'profile.json');
  console.log(`\n── Thesmos User Profile ─────────────────────────────────────────`);
  console.log(`   File   : ${profileFile}`);
  console.log(`   Created: ${new Date(profile.createdAt).toLocaleDateString()}`);
  console.log(`   Updated: ${new Date(profile.updatedAt).toLocaleDateString()}`);
  console.log(``);
  console.log(`── Preferences ──────────────────────────────────────────────────`);
  console.log(`   Severity filter : ${profile.preferences.defaultSeverityFilter}`);
  console.log(`   Verbosity       : ${profile.preferences.verbosity}`);
  const disabled = profile.preferences.disabledGlobally;
  console.log(`   Globally off    : ${disabled.length === 0 ? '(none)' : disabled.join(', ')}`);
  console.log(``);

  const learnedEntries = Object.values(profile.learned);
  const frequently = getFrequentlyIgnored();
  console.log(`── Learned Behavior (${learnedEntries.length} rules seen) ─────────────────────`);
  if (learnedEntries.length === 0) {
    console.log(`   (nothing learned yet — suppress rules to teach Thesmos)`);
  } else {
    const sorted = [...learnedEntries].sort((a, b) => b.suppressCount - a.suppressCount);
    for (const e of sorted.slice(0, 10)) {
      const flag = frequently.includes(e.rule) ? '⚠️ frequently ignored' : '';
      const sug = e.suggestedSeverity ? `  → suggest ${severityLabel(e.suggestedSeverity)}` : '';
      console.log(`   ${e.rule.padEnd(40)} × ${String(e.suppressCount).padStart(3)}${sug}  ${flag}`);
    }
    if (sorted.length > 10) console.log(`   … and ${sorted.length - 10} more`);
  }
  console.log(``);

  console.log(`── Corrections (${profile.corrections.length} rules corrected) ──────────────────────`);
  if (profile.corrections.length === 0) {
    console.log(`   (none — run \`thesmos profile:correct <rule> --severity=LOW\` to override)`);
  } else {
    for (const c of profile.corrections.slice(-10)) {
      const date = new Date(c.ts).toLocaleDateString();
      const reason = c.reason ? `  # ${c.reason}` : '';
      console.log(`   ${c.rule.padEnd(40)} → ${severityLabel(c.severity)}  ${date}${reason}`);
    }
  }
  console.log(``);
}

// ── profile:correct ───────────────────────────────────────────────────────────

function cmdProfileCorrect(argv: string[], json: boolean): void {
  const { positionals, flags } = parseArgs(argv);
  const rule = positionals[0];
  const severityRaw = flagVal(flags, 'severity')?.toUpperCase();
  const reason = flagVal(flags, 'reason');

  if (!rule) {
    process.stderr.write('Usage: thesmos profile:correct <rule-id> --severity=<SEVERITY>\n');
    process.exit(1);
  }

  if (!severityRaw || !VALID_SEVERITIES.has(severityRaw)) {
    process.stderr.write(
      `Invalid severity "${severityRaw ?? ''}". Must be one of: BLOCKER HIGH MEDIUM LOW TECH_DEBT\n`,
    );
    process.exit(1);
  }

  const severity = severityRaw as Severity;
  const profile = loadProfile();

  const correction: ProfileCorrection = {
    rule,
    severity,
    ts: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };

  profile.corrections.push(correction);
  saveProfile(profile);

  if (json) {
    process.stdout.write(JSON.stringify({ rule, severity, ts: correction.ts }) + '\n');
  } else {
    console.log(`\n  ✅ Correction saved: ${rule} → ${severityLabel(severity)}\n`);
    if (reason) console.log(`     Reason: ${reason}\n`);
    console.log(`  Run \`thesmos profile:view\` to review all corrections.\n`);
  }
}

// ── profile:disable / profile:enable ─────────────────────────────────────────

function cmdProfileDisable(argv: string[], json: boolean): void {
  const { positionals } = parseArgs(argv);
  const rule = positionals[0];
  if (!rule) {
    process.stderr.write('Usage: thesmos profile:disable <rule-id>\n');
    process.exit(1);
  }

  const profile = loadProfile();
  if (!profile.preferences.disabledGlobally.includes(rule)) {
    profile.preferences.disabledGlobally.push(rule);
    saveProfile(profile);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ rule, disabled: true }) + '\n');
  } else {
    console.log(`\n  ✅ Rule ${rule} globally disabled.\n`);
  }
}

function cmdProfileEnable(argv: string[], json: boolean): void {
  const { positionals } = parseArgs(argv);
  const rule = positionals[0];
  if (!rule) {
    process.stderr.write('Usage: thesmos profile:enable <rule-id>\n');
    process.exit(1);
  }

  const profile = loadProfile();
  profile.preferences.disabledGlobally = profile.preferences.disabledGlobally.filter(
    (r) => r !== rule,
  );
  saveProfile(profile);

  if (json) {
    process.stdout.write(JSON.stringify({ rule, disabled: false }) + '\n');
  } else {
    console.log(`\n  ✅ Rule ${rule} re-enabled globally.\n`);
  }
}

// ── profile:reset ─────────────────────────────────────────────────────────────

function cmdProfileReset(profile: UserProfile, json: boolean): void {
  const fresh: UserProfile = {
    version: 1,
    createdAt: profile.createdAt,
    updatedAt: new Date().toISOString(),
    preferences: {
      defaultSeverityFilter: 'none',
      verbosity: 'normal',
      disabledGlobally: [],
    },
    learned: {},
    corrections: [],
  };
  saveProfile(fresh);

  if (json) {
    process.stdout.write(JSON.stringify({ status: 'reset' }) + '\n');
  } else {
    console.log(`\n  ✅ Profile reset to defaults.\n`);
  }
}

// ── profile:set ───────────────────────────────────────────────────────────────

function cmdProfileSet(argv: string[], json: boolean): void {
  const { flags } = parseArgs(argv);
  const profile = loadProfile();
  let changed = false;

  const verbosity = flagVal(flags, 'verbosity');
  if (verbosity === 'compact' || verbosity === 'normal' || verbosity === 'verbose') {
    profile.preferences.verbosity = verbosity;
    changed = true;
  }

  const filter = flagVal(flags, 'severity-filter')?.toUpperCase();
  if (filter && (VALID_SEVERITIES.has(filter) || filter === 'NONE')) {
    profile.preferences.defaultSeverityFilter = filter === 'NONE' ? 'none' : (filter as Severity);
    changed = true;
  }

  if (!changed) {
    process.stderr.write(
      'Usage: thesmos profile:set [--verbosity=compact|normal|verbose] [--severity-filter=BLOCKER|HIGH|...]\n',
    );
    process.exit(1);
  }

  saveProfile(profile);

  if (json) {
    process.stdout.write(JSON.stringify(profile.preferences) + '\n');
  } else {
    console.log(`\n  ✅ Profile preferences updated.\n`);
  }
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

export async function cmdProfile(subcommand: string, argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');

  switch (subcommand) {
    case 'init':
      cmdProfileInit(json);
      break;

    case 'view':
      cmdProfileView(json);
      break;

    case 'correct':
      cmdProfileCorrect(argv, json);
      break;

    case 'disable':
      cmdProfileDisable(argv, json);
      break;

    case 'enable':
      cmdProfileEnable(argv, json);
      break;

    case 'reset': {
      const profile = loadProfile();
      cmdProfileReset(profile, json);
      break;
    }

    case 'set':
      cmdProfileSet(argv, json);
      break;

    default:
      process.stderr.write(
        `thesmos profile: unknown subcommand "${subcommand}"\n` +
          `  Available: profile:init, profile:view, profile:correct, profile:disable, profile:enable, profile:set, profile:reset\n`,
      );
      process.exit(1);
  }
}
