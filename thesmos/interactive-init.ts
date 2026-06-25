/**
 * Interactive wizard for `thesmos init --interactive`.
 *
 * Guides the user through:
 *   1. Detecting and confirming the framework
 *   2. Choosing AI assistant targets (adapter files to generate)
 *   3. Choosing a governance profile
 *   4. Setting the CI severity threshold
 *   5. Scaffolding everything with a tailored config
 *
 * Isolated from interactive.ts (pure prompts) and init.ts (pure file gen).
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ThesmosConfig } from './types.js';
import { runScanner } from './scanner/index.js';
import { writeThesmosDir } from './init.js';
import { writeAllAdapters, THESMOS_RULES } from './adapters.js';
import {
  isTTY,
  confirm,
  select,
  multiSelect,
  type SelectOption,
} from './interactive.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InteractiveInitOptions {
  dryRun?: boolean;
}

type AdapterTarget = 'claude' | 'gemini' | 'cursor' | 'copilot' | 'codex' | 'agents';
type SeverityPreset = 'strict' | 'standard' | 'lenient';
type ProfileId = 'base' | 'web' | 'next-supabase' | 'enterprise';

// ── Wizard ────────────────────────────────────────────────────────────────────

const ADAPTER_OPTIONS: SelectOption<AdapterTarget>[] = [
  { label: 'Claude',   value: 'claude',  description: 'CLAUDE.md' },
  { label: 'Gemini',   value: 'gemini',  description: 'GEMINI.md' },
  { label: 'Cursor',   value: 'cursor',  description: '.cursor/rules/thesmos.mdc' },
  { label: 'Copilot',  value: 'copilot', description: '.github/copilot-instructions.md' },
  { label: 'Codex',    value: 'codex',   description: '.codex/thesmos.md' },
  { label: 'AGENTS.md',value: 'agents',  description: 'AGENTS.md (OpenAI agents, generic)' },
];

const PROFILE_OPTIONS: SelectOption<ProfileId>[] = [
  { label: 'base',           value: 'base',          description: 'Minimal core rules — good starting point' },
  { label: 'web',            value: 'web',            description: 'Frontend + React + TypeScript focus' },
  { label: 'next-supabase',  value: 'next-supabase',  description: 'Next.js + Supabase + auth patterns' },
  { label: 'enterprise',     value: 'enterprise',     description: 'Full rule set — all categories enabled' },
];

const SEVERITY_OPTIONS: SelectOption<SeverityPreset>[] = [
  { label: 'Standard', value: 'standard', description: 'BLOCKER fails CI, HIGH warns (recommended)' },
  { label: 'Strict',   value: 'strict',   description: 'BLOCKER + HIGH fail CI' },
  { label: 'Lenient',  value: 'lenient',  description: 'Only BLOCKER fails CI, everything else advisory' },
];

function severityConfig(preset: SeverityPreset): Pick<ThesmosConfig, 'failOnSeverity' | 'warnOnSeverity'> {
  if (preset === 'strict')  return { failOnSeverity: ['BLOCKER', 'HIGH'], warnOnSeverity: ['MEDIUM'] };
  if (preset === 'lenient') return { failOnSeverity: ['BLOCKER'], warnOnSeverity: [] };
  return { failOnSeverity: ['BLOCKER'], warnOnSeverity: ['HIGH'] };
}

/**
 * Run the interactive init wizard.
 * Falls back to non-interactive defaults when not in a TTY (e.g. CI).
 */
