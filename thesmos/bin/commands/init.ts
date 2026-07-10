// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos init — scaffold or update the .thesmos/ governance folder.
 * Safe to run repeatedly: generated sections are overwritten, manual content preserved.
 *
 * Flags:
 *   --dry-run       print what would change without writing
 *   --json          output as JSON
 *   --markdown      output as Markdown
 *   --no-adapters   skip AI adapter file generation (CLAUDE.md, GEMINI.md, etc.)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { writeThesmosDir, type InitFileResult } from '../../init.ts';
import { runScanner } from '../../scanner/index.ts';
import { loadCatalogProfile, loadBuiltInCatalog, getActiveCatalog } from '../../catalog.ts';
import { REGISTRY_PATH, loadRegistryConfig, mergeRegistryConfig, REGISTRY_DEFAULTS } from '../../registry.ts';
import { runInteractiveInit } from '../../interactive-init.ts';
import { mythicBanner, formatOracleVerdict } from '../lib/oracle.ts';
import { initFromAiConfig, formatInitFromAiConfigConsole } from '../../ai-lint.ts';
import {
  THESMOS_RULES,
  writeAllAdapters,
  type AdapterCatalog,
  type AdapterManifest,
  type AdapterTarget,
} from '../../adapters.ts';

export async function cmdInit(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);

  const dryRun      = flag(flags, 'dry-run');
  const json        = flag(flags, 'json');
  const markdown    = flag(flags, 'markdown');
  const profileId   = flagVal(flags, 'profile');
  const interactive = flag(flags, 'interactive') || flag(flags, 'i');
  const fromAi     = flag(flags, 'from-ai-config');
  const noAdapters = flag(flags, 'no-adapters');

  // Interactive wizard mode
  if (interactive) {
    await runInteractiveInit(root, config, { dryRun });
    return;
  }

  // --from-ai-config: read existing AI behavior files and generate config
  if (fromAi) {
    const result = initFromAiConfig(root, dryRun);
    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      process.stdout.write(formatInitFromAiConfigConsole(result) + '\n');
    }
    return;
  }

  // Mythic first-run output is TTY-only decoration: piped/CI/json/markdown
  // output stays byte-identical to before.
  const mythic = process.stdout.isTTY === true && !json && !markdown;
  if (mythic) process.stdout.write(mythicBanner() + '\n');

  // Optional: run a quick scan to populate architecture files.
  // If it fails (e.g. in a temp dir), init still proceeds with placeholders.
  let scan;
  try {
    if (mythic) process.stdout.write('  👁 Argus opens his hundred eyes…\n\n');
    scan = runScanner(root, config);
  } catch {
    scan = undefined;
  }

  const results = writeThesmosDir(root, config, scan, { dryRun });

  // Apply profile: copy built-in agent/skill files and register IDs
  if (profileId && !dryRun) {
    const profile = loadCatalogProfile(profileId);
    if (!profile) {
      process.stderr.write(`init: unknown profile "${profileId}". Run: thesmos catalog:profiles\n`);
      process.exit(1);
    }

    const builtin = loadBuiltInCatalog();
    const agentMap = new Map(builtin.agents.map((a) => [a.frontmatter.id, a]));
    const skillMap = new Map(builtin.skills.map((s) => [s.frontmatter.id, s]));

    const agentsDir = join(root, '.thesmos', 'agents');
    const skillsDir = join(root, '.thesmos', 'skills');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(skillsDir, { recursive: true });

    for (const id of profile.agents) {
      const entry = agentMap.get(id);
      if (!entry) continue;
      const dest = join(agentsDir, `${id}.md`);
      if (!existsSync(dest)) writeFileSync(dest, entry.content, 'utf8');
    }

    for (const id of profile.skills) {
      const entry = skillMap.get(id);
      if (!entry) continue;
      const dest = join(skillsDir, `${id}.md`);
      if (!existsSync(dest)) writeFileSync(dest, entry.content, 'utf8');
    }

    // Merge profile IDs into registry.json
    const regPath = join(root, REGISTRY_PATH);
    let registry: Record<string, unknown> = { rules: ['@thesmos/core'], agents: [], skills: [], profiles: [] };
    if (existsSync(regPath)) {
      try { registry = JSON.parse(readFileSync(regPath, 'utf8')) as Record<string, unknown>; } catch { /* keep defaults */ }
    }
    const existingAgents = new Set((registry['agents'] as string[] | undefined) ?? []);
    const existingSkills = new Set((registry['skills'] as string[] | undefined) ?? []);
    const existingProfiles = new Set((registry['profiles'] as string[] | undefined) ?? []);
    for (const id of profile.agents) existingAgents.add(id);
    for (const id of profile.skills) existingSkills.add(id);
    existingProfiles.add(profileId);
    registry['agents'] = [...existingAgents];
    registry['skills'] = [...existingSkills];
    registry['profiles'] = [...existingProfiles];
    writeFileSync(regPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  }

  // Generate AI adapter files by default so a plain `thesmos init` leaves the
  // repo fully wired — no separate `thesmos adapters` step to forget. Opt out
  // with --no-adapters. Targets are DETECTED, not shotgunned: CLAUDE.md +
  // AGENTS.md always (Claude Code is the primary surface; AGENTS.md is the
  // cross-tool convention), other tools only when their footprint already
  // exists in the repo. `thesmos adapters` still generates all targets.
  // Runs after profile application so the registry (and therefore the agent
  // context section) reflects any profile agents/skills just installed.
  let adapterManifests: AdapterManifest[] = [];
  if (!noAdapters && !dryRun) {
    const detected: AdapterTarget[] = ['claude', 'agents'];
    if (existsSync(join(root, 'GEMINI.md'))) detected.push('gemini');
    if (existsSync(join(root, '.cursor')) || existsSync(join(root, '.cursorrules'))) detected.push('cursor');
    if (existsSync(join(root, '.github', 'copilot-instructions.md'))) detected.push('copilot');
    if (existsSync(join(root, '.codex'))) detected.push('codex');

    const registryConfig = loadRegistryConfig(root);
    const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, registryConfig);
    const activeCatalog = getActiveCatalog(root, { agents: merged.agents, skills: merged.skills });
    const catalog: AdapterCatalog | undefined =
      activeCatalog.agents.length > 0 || activeCatalog.skills.length > 0
        ? {
            agents: activeCatalog.agents.map((a) => ({ id: a.frontmatter.id, name: a.frontmatter.name })),
            skills: activeCatalog.skills.map((s) => ({ id: s.frontmatter.id, name: s.frontmatter.name })),
            profile: merged.profiles[0],
          }
        : undefined;
    adapterManifests = writeAllAdapters(root, THESMOS_RULES, config, detected, catalog);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ dryRun, results, adapters: adapterManifests }, null, 2) + '\n');
    return;
  }

  if (markdown) {
    const lines = [`## Thesmos Init${dryRun ? ' (dry run)' : ''}\n`];
    lines.push('| Status | File |');
    lines.push('|---|---|');
    for (const r of results) {
      const status = r.created ? 'created' : r.updated ? 'updated' : 'skipped';
      lines.push(`| ${status} | \`${r.path}\` |`);
    }
    for (const m of adapterManifests) {
      lines.push(`| adapter | \`${m.outputPath}\` |`);
    }
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }

  // Console output
  const created = results.filter((r: InitFileResult) => r.created).length;
  const updated = results.filter((r: InitFileResult) => r.updated).length;
  const skipped = results.filter((r: InitFileResult) => r.skipped).length;

  const profileSuffix = profileId ? ` [profile: ${profileId}]` : '';
  console.log(`Thesmos Init${dryRun ? ' (dry run)' : ''}${profileSuffix} — ${config.project}`);
  console.log('');
  for (const r of results) {
    const icon = r.created ? '✓' : r.updated ? '↻' : '–';
    const label = r.created ? 'created' : r.updated ? 'updated' : 'skipped';
    console.log(`  ${icon}  ${r.path}  [${label}]`);
  }
  console.log('');
  console.log(`${results.length} files: ${created} created, ${updated} updated, ${skipped} skipped`);
  if (adapterManifests.length > 0) {
    console.log('');
    console.log('AI adapter files (skip with --no-adapters):');
    for (const m of adapterManifests) {
      console.log(`  ✓  ${m.outputPath}  [${m.target}]`);
    }
    console.log('');
    console.log('Token budgets are enabled in .thesmos/config.json — run');
    console.log('`thesmos claude:govern install` to enforce them (and BLOCKER gating) in Claude Code.');
  }
  if (dryRun) console.log('(dry run — no files written, adapters skipped)');
  if (profileId && !dryRun) {
    console.log(`\nProfile "${profileId}" applied — agents and skills copied to .thesmos/`);
    console.log('Run: thesmos catalog:list  to see active agents and skills');
  }

  // The oracle verdict — health grade + first labor. Pure decoration: any
  // failure inside degrades to no verdict, never a broken init.
  if (mythic && !dryRun) {
    try {
      const { computeHealthForRoot } = await import('../../health.ts');
      const { runReview } = await import('../../review.ts');
      const health = computeHealthForRoot(root, config);
      const findings = scan ? runReview({ scan, config }) : [];
      const top = findings[0];
      console.log('');
      console.log(formatOracleVerdict({
        grade: health.grade,
        score: health.score,
        topFinding: top ? { severity: top.severity, category: top.category, file: top.file } : undefined,
      }));
    } catch {
      // Verdict is decoration — init must never fail because of it.
    }
  }
}
