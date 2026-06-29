// Copyright (c) 2026 Holley Studios. All rights reserved.
/**
 * thesmos agent:create <name> — scaffold a new agent file in .thesmos/agents/
 *
 * Usage:
 *   thesmos agent:create "My Custom Agent"
 *   thesmos agent:create my-agent-id "My Custom Agent"
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext } from '../lib/context.ts';
import { parseArgs } from '../lib/args.ts';
import { buildAgentStub } from '../../catalog.ts';

function toKebabCase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export async function cmdAgentCreate(argv: string[]): Promise<void> {
  const { root } = createContext();
  const { positionals } = parseArgs(argv);

  let id: string;
  let name: string;

  if (positionals.length === 0) {
    process.stderr.write(
      'agent:create: missing <name>\nUsage: thesmos agent:create "<Agent Name>"\n'
    );
    process.exit(1);
  }

  if (positionals.length === 1) {
    name = positionals[0];
    id = toKebabCase(name);
  } else {
    id = toKebabCase(positionals[0]);
    name = positionals[1];
  }

  if (!/^[a-z0-9-]+$/.test(id)) {
    process.stderr.write(
      `agent:create: invalid id "${id}" — must be lowercase kebab-case\n`
    );
    process.exit(1);
  }

  const agentsDir = join(root, '.thesmos', 'agents');
  mkdirSync(agentsDir, { recursive: true });

  const filePath = join(agentsDir, `${id}.md`);
  if (existsSync(filePath)) {
    process.stderr.write(
      `agent:create: file already exists: .thesmos/agents/${id}.md\n`
    );
    process.exit(1);
  }

  const content = buildAgentStub(id, name);
  writeFileSync(filePath, content, 'utf8');

  console.log(`agent:create — created .thesmos/agents/${id}.md`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Edit .thesmos/agents/${id}.md with your agent's logic`);
  console.log(`  2. Add "${id}" to .thesmos/registry.json agents array`);
  console.log(`     (or run: thesmos catalog:enable ${id} agent)`);
  console.log('  3. Run: npm run thesmos:adapters  to regenerate adapter files');
}