export async function runInteractiveInit(
  root: string,
  config: ThesmosConfig,
  opts: InteractiveInitOptions = {},
): Promise<void> {
  const dryRun = opts.dryRun ?? false;

  if (!isTTY()) {
    process.stderr.write('[thesmos] --interactive requires a TTY. Run in a terminal.\n');
    process.exit(1);
  }

  console.log('\n Thesmos Governance — Setup Wizard\n');
  console.log('This wizard will scaffold your governance folder and generate AI adapter files.');
  console.log('You can re-run at any time — existing manual content is always preserved.\n');

  // ── Step 1: Detect framework ──────────────────────────────────────────────

  let scan;
  try { scan = runScanner(root, config); } catch { scan = undefined; }
  const detected = scan?.detector;

  let projectName = config.project === 'unknown' ? '' : config.project;
  if (!projectName) {
    // Try to read from package.json
    const pkgPath = join(root, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
        projectName = typeof pkg.name === 'string' ? pkg.name : '';
      } catch { /* ignore */ }
    }
  }

  if (projectName) {
    console.log(`Detected project: ${projectName}`);
  }

  if (detected?.framework && detected.framework !== 'unknown') {
    console.log(`Detected framework: ${detected.framework}`);
    const confirmed = await confirm(`Use "${detected.framework}" as your framework?`);
    if (!confirmed) {
      console.log('OK — framework will be detected automatically from your package.json.\n');
    }
  }

  // ── Step 2: AI assistant adapters ────────────────────────────────────────

  const defaultAdapters: number[] = [0, 1, 2]; // claude, gemini, cursor selected by default
  const selectedAdapters = await multiSelect<AdapterTarget>(
    'Which AI assistants do you use? (toggle with numbers, Enter to confirm)',
    ADAPTER_OPTIONS,
    defaultAdapters,
  );

  // ── Step 3: Profile ───────────────────────────────────────────────────────

  const profile = await select<ProfileId>(
    'Choose a governance profile:',
    PROFILE_OPTIONS,
  );

  // ── Step 4: Severity preset ───────────────────────────────────────────────

  const severityPreset = await select<SeverityPreset>(
    'How strict should CI be?',
    SEVERITY_OPTIONS,
  );

  // ── Step 5: Git hooks ─────────────────────────────────────────────────────

  const installHooksChoice = await confirm(
    'Install governance git hooks? (thesmos ci-check on commit, validate on push)',
    false,
  );

  // ── Step 6: Confirm ───────────────────────────────────────────────────────

  console.log('\n Setup summary:');
  console.log(`  Profile:   ${profile}`);
  console.log(`  Severity:  ${severityPreset}`);
  console.log(`  Adapters:  ${selectedAdapters.length ? selectedAdapters.join(', ') : '(none)'}`);
  console.log(`  Hooks:     ${installHooksChoice ? 'yes (.git/hooks/)' : 'no'}`);
  if (dryRun) console.log('  Mode:      dry run');
  console.log('');

  const proceed = await confirm('Proceed?');
  if (!proceed) {
    console.log('Aborted. No files were written.');
    return;
  }

  // ── Execute ───────────────────────────────────────────────────────────────

  const { failOnSeverity, warnOnSeverity } = severityConfig(severityPreset);

  // Build tailored config overlay
  const configOverlay: Partial<ThesmosConfig> = {
    project: projectName || 'my-project',
    failOnSeverity,
    warnOnSeverity,
  };

  const mergedConfig: ThesmosConfig = { ...config, ...configOverlay };

  // Scaffold .thesmos/ folder
  console.log('\n Scaffolding governance folder...');
  const results = writeThesmosDir(root, mergedConfig, scan, { dryRun });
  for (const r of results) {
    const icon  = r.created ? '✓' : r.updated ? '↻' : '–';
    const label = r.created ? 'created' : r.updated ? 'updated' : 'skipped';
    console.log(`  ${icon}  ${r.path}  [${label}]`);
  }

  // Write tailored config.json
  if (!dryRun) {
    const configPath = join(root, '.thesmos', 'config.json');
    const baseConfig = existsSync(configPath)
      ? JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
      : {};
    const finalConfig = {
      $schema: 'node_modules/thesmos-governance/config.schema.json',
      ...baseConfig,
      ...configOverlay,
    };
    mkdirSync(join(root, '.thesmos'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(finalConfig, null, 2) + '\n', 'utf8');
    console.log('  ✓  .thesmos/config.json  [configured]');
  }

  // Generate adapter files
  if (selectedAdapters.length && !dryRun && scan) {
    console.log('\n Generating adapter files...');
    const written = writeAllAdapters(root, THESMOS_RULES, mergedConfig, selectedAdapters);
    for (const w of written) {
      console.log(`  ✓  ${w.outputPath}  [${w.target}]`);
    }
  }

  // Install git hooks
  if (installHooksChoice && !dryRun) {
    console.log('\n Installing git hooks...');
    const { installHooks } = await import('./hooks.js');
    try {
      const hookResults = installHooks(root, { target: 'git', base: 'origin/main' });
      for (const r of hookResults) {
        console.log(`  ✓  ${r.hook}  [${r.status}]`);
      }
    } catch (err) {
      console.warn(`  ⚠  hooks: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Final summary ─────────────────────────────────────────────────────────

  console.log('\n Done!\n');
  console.log('Next steps:');
  if (!scan) {
    console.log('  1. thesmos scan                  — analyse your repo');
  }
  if (!selectedAdapters.length || dryRun) {
    console.log('  1. thesmos adapters              — generate AI instruction files');
  }
  console.log('  2. thesmos review --base=main     — see current findings');
  console.log('  3. thesmos health                 — check governance score');
  if (dryRun) {
    console.log('\n(dry run — no files were written)');
  }
}
