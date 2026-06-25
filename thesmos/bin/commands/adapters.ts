/**
 * thesmos adapters — generate AI adapter files from canonical Thesmos rules.
 * Safe to run repeatedly: generated sections are updated, manual content preserved.
 *
 * Flags:
 *   --targets=<csv>   comma-separated adapter targets (default: all)
 *   --json            output as JSON
 *   --markdown        output as Markdown
 */
import { createContext } from '../lib/context.ts';
import { parseArgs, flag, flagVal } from '../lib/args.ts';
import {
  THESMOS_RULES,
  writeAllAdapters,
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

  const targets: AdapterTarget[] = targetsFlag
    ? (targetsFlag.split(',').map((t) => t.trim()).filter((t) => t in ADAPTER_OUTPUT_PATHS) as AdapterTarget[])
    : ALL_TARGETS;

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

  if (json) {
    process.stdout.write(JSON.stringify({ rules: THESMOS_RULES.length, targets: manifests }, null, 2) + '\n');
    return;
  }

  if (markdown) {
    const lines = [`## Thesmos Adapters — ${config.project}\n`];
    lines.push('| Target | Output path | Status |');
    lines.push('|---|---|---|');
    for (const m of manifests) {
      lines.push(`| ${m.target} | \`${m.outputPath}\` | generated |`);
    }
    lines.push(`\n_${THESMOS_RULES.length} canonical rules applied to ${manifests.length} adapter${manifests.length === 1 ? '' : 's'}._`);
    process.stdout.write(lines.join('\n') + '\n');
    return;
  }

  console.log(`Thesmos Adapters — ${config.project}`);
  console.log(`Generating ${targets.length} adapter${targets.length === 1 ? '' : 's'} from ${THESMOS_RULES.length} canonical rules...\n`);
  for (const m of manifests) {
    console.log(`  ✓  ${m.outputPath}  (${m.target})`);
  }
  console.log(`\n${manifests.length} adapter${manifests.length === 1 ? '' : 's'} written. Manual content outside THESMOS:GENERATED markers was preserved.`);
}
