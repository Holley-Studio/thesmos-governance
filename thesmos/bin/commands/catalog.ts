/**
 * thesmos catalog:list      — list all agents and skills
 * thesmos catalog:validate  — validate built-in + user catalog frontmatter
 * thesmos catalog:enable    — add an agent/skill ID to .thesmos/registry.json
 * thesmos catalog:disable   — remove an agent/skill ID from .thesmos/registry.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs, flag } from '../lib/args.ts';
import {
  loadBuiltInCatalog,
  loadBuiltInProfiles,
  loadUserCatalog,
  validateCatalog,
  type CatalogEntry,
} from '../../catalog.ts';
import { REGISTRY_PATH } from '../../registry.ts';

type SubCommand = 'list' | 'validate' | 'enable' | 'disable' | 'profiles';

function readRegistry(root: string): Record<string, unknown> {
  const p = join(root, REGISTRY_PATH);
  if (!existsSync(p)) return { rules: ['@thesmos/core'], agents: [], skills: [] };
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
  } catch {
    return { rules: ['@thesmos/core'], agents: [], skills: [] };
  }
}

function writeRegistry(root: string, data: Record<string, unknown>): void {
  writeFileSync(join(root, REGISTRY_PATH), JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function printEntries(entries: CatalogEntry[], label: string, json: boolean): void {
  if (json) return;
  console.log(`\n${label}:`);
  if (entries.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const e of entries) {
    const status = e.frontmatter.enabled ? '●' : '○';
    const src = e.source === 'builtin' ? '' : ' [user]';
    console.log(
      `  ${status}  [${e.frontmatter.id}] ${e.frontmatter.name}${src}  (${e.frontmatter.tags.join(', ')})`
    );
  }
}

export async function cmdCatalog(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { flags, positionals } = parseArgs(argv);
  const json = flag(flags, 'json');

  const sub = (positionals[0] ?? 'list') as SubCommand;

  if (sub === 'list') {
    const builtin = loadBuiltInCatalog();
    const user = loadUserCatalog(root);

    if (json) {
      const out = {
        builtIn: {
          agents: builtin.agents.map((a) => ({ id: a.frontmatter.id, name: a.frontmatter.name })),
          skills: builtin.skills.map((s) => ({ id: s.frontmatter.id, name: s.frontmatter.name })),
        },
        user: {
          agents: user.agents.map((a) => ({ id: a.frontmatter.id, name: a.frontmatter.name })),
          skills: user.skills.map((s) => ({ id: s.frontmatter.id, name: s.frontmatter.name })),
        },
      };
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }

    console.log('Thesmos Catalog');
    console.log(`  Built-in: ${builtin.agents.length} agents, ${builtin.skills.length} skills`);
    console.log(
      `  User:     ${user.agents.length} agents, ${user.skills.length} skills`
    );

    printEntries(builtin.agents, 'Built-in Agents', json);
    printEntries(builtin.skills, 'Built-in Skills', json);
    if (user.agents.length > 0 || user.skills.length > 0) {
      printEntries(user.agents, 'User Agents (.thesmos/agents/)', json);
      printEntries(user.skills, 'User Skills (.thesmos/skills/)', json);
    }
    return;
  }

  if (sub === 'profiles') {
    const profiles = loadBuiltInProfiles();
    if (json) {
      process.stdout.write(JSON.stringify(profiles, null, 2) + '\n');
      return;
    }
    console.log('Built-in Profiles:');
    for (const p of profiles) {
      console.log(
        `  [${p.id}]  ${p.name} — ${p.agents.length} agents, ${p.skills.length} skills`
      );
      console.log(`           ${p.description}`);
    }
    return;
  }

  if (sub === 'validate') {
    const builtin = loadBuiltInCatalog();
    const user = loadUserCatalog(root);

    const agentResult = validateCatalog([...builtin.agents, ...user.agents]);
    const skillResult = validateCatalog([...builtin.skills, ...user.skills]);

    const allValid = agentResult.valid && skillResult.valid;
    const errors = [...agentResult.errors, ...skillResult.errors];

    if (json) {
      process.stdout.write(JSON.stringify({ valid: allValid, errors }, null, 2) + '\n');
      return;
    }

    if (allValid) {
      console.log(
        `catalog:validate — OK (${builtin.agents.length + user.agents.length} agents, ${builtin.skills.length + user.skills.length} skills)`
      );
    } else {
      console.error(`catalog:validate — FAILED (${errors.length} error${errors.length > 1 ? 's' : ''})`);
      for (const err of errors) {
        console.error(`  ✗  ${err}`);
      }
      process.exit(1);
    }
    return;
  }

  if (sub === 'enable' || sub === 'disable') {
    const id = positionals[1];
    const type = (positionals[2] ?? 'agent') as 'agent' | 'skill';

    if (!id) {
      process.stderr.write(`catalog:${sub}: missing <id>\nUsage: thesmos catalog:${sub} <id> [agent|skill]\n`);
      process.exit(1);
    }

    const registry = readRegistry(root);
    const key = type === 'agent' ? 'agents' : 'skills';
    const list = (registry[key] as string[] | undefined) ?? [];

    if (sub === 'enable') {
      if (!list.includes(id)) {
        registry[key] = [...list, id];
        writeRegistry(root, registry);
        console.log(`catalog:enable — added ${type} "${id}" to .thesmos/registry.json`);
      } else {
        console.log(`catalog:enable — ${type} "${id}" is already enabled`);
      }
    } else {
      const updated = list.filter((x) => x !== id);
      if (updated.length < list.length) {
        registry[key] = updated;
        writeRegistry(root, registry);
        console.log(`catalog:disable — removed ${type} "${id}" from .thesmos/registry.json`);
      } else {
        console.log(`catalog:disable — ${type} "${id}" was not enabled`);
      }
    }
    return;
  }

  process.stderr.write(
    `catalog: unknown subcommand "${sub}"\nAvailable: list, profiles, validate, enable, disable\n`
  );
  process.exit(1);
}
