/**
 * prometheus init — scaffold or update the .prometheus/ governance folder.
 * Safe to run repeatedly: generated sections are overwritten, manual content preserved.
 *
 * Flags:
 *   --dry-run    print what would change without writing
 *   --json       output as JSON
 *   --markdown   output as Markdown
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { writePrometheusDir, type InitFileResult } from '../../init.ts';
import { runScanner } from '../../scanner/index.ts';
import { loadCatalogProfile, loadBuiltInCatalog } from '../../catalog.ts';
import { REGISTRY_PATH } from '../../registry.ts';

export async function cmdInit(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);

  const dryRun = flag(flags, 'dry-run');
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const profileId = flagVal(flags, 'profile');

  // Optional: run a quick scan to populate architecture files.
  // If it fails (e.g. in a temp dir), init still proceeds with placeholders.
  let scan;
  try {
    scan = runScanner(root, config);
  } catch {
    scan = undefined;
  }

  const results = writePrometheusDir(root, config, scan, { dryRun });

  // Apply profile: copy built-in agent/skill files and register IDs
  if (profileId && !dryRun) {
    const profile = loadCatalogProfile(profileId);
    if (!profile) {
      process.stderr.write(`init: unknown profile "${profileId}". Run: prometheus catalog:profiles\n`);
      process.exit(1);
    }

    const builtin = loadBuiltInCatalog();
    const agentMap = new Map(builtin.agents.map((a) => [a.frontmatter.id, a]));
    const skillMap = new Map(builtin.skills.map((s) => [s.frontmatter.id, s]));

    const agentsDir = join(root, '.prometheus', 'agents');
    const skillsDir = join(root, '.prometheus', 'skills');
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
    let registry: Record<string, unknown> = { rules: ['@prometheus/core'], agents: [], skills: [], profiles: [] };
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

  if (json) {
    process.stdout.write(JSON.stringify({ dryRun, results }, null, 2) + '\n');
    return;
  }

  if (markdown) {
    const lines = [`## Prometheus Init${dryRun ? ' (dry run)' : ''}\n`];
    lines.push('| Status | File |');
    lines.push('|---|---|');
    for (const r of results) {
      const status = r.created ? 'created' : r.updated ? 'updated' : 'skipped';
      lines.push(`| ${status} | \`${r.path}\` |`);
    }
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }

  // Console output
  const created = results.filter((r: InitFileResult) => r.created).length;
  const updated = results.filter((r: InitFileResult) => r.updated).length;
  const skipped = results.filter((r: InitFileResult) => r.skipped).length;

  const profileSuffix = profileId ? ` [profile: ${profileId}]` : '';
  console.log(`Prometheus Init${dryRun ? ' (dry run)' : ''}${profileSuffix} — ${config.project}`);
  console.log('');
  for (const r of results) {
    const icon = r.created ? '✓' : r.updated ? '↻' : '–';
    const label = r.created ? 'created' : r.updated ? 'updated' : 'skipped';
    console.log(`  ${icon}  ${r.path}  [${label}]`);
  }
  console.log('');
  console.log(`${results.length} files: ${created} created, ${updated} updated, ${skipped} skipped`);
  if (dryRun) console.log('(dry run — no files written)');
  if (profileId && !dryRun) {
    console.log(`\nProfile "${profileId}" applied — agents and skills copied to .prometheus/`);
    console.log('Run: prometheus catalog:list  to see active agents and skills');
  }
}
