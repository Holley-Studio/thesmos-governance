// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * thesmos adapters — generate AI adapter files from canonical Thesmos rules.
 * Safe to run repeatedly: generated sections are updated, manual content preserved.
 *
 * Flags:
 *   --targets=<csv>   comma-separated adapter targets (default: detected integrations
 *                     + any target with an existing file — see detectAdapterTargets)
 *   --json            output as JSON
 *   --markdown        output as Markdown
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import { existsSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import {
  THESMOS_RULES,
  writeAllAdapters,
  detectAdapterTargets,
  ADAPTER_OUTPUT_PATHS,
  type AdapterTarget,
  type AdapterCatalog,
} from '../../adapters.ts';
import { loadRegistryConfig, mergeRegistryConfig, REGISTRY_DEFAULTS } from '../../registry.ts';
import { getActiveCatalog } from '../../catalog.ts';

const ALL_TARGETS = Object.keys(ADAPTER_OUTPUT_PATHS) as AdapterTarget[];

export async function cmdAdapters(argv: string[]): Promise<void> {
  const { root, config } = createContext();
  const { flags } = parseArgs(argv);
  const json = flag(flags, 'json');
  const markdown = flag(flags, 'markdown');
  const targetsFlag = flagVal(flags, 'targets');

  // No --targets override: regenerate every DETECTED integration, plus any
  // target that already has a file on disk (an adapter written before its
  // integration was detectable, e.g. by hand, must never silently stop being
  // refreshed just because the heuristic doesn't recognize it).
  const targets: AdapterTarget[] = targetsFlag
    ? (targetsFlag.split(',').map((t) => t.trim()).filter((t) => t in ADAPTER_OUTPUT_PATHS) as AdapterTarget[])
    : Array.from(
        new Set([
          ...detectAdapterTargets(root),
          ...ALL_TARGETS.filter((t) => existsSync(pathJoin(root, ADAPTER_OUTPUT_PATHS[t]))),
        ])
      );
  const skipped = targetsFlag ? [] : ALL_TARGETS.filter((t) => !targets.includes(t));

  if (targets.length === 0) {
    process.stderr.write('thesmos adapters: no valid targets specified\n');
    process.exit(1);
  }

  const registryConfig = loadRegistryConfig(root);
  const merged = mergeRegistryConfig(REGISTRY_DEFAULTS, registryConfig);
  const enabledIds = { agents: merged.agents, skills: merged.skills };
  const activeCatalog = getActiveCatalog(root, enabledIds);
  const catalog: AdapterCatalog | undefined =
    activeCatalog.agents.length > 0 || activeCatalog.skills.length > 0
      ? {
          agents: activeCatalog.agents.map((a) => ({ id: a.frontmatter.id, name: a.frontmatter.name })),
          skills: activeCatalog.skills.map((s) => ({ id: s.frontmatter.id, name: s.frontmatter.name })),
          profile: merged.profiles[0],
        }
      : undefined;

  const manifests = writeAllAdapters(root, THESMOS_RULES, config, targets, catalog);
  const failed = manifests.filter((m) => m.status === 'failed');

  if (json) {
    process.stdout.write(
      JSON.stringify({ rules: THESMOS_RULES.length, targets: manifests, skipped }, null, 2) + '\n'
    );
    if (failed.length > 0) process.exitCode = 1;
    return;
  }

  if (markdown) {
    const lines = [`## Thesmos Adapters — ${config.project}\n`];
    lines.push('| Target | Output path | Status |');
    lines.push('|---|---|---|');
    for (const m of manifests) {
      lines.push(`| ${m.target} | \`${m.outputPath}\` | ${m.status}${m.error ? ` — ${m.error}` : ''} |`);
    }
    for (const t of skipped) {
      lines.push(`| ${t} | \`${ADAPTER_OUTPUT_PATHS[t]}\` | skipped (not detected) |`);
    }
    lines.push(`\n_${THESMOS_RULES.length} canonical rules applied to ${manifests.length} adapter${manifests.length === 1 ? '' : 's'}._`);
    process.stdout.write(lines.join('\n') + '\n');
    if (failed.length > 0) process.exitCode = 1;
    return;
  }

  console.log(`Thesmos Adapters — ${config.project}`);
  console.log(`Generating ${targets.length} adapter${targets.length === 1 ? '' : 's'} from ${THESMOS_RULES.length} canonical rules...\n`);
  for (const m of manifests) {
    const icon = m.status === 'generated' ? '✓' : '✗';
    console.log(`  ${icon}  ${m.outputPath}  (${m.target})${m.error ? ` — ${m.error}` : ''}`);
  }
  if (skipped.length > 0) {
    console.log(`\nSkipped (not detected in this repo): ${skipped.map((t) => ADAPTER_OUTPUT_PATHS[t]).join(', ')}`);
    console.log(`  → run with --targets=${skipped.join(',')} to generate them anyway`);
  }
  console.log(`\n${manifests.length} adapter${manifests.length === 1 ? '' : 's'} written. Manual content outside THESMOS:GENERATED markers was preserved.`);
  if (failed.length > 0) {
    console.log(`\n${failed.length} adapter${failed.length === 1 ? '' : 's'} FAILED to write — see errors above.`);
    process.exitCode = 1;
  }
}
